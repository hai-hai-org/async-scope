"""AppShell summary metrics. 전부 event buffer에서 파생한다."""

import json
import time
from pathlib import Path

import pytest

from asyncscope.analysis import QueryError
from asyncscope.analysis.metrics import summarize

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"

# blocking.json은 2.000s에 시작해 2.317s에 끝난다.
FIXTURE_START_NS = 2_000_000_000


def _events(*names):
    events = []
    for name in names:
        events.extend(json.loads((FIXTURE_DIR / f"{name}.json").read_text())["events"])
    return events


def test_rate_divides_by_the_window_the_buffer_actually_covers():
    """buffer가 60초를 못 덮는데 60으로 나누면 rate가 실제보다 낮게 나온다."""
    summary = summarize(_events("blocking"), now_ns=2_400_000_000, window_s=60)

    assert summary["window_ns"] == 60_000_000_000
    assert summary["measured_window_ns"] == 400_000_000
    # 0.4초 동안 request 2건.
    assert summary["request_rate_per_second"] == 5.0


def test_idle_window_reports_zero_rate_but_empty_buffer_reports_null():
    """요청이 없던 것과 잴 수 없는 것은 다르다."""
    idle = summarize(_events("blocking"), now_ns=FIXTURE_START_NS + 100_000_000_000)
    assert idle["request_rate_per_second"] == 0.0

    empty = summarize([], now_ns=1_000_000_000)
    assert empty["request_rate_per_second"] is None
    assert empty["measured_window_ns"] == 0
    assert empty["active_requests"] == 0
    assert empty["blocking_count"] == 0
    assert empty["loop_delay"] == {
        "average_ns": None,
        "max_ns": None,
        "samples": 0,
        "threshold_ns": None,
    }


def test_active_requests_counts_requests_that_started_before_the_window():
    """window로 자르면 오래 도는 request가 통째로 빠진다."""
    running = {
        "type": "request.start",
        "timestamp_ns": 1_000_000_000,
        "request_id": "req-long",
        "method": "GET",
        "path": "/long",
    }
    summary = summarize([running, *_events("blocking")], now_ns=2_400_000_000, window_s=1)

    assert summary["measured_window_ns"] == 1_000_000_000
    # req-long은 window 밖에서 시작했지만 아직 끝나지 않았다.
    assert summary["active_requests"] == 1


def test_loop_delay_reports_what_it_is_the_average_of():
    """heartbeat는 threshold 이하 sample을 남기지 않는다. 전체 평균이 아니다."""
    summary = summarize(_events("blocking"), now_ns=2_400_000_000)

    assert summary["blocking_count"] == 1
    assert summary["loop_delay"] == {
        "average_ns": 300_000_000,
        "max_ns": 300_000_000,
        "samples": 1,
        "threshold_ns": 50_000_000,
    }


def test_loop_delay_averages_only_the_samples_inside_the_window():
    events = [
        _blocked(1_000_000_000, 100_000_000),  # window 밖
        _blocked(2_300_000_000, 300_000_000),
        _blocked(2_350_000_000, 500_000_000),
    ]
    summary = summarize(events, now_ns=2_400_000_000, window_s=1)

    assert summary["loop_delay"]["samples"] == 2
    assert summary["loop_delay"]["average_ns"] == 400_000_000
    assert summary["loop_delay"]["max_ns"] == 500_000_000
    assert summary["blocking_count"] == 2


def _blocked(timestamp_ns: int, delay_ns: int) -> dict:
    return {
        "type": "loop.blocked",
        "timestamp_ns": timestamp_ns,
        "request_id": None,
        "duration_ns": delay_ns,
        "delay_ns": delay_ns,
        "threshold_ns": 50_000_000,
        "evidence": "inferred",
        "confidence": 0.6,
    }


@pytest.mark.parametrize(
    ("window", "message"),
    [(0, "window must be >= 1"), ("abc", "window must be an integer"), (3601, "window must be <=")],
)
def test_summarize_rejects_unusable_windows(window, message):
    with pytest.raises(QueryError, match=message):
        summarize(_events("blocking"), now_ns=2_400_000_000, window_s=window)


def test_blocked_gap_length_equals_the_measured_delay():
    """gap 구간 길이가 delay_ns와 어긋나면 metric과 finding이 이벤트와 다른 값을 말한다.

    collector는 gap_start_ns를 emit()이 timestamp_ns를 찍기 직전에 읽는다. 그 사이 몇 µs가
    구간에 섞이면 안 된다.
    """
    from asyncscope.analysis.spans import blocked_gap

    event = _blocked(2_300_000_000, 300_000_000)
    event["gap_start_ns"] = 2_000_000_000  # timestamp - delay 보다 조금 이르게 읽힌 값

    start, stop = blocked_gap(event)
    assert stop - start == event["delay_ns"]
    assert start == 2_000_000_000


def test_replayed_capture_must_be_measured_on_its_own_clock():
    """timestamp_ns는 perf_counter_ns로 프로세스 상대값이다.

    지금 perf_counter를 anchor로 쓰면 남의 capture는 window 밖으로 전부 밀려나고
    "blocking 없음, 트래픽 없음"이 된다. capture의 존재 이유가 그 둘일 때 특히 위험하다.
    """
    events = _events("blocking")
    newest_ns = max(event["timestamp_ns"] for event in events)

    # 잘못된 anchor: 이 프로세스의 지금 시각
    wrong = summarize(events, now_ns=time.perf_counter_ns())
    assert wrong["request_rate_per_second"] == 0.0
    assert wrong["blocking_count"] == 0
    assert wrong["loop_delay"]["samples"] == 0

    # 옳은 anchor: capture의 마지막 이벤트
    right = summarize(events, now_ns=newest_ns)
    assert right["measured_window_ns"] == newest_ns - min(
        event["timestamp_ns"] for event in events
    )
    assert right["request_rate_per_second"] > 0
    assert right["blocking_count"] == 1
    assert right["loop_delay"]["samples"] == 1
    assert right["loop_delay"]["max_ns"] == 300_000_000
