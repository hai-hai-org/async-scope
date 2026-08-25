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


async def test_response_start_sits_between_request_start_and_end(demo_app):
    """Timeline의 Response 구간 시작점. request.end만으로는 알 수 없다."""
    out = io.StringIO()
    traced = AsyncScope(demo_app, project_root=ROOT, out=out).install()
    try:
        response = await _get(traced, "/demo/quick")
    finally:
        traced.uninstall()

    assert response.status_code == 200
    lifecycle = [
        row for row in _rows(out)
        if row["type"] in {"request.start", "response.start", "request.end"}
    ]
    assert [row["type"] for row in lifecycle] == [
        "request.start", "response.start", "request.end",
    ], lifecycle
    started, responded, ended = lifecycle
    assert responded["status_code"] == 200
    assert responded["category"] == "response"
    assert started["timestamp_ns"] <= responded["timestamp_ns"] <= ended["timestamp_ns"]
    assert responded["request_id"] == started["request_id"]


async def test_error_response_still_has_response_start(demo_app):
    """500도 응답은 나간다. request.end가 failed여도 Response 구간은 존재한다."""
    out = io.StringIO()
    traced = AsyncScope(demo_app, project_root=ROOT, out=out).install()
    try:
        response = await _get(traced, "/demo/failure")
    finally:
        traced.uninstall()

    assert response.status_code == 500
    rows = _rows(out)
    responded = [row for row in rows if row["type"] == "response.start"]
    assert [row["status_code"] for row in responded] == [500], responded
    assert responded[0]["label"] == "HTTP 500"
    ended = [row for row in rows if row["type"] == "request.end"]
    assert [row["status"] for row in ended] == ["failed"], ended


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


async def test_normal_workload_is_not_reported_as_blocking():
    """짧은 정상 callback이 blocking으로 잡히면 Analyzer 전체가 거짓말이 된다.

    양성(time.sleep)은 위 테스트가 덮는다. 여기는 음성 쪽 경계다.

    ponytail: 벽시계 기준이라 심하게 부하가 걸린 머신에서는 흔들릴 수 있다.
    흔들리면 threshold를 올리기 전에 왜 50ms가 밀렸는지부터 본다.
    """

    async def short_callback():
        for _ in range(100):
            await asyncio.sleep(0.001)
            sum(range(2000))  # 실제 handler의 짧은 CPU 구간

    with tracing(ROOT) as rows:
        heartbeat = loop_collector.start()  # 기본 threshold 50ms, interval 10ms
        await asyncio.gather(*(short_callback() for _ in range(20)))
        heartbeat.cancel()

    blocked = [row for row in rows if row["type"] == "loop.blocked"]
    assert not blocked, blocked


def test_unsupported_reason():
    assert unsupported_reason((3, 13, 0), "cpython") is None
    assert "3.12" in unsupported_reason((3, 11, 9), "cpython")
    assert "pypy" in unsupported_reason((3, 13, 0), "pypy")


async def test_request_without_a_response_is_recorded_as_disconnected():
    """응답을 시작하지 못하고 끝난 request. contracts/fixtures/disconnect.json의 계약이다.

    uvicorn HTTP에서는 client가 끊어도 handler가 끝까지 돌아 이 경로가 실제로는 안 나온다
    (contracts/README.md 알려진 경계). 하지만 RequestTracker는 순수 ASGI라 응답을 시작하지
    않고 끝나는 app이면 여기로 온다. 지금까지 outcome()만 단위 테스트돼 있었다.

    httpx를 거치지 않고 ASGI를 직접 호출한다. 응답이 없는 요청은 transport 계층에서
    먼저 막혀서 middleware까지 닿지 않는다.
    """

    async def silent_app(app_scope, receive, send):
        """client가 끊어서 응답을 시작하지 못하고 끝난다."""
        assert (await receive())["type"] == "http.disconnect"

    scope = AsyncScope(silent_app, project_root=ROOT).install()
    try:
        await scope(
            {"type": "http", "method": "GET", "path": "/never-responds", "headers": []},
            _disconnect_receive,
            _drop_send,
        )
        events = list(scope.events)
    finally:
        scope.uninstall()

    end = next(event for event in events if event["type"] == "request.end")
    assert end["status"] == "disconnected"
    assert end["status_code"] is None
    assert not any(event["type"] == "response.start" for event in events)

    fixture = json.loads(
        (ROOT / "contracts" / "fixtures" / "disconnect.json").read_text()
    )
    expected = next(
        event for event in fixture["events"] if event["type"] == "request.end"
    )
    for field in ("status", "status_code", "category", "label", "disconnect_reason"):
        assert end[field] == expected[field], field


async def _disconnect_receive():
    return {"type": "http.disconnect"}


async def _drop_send(message):
    raise AssertionError(f"응답을 보내면 안 되는 경로다: {message}")
