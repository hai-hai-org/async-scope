"""AsyncScope(app).install() lifecycle.

핵심은 "끈 뒤에 아무것도 남지 않는다"다 — monitoring callback, heartbeat Task, sink.
"""

import asyncio
import io
import json
import sys
import time
from pathlib import Path

import httpx
import pytest

from asyncscope import AsyncScope
from asyncscope.collector import loop as loop_collector
from asyncscope.collector.monitoring import request_id, tracing
from asyncscope.scope import SINK_NAME, unsupported_reason

ROOT = Path(__file__).resolve().parent.parent
HEARTBEAT = "asyncscope-heartbeat"


@pytest.fixture
def demo_app():
    from examples.demo import app

    return app


async def _get(app, path):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
        return await client.get(path)


def _heartbeats():
    return [task for task in asyncio.all_tasks() if task.get_name() == HEARTBEAT]


def _rows(out):
    return [json.loads(line) for line in out.getvalue().splitlines()]


async def test_install_collects_and_uninstall_leaves_nothing(demo_app):
    out = io.StringIO()
    traced = AsyncScope(demo_app, project_root=ROOT, out=out).install()
    assert traced.installed

    response = await _get(traced, "/demo/non-blocking")
    assert response.status_code == 200
    assert _rows(out), "install() 후 이벤트가 수집되지 않았다"
    heartbeat = _heartbeats()
    assert len(heartbeat) == 1, heartbeat

    traced.uninstall()
    await asyncio.sleep(0.01)  # cancel 전달

    assert not traced.installed
    assert heartbeat[0].cancelled(), "heartbeat Task가 남았다"
    assert sys.monitoring.get_tool(sys.monitoring.PROFILER_ID) is None, "tool id가 남았다"


async def test_uninstalled_app_still_serves_but_records_nothing(demo_app):
    out = io.StringIO()
    traced = AsyncScope(demo_app, project_root=ROOT, out=out).install()
    await _get(traced, "/demo/quick")
    traced.uninstall()
    before = len(_rows(out))

    response = await _get(traced, "/demo/quick")

    assert response.status_code == 200
    assert len(_rows(out)) == before, "tracing을 끈 뒤에도 기록됐다"


async def test_default_sink_records_to_event_buffer(demo_app, tmp_path):
    scope = AsyncScope(demo_app, project_root=tmp_path, buffer_size=10).install()

    response = await _get(scope, "/demo/non-blocking")

    assert response.status_code == 200
    assert scope.events
    assert all("sequence" in event for event in scope.events)
    assert not (tmp_path / SINK_NAME).exists(), "기본 sink가 파일을 만들면 안 된다"
    scope.uninstall()


async def test_uninstalled_default_buffer_stops_growing(demo_app):
    scope = AsyncScope(demo_app, project_root=ROOT, buffer_size=10).install()
    await _get(scope, "/demo/quick")
    scope.uninstall()
    before = len(scope.events)

    response = await _get(scope, "/demo/quick")

    assert response.status_code == 200
    assert len(scope.events) == before, "tracing을 끈 뒤에도 buffer가 증가했다"


async def test_install_twice_fails(demo_app):
    traced = AsyncScope(demo_app, project_root=ROOT, out=io.StringIO()).install()
    try:
        with pytest.raises(RuntimeError, match="already installed"):
            traced.install()
    finally:
        traced.uninstall()


async def test_scope_is_reusable_with_default_buffer_sink(demo_app, tmp_path):
    scope = AsyncScope(demo_app, project_root=tmp_path)
    scope.install()
    scope.uninstall()

    # 상태가 완전히 정리됐으면 같은 객체를 다시 켤 수 있다.
    scope.install()
    scope.uninstall()


async def test_heartbeat_is_not_attributed_to_the_current_request():
    """요청 처리 중에 heartbeat가 시작돼도 loop.blocked가 그 요청 소유가 되면 안 된다.

    __call__의 지연 시작 경로가 이 위험을 만든다. create_task가 context를 복사하므로
    빈 Context 없이는 loop.blocked에 request_id가 붙는다.
    """
    with tracing(ROOT) as rows:
        token = request_id.set("req-x")
        heartbeat = loop_collector.start(threshold=0.02, interval=0.01)
        await asyncio.sleep(0.02)
        time.sleep(0.1)  # noqa: ASYNC251 — loop를 일부러 막아 지연을 만든다
        await asyncio.sleep(0.02)
        heartbeat.cancel()
        request_id.reset(token)

    blocked = [row for row in rows if row["type"] == "loop.blocked"]
    assert blocked, "지연을 감지하지 못했다"
    assert all(row["request_id"] is None for row in blocked), blocked


def test_unsupported_reason():
    assert unsupported_reason((3, 13, 0), "cpython") is None
    assert "3.12" in unsupported_reason((3, 11, 9), "cpython")
    assert "pypy" in unsupported_reason((3, 13, 0), "pypy")
