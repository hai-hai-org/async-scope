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
    "response.start",
    "request.end",
    "task.start",
    "task.end",
    "task.cancel",
    "coroutine.start",
    "coroutine.suspend",
    "coroutine.resume",
    "coroutine.end",
    "loop.blocked",
}
EVIDENCE = {"observed", "inferred"}
REQUEST_STATUSES = {"completed", "failed", "cancelled", "disconnected"}
TASK_STATUSES = {"running", "completed", "failed", "cancelled"}
TASK_OUTCOMES = {"returned", "raised", "cancelled"}
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
ADAPTER_LIBRARIES = {"asyncpg", "httpx", "redis.asyncio", "websockets"}


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


def assert_normalized(event):
    """normalized event 하나가 계약을 지키는지 검사한다.

    fixture와 실제 수집 결과가 같은 검사를 통과해야 하므로 여기서 한 번만 정의한다.
    """
    assert COMMON_FIELDS <= set(event), event
    assert event["type"] in EVENT_TYPES, event
    assert event["evidence"] in EVIDENCE, event

    if event["evidence"] == "observed":
        assert event["confidence"] is None, event
    else:
        assert isinstance(event["confidence"], int | float), event
        assert 0 <= event["confidence"] <= 1, event

    source = event["source"]
    if source is not None:
        assert set(source) == {"file", "function", "line"}, event
        assert source["file"].endswith(".py"), event
        assert not source["file"].startswith("/"), event
        assert ".." not in Path(source["file"]).parts, event

    for node in _walk(event):
        assert FORBIDDEN_KEYS.isdisjoint(node), event

    if event["type"] == "response.start":
        assert isinstance(event["status_code"], int), event
        assert event["category"] == "response", event
        assert event["label"] == f"HTTP {event['status_code']}", event

    if event["type"] == "request.end":
        assert event["status"] in REQUEST_STATUSES, event

    if event["type"].startswith("task."):
        assert event["status"] in TASK_STATUSES, event
    if event["type"] in {"task.end", "task.cancel"}:
        assert event["outcome"] in TASK_OUTCOMES, event


def test_expected_fixture_files_exist():
    assert set(FIXTURES) == {
        "adapter-awaits",
        "background-task",
        "blocking",
        "disconnect",
        "failure-cancel",
        "timeline",
        "ui-stress",
        "unknown-await",
    }


def test_fixtures_follow_m0_normalized_contract():
    for fixture in FIXTURES.values():
        assert fixture["schema_version"] == "m0.normalized.v1"
        assert fixture["events"]

        previous_ts = 0
        for event in fixture["events"]:
            assert_normalized(event)
            assert event["timestamp_ns"] >= previous_ts
            previous_ts = event["timestamp_ns"]


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


def test_response_start_precedes_request_end_when_response_exists():
    for fixture in FIXTURES.values():
        response_starts = {
            event["request_id"]: event
            for event in fixture["events"]
            if event["type"] == "response.start"
        }

        for event in fixture["events"]:
            if event["type"] != "request.end" or event["status_code"] is None:
                continue

            response_start = response_starts[event["request_id"]]
            assert response_start["timestamp_ns"] <= event["timestamp_ns"], event
            assert response_start["status_code"] == event["status_code"], event


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


def test_background_task_fixture_has_parent_child_and_terminal_states():
    events = _events("background-task")
    task_events = [event for event in events if event["type"].startswith("task.")]

    assert {event["type"] for event in task_events} == {
        "task.start",
        "task.end",
        "task.cancel",
    }
    assert all(event["parent_task_id"] for event in task_events)
    assert any(event["status"] == "completed" for event in task_events)
    assert any(event["status"] == "cancelled" for event in task_events)

    background_spans = {
        event["span_id"]
        for event in events
        if (event.get("source") or {}).get("function") == "_background_job"
    }
    assert {"span-background-complete", "span-background-cancel"} <= background_spans


def test_adapter_fixture_names_supported_libraries_with_evidence():
    adapter_events = [
        event
        for event in _events("adapter-awaits")
        if event.get("category") == "await"
    ]

    assert {event["library"] for event in adapter_events} == ADAPTER_LIBRARIES
    assert all(event["evidence"] == "observed" for event in adapter_events)
    assert all(event["confidence"] is None for event in adapter_events)
    assert all(event["label"].startswith("await ") for event in adapter_events)


