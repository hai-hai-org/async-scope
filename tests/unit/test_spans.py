"""span tree. coroutine 프레임 하나가 span 하나이고, parent는 그것을 await한 프레임이다.

이 파일의 coroutine들은 project root 안에 있으므로 그대로 수집 대상이 된다.
"""

import asyncio
import contextlib
import functools
import inspect
from pathlib import Path

from asyncscope.collector.monitoring import tracing
from asyncscope.source import read_snippet

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


def _passthrough(fn):
    """아무것도 하지 않는 decorator. co_firstlineno가 어디를 가리키는지 보려는 것뿐이다."""

    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        return await fn(*args, **kwargs)

    return wrapper


@_passthrough
async def decorated():
    await asyncio.sleep(0)
    return "decorated"


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


# --- segment → span → source 연결 (Day 17) ---------------------------------
#
# 기록된 source가 실제 코드를 가리키지 못하면 SourceViewer가 엉뚱한 줄을 보여 주고
# 아무도 모른다. 진실은 stdlib(inspect)에서 독립적으로 구한다 — collector와 같은 계산을
# 재사용하면 둘이 같이 틀렸을 때 테스트가 공허하게 통과한다.

RELATIVE_PATH = "tests/unit/test_spans.py"


async def test_recorded_source_points_at_the_function_that_ran():
    with tracing(ROOT) as rows:
        assert await root() == "leaf"

    traced = {"root": root, "middle": middle, "leaf": leaf}
    seen = set()
    for row in rows:
        function = (row["source"] or {}).get("function")
        if function not in traced:
            continue
        seen.add(function)
        _, first_lineno = inspect.getsourcelines(traced[function])
        assert row["source"]["line"] == first_lineno, row
        assert row["source"]["file"] == RELATIVE_PATH, row

    assert seen == set(traced), seen


async def test_recorded_source_opens_a_snippet_containing_the_definition():
    """UI의 클릭 경로. segment의 source를 그대로 snippet reader에 넘긴다."""
    with tracing(ROOT) as rows:
        assert await leaf() == "leaf"

    source = next(row["source"] for row in rows if (row["source"] or {}).get("function") == "leaf")
    snippet = read_snippet(ROOT, source["file"], source["line"])

    assert snippet["file"] == source["file"]
    assert any("async def leaf(" in line for line in snippet["lines"])
    # source.line이 snippet 범위 안에 있어야 UI가 그 줄을 하이라이트할 수 있다.
    assert snippet["start_line"] <= source["line"] < snippet["start_line"] + len(snippet["lines"])


async def test_decorated_function_records_the_decorator_line_not_the_def_line():
    """계약이다. co_firstlineno는 CPython이 주는 값이고 우리가 바꾸지 않는다.

    SourceViewer가 source.line만 하이라이트하면 사용자는 decorator를 보게 된다.
    def 줄을 강조하려면 snippet 안에서 찾아야 한다.
    """
    with tracing(ROOT) as rows:
        assert await decorated() == "decorated"

    source = next(
        row["source"] for row in rows if (row["source"] or {}).get("function") == "decorated"
    )
    lines, first_lineno = inspect.getsourcelines(decorated)

    assert source["line"] == first_lineno
    assert lines[0].lstrip().startswith("@_passthrough"), lines[0]
    assert lines[1].lstrip().startswith("async def decorated("), lines[1]

    # 기본 radius로도 def 줄이 snippet에 들어온다.
    snippet = read_snippet(ROOT, source["file"], source["line"])
    assert any("async def decorated(" in line for line in snippet["lines"])
