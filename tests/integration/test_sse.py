import asyncio
import json
import time
from pathlib import Path

import httpx
import pytest

from asyncscope import AsyncScope

ROOT = Path(__file__).resolve().parents[2]
EVENTS_PATH = "/__asyncscope__/api/events"


@pytest.fixture
def demo_app():
    from examples.demo import app

    return app


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


async def test_sse_once_replays_current_buffer_without_tracing_itself(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/quick")
            before = len(scope.events)
            response = await client.get(EVENTS_PATH, params={"once": "true"})
            after = len(scope.events)
    finally:
        scope.uninstall()

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert after == before, "SSE 내부 API 호출이 대상 앱 tracing event가 되면 안 된다"

    frames = _sse_frames(response.text)
    assert [frame["id"] for frame in frames] == [
        str(event["sequence"]) for event in scope.events
    ]
    assert {frame["event"] for frame in frames} == {"asyncscope.event"}


async def test_sse_reconnect_with_cursor_returns_only_newer_events(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/quick")
            cursor = scope.buffer.last_sequence
            await client.get("/demo/unknown-await")
            response = await client.get(
                EVENTS_PATH,
                params={"once": "true", "cursor": str(cursor)},
            )
    finally:
        scope.uninstall()

    frames = _sse_frames(response.text)
    assert frames
    assert all(int(frame["id"]) > cursor for frame in frames)
    assert [int(frame["id"]) for frame in frames] == sorted(
        int(frame["id"]) for frame in frames
    )


async def test_sse_reconnect_uses_last_event_id_header(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/quick")
            cursor = scope.buffer.last_sequence
            await client.get("/demo/unknown-await")
            response = await client.get(
                EVENTS_PATH,
                params={"once": "true"},
                headers={"Last-Event-ID": str(cursor)},
            )
    finally:
        scope.uninstall()

    frames = _sse_frames(response.text)
    assert frames
    assert all(int(frame["id"]) > cursor for frame in frames)


async def test_sse_reports_gap_when_cursor_was_evicted(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT, buffer_size=2).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/quick")
            response = await client.get(
                EVENTS_PATH,
                params={"once": "true", "cursor": "0"},
            )
    finally:
        scope.uninstall()

    frames = _sse_frames(response.text)
    assert len(frames) == 1
    assert frames[0]["event"] == "asyncscope.gap"
    assert '"error":"event_gap"' in frames[0]["data"]
    assert '"cursor":0' in frames[0]["data"]
    assert f'"first_sequence":{scope.buffer.first_sequence}' in frames[0]["data"]


async def test_sse_rejects_invalid_cursor(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            response = await client.get(
                EVENTS_PATH,
                params={"once": "true", "cursor": "not-an-int"},
            )
    finally:
        scope.uninstall()

    assert response.status_code == 400
    assert response.json()["error"] == "bad_request"


# ponytail: streaming 연결을 열지 않는다. 기본 모드는 disconnect까지 도는 무한 loop이라
# ASGITransport로 열면 테스트가 매달린다. 누락·중복이 생길 수 있는 지점은
# `buffer.since(cursor)`와 `buffer.cursor_was_dropped(cursor)` 두 호출이고, 무한 loop도
# 매 tick에 같은 둘을 부른다. once=true + cursor 재연결이 같은 경로를 덮는다.
# 진짜 streaming을 검사해야 하면 uvicorn을 띄우는 e2e로 올린다.


async def test_pause_and_resume_loses_and_duplicates_nothing(demo_app):
    """pause는 수집을 멈추지 않는다. 멈춘 동안 쌓인 것을 이어받을 때 손실도 중복도 없어야 한다."""
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            await client.get("/demo/quick")
            first = await client.get(EVENTS_PATH, params={"once": "true"})
            cursor = scope.buffer.last_sequence

            # pause 중 buffer는 계속 자란다.
            await client.get("/demo/unknown-await")
            await client.get("/demo/non-blocking")

            resumed = await client.get(
                EVENTS_PATH, params={"once": "true", "cursor": str(cursor)}
            )
            expected = [event["sequence"] for event in scope.events]
    finally:
        scope.uninstall()

    before = [int(frame["id"]) for frame in _sse_frames(first.text)]
    after = [int(frame["id"]) for frame in _sse_frames(resumed.text)]

    assert not set(before) & set(after), "같은 event를 두 번 받았다"
    assert before + after == expected, "이어 붙인 결과가 buffer 전체와 다르다"
    assert after == list(range(cursor + 1, expected[-1] + 1)), "빠진 sequence가 있다"


async def test_no_event_is_lost_or_duplicated_across_a_loop_block(demo_app):
    """loop이 300ms 막히는 동안 SSE task도 멈춘다. 풀린 뒤 그 구간을 온전히 받아야 한다."""
    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            # heartbeat가 첫 주기에 들어가기 전에 막으면 잴 지연 자체가 없다.
            await asyncio.sleep(0.05)
            await client.get("/demo/quick")
            cursor = scope.buffer.last_sequence

            await client.get("/demo/blocking")
            await _wait_for_loop_blocked(scope)

            response = await client.get(
                EVENTS_PATH, params={"once": "true", "cursor": str(cursor)}
            )
            missed = [
                event for event in scope.events if event["sequence"] > cursor
            ]
    finally:
        scope.uninstall()

    frames = _sse_frames(response.text)
    ids = [int(frame["id"]) for frame in frames]

    assert {frame["event"] for frame in frames} == {"asyncscope.event"}
    assert ids == [event["sequence"] for event in missed]
    assert len(ids) == len(set(ids)), "중복 event가 있다"
    assert ids == sorted(ids), "순서가 바뀌었다"
    assert any(
        json.loads(frame["data"])["type"] == "loop.blocked" for frame in frames
    ), "막힌 구간이 stream에 없다"


async def test_cursor_from_before_a_replay_gets_a_gap_instead_of_silence(demo_app):
    """replay는 buffer를 덮고 sequence를 1로 되돌린다.

    이전 cursor로 연결하면 since()가 빈 결과라 event frame이 나갈 수 없다. gap frame이
    없으면 client는 끊긴 줄도 모른 채 아무것도 받지 못한다.
    """
    fixture = json.loads(
        (ROOT / "contracts" / "fixtures" / "blocking.json").read_text()
    )
    capture = {"schema_version": fixture["schema_version"], "events": fixture["events"]}

    scope = AsyncScope(demo_app, project_root=ROOT).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            for _ in range(4):
                await client.get("/demo/quick")
            stale_cursor = scope.buffer.last_sequence

            await client.post("/__asyncscope__/api/replay", json=capture)
            assert scope.buffer.last_sequence < stale_cursor

            response = await client.get(
                EVENTS_PATH, params={"once": "true", "cursor": str(stale_cursor)}
            )
    finally:
        scope.uninstall()

    frames = _sse_frames(response.text)
    assert [frame["event"] for frame in frames] == ["asyncscope.gap"]

    gap = json.loads(frames[0]["data"])
    assert gap["error"] == "event_gap"
    assert gap["cursor"] == stale_cursor
    assert gap["last_sequence"] < stale_cursor


async def _wait_for_loop_blocked(scope, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(event["type"] == "loop.blocked" for event in scope.events):
            return
        await asyncio.sleep(0.01)
    raise AssertionError("heartbeat가 loop 지연을 기록하지 않았다")