def test_failure_cancel_and_disconnect_fixtures_expose_user_visible_status():
    failure_cancel_statuses = {
        event.get("status")
        for event in _events("failure-cancel")
        if event["type"] == "request.end"
    }
    disconnect_statuses = {
        event.get("status")
        for event in _events("disconnect")
        if event["type"] == "request.end"
    }

    assert {"failed", "cancelled"} <= failure_cancel_statuses
    assert "disconnected" in disconnect_statuses

    failure = next(
        event
        for event in _events("failure-cancel")
        if event["type"] == "request.end" and event.get("status") == "failed"
    )
    assert failure["status_code"] == 500

    disconnected = next(
        event
        for event in _events("disconnect")
        if event["type"] == "request.end" and event.get("status") == "disconnected"
    )
    assert disconnected["status_code"] is None
    assert disconnected["disconnect_reason"] == "client_disconnected"


# UI stress fixture가 시간이 지나며 평범해지면 조용히 stress 역할을 잃는다.
# 하한을 걸어 두면 값을 줄일 때 테스트가 먼저 막는다.
MIN_STRESS_PATH_LEN = 200
MIN_STRESS_LABEL_LEN = 40
MIN_STRESS_DURATION_NS = 3600 * 1_000_000_000
MIN_STRESS_SPAN_DEPTH = 5


def test_ui_stress_fixture_actually_stresses_the_layout():
    events = _events("ui-stress")

    longest_path = max(
        len(event["path"]) for event in events if event["type"] == "request.start"
    )
    assert longest_path >= MIN_STRESS_PATH_LEN, longest_path

    longest_label = max(len(event.get("label") or "") for event in events)
    assert longest_label >= MIN_STRESS_LABEL_LEN, longest_label

    longest_request = max(
        event["duration_ns"] for event in events if event["type"] == "request.end"
    )
    assert longest_request >= MIN_STRESS_DURATION_NS, longest_request

    parents = {
        event["span_id"]: event["parent_span_id"]
        for event in events
        if event["type"] == "coroutine.start"
    }
    assert _deepest_chain(parents) >= MIN_STRESS_SPAN_DEPTH


def test_ui_stress_fixture_covers_every_request_status():
    ends = {
        event["status"]
        for event in _events("ui-stress")
        if event["type"] == "request.end"
    }
    assert REQUEST_STATUSES <= ends, ends

    # 끝나지 않은 request가 있어야 partial/live 상태를 그릴 수 있다.
    started = {
        event["request_id"]
        for event in _events("ui-stress")
        if event["type"] == "request.start"
    }
    ended = {
        event["request_id"]
        for event in _events("ui-stress")
        if event["type"] == "request.end"
    }
    assert started - ended


def test_ui_stress_fixture_covers_unknown_missing_and_truncated_state():
    events = _events("ui-stress")

    assert any(
        event.get("label") == "unknown await" and event.get("library") is None
        for event in events
    ), "unknown await 상태가 없다"

    assert any(
        event["type"].startswith("coroutine.") and event["source"] is None
        for event in events
    ), "missing source 상태가 없다"

    started = {
        event["span_id"] for event in events if event["type"] == "coroutine.start"
    }
    ended = {event["span_id"] for event in events if event["type"] == "coroutine.end"}
    assert ended - started, "coroutine.start 없이 끝난 truncated span이 없다"


def test_timeline_fixture_carries_expected_geometry_for_every_request():
    """UI가 좌표 계산을 대조할 기대 출력. 없으면 z가 기대값을 손으로 베낀다."""
    expected = FIXTURES["timeline"]["expected"]
    request_ids = {
        event["request_id"]
        for event in _events("timeline")
        if event["type"] == "request.start"
    }

    assert set(expected) == request_ids
    for geometry in expected.values():
        assert sum(geometry["buckets"].values()) == geometry["measured_ns"]
        assert geometry["spans"]
        for span in geometry["spans"]:
            # offset은 request 시작 기준 상대 좌표다. timestamp_ns는 축에 못 쓴다.
            assert span["offset_ns"] >= 0


def _deepest_chain(parents):
    def depth(span_id, seen=()):
        parent = parents.get(span_id)
        if parent is None or parent not in parents or parent in seen:
            return 1
        return 1 + depth(parent, (*seen, span_id))

    return max((depth(span_id) for span_id in parents), default=0)
