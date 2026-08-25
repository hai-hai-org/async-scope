import json
from pathlib import Path

import pytest

from asyncscope.analysis.requests import (
    RequestQueryError,
    get_request_detail,
    query_requests,
)
from asyncscope.storage import EventBuffer

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"


def _events(*names):
    events = []
    for name in names:
        fixture = json.loads((FIXTURE_DIR / f"{name}.json").read_text())
        events.extend(fixture["events"])
    return events


def test_request_summaries_include_lifecycle_counts_and_response_start():
    result = query_requests(_events("timeline"), page_size=10)

    assert result["total"] == 2
    assert [item["request_id"] for item in result["items"]] == ["req-2", "req-1"]

    req_1 = next(item for item in result["items"] if item["request_id"] == "req-1")
    assert req_1["method"] == "GET"
    assert req_1["path"] == "/demo/non-blocking"
    assert req_1["status"] == "completed"
    assert req_1["status_code"] == 200
    assert req_1["started_at_ns"] == 1000000000
    assert req_1["ended_at_ns"] == 1057000000
    assert req_1["duration_ns"] == 57000000
    assert req_1["response_started_at_ns"] == 1056500000
    assert req_1["event_count"] == 9
    assert req_1["span_count"] == 2
    assert req_1["task_count"] == 1


def test_query_requests_search_filter_sort_and_paginate():
    events = _events("timeline", "blocking", "unknown-await", "adapter-awaits")

    searched = query_requests(events, search="redis")
    assert searched["total"] == 1
    assert searched["items"][0]["request_id"] == "req-adapters"
    assert searched["items"][0]["libraries"] == [
        "asyncpg",
        "httpx",
        "redis.asyncio",
        "websockets",
    ]

    filtered = query_requests(events, status="completed", path="/demo/quick")
    assert [item["request_id"] for item in filtered["items"]] == ["req-quick"]

    paged = query_requests(
        events,
        sort="started_at_ns",
        order="asc",
        page=2,
        page_size=2,
    )
    assert paged["total"] == 6
    assert paged["has_next"]
    assert [item["request_id"] for item in paged["items"]] == [
        "req-blocking",
        "req-quick",
    ]


def test_query_requests_reports_running_request():
    result = query_requests(
        [
            {
                "type": "request.start",
                "timestamp_ns": 1,
                "request_id": "req-live",
                "method": "GET",
                "path": "/live",
            }
        ]
    )

    item = result["items"][0]
    assert item["status"] == "running"
    assert item["status_code"] is None
    assert item["ended_at_ns"] is None
    assert item["duration_ns"] is None
    assert item["event_count"] == 1


def test_get_request_detail_returns_summary_and_request_events_only():
    detail = get_request_detail(_events("timeline"), "req-1")

    assert detail is not None
    assert detail["request"]["request_id"] == "req-1"
    assert detail["request"]["event_count"] == len(detail["events"])
    assert all(event["request_id"] == "req-1" for event in detail["events"])
    assert [event["type"] for event in detail["events"]][-1] == "request.end"

    assert get_request_detail(_events("timeline"), "missing") is None


def test_query_requests_marks_unknown_await_and_overlapping_loop_delay():
    """loop.blocked는 request_id가 없다. window가 겹치는 request에만 붙어야 한다."""
    result = query_requests(_events("blocking", "unknown-await"), page_size=10)
    by_id = {item["request_id"]: item for item in result["items"]}

    assert by_id["req-unknown"]["has_unknown_await"]
    assert by_id["req-blocking"]["has_blocking"]
    # 지연이 끝난 뒤에 시작한 request까지 blocking으로 물들이지 않는다.
    assert not by_id["req-quick"]["has_blocking"]


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"sort": "sequence"}, "unsupported sort"),
        ({"order": "sideways"}, "unsupported order"),
        ({"page": 0}, "page must be >= 1"),
        ({"page_size": 201}, "page_size must be <="),
    ],
)
def test_query_requests_rejects_invalid_parameters(kwargs, message):
    with pytest.raises(RequestQueryError, match=message):
        query_requests(_events("timeline"), **kwargs)


def test_request_detail_time_distribution_accounts_for_every_nanosecond():
    """Day 9 완료 조건. 합을 duration에 맞추되 설명 못 한 시간은 unattributed로 남긴다."""
    detail = get_request_detail(_events("timeline"), "req-1")
    distribution = detail["time_distribution"]
    buckets = distribution["buckets"]

    assert distribution["complete"]
    assert sum(buckets.values()) == distribution["measured_ns"]
    assert all(value >= 0 for value in buckets.values())

    # asyncio.sleep(0.05)이 waiting으로 잡히고, 억지로 0을 만들지 않는다.
    assert buckets["waiting"] > buckets["running"]
    assert buckets["unattributed"] > 0


def test_request_detail_matches_the_expected_geometry_fixture():
    """timeline.json의 expected가 UI 좌표 계약이다. 여기서 어긋나면 z의 Timeline이 틀어진다."""
    fixture = json.loads((FIXTURE_DIR / "timeline.json").read_text())

    for request_id, geometry in fixture["expected"].items():
        detail = get_request_detail(fixture["events"], request_id)
        distribution = detail["time_distribution"]

        assert distribution["duration_ns"] == geometry["duration_ns"], request_id
        assert distribution["measured_ns"] == geometry["measured_ns"], request_id
        assert distribution["buckets"] == geometry["buckets"], request_id

        origin = detail["request"]["started_at_ns"]
        assert _geometry(detail["spans"], origin) == geometry["spans"], request_id


