"""실제 수집 결과가 contracts/의 normalized event 계약을 지키는지 검사한다.

fixture 검증기(test_contract_fixtures.assert_normalized)를 그대로 재사용한다.
같은 검사를 통과하지 않으면 z의 API가 fixture로 개발한 뒤 실제 이벤트에서 깨진다.
"""

import asyncio
from pathlib import Path

import httpx
import pytest
from test_contract_fixtures import assert_normalized

from asyncscope.collector import loop as loop_collector
from asyncscope.collector.middleware import RequestTracker, outcome
from asyncscope.collector.monitoring import tracing

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def app():
    from examples.demo import app as demo_app

    return RequestTracker(demo_app)


async def _get(app, *paths):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        return await asyncio.gather(*(client.get(p) for p in paths))


async def test_every_collected_event_matches_the_contract(app):
    with tracing(ROOT) as rows:
        hb = loop_collector.start()
        await asyncio.sleep(0.05)
        await _get(app, "/demo/non-blocking", "/demo/quick")
        await _get(app, "/demo/blocking")
        await asyncio.sleep(0.05)
        hb.cancel()

    assert rows
    for row in rows:
        assert_normalized(row)

    types = {row["type"] for row in rows}
    assert {
        "request.start",
        "request.end",
        "coroutine.start",
        "coroutine.suspend",
        "coroutine.resume",
        "coroutine.end",
        "loop.blocked",
    } <= types, types


async def test_suspend_does_not_claim_an_adapter(app):
    """await 대상은 아직 분류하지 않는다. DB·HTTP·Redis로 단정하면 안 된다."""
    with tracing(ROOT) as rows:
        await _get(app, "/demo/non-blocking")

    suspends = [row for row in rows if row["type"] == "coroutine.suspend"]
    assert suspends
    assert all(row["label"] == "unknown await" for row in suspends), suspends
    assert all(row["library"] is None for row in suspends), suspends


async def test_request_end_reports_completed_and_failed(app):
    with tracing(ROOT) as rows:
        await _get(app, "/demo/quick")
        await _get(app, "/demo/failure")

    ends = [row for row in rows if row["type"] == "request.end"]
    assert [row["status"] for row in ends] == ["completed", "failed"]
    assert [row["status_code"] for row in ends] == [200, 500]
    assert ends[1]["label"] == "HTTP 500"
    assert all(row["duration_ns"] > 0 for row in ends)


async def test_request_end_reports_cancelled(app):
    with tracing(ROOT) as rows:
        pending = asyncio.create_task(_get(app, "/demo/long-running"))
        await asyncio.sleep(0.01)
        pending.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pending

    end = next(row for row in rows if row["type"] == "request.end")
    assert end["status"] == "cancelled"
    assert end["status_code"] is None


def test_outcome_rules():
    """disconnect는 ASGITransport로 재현할 수 없으므로 판정 규칙을 직접 검사한다."""
    assert outcome(200, None)["status"] == "completed"
    assert outcome(503, None)["status"] == "failed"
    assert outcome(200, asyncio.CancelledError())["status"] == "cancelled"
    assert outcome(None, RuntimeError())["status"] == "failed"

    disconnected = outcome(None, None)
    assert disconnected["status"] == "disconnected"
    assert disconnected["disconnect_reason"] == "client_disconnected"
