"""ASGI middleware. request와 그 안에서 생긴 Task를 contextvars로 잇는다."""

from __future__ import annotations

import itertools

from .monitoring import emit, request_id

_counter = itertools.count(1)


class RequestTracker:
    """순수 ASGI. framework 의존성 없음.

    contextvar를 여기서 set하면 handler 안의 asyncio.create_task가 context를
    복사하므로 자식 Task까지 같은 request_id를 갖는다.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        rid = f"req-{next(_counter)}"
        token = request_id.set(rid)
        # ponytail: query string은 기록하지 않는다 (민감 값 미수집 경계). path만.
        emit(event="request.start", request_id=rid, method=scope["method"], path=scope["path"])
        status = None

        async def send_wrapper(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            emit(event="request.end", request_id=rid, status=status)
            request_id.reset(token)