def _geometry(spans, origin):
    return [
        {
            "span_id": span["span_id"],
            "parent_span_id": span["parent_span_id"],
            "offset_ns": span["started_at_ns"] - origin,
            "duration_ns": span["duration_ns"],
            "wait_ns": span["wait_ns"],
            "children": _geometry(span["children"], origin),
        }
        for span in spans
    ]


def test_request_detail_attributes_loop_delay_to_the_overlapping_request():
    """loop.blocked는 request_id가 없으므로 window 겹침으로만 붙일 수 있다."""
    blocked = get_request_detail(_events("blocking"), "req-blocking")
    after = get_request_detail(_events("blocking"), "req-quick")

    assert blocked["time_distribution"]["buckets"]["blocking"] == 300000000
    assert blocked["request"]["has_blocking"]
    assert after["time_distribution"]["buckets"]["blocking"] == 0
    assert not after["request"]["has_blocking"]


def test_request_detail_span_tree_follows_the_await_chain():
    detail = get_request_detail(_events("timeline"), "req-1")

    assert len(detail["spans"]) == 1
    handler = detail["spans"][0]
    assert handler["span_id"] == "span-req-1-handler"
    assert handler["parent_span_id"] is None
    assert handler["duration_ns"] == 55000000
    assert not handler["truncated"]

    assert [child["span_id"] for child in handler["children"]] == ["span-req-1-step"]
    step = handler["children"][0]
    assert step["source"]["function"] == "_step"
    assert step["wait_ns"] == 51000000
    assert step["duration_ns"] == 53000000


def test_span_without_a_start_event_is_marked_truncated():
    """ring buffer가 앞부분을 버리면 parent 없는 조각만 남는다. 조용히 빠뜨리지 않는다."""
    detail = get_request_detail(
        [
            {
                "type": "request.start",
                "timestamp_ns": 10,
                "request_id": "req-cut",
                "method": "GET",
                "path": "/cut",
            },
            {
                "type": "coroutine.end",
                "timestamp_ns": 20,
                "request_id": "req-cut",
                "span_id": "span-cut",
                "parent_span_id": "span-evicted",
                "duration_ns": 5,
                "category": "running",
                "label": "handler()",
            },
        ],
        "req-cut",
    )

    assert [span["span_id"] for span in detail["spans"]] == ["span-cut"]
    assert detail["spans"][0]["truncated"]


STRESS_REQUESTS = 1000


def _stress_events(count=STRESS_REQUESTS):
    """1000 request를 fixture 파일로 두지 않는다. 수 MB JSON이 저장소에 들어간다."""
    events = []
    for index in range(count):
        request_id = f"req-{index:04d}"
        start = index * 1_000_000
        duration = (index % 7 + 1) * 1_000_000
        events.append(
            {
                "type": "request.start",
                "timestamp_ns": start,
                "request_id": request_id,
                "method": "GET" if index % 2 else "POST",
                "path": f"/api/items/{index % 10}",
            }
        )
        events.append(
            {
                "type": "request.end",
                "timestamp_ns": start + duration,
                "request_id": request_id,
                "duration_ns": duration,
                "status_code": 500 if index % 10 == 0 else 200,
                "status": "failed" if index % 10 == 0 else "completed",
            }
        )
    return events


def test_pagination_covers_every_request_without_gaps_or_duplicates():
    events = _stress_events()

    seen = []
    page = 1
    while True:
        result = query_requests(events, sort="started_at_ns", order="asc", page=page, page_size=200)
        assert result["total"] == STRESS_REQUESTS
        seen.extend(item["request_id"] for item in result["items"])
        if not result["has_next"]:
            break
        page += 1

    assert page == 5
    assert len(seen) == STRESS_REQUESTS
    assert len(set(seen)) == STRESS_REQUESTS
    # 경계에서 순서가 흐트러지면 virtualization이 같은 행을 두 번 그린다.
    assert seen == sorted(seen)


def test_sort_and_filter_stay_exact_at_scale():
    events = _stress_events()

    newest = query_requests(events, sort="started_at_ns", order="desc", page_size=1)
    assert newest["items"][0]["request_id"] == f"req-{STRESS_REQUESTS - 1:04d}"

    longest = query_requests(events, sort="duration_ns", order="desc", page_size=1)
    assert longest["items"][0]["duration_ns"] == 7_000_000

    assert query_requests(events, status="failed")["total"] == STRESS_REQUESTS // 10
    assert query_requests(events, method="get")["total"] == STRESS_REQUESTS // 2
    assert query_requests(events, path="/api/items/3")["total"] == STRESS_REQUESTS // 10


def test_requests_disappear_when_the_ring_buffer_drops_their_start():
    """ring buffer 계약. total이 줄어드는 건 버그가 아니라 상한의 결과다.

    z가 이걸 모르면 "1000개를 보냈는데 왜 목록이 짧지"로 시간을 날린다.
    """
    events = _stress_events()
    buffer = EventBuffer(max_events=500)
    for event in events:
        buffer.append(event)

    result = query_requests(buffer.snapshot(), page_size=200)

    assert buffer.dropped_count == len(events) - 500
    assert result["total"] < STRESS_REQUESTS
    # 살아남은 request는 전부 최신 쪽이고 summary가 온전하다.
    assert all(item["duration_ns"] is not None for item in result["items"])
    assert min(item["request_id"] for item in result["items"]) > "req-0000"
