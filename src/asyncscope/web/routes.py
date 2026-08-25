"""AsyncScope 내부 HTTP API.

FastAPI를 runtime dependency로 만들지 않기 위해 순수 ASGI로 처리한다.
"""

from __future__ import annotations

import json
from urllib.parse import parse_qs, unquote

from ..analysis.requests import RequestQueryError, get_request_detail, query_requests

API_PREFIX = "/__asyncscope__/api"
REQUESTS_PATH = f"{API_PREFIX}/requests"


async def handle_api(buffer, scope, send) -> bool:
    """내부 API 요청이면 응답하고 True를 반환한다."""

    if scope["type"] != "http":
        return False

    path = scope.get("path", "")
    if not path.startswith(API_PREFIX):
        return False

    if scope.get("method") != "GET":
        await _json_response(send, 405, {"error": "method_not_allowed"})
        return True

    if path == REQUESTS_PATH:
        await _handle_requests(buffer, scope, send)
        return True

    detail_prefix = f"{REQUESTS_PATH}/"
    if path.startswith(detail_prefix) and path != detail_prefix:
        request_id = unquote(path.removeprefix(detail_prefix))
        await _handle_request_detail(buffer, request_id, send)
        return True

    await _json_response(send, 404, {"error": "not_found"})
    return True


async def _handle_requests(buffer, scope, send) -> None:
    params = _query_params(scope)
    try:
        payload = query_requests(
            buffer.snapshot(),
            search=_one(params, "q"),
            status=params.get("status"),
            method=params.get("method"),
            path=params.get("path"),
            sort=_one(params, "sort", "started_at_ns"),
            order=_one(params, "order", "desc"),
            page=_one(params, "page", "1"),
            page_size=_one(params, "page_size", "50"),
        )
    except RequestQueryError as exc:
        await _json_response(send, 400, {"error": "bad_request", "message": str(exc)})
        return

    await _json_response(send, 200, payload)


async def _handle_request_detail(buffer, request_id: str, send) -> None:
    payload = get_request_detail(buffer.snapshot(), request_id)
    if payload is None:
        await _json_response(send, 404, {"error": "not_found"})
        return

    await _json_response(send, 200, payload)


def _query_params(scope) -> dict[str, list[str]]:
    raw = scope.get("query_string", b"")
    return parse_qs(raw.decode("utf-8"), keep_blank_values=True)


def _one(params: dict[str, list[str]], name: str, default: str | None = None) -> str | None:
    values = params.get(name)
    if not values:
        return default
    return values[-1]


async def _json_response(send, status: int, payload: dict) -> None:
    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", b"application/json; charset=utf-8")],
        }
    )
    await send({"type": "http.response.body", "body": body})
