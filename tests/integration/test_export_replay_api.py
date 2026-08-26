import asyncio
import json
import time
from pathlib import Path

import httpx
import pytest

from asyncscope import AsyncScope
from asyncscope.export import SCHEMA_VERSION

ROOT = Path(__file__).resolve().parents[2]
EXPORT_PATH = "/__asyncscope__/api/export"
REPLAY_PATH = "/__asyncscope__/api/replay"
EVENTS_PATH = "/__asyncscope__/api/events"
CLEAR_PATH = "/__asyncscope__/api/buffer/clear"


@pytest.fixture
def demo_app():
    from examples.demo import app

    return app


async def _wait_for_loop_blocked(scope, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(event["type"] == "loop.blocked" for event in scope.events):
            return
        await asyncio.sleep(0.01)
    raise AssertionError("heartbeat가 loop 지연을 기록하지 않았다")


def _sse_frames(text: str) -> list[dict[str, str]]:
    frames = []
    for raw_frame in text.strip().split("\n\n"):
        if not raw_frame:
            continue
        frame = {}
        for line in raw_frame.splitlines():
            key, value = line.split(": ", 1)
            frame[key] = value
        frames.append(frame)
    return frames


async def test_export_api_returns_current_buffer_without_tracing_itself(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/quick")
            before = len(scope.events)
            response = await client.get(EXPORT_PATH)
            after = len(scope.events)
    finally:
        scope.uninstall()

    assert response.status_code == 200
    assert after == before, "export 내부 API 호출이 대상 앱 tracing event가 되면 안 된다"

    payload = response.json()
    assert payload["schema_version"] == SCHEMA_VERSION
    assert payload["exported_at"]
    assert payload["buffer"]["events"] == len(scope.events)
    assert [event["sequence"] for event in payload["events"]] == [
        event["sequence"] for event in scope.events
    ]


async def test_replay_api_replaces_buffer_used_by_sse_and_query_apis(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await asyncio.sleep(0.05)
            await client.get("/demo/quick")
            await client.get("/demo/blocking")
            await _wait_for_loop_blocked(scope)
            exported = (await client.get(EXPORT_PATH)).json()

            await client.get("/demo/unknown-await")
            assert len(scope.events) > len(exported["events"])

            before_replay = len(scope.events)
            replayed = await client.post(REPLAY_PATH, json=exported)
            after_replay = len(scope.events)

            sse = await client.get(EVENTS_PATH, params={"once": "true"})
            requests = await client.get("/__asyncscope__/api/requests")
            findings = await client.get("/__asyncscope__/api/findings")
            summary = await client.get("/__asyncscope__/api/summary")
    finally:
        scope.uninstall()

    assert replayed.status_code == 200
    assert after_replay == len(exported["events"])
    assert after_replay < before_replay

    payload = replayed.json()
    assert [event["type"] for event in payload["events"]] == [
        event["type"] for event in exported["events"]
    ]
    assert [event["sequence"] for event in payload["events"]] == list(
        range(1, len(exported["events"]) + 1)
    )

    frames = _sse_frames(sse.text)
    assert [int(frame["id"]) for frame in frames] == list(
        range(1, len(exported["events"]) + 1)
    )

    request_payload = requests.json()
    assert request_payload["total"] == 2
    assert {item["path"] for item in request_payload["items"]} == {
        "/demo/quick",
        "/demo/blocking",
    }

    finding_payload = findings.json()
    assert any(item["type"] == "blocking" for item in finding_payload["items"])

    summary_payload = summary.json()
    assert summary_payload["request_rate_per_second"] is not None
    assert summary_payload["blocking_count"] >= 1
    assert summary_payload["buffer"]["events"] == len(exported["events"])


@pytest.mark.parametrize(
    "payload",
    [
        {"schema_version": "other", "events": []},
        {"schema_version": SCHEMA_VERSION},
        {"schema_version": SCHEMA_VERSION, "events": ["bad"]},
    ],
)
async def test_replay_api_rejects_invalid_payloads(demo_app, payload):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            response = await client.post(REPLAY_PATH, json=payload)
    finally:
        scope.uninstall()

    assert response.status_code == 400
    assert response.json()["error"] == "bad_request"


async def test_export_and_replay_methods_are_limited(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            export_post = await client.post(EXPORT_PATH)
            replay_get = await client.get(REPLAY_PATH)
    finally:
        scope.uninstall()

    assert export_post.status_code == 405
    assert export_post.json()["error"] == "method_not_allowed"
    assert replay_get.status_code == 405
    assert replay_get.json()["error"] == "method_not_allowed"


async def test_clear_api_empties_buffer_and_gaps_a_connected_stream(demo_app):
    """비운 뒤에도 지금부터는 계속 추적한다 — 버퍼만 비고 tracing은 꺼지지 않는다."""
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/quick")
            stale_cursor = (await client.get(EXPORT_PATH)).json()["buffer"]["last_sequence"]

            cleared = await client.post(CLEAR_PATH)
            sse = await client.get(
                EVENTS_PATH, params={"cursor": stale_cursor, "once": "true"}
            )

            await client.get("/demo/quick")
            after = await client.get(EXPORT_PATH)
    finally:
        scope.uninstall()

    assert cleared.status_code == 200
    cleared_payload = cleared.json()
    assert cleared_payload["schema_version"] == SCHEMA_VERSION
    assert cleared_payload["events"] == []
    assert cleared_payload["buffer"]["events"] == 0
    assert cleared_payload["buffer"]["first_sequence"] is None
    assert cleared_payload["buffer"]["last_sequence"] is None

    # 옛 cursor로 붙은 연결은 gap을 받는다. first/last_sequence가 둘 다 없다는 게
    # ring buffer가 밀어낸 것과 통째로 비운 것을 client가 구분하는 신호다.
    frames = _sse_frames(sse.text)
    assert len(frames) == 1
    gap = frames[0]
    assert gap["event"] == "asyncscope.gap"
    gap_data = json.loads(gap["data"])
    assert gap_data["first_sequence"] is None
    assert gap_data["last_sequence"] is None

    # clear가 tracing 자체를 끄지 않는다 — 이후 요청은 새 buffer에 다시 쌓인다.
    assert after.json()["buffer"]["events"] > 0


async def test_clear_api_method_is_limited(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            response = await client.get(CLEAR_PATH)
    finally:
        scope.uninstall()

    assert response.status_code == 405
    assert response.json()["error"] == "method_not_allowed"
