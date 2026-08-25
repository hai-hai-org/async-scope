from pathlib import Path

import pytest

from asyncscope import AsyncScope
from asyncscope.analysis import QueryError
from asyncscope.config import (
    MAX_BUFFER_SIZE,
    MAX_INTERVAL_S,
    MAX_THRESHOLD_S,
    MIN_BUFFER_SIZE,
    MIN_INTERVAL_S,
    MIN_THRESHOLD_S,
    FeedbackState,
    apply_settings_patch,
    limits,
    settings_payload,
    validate_patch,
)


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


def test_feedback_records_both_kinds_and_counts_them():
    """같은 finding에 두 kind를 다 표시할 수 있다 — 인지했고 오탐이다."""
    state = FeedbackState()
    assert state.marks("f1") == {"acknowledged": False, "false_positive": False}

    state.record("f1", "acknowledged")
    state.record("f1", "false_positive")
    state.record("f2", "acknowledged")

    assert state.marks("f1") == {"acknowledged": True, "false_positive": True}
    assert state.marks("f2") == {"acknowledged": True, "false_positive": False}
    assert state.marks("missing") == {"acknowledged": False, "false_positive": False}
    assert state.summary() == {"acknowledged": 2, "false_positive": 1}

    # 같은 표시를 두 번 해도 count가 늘지 않는다.
    state.record("f1", "acknowledged")
    assert state.summary()["acknowledged"] == 2


def test_feedback_rejects_an_unknown_kind():
    with pytest.raises(QueryError, match="kind must be one of"):
        FeedbackState().record("f1", "resolved")


@pytest.mark.parametrize(
    ("patch", "message"),
    [
        ({"threshold_s": 10.1}, "threshold_s"),
        ({"interval_s": 10.1}, "interval_s"),
        ({"buffer_size": 100_001}, "buffer_size"),
    ],
)
def test_validate_patch_rejects_values_above_the_maximum(patch, message):
    """기존 목록은 전부 하한·타입 쪽이었다. 상한이 실제로 막히는지 본다."""
    with pytest.raises(QueryError, match=message):
        validate_patch(patch)


def test_validate_patch_accepts_the_exact_boundaries():
    """경계에서 거부하면 UI가 limits로 만든 form이 서버에 막힌다."""
    accepted = validate_patch(
        {
            "threshold_s": MAX_THRESHOLD_S,
            "interval_s": MIN_INTERVAL_S,
            "buffer_size": MAX_BUFFER_SIZE,
        }
    )

    assert accepted == {
        "threshold_s": MAX_THRESHOLD_S,
        "interval_s": MIN_INTERVAL_S,
        "buffer_size": MAX_BUFFER_SIZE,
    }
    assert validate_patch({"buffer_size": MIN_BUFFER_SIZE})["buffer_size"] == MIN_BUFFER_SIZE
    assert validate_patch({"threshold_s": MIN_THRESHOLD_S})["threshold_s"] == MIN_THRESHOLD_S


@pytest.mark.parametrize("value", ["pyproject.toml", "", "   ", 42, None])
def test_validate_patch_rejects_a_project_root_that_is_not_a_directory(value):
    with pytest.raises(QueryError, match="project_root"):
        validate_patch({"project_root": value})


def test_limits_matches_the_values_the_server_actually_enforces():
    """UI가 limits로 form을 만든다. 손으로 고친 limits가 상수와 어긋나면 form이 거짓말을 한다."""
    reported = limits()

    assert reported["threshold_s"] == {"min": MIN_THRESHOLD_S, "max": MAX_THRESHOLD_S}
    assert reported["interval_s"] == {"min": MIN_INTERVAL_S, "max": MAX_INTERVAL_S}
    assert reported["buffer_size"] == {"min": MIN_BUFFER_SIZE, "max": MAX_BUFFER_SIZE}

    for field, bounds in reported.items():
        if "max" not in bounds:
            continue
        validate_patch({field: bounds["min"]})
        validate_patch({field: bounds["max"]})
        with pytest.raises(QueryError):
            validate_patch({field: bounds["max"] * 2})
