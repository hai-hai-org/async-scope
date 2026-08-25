from pathlib import Path

import pytest

from asyncscope import AsyncScope
from asyncscope.analysis import QueryError
from asyncscope.config import apply_settings_patch, settings_payload, validate_patch


def _app():
    async def app(_scope, _receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    return app


def test_settings_payload_reports_current_runtime_state(tmp_path):
    scope = AsyncScope(
        _app(),
        project_root=tmp_path,
        buffer_size=10,
        threshold=0.2,
        interval=0.03,
    )

    payload = settings_payload(scope)

    assert payload["tracing"] is False
    assert payload["persisted"] is False
    assert payload["settings"] == {
        "threshold_s": 0.2,
        "interval_s": 0.03,
        "buffer_size": 10,
        "project_root": str(tmp_path.resolve()),
    }
    assert payload["pending_restart"] == {}
    assert payload["feedback"] == {"acknowledged": 0, "false_positive": 0}
    assert payload["limits"]["project_root"]["must_exist"]


def test_apply_settings_patch_splits_live_and_restart_required_values(tmp_path):
    scope = AsyncScope(_app(), project_root=tmp_path, buffer_size=10)
    next_root = tmp_path / "next"
    next_root.mkdir()

    payload = apply_settings_patch(
        scope,
        {
            "threshold_s": 0.1,
            "interval_s": 0.02,
            "buffer_size": 20,
            "project_root": str(next_root),
        },
    )

    assert scope.threshold == 0.1
    assert scope.interval == 0.02
    assert scope.buffer.max_events == 10
    assert Path(scope.project_root).resolve() == tmp_path.resolve()
    assert payload["settings"]["buffer_size"] == 10
    assert payload["pending_restart"] == {
        "buffer_size": 20,
        "project_root": str(next_root.resolve()),
    }


def test_pending_restart_clears_when_value_matches_current(tmp_path):
    scope = AsyncScope(_app(), project_root=tmp_path, buffer_size=10)

    apply_settings_patch(scope, {"buffer_size": 20})
    payload = apply_settings_patch(scope, {"buffer_size": 10})

    assert payload["pending_restart"] == {}


def test_validate_patch_rejects_non_object_payload():
    with pytest.raises(QueryError, match="settings payload must be an object"):
        validate_patch([])


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"threshold_s": 0}, "threshold_s must be between"),
        ({"interval_s": "slow"}, "interval_s must be a number"),
        ({"buffer_size": 1.5}, "buffer_size must be an integer"),
        ({"buffer_size": 100_001}, "buffer_size must be between"),
        ({"project_root": ""}, "project_root must be a non-empty string"),
        ({"unknown": True}, "unsupported setting"),
    ],
)
def test_validate_patch_rejects_invalid_values(patch, message):
    with pytest.raises(QueryError, match=message):
        validate_patch(patch)


def test_validate_patch_rejects_missing_project_root(tmp_path):
    with pytest.raises(QueryError, match="existing directory"):
        validate_patch({"project_root": str(tmp_path / "missing")})
