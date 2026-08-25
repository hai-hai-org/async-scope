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


def test_query_requests_marks_unknown_await_but_not_unattributed_blocking():
    result = query_requests(_events("blocking", "unknown-await"), page_size=10)
    by_id = {item["request_id"]: item for item in result["items"]}

    assert by_id["req-unknown"]["has_unknown_await"]
    assert not by_id["req-blocking"]["has_blocking"]


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
