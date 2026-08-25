"""Coroutine 상태 기록. sys.monitoring의 start/yield/resume/return을 JSON Lines로 남긴다.

이 모듈이 기록 sink를 소유한다. loop.py와 middleware.py는 emit()으로 같은 stream에 쓴다.
emit()이 contracts/README.md의 공통 필드를 채우므로 세 모듈의 출력 shape가 같다.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import io
import itertools
import json
import os
import sys
import time
import weakref
from pathlib import Path

CO_COROUTINE = 0x0080
_TOOL_ID = sys.monitoring.PROFILER_ID
DISABLE = sys.monitoring.DISABLE
# raw sys.monitoring event -> (normalized type, category, label template)
_NORMALIZED = {
    "PY_START": ("coroutine.start", "running", "{name}()"),
    "PY_YIELD": ("coroutine.suspend", "await", "unknown await"),
    "PY_RESUME": ("coroutine.resume", "running", "{name}() resumed"),
    "PY_RETURN": ("coroutine.end", "running", "{name}()"),
}
# 자기 자신과 설치된 package는 프로젝트 코드가 아니다. .venv가 project root 안에
# 있는 경우가 흔하므로 root 검사만으로는 site-packages가 새어 들어온다.
_SELF = str(Path(__file__).resolve().parent.parent) + os.sep  # src/asyncscope/
_FOREIGN = tuple(
    str(Path(p).resolve()) + os.sep for p in {sys.prefix, sys.base_prefix}
)
# 모든 normalized event가 가지는 공통 필드 (contracts/README.md).
# span_id/parent_span_id/duration_ns는 span tree 작업에서 채운다.
_COMMON = {
    "request_id": None,
    "task_id": None,
    "span_id": None,
    "parent_span_id": None,
    "source": None,
    "duration_ns": None,
    "evidence": "observed",
    "confidence": None,
}

request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "asyncscope_request_id", default=None
)

# adapter가 "지금 이 프레임이 무엇을 기다리는 중인지"를 남기는 자리. (span_id, library, label).
# span_id는 adapter를 직접 호출한 프레임의 것이다 — 대조하지 않으면 adapter 호출 아래에서
# 도는 남의 suspend까지 같은 label을 받는다.
# (이름을 classifiers/awaits.py에 두면 monitoring이 classifiers를 import해야 해서 순환이
#  된다. request_id, TASK_ID_ATTR과 같은 이유로 여기 둔다)
awaiting: contextvars.ContextVar[tuple[str | None, str, str] | None] = contextvars.ContextVar(
    "asyncscope_awaiting", default=None
)

# Task identity는 sink가 소유한다. 값을 붙이는 쪽은 collector/tasks.py다.
# (이름을 tasks.py에 두면 monitoring이 tasks를 import해야 해서 순환이 된다)
TASK_ID_ATTR = "_asyncscope_task_id"

_prefix: str | None = None
_out = None

_span_counter = itertools.count(1)
# Task별 (실행 중, 중단됨) span 스택. Task가 죽으면 stdlib이 항목을 지우므로 정리 코드가
# 필요 없다. tasks.py의 done callback은 프로젝트 Task에만 붙어서 여기 쓸 수 없다.
_spans: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
# Task 밖에서 도는 coroutine용 fallback (lifespan, 직접 await).
_taskless: tuple[list, list] = ([], [])


def _new_span(started_ns: int | None) -> tuple[str, int | None]:
    """started_ns가 None이면 시작 시각을 관측하지 못한 span이다 (duration을 만들지 않는다)."""
    return (f"span-{next(_span_counter)}", started_ns)


def _stacks(task) -> tuple[list, list]:
    """(active, parked). active는 실행 중인 프레임, parked는 await에서 중단된 프레임이다."""
    if task is None:
        return _taskless
    pair = _spans.get(task)
    if pair is None:
        pair = ([], [])
        _spans[task] = pair
    return pair


def current_span_id() -> str | None:
    """지금 실행 중인 프로젝트 coroutine 프레임의 span_id. adapter wrapper가 호출자를 안다."""
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None
    stack, _ = _stacks(task)
    return stack[-1][0] if stack else None


def task_id(task) -> str | None:
    """tasks.py의 factory가 붙인 안정적 id. factory가 없었으면 None."""
    return getattr(task, TASK_ID_ATTR, None)


def relative_source(code) -> dict | None:
    """프로젝트 코드면 project-relative source, 아니면 None.

    .venv가 project root 안에 있는 경우가 흔하므로 root 검사만으로는 site-packages가
    새어 들어온다. asyncscope 자신도 프로젝트 코드가 아니다.
    """
    if _prefix is None:
        return None
    filename = code.co_filename
    if not filename.startswith(_prefix) or filename.startswith(_SELF) or filename.startswith(_FOREIGN):
        return None
    return {
        "file": filename[len(_prefix):],
        "function": code.co_name,
        "line": code.co_firstlineno,
    }


def emit(event_type: str, **fields) -> None:
    """tracing 중일 때만 한 줄 기록한다. timestamp와 공통 필드는 여기서 붙인다.

    request_id는 contextvar에서 읽는다. heartbeat Task는 request 밖에서 만들어지므로
    loop.blocked가 남의 request를 상속하지 않는다.

    ponytail: 기본 sink(EventBufferSink)는 여기서 dumps한 줄을 곧바로 loads해서 dict로
    되돌린다. 실측 ~2.5µs/event 중 ~1.4µs가 이 왕복이다. `_out`에 append가 있으면 row를
    그대로 넘기는 분기 하나로 사라지지만 buffer는 z 소유라 Day 11 오버헤드 측정 때 같이
    정한다. 지금 ratio는 1.1x 수준이라 급하지 않다.
    """
    if _out is not None:
        row = {
            "type": event_type,
            "timestamp_ns": time.perf_counter_ns(),
            **_COMMON,
            "request_id": request_id.get(),
            **fields,
        }
        _out.write(json.dumps(row) + "\n")


def _record(name: str, code):
    """추적 대상이 아닌 code location은 DISABLE로 되돌려 다시 호출되지 않게 한다.

    판정이 code object마다 고정(파일 경로 + coroutine 여부)이므로 영구히 꺼도 안전하다.
    덕분에 프로젝트 밖 함수는 최초 1회만 비용을 낸다. set_local_events처럼 대상 목록을
    미리 walk할 필요가 없고, 나중에 import되는 module도 자동으로 처리된다.
    """
    if _prefix is None:
        return DISABLE
    if not (code.co_flags & CO_COROUTINE):
        return DISABLE
    source = relative_source(code)
    if source is None:
        return DISABLE
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None
    event_type, category, label = _NORMALIZED[name]
    # span = 프로젝트 coroutine 프레임 1회 실행. sys.monitoring이 프레임 정체성을 주지
    # 않으므로 Task별 스택으로 잇는다 — await 체인은 Task 안에서 항상 well-nested다.
    # 중단은 안->밖, 재개는 밖->안 캐스케이드라 pop/push 순서가 그대로 맞는다.
    stack, parked = _stacks(task)
    now_ns = time.perf_counter_ns()
    duration_ns = None
    if name == "PY_START":
        parent = stack[-1][0] if stack else None
        entry = _new_span(now_ns)
        stack.append(entry)
    elif name == "PY_RESUME":
        parent = stack[-1][0] if stack else None
        # parked가 비었으면 tracing 시작 전에 중단된 프레임이다. 시작 시각을 모른다.
        entry = parked.pop() if parked else _new_span(None)
        stack.append(entry)
    else:
        # stack이 비면 tracing 시작 전에 진입한 프레임이다. 그래도 span을 발급해 스택
        # 균형을 맞춘다 — 여기서 건너뛰면 중단 캐스케이드의 자리가 하나 비어서, 바깥
        # 프레임의 resume이 안쪽 프레임의 span을 집어간다.
        entry = stack.pop() if stack else _new_span(None)
        parent = stack[-1][0] if stack else None
        if name == "PY_YIELD":
            parked.append(entry)
        elif entry[1] is not None:  # PY_RETURN, 시작을 관측한 span만 duration을 낸다
            duration_ns = now_ns - entry[1]
    # PY_YIELD의 code object는 yield하는 쪽이고 awaitee가 아니다. 무엇을 기다리는지는
    # classifiers/awaits.py가 adapter 진입점에서 남긴 값으로만 알 수 있고, 그 값은
    # adapter를 직접 호출한 프레임에만 적용한다 (span 대조).
    label_text = label.format(name=code.co_qualname)
    library = {}
    if category == "await":
        hint = awaiting.get()
        if hint is not None and hint[0] == entry[0]:
            library, label_text = {"library": hint[1]}, hint[2]
        else:
            library = {"library": None}
    # ponytail: retval은 기록하지 않는다 (민감 값 미수집 경계).
    emit(
        event_type,
        task_id=task_id(task) if task else None,
        span_id=entry[0],
        parent_span_id=parent,
        duration_ns=duration_ns,
        source=source,
        category=category,
        label=label_text,
        **library,
    )


def _unwind(code) -> None:
    """예외로 빠져나간 프레임은 PY_RETURN이 오지 않는다. 스택만 회수하고 이벤트는 남기지 않는다.

    회수하지 않으면 그 뒤 형제 span의 parent가 죽은 프레임을 가리킨다.

    ponytail: PY_UNWIND는 DISABLE할 수 없어서(`Cannot disable PY_UNWIND events`)
    다른 event처럼 최초 1회로 비용을 끝낼 수 없다. 대신 co_flags 검사 하나로 coroutine이
    아닌 프레임을 즉시 걸러낸다. 예외 전파가 잦은 앱에서 비용이 보이면 프로젝트 code
    object에만 set_local_events로 켜는 방향으로 올린다.
    """
    if _prefix is None or not (code.co_flags & CO_COROUTINE) or relative_source(code) is None:
        return
    try:
        task = asyncio.current_task()
    except RuntimeError:
        task = None
    stack, _ = _stacks(task)
    if stack:
        stack.pop()


def start(project_root: str | Path, out) -> None:
    """out은 write()를 가진 텍스트 스트림. 열려 있는 동안만 기록한다."""
    global _prefix, _out
    if _out is not None:
        raise RuntimeError("already tracing")
    m = sys.monitoring
    holder = m.get_tool(_TOOL_ID)
    if holder is not None:
        raise RuntimeError(
            f"sys.monitoring PROFILER_ID를 {holder!r}가 사용 중이다. "
            "해당 profiler를 끄고 다시 시도한다."
        )
    _prefix = str(Path(project_root).resolve()) + os.sep
    _out = out
    # 이전 session의 스택이 남아 있으면 span 부모가 엉킨다.
    _spans.clear()
    _taskless[0].clear()
    _taskless[1].clear()
    m.restart_events()  # 이전 실행에서 DISABLE된 location을 되살린다
    m.use_tool_id(_TOOL_ID, "asyncscope")
    mask = 0
    for name in _NORMALIZED:
        event = getattr(m.events, name)
        mask |= event
        m.register_callback(_TOOL_ID, event, lambda *a, _n=name: _record(_n, a[0]))
    # PY_UNWIND는 이벤트를 만들지 않는다 (계약에 없다). span 스택 회수 전용이다.
    mask |= m.events.PY_UNWIND
    m.register_callback(_TOOL_ID, m.events.PY_UNWIND, lambda *a: _unwind(a[0]))
    m.set_events(_TOOL_ID, mask)


def stop() -> None:
    global _prefix, _out
    if _out is None:
        return
    m = sys.monitoring
    m.set_events(_TOOL_ID, 0)
    for name in (*_NORMALIZED, "PY_UNWIND"):
        m.register_callback(_TOOL_ID, getattr(m.events, name), None)
    m.free_tool_id(_TOOL_ID)
    _prefix, _out = None, None


@contextlib.contextmanager
def tracing(project_root: str | Path):
    """with tracing(root) as records: ...  — 블록을 빠져나온 뒤 records가 채워진다.

    테스트용 전체 수집이므로 Task factory까지 붙인다. 없으면 coroutine 이벤트의
    task_id가 전부 None이 되어 Task별 검사가 공허하게 통과한다.
    """
    from . import tasks  # module-level import는 순환 (tasks가 emit을 쓴다)

    buf = io.StringIO()
    records: list[dict] = []
    start(project_root, buf)
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None
    if loop is not None:
        tasks.start(loop)
    try:
        yield records
    finally:
        if loop is not None:
            tasks.stop()
        stop()
        records.extend(json.loads(line) for line in buf.getvalue().splitlines())
