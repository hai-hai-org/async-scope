"""M0 게이트. 이게 전부 통과해야 Day 4로 넘어간다 (개발 계획 §5, 일정 Day 3).

실패하면 UI가 아니라 ADR-0001의 수집 방식을 다시 본다.
"""

import asyncio
import statistics
import time
from pathlib import Path

import httpx
import pytest

from asyncscope.collector import loop as loop_collector
from asyncscope.collector.middleware import RequestTracker
from asyncscope.collector.monitoring import tracing
from asyncscope.web.source import read_snippet

ROOT = Path(__file__).resolve().parent.parent
DEMO = "examples/demo.py"


async def _request(app, *paths):
    """paths를 거의 동시에 보낸다."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        return await asyncio.gather(*(client.get(p) for p in paths))


@pytest.fixture
def app():
    from examples.demo import app as demo_app

    return RequestTracker(demo_app)


# --- 관측 -----------------------------------------------------------------


async def test_concurrent_requests_suspend_and_resume(app):
    """두 동시 요청의 중단·재개 순서를 재현할 수 있다."""
    with tracing(ROOT) as rows:
        await _request(app, "/demo/non-blocking", "/demo/non-blocking")

    ids = {r["request_id"] for r in rows if r.get("request_id")}
    assert len(ids) == 2, ids
    for rid in ids:
        steps = [r["event"] for r in rows if r.get("request_id") == rid and r.get("coroutine") == "_step"]
        assert steps == ["PY_START", "PY_YIELD", "PY_RESUME", "PY_RETURN"], (rid, steps)

    # 두 요청이 실제로 겹쳤다: 한쪽이 끝나기 전에 다른 쪽이 시작한다.
    starts = {rid: next(r["ts"] for r in rows if r.get("request_id") == rid) for rid in ids}
    ends = {rid: next(r["ts"] for r in reversed(rows) if r.get("request_id") == rid) for rid in ids}
    assert max(starts.values()) < min(ends.values()), "요청이 순차 실행됐다"


async def test_sleep_patterns_differ(app):
    """asyncio.sleep은 yield하고 time.sleep은 하지 않는다 — 이게 blocking의 관측 근거다."""
    with tracing(ROOT) as rows:
        await _request(app, "/demo/non-blocking")
        await _request(app, "/demo/blocking")

    def yields(coroutine):
        return [r for r in rows if r.get("coroutine") == coroutine and r["event"] == "PY_YIELD"]

    assert yields("_step"), "asyncio.sleep이 suspend되지 않았다"
    assert not yields("blocking"), "time.sleep이 suspend된 것처럼 보인다"


async def test_request_ids_do_not_mix(app):
    """동시 요청의 request_id가 섞이지 않는다."""
    with tracing(ROOT) as rows:
        await _request(app, "/demo/non-blocking", "/demo/quick", "/demo/non-blocking")

    per_task = {}
    for r in rows:
        if r.get("task") and r.get("request_id"):
            per_task.setdefault(r["task"], set()).add(r["request_id"])
    assert all(len(v) == 1 for v in per_task.values()), per_task


async def test_tracing_off_records_nothing(app):
    """tracing을 끄면 hook도 기록도 남지 않는다."""
    with tracing(ROOT) as rows:
        pass
    await _request(app, "/demo/non-blocking")
    assert rows == []


# --- blocking 감지 ---------------------------------------------------------


async def test_heartbeat_detects_blocking(app):
    with tracing(ROOT) as rows:
        hb = loop_collector.start()
        await asyncio.sleep(0.05)  # heartbeat 워밍업
        await _request(app, "/demo/blocking")
        await asyncio.sleep(0.05)  # heartbeat가 지연을 관측하는 건 다음 tick이다
        hb.cancel()

    blocked = [r for r in rows if r["event"] == "loop.blocked"]
    assert blocked, "time.sleep(0.3)을 감지하지 못했다"
    assert max(r["delay_ms"] for r in blocked) > 200
    assert all(r["evidence"] == "inferred" for r in blocked), "blocking 원인을 단정하면 안 된다"
    assert all("suspect" not in r for r in blocked), "collector가 원인을 지목하면 안 된다"


def _culprit(rows, blocked):
    """침묵 구간 직전의 project coroutine. 원인 추정은 stream을 다 가진 쪽이 한다."""
    before = [
        r for r in rows
        if "coroutine" in r and r["ts"] <= blocked["gap_start_ts"]
    ]
    return before[-1] if before else None


async def test_blocking_is_attributed_to_the_right_coroutine(app):
    """blocking 이후에 실행된 다른 요청을 원인으로 지목하면 안 된다.

    실제 uvicorn QA에서 나온 오탐: heartbeat가 깨어난 시점의 마지막 coroutine은
    이미 blocking이 끝난 뒤 처리된 /demo/quick이었다.
    """
    with tracing(ROOT) as rows:
        hb = loop_collector.start()
        await asyncio.sleep(0.05)
        slow = asyncio.create_task(_request(app, "/demo/blocking"))
        await asyncio.sleep(0.01)
        await _request(app, "/demo/quick")  # 해제 직후 실행되어 오탐을 유도한다
        await slow
        await asyncio.sleep(0.05)
        hb.cancel()

    blocked = next(r for r in rows if r["event"] == "loop.blocked")
    culprit = _culprit(rows, blocked)
    assert culprit is not None, "침묵 구간 직전 이벤트를 찾지 못했다"
    assert culprit["coroutine"] == "blocking", culprit


async def test_heartbeat_ignores_normal_work(app):
    """짧은 정상 실행을 blocking으로 잡지 않는다."""
    with tracing(ROOT) as rows:
        hb = loop_collector.start()
        await asyncio.sleep(0.05)
        await _request(app, "/demo/quick", "/demo/non-blocking")
        await asyncio.sleep(0.05)
        hb.cancel()

    assert [r for r in rows if r["event"] == "loop.blocked"] == []


# --- span tree -------------------------------------------------------------


def _spans(rows, request_id):
    """PY_START/PY_RETURN 중첩으로 span tree를 만든다.

    ponytail: M0 스파이크라 테스트 안에 둔다. M1에서 소비자가 생기면 analysis/spans.py로.
    """
    stack, roots = [], []
    for r in rows:
        if r.get("request_id") != request_id or "coroutine" not in r:
            continue
        if r["event"] == "PY_START":
            span = {"name": r["coroutine"], "start": r["ts"], "children": []}
            (stack[-1]["children"] if stack else roots).append(span)
            stack.append(span)
        elif r["event"] == "PY_RETURN" and stack:
            span = stack.pop()
            span["duration"] = r["ts"] - span["start"]
    return roots


async def test_span_tree_has_parent_child(app):
    with tracing(ROOT) as rows:
        await _request(app, "/demo/non-blocking")

    rid = next(r["request_id"] for r in rows if r.get("request_id"))
    roots = _spans(rows, rid)
    handler = next(s for s in roots if s["name"] == "non_blocking")
    child = next(c for c in handler["children"] if c["name"] == "_step")
    assert handler["duration"] >= child["duration"] > 0
    assert child["duration"] >= 50_000_000 * 0.8  # asyncio.sleep(0.05), 여유 있게


# --- source 경계 -----------------------------------------------------------


def test_source_reads_project_file():
    snippet = read_snippet(ROOT, DEMO, line=20)
    assert snippet["file"] == DEMO
    assert snippet["lines"]


@pytest.mark.parametrize(
    "path",
    [
        "../../../etc/passwd",
        "/etc/passwd",
        "pyproject.toml",  # root 안이지만 .py가 아님
    ],
)
def test_source_rejects_unsafe_paths(path):
    with pytest.raises(PermissionError):
        read_snippet(ROOT, path, line=1)


def test_source_rejects_symlink_escape(tmp_path):
    (tmp_path / "escape.py").symlink_to("/etc/hosts")
    with pytest.raises(PermissionError):
        read_snippet(tmp_path / "root", "../escape.py", line=1)


# --- 오버헤드 --------------------------------------------------------------


async def test_overhead_is_measured(app, capsys):
    """수치를 기록한다. 임계는 느슨하게만 — 정확한 판정은 Day 3 실측 (계획 §7)."""

    async def timed(n=20):
        await _request(app, "/demo/quick")  # warmup
        samples = []
        for _ in range(n):
            t0 = time.perf_counter()
            await _request(app, "/demo/quick")
            samples.append(time.perf_counter() - t0)
        return statistics.median(samples)

    off = await timed()
    with tracing(ROOT):
        on = await timed()

    ratio = on / off
    with capsys.disabled():
        print(f"\n[overhead] off={off * 1000:.2f}ms on={on * 1000:.2f}ms ratio={ratio:.2f}x")
    # 측정 (M0, macOS/CPython 3.13): DISABLE 도입 전 1.60x → 도입 후 1.07x.
    # 여기 /demo/quick은 대기가 없는 최악 조건이고, 실제 대기가 있는 요청은 1.01x다.
    # ponytail: set_local_events는 검토 후 기각. DISABLE 이후 남은 callback의 85%가
    # 실제로 기록되는 project coroutine이라 더 줄일 여지가 없다 (요청당 낭비 0.35회).
    assert ratio < 1.5, f"오버헤드 {ratio:.1f}x — 수집 방식 재검토"
