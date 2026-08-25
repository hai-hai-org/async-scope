import json
from pathlib import Path

import pytest

from asyncscope.analysis.requests import (
    RequestQueryError,
    get_request_detail,
    query_requests,
)

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
    assert distribution["duration_ns"] == 57000000
    assert distribution["measured_ns"] == 57000000
    assert sum(buckets.values()) == distribution["measured_ns"]
    assert all(value >= 0 for value in buckets.values())

    # asyncio.sleep(0.05)이 waiting으로 잡히고, 억지로 0을 만들지 않는다.
    assert buckets["waiting"] == 51000000
    assert buckets["response"] == 500000
    assert buckets["unattributed"] == 1500000


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
