"""demo route 전부를 한 번에 돌리는 회귀.

개별 회귀(오버헤드, tracing off, source 경계, hook cleanup)는 각자 자리에 있다. 여기서
보는 건 "모든 route를 한 번에 돌렸을 때 수집 결과가 공개 계약을 지키는가"다. fixture가
아니라 실제 collector 출력에 같은 검사를 건다.
"""

import asyncio
import json
import time
from pathlib import Path

import httpx
import pytest

from asyncscope import AsyncScope
from asyncscope.analysis.requests import query_requests

# fixture와 실제 수집 결과가 같은 검사를 통과해야 한다. 검사는 저기 한 곳에만 있다.
from tests.test_contract_fixtures import FORBIDDEN_KEYS, assert_normalized

ROOT = Path(__file__).resolve().parents[2]

ROUTES = [
    ("GET", "/demo/quick"),
    ("GET", "/demo/non-blocking"),
    ("GET", "/demo/unknown-await"),
    ("GET", "/demo/adapters"),
    ("GET", "/demo/failure"),
    ("GET", "/demo/long-running"),
    ("POST", "/demo/background"),
    ("POST", "/demo/background-cancel"),
    ("GET", "/demo/blocking"),  # loop을 막으므로 마지막에 둔다
]


async def _drive_demo():
    from examples.demo import app

    # 9개 route의 이벤트가 ring buffer에서 밀리면 request가 목록에서 통째로 사라진다.
    scope = AsyncScope(app, project_root=ROOT, buffer_size=5000).install()
    try:
        transport = httpx.ASGITransport(app=scope)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
            # heartbeat가 첫 주기에 들어가기 전에 막으면 잴 지연 자체가 없다.
            await asyncio.sleep(0.05)
            for method, path in ROUTES:
                await client.request(method, path)
            await _wait_for_loop_blocked(scope)
        events = list(scope.events)
    finally:
        scope.uninstall()

    # 끈 뒤에는 아무것도 더 들어오지 않아야 한다.
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=scope), base_url="http://t"
    ) as client:
        await client.get("/demo/quick")
    return events, len(scope.events)


async def _wait_for_loop_blocked(scope, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(event["type"] == "loop.blocked" for event in scope.events):
            return
        await asyncio.sleep(0.01)
    raise AssertionError("heartbeat가 loop 지연을 기록하지 않았다")


@pytest.fixture(scope="module")
def captured():
    """demo를 한 번만 돌린다. /demo/long-running이 1초를 쓴다."""
    return asyncio.run(_drive_demo())


@pytest.fixture(scope="module")
def events(captured):
    return captured[0]


def _by_request(events):
    grouped = {}
    for event in events:
        if event.get("request_id") is not None:
            grouped.setdefault(event["request_id"], []).append(event)
    return grouped


def _request_events(events, path):
    starts = [
        event
        for event in events
        if event["type"] == "request.start" and event.get("path") == path
    ]
    assert starts, f"{path} 요청이 수집되지 않았다"
    request_id = starts[0]["request_id"]
    return [event for event in events if event.get("request_id") == request_id]


def test_every_collected_event_satisfies_the_public_contract(events):
    assert events

    previous_ts = 0
    for event in events:
        assert_normalized(event)
        assert event["timestamp_ns"] >= previous_ts, event
        previous_ts = event["timestamp_ns"]


def test_no_sensitive_value_or_absolute_path_is_collected(events):
    """민감 값 미수집 경계. demo가 통째로 돌아도 새면 안 된다."""
    for event in events:
        assert FORBIDDEN_KEYS.isdisjoint(event), event
        source = event["source"]
        if source is not None:
            assert not source["file"].startswith("/"), event
            assert ".." not in Path(source["file"]).parts, event

    # path는 기록하지만 query string은 기록하지 않는다.
    assert all("?" not in event["path"] for event in events if event["type"] == "request.start")


def test_every_request_starts_and_ends_in_order(events):
    """request.end 뒤에 오는 건 request보다 오래 사는 background Task뿐이다.

    handler가 만든 Task는 contextvar를 물려받아 같은 request_id를 갖는다. 그래서 request가
    끝난 뒤에도 그 id로 이벤트가 더 나온다 — 계약대로다.
    """
    for request_id, request_events in _by_request(events).items():
        types = [event["type"] for event in request_events]
        assert types[0] == "request.start", (request_id, types)
        assert types.count("request.end") == 1, (request_id, types)

        end_index = types.index("request.end")
        end = request_events[end_index]
        if end["status_code"] is not None:
            assert "response.start" in types[:end_index], (request_id, types)

        for event_type in types[end_index + 1 :]:
            assert event_type.startswith(("task.", "coroutine.")), (request_id, types)


def test_each_demo_route_produces_its_anchor_event(events):
    """route가 무엇을 증명하려고 있는지 — 그 이벤트가 실제로 나오는지 본다."""
    blocking = _request_events(events, "/demo/blocking")
    assert any(event["type"] == "loop.blocked" for event in events)
    assert blocking[-1]["status"] == "completed"

    unknown = _request_events(events, "/demo/unknown-await")
    assert any(
        event.get("label") == "unknown await" and event.get("library") is None
        for event in unknown
    )

    failure = _request_events(events, "/demo/failure")
    assert failure[-1]["status"] == "failed"
    assert failure[-1]["status_code"] == 500

    cancel = _request_events(events, "/demo/background-cancel")
    assert any(event["type"] == "task.cancel" for event in cancel)

    background = _request_events(events, "/demo/background")
    assert any(event["type"] == "task.start" for event in background)

    non_blocking = _request_events(events, "/demo/non-blocking")
    assert any(event["type"] == "coroutine.suspend" for event in non_blocking)
    assert any(event["type"] == "coroutine.resume" for event in non_blocking)


def test_loop_delay_is_inferred_and_never_names_a_culprit(events):
    """collector는 heartbeat 타이밍만으로 범인을 지목하지 않는다."""
    blocked = [event for event in events if event["type"] == "loop.blocked"]

    assert blocked
    for event in blocked:
        assert event["evidence"] == "inferred", event
        assert event["request_id"] is None, event
        assert event["source"] is None, event
        assert "suspect" not in event, event


def test_every_demo_request_reaches_the_query_api(events):
    result = query_requests(events, page_size=200)

    assert result["total"] == len(ROUTES)
    assert {item["path"] for item in result["items"]} == {path for _method, path in ROUTES}
    assert all(item["duration_ns"] is not None for item in result["items"])


def test_uninstall_stops_collection(captured):
    events, after_uninstall = captured

    assert after_uninstall == len(events)


def test_demo_events_match_the_m0_scenario_fixtures(events):
    """계약 fixture가 약속한 값을 실제 수집이 낸다."""
    fixture_dir = ROOT / "contracts" / "fixtures"
    blocking_fixture = json.loads((fixture_dir / "blocking.json").read_text())

    fixture_blocked = next(
        event for event in blocking_fixture["events"] if event["type"] == "loop.blocked"
    )
    collected_blocked = next(event for event in events if event["type"] == "loop.blocked")

    for field in ("evidence", "confidence", "category", "label"):
        assert collected_blocked[field] == fixture_blocked[field], field
