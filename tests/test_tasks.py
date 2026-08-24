"""Task 수명 주기 수집과 안정적 task_id."""

import asyncio
import io
from pathlib import Path

import httpx
import pytest
from test_contract_fixtures import assert_normalized

from asyncscope import AsyncScope
from asyncscope.collector import loop as loop_collector
from asyncscope.collector.middleware import RequestTracker
from asyncscope.collector.monitoring import tracing

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def app():
    from examples.demo import app as demo_app

    return RequestTracker(demo_app)


async def _post(app, path):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.post(path)


def _of_type(rows, event_type):
    return [row for row in rows if row["type"] == event_type]


async def test_background_task_start_and_end(app):
    with tracing(ROOT) as rows:
        await _post(app, "/demo/background")
        await asyncio.sleep(0.08)  # _background_job(0.05)이 끝나기를 기다린다

    for row in rows:
        assert_normalized(row)

    start = next(
        row for row in _of_type(rows, "task.start")
        if row["source"]["function"] == "_background_job"
    )
    end = next(
        row for row in _of_type(rows, "task.end")
        if row["task_id"] == start["task_id"]
    )
    assert start["status"] == "running"
    assert (end["status"], end["outcome"]) == ("completed", "returned")
    assert end["duration_ns"] > 0
    assert end["request_id"] == start["request_id"], "done callback이 request를 잃었다"
    assert start["request_id"] is not None


async def test_cancelled_background_task(app):
    with tracing(ROOT) as rows:
        await _post(app, "/demo/background-cancel")

    cancelled = _of_type(rows, "task.cancel")
    assert len(cancelled) == 1, cancelled
    assert (cancelled[0]["status"], cancelled[0]["outcome"]) == ("cancelled", "cancelled")
    assert cancelled[0]["source"]["function"] == "_background_job"


async def test_failed_task_is_not_reported_as_completed():
    """실패 Task를 만드는 demo endpoint가 없으므로 여기서 만든다."""

    async def boom():
        raise RuntimeError("demo failure")

    with tracing(ROOT) as rows:
        task = asyncio.create_task(boom())
        with pytest.raises(RuntimeError):
            await task

    end = next(row for row in _of_type(rows, "task.end") if row["source"]["function"] == "boom")
    assert (end["status"], end["outcome"]) == ("failed", "raised")
    assert "demo failure" not in str(end), "예외 값을 기록하면 안 된다"


async def test_task_id_is_stable_and_shared_with_coroutine_events(app):
    with tracing(ROOT) as rows:
        # 요청을 Task로 감싼다. 이 Task도 factory를 지나므로 부모 id를 갖는다.
        # pytest-asyncio가 만든 테스트 Task는 tracing 이전에 생겨서 id가 없다.
        await asyncio.create_task(_post(app, "/demo/background"))
        await asyncio.sleep(0.08)

    start = next(
        row for row in _of_type(rows, "task.start")
        if row["source"]["function"] == "_background_job"
    )
    task_id = start["task_id"]
    assert task_id.startswith("task-"), task_id

    caller = next(
        row for row in _of_type(rows, "task.start")
        if row["source"]["function"] == "_post"
    )
    assert start["parent_task_id"] == caller["task_id"], "부모 Task 연결이 끊겼다"

    functions = {
        row["source"]["function"]
        for row in rows
        if row["task_id"] == task_id and row["type"].startswith("coroutine.")
    }
    assert functions == {"_background_job"}, functions


async def test_heartbeat_task_is_not_reported():
    with tracing(ROOT) as rows:
        heartbeat = loop_collector.start()
        await asyncio.sleep(0.02)
        heartbeat.cancel()

    assert [row for row in rows if row["type"].startswith("task.")] == []


async def test_uninstall_restores_the_task_factory(app):
    loop = asyncio.get_running_loop()
    assert loop.get_task_factory() is None

    traced = AsyncScope(app, project_root=ROOT, out=io.StringIO()).install()
    assert loop.get_task_factory() is not None
    traced.uninstall()

    assert loop.get_task_factory() is None
