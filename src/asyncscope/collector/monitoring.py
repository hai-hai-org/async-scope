"""Coroutine 상태 기록 (M0). sys.monitoring의 start/yield/resume/return을 JSON Lines로 남긴다.

이 모듈이 기록 sink를 소유한다. loop.py와 middleware.py는 emit()으로 같은 stream에 쓴다.
"""

from __future__ import annotations

import asyncio
import contextlib
import contextvars
import io
import json
import os
import sys
import time
from pathlib import Path

CO_COROUTINE = 0x0080
_TOOL_ID = sys.monitoring.PROFILER_ID
DISABLE = sys.monitoring.DISABLE
_EVENTS = ("PY_START", "PY_YIELD", "PY_RESUME", "PY_RETURN")
# 자기 자신과 설치된 package는 프로젝트 코드가 아니다. .venv가 project root 안에
# 있는 경우가 흔하므로 root 검사만으로는 site-packages가 새어 들어온다.
_SELF = str(Path(__file__).resolve().parent.parent) + os.sep  # src/asyncscope/
_FOREIGN = tuple(
    str(Path(p).resolve()) + os.sep for p in {sys.prefix, sys.base_prefix}
)

request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "asyncscope_request_id", default=None
)

_prefix: str | None = None
_out = None
def emit(**fields) -> None:
    """tracing 중일 때만 한 줄 기록한다. ts는 여기서 붙인다."""
    if _out is not None:
        _out.write(json.dumps({"ts": time.perf_counter_ns(), **fields}) + "\n")


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
    filename = code.co_filename
    if not filename.startswith(_prefix) or filename.startswith(_SELF) or filename.startswith(_FOREIGN):
        return DISABLE
    try:
        task = asyncio.current_task()
        task_name = task.get_name() if task else None
    except RuntimeError:
        task_name = None
    # ponytail: retval은 기록하지 않는다 (민감 값 미수집 경계).
    emit(
        event=name,
        coroutine=code.co_qualname,
        file=filename[len(_prefix):],
        line=code.co_firstlineno,
        task=task_name,
        request_id=request_id.get(),
    )


def start(project_root: str | Path, out) -> None:
    """out은 write()를 가진 텍스트 스트림. 열려 있는 동안만 기록한다."""
    global _prefix, _out
    if _out is not None:
        raise RuntimeError("already tracing")
    _prefix = str(Path(project_root).resolve()) + os.sep
    _out = out
    m = sys.monitoring
    m.restart_events()  # 이전 실행에서 DISABLE된 location을 되살린다
    m.use_tool_id(_TOOL_ID, "asyncscope")
    mask = 0
    for name in _EVENTS:
        event = getattr(m.events, name)
        mask |= event
        m.register_callback(_TOOL_ID, event, lambda *a, _n=name: _record(_n, a[0]))
    m.set_events(_TOOL_ID, mask)


def stop() -> None:
    global _prefix, _out
    if _out is None:
        return
    m = sys.monitoring
    m.set_events(_TOOL_ID, 0)
    for name in _EVENTS:
        m.register_callback(_TOOL_ID, getattr(m.events, name), None)
    m.free_tool_id(_TOOL_ID)
    _prefix, _out = None, None


@contextlib.contextmanager
def tracing(project_root: str | Path):
    """with tracing(root) as records: ...  — 블록을 빠져나온 뒤 records가 채워진다."""
    buf = io.StringIO()
    records: list[dict] = []
    start(project_root, buf)
    try:
        yield records
    finally:
        stop()
        records.extend(json.loads(line) for line in buf.getvalue().splitlines())

