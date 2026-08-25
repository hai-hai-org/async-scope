"""공개 진입점. tracing을 켜고 끄는 곳은 여기 하나다.

    from asyncscope import AsyncScope

    app = FastAPI()
    traced = AsyncScope(app).install()   # uvicorn에 넘길 ASGI app

테스트나 데모처럼 앱 수명 주기에 맞춰 켜야 하면 install()과 uninstall()을 lifespan에서
직접 부른다 (examples/demo.py 참고).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from .classifiers import awaits
from .collector import loop as loop_collector
from .collector import monitoring
from .collector import tasks as task_collector
from .collector.middleware import RequestTracker
from .storage import EventBuffer, EventBufferSink
from .web.routes import handle_api

SINK_NAME = "asyncscope.jsonl"


def unsupported_reason(version_info, implementation_name: str) -> str | None:
    """지원하지 않는 런타임이면 원인을, 지원하면 None을 돌려준다.

    sys.monitoring은 CPython 3.12에서 들어왔다. 다른 구현이나 낮은 version에서는
    수집 자체가 불가능하므로 install()에서 원인을 설명하고 멈춘다.
    """
    if implementation_name != "cpython":
        return f"AsyncScope는 CPython에서만 동작한다 (현재 {implementation_name})."
    if version_info < (3, 12):
        current = ".".join(str(part) for part in version_info[:3])
        return f"AsyncScope는 sys.monitoring을 사용하므로 CPython 3.12 이상이 필요하다 (현재 {current})."
    return None


class AsyncScope:
    """ASGI app을 감싸고 수집기 lifecycle을 소유한다.

    install()이 self를 반환하므로 `traced = AsyncScope(app).install()` 한 줄로 끝난다.
    """

    def __init__(
        self,
        app,
        project_root: str | Path | None = None,
        out=None,
        buffer_size: int = 1000,
        buffer: EventBuffer | None = None,
        threshold: float = loop_collector.DEFAULT_THRESHOLD,
        interval: float = loop_collector.DEFAULT_INTERVAL,
    ):
        self.app = app
        self.project_root = Path(project_root) if project_root else Path.cwd()
        self.threshold = threshold
        self.interval = interval
        self.buffer = buffer if buffer is not None else EventBuffer(buffer_size)
        self._out = out
        self._default_sink = False  # 기본 sink만 우리가 정리한다
        self._tracker = None
        self._heartbeat: asyncio.Task | None = None

    @property
    def installed(self) -> bool:
        return self._tracker is not None

    @property
    def events(self) -> list[dict]:
        return self.buffer.snapshot()

    def install(self):
        """tracing을 켜고 ASGI app으로 쓸 self를 반환한다."""
        if self.installed:
            raise RuntimeError("already installed")
        reason = unsupported_reason(sys.version_info, sys.implementation.name)
        if reason:
            raise RuntimeError(reason)

        if self._out is None:
            self._out = EventBufferSink(self.buffer)
            self._default_sink = True
        monitoring.start(self.project_root, self._out)
        awaits.install()
        self._tracker = RequestTracker(self.app)
        self._attach_to_loop()
        return self

    def uninstall(self) -> None:
        """monitoring callback, heartbeat Task, 우리가 만든 sink를 모두 정리한다.

        out=으로 받은 sink는 호출자 소유이므로 닫지 않는다.
        """
        if self._heartbeat is not None:
            self._heartbeat.cancel()
            self._heartbeat = None
        task_collector.stop()
        awaits.uninstall()
        monitoring.stop()
        self._tracker = None
        if self._default_sink:
            self._out = None
            self._default_sink = False

    def _attach_to_loop(self) -> None:
        """loop가 필요한 부착(Task factory, heartbeat). 없으면 첫 요청에서 다시 시도한다."""
        if self._heartbeat is not None:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task_collector.start(loop)
        self._heartbeat = loop_collector.start(self.threshold, self.interval)

    async def __call__(self, scope, receive, send):
        if await handle_api(self, scope, receive, send):
            return None
        if self._tracker is None:
            return await self.app(scope, receive, send)
        # import 시점에 install()하면 loop가 없어서 여기서 붙인다.
        self._attach_to_loop()
        return await self._tracker(scope, receive, send)
