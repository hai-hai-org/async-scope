"""M0 검증용 최소 demo. `m`이 수집을 검증하려고 만든 seed다.

success/failure/cancel/disconnect와 background Task 시나리오는 `z`가 확장한다
(분담표 §6, 일정 Day 1).

    uv run uvicorn examples.demo:traced --port 8000

수집 결과는 asyncscope.jsonl로 흐른다. ponytail: 파일에 직접 쓴다.
ring buffer와 SSE는 `z`의 M1 작업이므로 여기서 미리 만들지 않는다.
"""

import asyncio
import contextlib
import time
from pathlib import Path

from fastapi import FastAPI

from asyncscope.collector import loop as loop_collector
from asyncscope.collector import monitoring
from asyncscope.collector.middleware import RequestTracker

ROOT = Path(__file__).resolve().parent.parent


@contextlib.asynccontextmanager
async def lifespan(_app):
    out = open(ROOT / "asyncscope.jsonl", "w", buffering=1)  # noqa: SIM115, ASYNC230 — 시작 시 1회, lifespan이 닫는다
    monitoring.start(ROOT, out)
    heartbeat = loop_collector.start()
    try:
        yield
    finally:
        heartbeat.cancel()
        monitoring.stop()
        out.close()


app = FastAPI(lifespan=lifespan)


async def _step(seconds: float) -> str:
    """중첩 span을 만들기 위한 자식 coroutine."""
    await asyncio.sleep(seconds)
    return "done"


@app.get("/demo/non-blocking")
async def non_blocking():
    return {"result": await _step(0.05)}


@app.get("/demo/blocking")
async def blocking():
    time.sleep(0.3)  # noqa: ASYNC251 — 일부러 Event Loop를 막는다. 감지 대상.
    return {"result": "done"}


@app.get("/demo/quick")
async def quick():
    return {"result": "done"}


traced = RequestTracker(app)
