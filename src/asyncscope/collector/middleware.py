"""ASGI middleware. request와 그 안에서 생긴 Task를 contextvars로 잇는다."""

from __future__ import annotations

import asyncio
import itertools
import time

from .monitoring import emit, request_id

_counter = itertools.count(1)


def outcome(status_code: int | None, error: BaseException | None) -> dict:
    """request.end의 status 판정. contracts/fixtures의 failure-cancel/disconnect 규칙이다."""
    if isinstance(error, asyncio.CancelledError):
        return {"status": "cancelled", "category": "cancelled", "label": "request cancelled"}
    if error is not None:
        return {"status": "failed", "category": "failure", "label": "handler failed"}
    if status_code is None:
        # response를 시작하지 못하고 끝났다. 원인을 client 연결 해제로만 설명한다.
        return {
            "status": "disconnected",
            "category": "disconnected",
            "label": "client disconnected",
            "disconnect_reason": "client_disconnected",
        }
    if status_code >= 500:
        return {"status": "failed", "category": "failure", "label": f"HTTP {status_code}"}
    return {"status": "completed"}


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
        emit("request.start", method=scope["method"], path=scope["path"])
        started_ns = time.perf_counter_ns()
        status_code = None
        error = None

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                # Timeline의 Response 구간은 여기서 시작한다. request.end만으로는
                # 응답이 언제 나가기 시작했는지 알 수 없다.
                emit(
                    "response.start",
                    status_code=status_code,
                    category="response",
                    label=f"HTTP {status_code}",
                )
            # ponytail: http.response.body는 기록하지 않는다. 마지막 body의 시각은
            # request.end와 사실상 같아서 구간이 생기지 않는다. streaming 응답의
            # chunk별 시각이 필요해지면 그때 more_body를 보고 추가한다.
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except BaseException as exc:  # 기록만 하고 앱 동작은 바꾸지 않는다
            error = exc
            raise
        finally:
            emit(
                "request.end",
                duration_ns=time.perf_counter_ns() - started_ns,
                status_code=status_code,
                **outcome(status_code, error),
            )
            request_id.reset(token)
