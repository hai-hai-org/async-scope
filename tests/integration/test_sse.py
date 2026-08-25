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
