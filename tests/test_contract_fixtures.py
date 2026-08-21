import json
from pathlib import Path

FIXTURE_DIR = Path(__file__).resolve().parent.parent / "contracts" / "fixtures"
FIXTURES = {
    path.stem: json.loads(path.read_text(encoding="utf-8"))
    for path in sorted(FIXTURE_DIR.glob("*.json"))
}

COMMON_FIELDS = {
    "type",
    "timestamp_ns",
    "request_id",
    "task_id",
    "span_id",
    "parent_span_id",
    "source",
    "duration_ns",
    "evidence",
    "confidence",
}
EVENT_TYPES = {
    "request.start",
    "request.end",
    "coroutine.start",
    "coroutine.suspend",
    "coroutine.resume",
    "coroutine.end",
    "loop.blocked",
}
EVIDENCE = {"observed", "inferred"}
FORBIDDEN_KEYS = {
    "args",
    "arguments",
    "authorization",
    "body",
    "cookie",
    "cookies",
    "env",
    "environment",
    "header",
    "headers",
    "locals",
    "query",
    "query_string",
    "request_body",
    "response_body",
    "suspect",
}
KNOWN_ADAPTER_LABELS = {
    "asyncpg",
    "db",
    "database",
    "http",
    "httpx",
    "redis",
    "redis.asyncio",
    "websocket",
    "websockets",
}


def _events(name):
    return FIXTURES[name]["events"]


def _walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from _walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from _walk(item)


def _request_intervals(events):
    starts = {}
    intervals = {}
    for event in events:
        if event["type"] == "request.start":
            starts[event["request_id"]] = event["timestamp_ns"]
        elif event["type"] == "request.end":
            intervals[event["request_id"]] = (
                starts[event["request_id"]],
                event["timestamp_ns"],
            )
    return intervals


def test_expected_fixture_files_exist():
    assert set(FIXTURES) == {"blocking", "timeline", "unknown-await"}


def test_fixtures_follow_m0_normalized_contract():
    for fixture in FIXTURES.values():
        assert fixture["schema_version"] == "m0.normalized.v1"
        assert fixture["events"]

        previous_ts = 0
        for event in fixture["events"]:
            assert COMMON_FIELDS <= set(event), event
            assert event["type"] in EVENT_TYPES
            assert event["timestamp_ns"] >= previous_ts
            previous_ts = event["timestamp_ns"]
            assert event["evidence"] in EVIDENCE

            if event["evidence"] == "observed":
                assert event["confidence"] is None
            else:
                assert isinstance(event["confidence"], int | float)
                assert 0 <= event["confidence"] <= 1

            source = event["source"]
            if source is not None:
                assert set(source) == {"file", "function", "line"}
                assert source["file"].endswith(".py")
                assert not source["file"].startswith("/")
                assert ".." not in Path(source["file"]).parts


def test_fixtures_do_not_include_sensitive_values_or_collector_culprits():
    for fixture in FIXTURES.values():
        for node in _walk(fixture):
            if isinstance(node, dict):
                assert FORBIDDEN_KEYS.isdisjoint(node)


def test_timeline_fixture_has_overlapping_requests_and_suspend_resume():
    events = _events("timeline")
    intervals = _request_intervals(events)

    assert set(intervals) == {"req-1", "req-2"}
    req_1_start, req_1_end = intervals["req-1"]
    req_2_start, req_2_end = intervals["req-2"]
    assert req_1_start < req_2_start < req_1_end < req_2_end

    for request_id in ("req-1", "req-2"):
        request_events = [
            event["type"]
            for event in events
            if event.get("request_id") == request_id
            and (event.get("source") or {}).get("function") == "_step"
        ]
        assert "coroutine.suspend" in request_events
        assert "coroutine.resume" in request_events
        assert request_events.index("coroutine.suspend") < request_events.index(
            "coroutine.resume"
        )


def test_blocking_fixture_keeps_loop_delay_inferred_and_unattributed():
    blocked_events = [
        event for event in _events("blocking") if event["type"] == "loop.blocked"
    ]

    assert len(blocked_events) == 1
    blocked = blocked_events[0]
    assert blocked["evidence"] == "inferred"
    assert blocked["source"] is None
    assert blocked["label"] == "unattributed loop delay"
    assert blocked["delay_ns"] > blocked["threshold_ns"]


def test_unknown_await_fixture_does_not_claim_a_known_adapter():
    unknown_events = [
        event
        for event in _events("unknown-await")
        if event.get("category") == "await" and event.get("label") == "unknown await"
    ]

    assert len(unknown_events) == 1
    event = unknown_events[0]
    assert event["type"] == "coroutine.suspend"
    assert event["library"] is None
    label = event["label"].lower()
    assert all(adapter not in label for adapter in KNOWN_ADAPTER_LABELS)
