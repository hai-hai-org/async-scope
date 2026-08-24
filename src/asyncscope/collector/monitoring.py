"""Coroutine 상태 기록. sys.monitoring의 start/yield/resume/return을 JSON Lines로 남긴다.

이 모듈이 기록 sink를 소유한다. loop.py와 middleware.py는 emit()으로 같은 stream에 쓴다.
emit()이 contracts/README.md의 공통 필드를 채우므로 세 모듈의 출력 shape가 같다.
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

_prefix: str | None = None
_out = None
def emit(event_type: str, **fields) -> None:
    """tracing 중일 때만 한 줄 기록한다. timestamp와 공통 필드는 여기서 붙인다.

    request_id는 contextvar에서 읽는다. heartbeat Task는 request 밖에서 만들어지므로
    loop.blocked가 남의 request를 상속하지 않는다.
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
    filename = code.co_filename
    if not filename.startswith(_prefix) or filename.startswith(_SELF) or filename.startswith(_FOREIGN):
        return DISABLE
    try:
        task = asyncio.current_task()
        task_name = task.get_name() if task else None
    except RuntimeError:
        task_name = None
    event_type, category, label = _NORMALIZED[name]
    # ponytail: suspend는 무엇을 await하는지 모른다. PY_YIELD의 code object는 yield하는
    # 쪽이고 awaitee가 아니다. 지원 adapter label은 classifiers/awaits.py에서 붙인다.
    library = {"library": None} if category == "await" else {}
    # ponytail: retval은 기록하지 않는다 (민감 값 미수집 경계).
    emit(
        event_type,
        task_id=task_name,
        source={
            "file": filename[len(_prefix):],
            "function": code.co_name,
            "line": code.co_firstlineno,
        },
        category=category,
        label=label.format(name=code.co_qualname),
        **library,
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
    for name in _NORMALIZED:
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
    for name in _NORMALIZED:
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
