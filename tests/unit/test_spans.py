"""span tree. coroutine 프레임 하나가 span 하나이고, parent는 그것을 await한 프레임이다.

이 파일의 coroutine들은 project root 안에 있으므로 그대로 수집 대상이 된다.
"""

import asyncio
import contextlib
from pathlib import Path

from asyncscope.collector.monitoring import tracing

ROOT = Path(__file__).resolve().parent.parent.parent


async def leaf():
    await asyncio.sleep(0)  # 여기서 suspend/resume이 한 번 일어난다
    return "leaf"


async def middle():
    return await leaf()


async def root():
    return await middle()


async def boom():
    await asyncio.sleep(0)
    raise ValueError("의도된 실패")


async def sibling():
    await asyncio.sleep(0)
    return "sibling"


async def parent_of_boom():
    with contextlib.suppress(ValueError):
        await boom()
    return await sibling()


def _by(rows, event_type, function):
    return [
        row for row in rows
        if row["type"] == event_type and (row["source"] or {}).get("function") == function
    ]


def _span_of(rows, function):
    """해당 함수의 coroutine.start가 발급받은 span_id 하나."""
    starts = _by(rows, "coroutine.start", function)
    assert len(starts) == 1, starts
    return starts[0]["span_id"]


async def test_parent_chain_follows_the_await_chain():
    with tracing(ROOT) as rows:
        assert await root() == "leaf"

    root_span = _span_of(rows, "root")
    middle_span = _span_of(rows, "middle")
    leaf_span = _span_of(rows, "leaf")

    assert root_span and middle_span and leaf_span
    assert len({root_span, middle_span, leaf_span}) == 3
    assert _by(rows, "coroutine.start", "middle")[0]["parent_span_id"] == root_span
    assert _by(rows, "coroutine.start", "leaf")[0]["parent_span_id"] == middle_span


async def test_span_id_survives_suspend_and_resume():
    """재개 때 새 span을 발급하면 Timeline이 같은 프레임을 둘로 그린다."""
    with tracing(ROOT) as rows:
        await leaf()

    span = _span_of(rows, "leaf")
    lifecycle = [
        row for row in rows
        if (row["source"] or {}).get("function") == "leaf"
    ]
    assert [row["type"] for row in lifecycle] == [
        "coroutine.start", "coroutine.suspend", "coroutine.resume", "coroutine.end",
    ], lifecycle
    assert {row["span_id"] for row in lifecycle} == {span}
    assert lifecycle[-1]["duration_ns"] > 0


async def test_concurrent_tasks_do_not_share_a_span_tree():
    with tracing(ROOT) as rows:
        await asyncio.gather(root(), root())

    owner = {
        row["span_id"]: row["task_id"]
        for row in rows if row["type"] == "coroutine.start"
    }
    children = [row for row in rows if row.get("parent_span_id")]
    assert children
    for row in children:
        assert owner[row["parent_span_id"]] == row["task_id"], row

    # 두 호출이 각자의 span을 받았다.
    assert len(_by(rows, "coroutine.start", "leaf")) == 2
    assert len({row["span_id"] for row in _by(rows, "coroutine.start", "leaf")}) == 2


async def test_exception_does_not_corrupt_the_sibling_parent():
    """예외로 빠져나간 프레임을 회수하지 않으면 다음 형제의 parent가 죽은 span을 가리킨다."""
    with tracing(ROOT) as rows:
        assert await parent_of_boom() == "sibling"

    caller = _span_of(rows, "parent_of_boom")
    assert _by(rows, "coroutine.start", "boom")[0]["parent_span_id"] == caller
    assert _by(rows, "coroutine.start", "sibling")[0]["parent_span_id"] == caller
