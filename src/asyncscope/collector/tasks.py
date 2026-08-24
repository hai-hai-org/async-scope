"""Task 수명 주기. loop.set_task_factory로 생성을 가로채고 done callback으로 종료를 본다.

task_id는 여기서 부여한다. Task 이름(`Task-7`)은 loop가 붙이는 순번이고 사용자가
name=으로 덮어쓸 수 있어서 식별자로 쓸 수 없다.
"""

from __future__ import annotations

import asyncio
import itertools
import time

from .monitoring import TASK_ID_ATTR, emit, relative_source, task_id

_counter = itertools.count(1)
_MISSING = object()  # "붙어 있지 않음"과 "이전 factory가 None"을 구분한다
_loop = None
_previous = _MISSING


def start(loop) -> None:
    """이전 factory를 저장하고 우리 factory로 교체한다. 이미 붙어 있으면 no-op."""
    global _loop, _previous
    if _previous is not _MISSING:
        return
    _loop, _previous = loop, loop.get_task_factory()
    loop.set_task_factory(_factory)


def stop() -> None:
    global _loop, _previous
    if _previous is _MISSING:
        return
    _loop.set_task_factory(_previous)
    _loop, _previous = None, _MISSING


def _factory(loop, coro, **kwargs):
    """kwargs는 그대로 넘긴다. 3.12는 context=를, 3.13은 아무것도 넘기지 않는다."""
    task = asyncio.Task(coro, loop=loop, **kwargs)
    # ponytail: 모든 Task에 id를 붙인다 (Task 생성마다 setattr 하나). 부모가 uvicorn
    # 내부 Task여도 parent_task_id를 채울 수 있다. 비용이 문제되면 프로젝트 Task로 줄인다.
    setattr(task, TASK_ID_ATTR, f"task-{next(_counter)}")

    code = getattr(coro, "cr_code", None)
    source = relative_source(code) if code is not None else None
    if source is None:
        # 프로젝트 코드가 아니면 이벤트를 만들지 않는다. uvicorn 내부, site-packages,
        # 그리고 asyncscope 자신의 heartbeat가 여기서 걸러진다.
        return task

    try:
        parent = asyncio.current_task()
    except RuntimeError:
        parent = None
    common = {
        "task_id": task_id(task),
        "parent_task_id": task_id(parent) if parent is not None else None,
        "source": source,
    }
    emit("task.start", status="running", label="background task", **common)
    started_ns = time.perf_counter_ns()
    # add_done_callback이 등록 시점의 context를 복사하므로 종료 이벤트도 생성 시점의
    # request_id를 갖는다 (테스트로 고정: task.end의 request_id == task.start의 것).
    task.add_done_callback(lambda done: _finish(done, started_ns, common))
    return task


def _finish(task, started_ns: int, common: dict) -> None:
    if task.cancelled():
        event_type, status, outcome, label = (
            "task.cancel", "cancelled", "cancelled", "background task cancelled",
        )
    # ponytail: exception()을 부르면 asyncio의 "Task exception was never retrieved"
    # 경고가 사라진다 (_log_traceback은 다시 True로 되돌릴 수 없다). 실패 사실은
    # task.end status=failed로 대신 보인다.
    elif task.exception() is not None:
        event_type, status, outcome, label = (
            "task.end", "failed", "raised", "background task failed",
        )
    else:
        event_type, status, outcome, label = (
            "task.end", "completed", "returned", "background task completed",
        )
    # 예외 값과 traceback은 기록하지 않는다 (민감 값 미수집 경계).
    emit(
        event_type,
        duration_ns=time.perf_counter_ns() - started_ns,
        status=status,
        outcome=outcome,
        label=label,
        **common,
    )
