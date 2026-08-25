"""M0 검증용 demo.

sleep/blocking은 수집 검증용이고, background/failure/cancel은 z의 fixture와
consumer contract 검증용이다. adapter와 disconnect는 M0에서 fixture-only 계약으로
다룬다.

    uv run uvicorn examples.demo:traced --port 8000

수집 결과는 파일이 아니라 메모리 ring buffer로 흐른다 (`scope.events`).

일반 앱은 `traced = AsyncScope(app).install()` 한 줄로 끝난다. 이 demo는 테스트가
`from examples.demo import app`으로 import하므로 import 시점에 install하지 않고
lifespan에서 켠다.
"""

import asyncio
import contextlib
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException

from asyncscope import AsyncScope

ROOT = Path(__file__).resolve().parent.parent


@contextlib.asynccontextmanager
async def lifespan(_app):
    scope.install()
    try:
        yield
    finally:
        scope.uninstall()


app = FastAPI(lifespan=lifespan)
_BACKGROUND_TASKS: dict[str, asyncio.Task] = {}


async def _step(seconds: float) -> str:
    """중첩 span을 만들기 위한 자식 coroutine."""
    await asyncio.sleep(seconds)
    return "done"


async def _background_job(name: str, seconds: float) -> str:
    """background Task fixture가 기대하는 자식 coroutine."""
    await asyncio.sleep(seconds)
    return name


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


@app.post("/demo/background")
async def background():
    task = asyncio.create_task(
        _background_job("background-complete", 0.05),
        name="demo-background-complete",
    )
    _BACKGROUND_TASKS[task.get_name()] = task
    task.add_done_callback(lambda done: _BACKGROUND_TASKS.pop(done.get_name(), None))
    return {"task": task.get_name(), "status": "started"}


@app.post("/demo/background-cancel")
async def background_cancel():
    task = asyncio.create_task(
        _background_job("background-cancel", 1),
        name="demo-background-cancel",
    )
    await asyncio.sleep(0)
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task
    return {"task": task.get_name(), "status": "cancelled"}


@app.get("/demo/failure")
async def failure():
    raise HTTPException(status_code=500, detail="demo failure")


@app.get("/demo/long-running")
async def long_running():
    await asyncio.sleep(1)
    return {"result": "done"}


@app.get("/demo/unknown-await")
async def unknown_await():
    """adapter 목록에 없는 await. 분류가 unknown으로 남는지 보는 anchor다."""
    await asyncio.sleep(0.05)
    return {"result": "done"}


@app.get("/demo/adapters")
async def adapter_demo():
    """지원 adapter fixture의 source anchor.

    ponytail: 여기서 진짜 asyncpg/Redis/WebSocket을 부르지 않는다. 넷 다 실제 서버가
    있어야 하는데 demo는 네트워크 없이 돌아야 한다. adapter wrapper가 실제로 붙고
    label을 붙이는지는 tests/unit/test_classifiers.py가 httpx로 검증한다.
    """
    await asyncio.sleep(0)
    return {"result": "fixture-only"}


scope = AsyncScope(app, project_root=ROOT)
traced = scope
