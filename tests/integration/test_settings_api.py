import asyncio
from pathlib import Path

import httpx
import pytest

from asyncscope import AsyncScope

ROOT = Path(__file__).resolve().parents[2]
HEARTBEAT = "asyncscope-heartbeat"


@pytest.fixture
def demo_app():
    from examples.demo import app

    return app


def _heartbeats():
    return [task for task in asyncio.all_tasks() if task.get_name() == HEARTBEAT]


async def test_settings_api_reports_current_state_without_tracing_itself(demo_app):
    scope = AsyncScope(
        demo_app,
        project_root=ROOT,
        buffer_size=10,
        threshold=0.2,
        interval=0.03,
    ).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/quick")
            before = len(scope.events)
            response = await client.get("/__asyncscope__/api/settings")
            after = len(scope.events)
    finally:
        scope.uninstall()

    assert response.status_code == 200
    assert after == before, "내부 API 호출이 대상 앱 tracing event가 되면 안 된다"

    payload = response.json()
    assert payload["tracing"] is True
    assert payload["persisted"] is False
    assert payload["settings"] == {
        "threshold_s": 0.2,
        "interval_s": 0.03,
        "buffer_size": 10,
        "project_root": str(ROOT.resolve()),
    }
    assert payload["pending_restart"] == {}
    assert payload["feedback"] == {"acknowledged": 0, "false_positive": 0}
    assert payload["limits"]["threshold_s"] == {"min": 0.001, "max": 10.0}
    assert payload["limits"]["project_root"] == {
        "must_exist": True,
        "must_be_directory": True,
    }


async def test_settings_patch_live_values_restart_heartbeat(demo_app):
    scope = AsyncScope(
        demo_app,
        project_root=ROOT,
        threshold=0.2,
        interval=0.03,
    ).install()
    try:
        old_heartbeat = _heartbeats()[0]
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            response = await client.patch(
                "/__asyncscope__/api/settings",
                json={"threshold_s": 0.02, "interval_s": 0.02},
            )
            await asyncio.sleep(0.01)

        live_heartbeats = [task for task in _heartbeats() if task is not old_heartbeat]
    finally:
        scope.uninstall()

    assert response.status_code == 200
    assert scope.threshold == 0.02
    assert scope.interval == 0.02
    assert old_heartbeat.cancelled(), "기존 heartbeat가 새 설정으로 교체되어야 한다"
    assert len(live_heartbeats) == 1

    payload = response.json()
    assert payload["settings"]["threshold_s"] == 0.02
    assert payload["settings"]["interval_s"] == 0.02
    assert payload["pending_restart"] == {}


async def test_settings_patch_restart_required_values_are_pending_only(
    demo_app,
    tmp_path,
):
    next_root = tmp_path / "next"
    next_root.mkdir()
    scope = AsyncScope(demo_app, project_root=ROOT, buffer_size=10).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            pending = await client.patch(
                "/__asyncscope__/api/settings",
                json={"buffer_size": 20, "project_root": str(next_root)},
            )
            cleared = await client.patch(
                "/__asyncscope__/api/settings",
                json={"buffer_size": 10, "project_root": str(ROOT)},
            )
    finally:
        scope.uninstall()

    assert pending.status_code == 200
    assert scope.buffer.max_events == 10
    assert Path(scope.project_root).resolve() == ROOT.resolve()

    payload = pending.json()
    assert payload["settings"]["buffer_size"] == 10
    assert payload["settings"]["project_root"] == str(ROOT.resolve())
    assert payload["pending_restart"] == {
        "buffer_size": 20,
        "project_root": str(next_root.resolve()),
    }

    assert cleared.status_code == 200
    assert cleared.json()["pending_restart"] == {}


@pytest.mark.parametrize(
    "json_body",
    [
        {"threshold_s": 0},
        {"interval_s": "slow"},
        {"buffer_size": 0},
        {"project_root": "/definitely/missing/asyncscope/root"},
        {"unknown": True},
    ],
)
async def test_settings_patch_rejects_invalid_json_objects(demo_app, json_body):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            response = await client.patch(
                "/__asyncscope__/api/settings",
                json=json_body,
            )
    finally:
        scope.uninstall()

    assert response.status_code == 400
    assert response.json()["error"] == "bad_request"


async def test_settings_patch_rejects_malformed_or_non_object_body(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            malformed = await client.patch(
                "/__asyncscope__/api/settings",
                content=b"not-json",
            )
            array_payload = await client.patch(
                "/__asyncscope__/api/settings",
                json=[],
            )
    finally:
        scope.uninstall()

    assert malformed.status_code == 400
    assert malformed.json()["error"] == "bad_request"
    assert array_payload.status_code == 400
    assert array_payload.json()["error"] == "bad_request"


async def test_settings_api_only_allows_get_and_patch(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            response = await client.post("/__asyncscope__/api/settings")
    finally:
        scope.uninstall()

    assert response.status_code == 405
    assert response.json()["error"] == "method_not_allowed"
