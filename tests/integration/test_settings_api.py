import asyncio
import time
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


async def _wait_for_loop_blocked(scope, timeout: float = 2.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(event["type"] == "loop.blocked" for event in scope.events):
            return True
        await asyncio.sleep(0.01)
    return False


async def test_new_threshold_actually_changes_the_blocking_verdict(demo_app):
    """설정 숫자만 바뀌고 수집은 옛 값으로 도는 회귀를 잡는다.

    z의 테스트는 scope.threshold와 새 heartbeat Task까지 본다. 그 값으로 판정이 달라지는지는
    아무도 확인하지 않았다.
    """
    scope = AsyncScope(demo_app, project_root=ROOT, threshold=1.0).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            # heartbeat가 첫 주기에 들어가기 전에 막으면 잴 지연 자체가 없다.
            await asyncio.sleep(0.05)
            await client.get("/demo/blocking")
            detected_at_1s = await _wait_for_loop_blocked(scope, timeout=0.5)

            patched = await client.patch(
                "/__asyncscope__/api/settings", json={"threshold_s": 0.05}
            )
            await asyncio.sleep(0.05)  # 교체된 heartbeat가 첫 주기에 들어간다

            await client.get("/demo/blocking")
            detected_at_50ms = await _wait_for_loop_blocked(scope)

            summary = (await client.get("/__asyncscope__/api/summary")).json()
        blocked = [event for event in scope.events if event["type"] == "loop.blocked"]
    finally:
        scope.uninstall()

    assert patched.status_code == 200
    assert not detected_at_1s, "1초 threshold를 300ms 블록이 넘어서는 안 된다"
    assert detected_at_50ms, "낮춘 threshold가 수집에 반영되지 않았다"

    # 새 값이 이벤트에 실렸다는 직접 증거.
    assert blocked
    assert {event["threshold_ns"] for event in blocked} == {50_000_000}
    assert summary["loop_delay"]["threshold_ns"] == 50_000_000


async def test_pending_project_root_does_not_widen_the_source_sandbox(demo_app, tmp_path):
    """PATCH 한 번으로 sandbox가 넓어지면 보안 경계가 무너진다.

    restart-required는 "지금은 안 바뀐다"는 뜻이고, 실제 경계는 GET /api/source가 쓰는 값이다.
    """
    (tmp_path / "outside.py").write_text("SECRET = 1\n")

    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            before = await client.get(
                "/__asyncscope__/api/source", params={"file": "outside.py", "line": 1}
            )
            patched = await client.patch(
                "/__asyncscope__/api/settings", json={"project_root": str(tmp_path)}
            )
            after = await client.get(
                "/__asyncscope__/api/source", params={"file": "outside.py", "line": 1}
            )
            inside = await client.get(
                "/__asyncscope__/api/source",
                params={"file": "examples/demo.py", "line": 1},
            )
    finally:
        scope.uninstall()

    assert patched.status_code == 200
    assert patched.json()["pending_restart"]["project_root"] == str(tmp_path.resolve())
    # pending일 뿐 live root는 그대로다.
    assert patched.json()["settings"]["project_root"] == str(ROOT.resolve())
    assert Path(scope.project_root).resolve() == ROOT.resolve()

    assert before.status_code == 404, "저장소 안에 outside.py가 있으면 검사가 공허하다"
    assert after.status_code == 404, "pending root가 sandbox를 넓혔다"
    assert inside.status_code == 200


@pytest.mark.parametrize(
    "json_body",
    [
        {"threshold_s": 10.1},
        {"interval_s": 10.1},
        {"buffer_size": 100_001},
        {"project_root": "pyproject.toml"},  # 존재하지만 디렉터리가 아니다
        {"project_root": "   "},
    ],
)
async def test_settings_patch_rejects_values_above_the_limits(demo_app, json_body):
    """z의 목록은 전부 하한·타입 쪽이었다. 상한과 잘못된 root 종류를 채운다."""
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            response = await client.patch(
                "/__asyncscope__/api/settings", json=json_body
            )
            settings = (await client.get("/__asyncscope__/api/settings")).json()
    finally:
        scope.uninstall()

    assert response.status_code == 400
    assert response.json()["error"] == "bad_request"
    # 거부된 값이 pending에도 남지 않는다.
    assert settings["pending_restart"] == {}
