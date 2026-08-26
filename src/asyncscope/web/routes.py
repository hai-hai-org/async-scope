"""AsyncScope 내부 HTTP API.

FastAPI를 runtime dependency로 만들지 않기 위해 순수 ASGI로 처리한다.
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import parse_qs, unquote

from ..analysis import QueryError
from ..analysis.findings import get_finding, query_findings
from ..analysis.metrics import DEFAULT_WINDOW_S, summarize
from ..analysis.requests import get_request_detail, query_requests
from ..config import apply_settings_patch, settings_payload, settings_state
from ..export import buffer_metadata, clear_buffer, export_payload, replay_into
from ..source import read_snippet
from .sse import handle_sse

API_PREFIX = "/__asyncscope__/api"
REQUESTS_PATH = f"{API_PREFIX}/requests"
FINDINGS_PATH = f"{API_PREFIX}/findings"
SOURCE_PATH = f"{API_PREFIX}/source"
EVENTS_PATH = f"{API_PREFIX}/events"
SUMMARY_PATH = f"{API_PREFIX}/summary"
SETTINGS_PATH = f"{API_PREFIX}/settings"
EXPORT_PATH = f"{API_PREFIX}/export"
REPLAY_PATH = f"{API_PREFIX}/replay"
CLEAR_PATH = f"{API_PREFIX}/buffer/clear"

# snippet은 화면에 붙는 문맥이지 파일 뷰어가 아니다.
MAX_RADIUS = 50


async def handle_api(app_scope, scope, receive, send) -> bool:
    """내부 API 요청이면 응답하고 True를 반환한다.

    AsyncScope 인스턴스를 통째로 받는다. buffer, project_root, tracing 상태를 각각
    인자로 늘리면 endpoint를 더할 때마다 시그니처가 자란다.
    """

    if scope["type"] != "http":
        return False

    path = scope.get("path", "")
    if not path.startswith(API_PREFIX):
        return False

    method = scope.get("method")
    if path == SETTINGS_PATH:
        await _handle_settings(app_scope, method, receive, send)
        return True
    if path == REPLAY_PATH:
        await _handle_replay(app_scope.buffer, method, receive, send)
        return True
    if path == CLEAR_PATH:
        await _handle_clear(app_scope.buffer, method, send)
        return True
    # /findings/<id>/feedback은 detail 분기(/findings/<id>)보다 먼저 걸러야 한다.
    if (feedback_id := _feedback_id(path)) is not None:
        await _handle_feedback(app_scope, feedback_id, method, receive, send)
        return True

    if method != "GET":
        await _json_response(send, 405, {"error": "method_not_allowed"})
        return True

    buffer = app_scope.buffer
    params = _query_params(scope)
    if path == REQUESTS_PATH:
        await _guarded(send, lambda: query_requests(buffer.snapshot(), **_request_args(params)))
    elif path == FINDINGS_PATH:
        await _guarded(send, lambda: _findings(app_scope, params))
    elif path == EVENTS_PATH:
        await _handle_events(buffer, params, scope, receive, send)
    elif path == SUMMARY_PATH:
        await _guarded(send, lambda: _summary(app_scope, params))
    elif path == EXPORT_PATH:
        await _json_response(send, 200, export_payload(buffer))
    elif path == SOURCE_PATH:
        await _handle_source(app_scope.project_root, params, send)
    elif (request_id := _detail_id(path, REQUESTS_PATH)) is not None:
        await _detail_response(send, get_request_detail(buffer.snapshot(), request_id))
    elif (finding_id := _detail_id(path, FINDINGS_PATH)) is not None:
        await _detail_response(send, _finding(app_scope, finding_id))
    else:
        await _json_response(send, 404, {"error": "not_found"})
    return True


def _request_args(params: dict[str, list[str]]) -> dict:
    return {
        "search": _one(params, "q"),
        "status": params.get("status"),
        "method": params.get("method"),
        "path": params.get("path"),
        "sort": _one(params, "sort", "started_at_ns"),
        "order": _one(params, "order", "desc"),
        "page": _one(params, "page", "1"),
        "page_size": _one(params, "page_size", "50"),
    }


def _finding_args(params: dict[str, list[str]]) -> dict:
    return {
        "finding_type": params.get("type"),
        "severity": params.get("severity"),
        "evidence": params.get("evidence"),
        "request_id": params.get("request_id"),
        "page": _one(params, "page", "1"),
        "page_size": _one(params, "page_size", "50"),
    }


def _findings(app_scope, params: dict[str, list[str]]) -> dict:
    payload = query_findings(
        app_scope.buffer.snapshot(),
        project_root=app_scope.project_root,
        **_finding_args(params),
    )
    feedback = settings_state(app_scope).feedback
    for finding in payload["items"]:
        finding["feedback"] = feedback.marks(finding["finding_id"])
    return payload


def _finding(app_scope, finding_id: str) -> dict | None:
    """analysis는 feedback을 모른다. event만 읽는 계층으로 유지하고 표시는 여기서 얹는다."""
    finding = get_finding(
        app_scope.buffer.snapshot(), finding_id, project_root=app_scope.project_root
    )
    if finding is None:
        return None
    finding["feedback"] = settings_state(app_scope).feedback.marks(finding_id)
    return finding


async def _handle_feedback(app_scope, finding_id: str, method: str, receive, send) -> None:
    """finding 하나에 사용자 표시를 남긴다. 표시해도 목록에서 걸러내지 않는다 — 숨김은 UI 결정이다."""
    if method != "POST":
        await _json_response(send, 405, {"error": "method_not_allowed"})
        return

    finding = _finding(app_scope, finding_id)
    if finding is None:
        await _json_response(send, 404, {"error": "not_found"})
        return

    try:
        body = await _json_body(receive)
        if not isinstance(body, dict):
            raise QueryError("feedback payload must be an object")
        settings_state(app_scope).feedback.record(finding_id, body.get("kind"))
    except QueryError as exc:
        await _json_response(send, 400, {"error": "bad_request", "message": str(exc)})
        return

    await _json_response(send, 200, _finding(app_scope, finding_id))


def _feedback_id(path: str) -> str | None:
    prefix, suffix = f"{FINDINGS_PATH}/", "/feedback"
    if not path.startswith(prefix) or not path.endswith(suffix):
        return None
    return unquote(path[len(prefix) : -len(suffix)]) or None


def _summary(app_scope, params: dict[str, list[str]]) -> dict:
    """metrics 계산은 analysis가, 벽시계와 buffer 상태는 여기가 담당한다.

    `stale`, `paused`, `disconnected`는 서버가 판정하지 않는다. 응답은 항상 방금 계산한
    값이고, poll 실패나 SSE 끊김은 client만 안다. 서버는 자기가 아는 상태만 알려 준다.
    """
    buffer = app_scope.buffer
    events = buffer.snapshot()
    payload = summarize(
        events,
        now_ns=_metrics_anchor(events, buffer.source),
        window_s=_one(params, "window", str(DEFAULT_WINDOW_S)),
    )
    # 이벤트의 timestamp_ns는 perf_counter_ns라 벽시계가 아니다. 값을 섞지 않는다.
    # 대신 두 시계를 나란히 읽어 기준점 쌍으로 내보낸다. 화면이 event 시각을 사람이
    # 읽는 시각으로 옮기려면 이 쌍이 필요하다. 변환은 client가 하고 여기서는
    # 계산하지 않는다. 두 값 사이에 다른 작업이 끼면 기준점이 틀어지므로 붙여 읽는다.
    wall, perf = datetime.now(UTC), time.perf_counter_ns()
    return {
        "server_time": wall.isoformat(),
        "server_perf_counter_ns": perf,
        "status": app_scope.status,
        "status_reason": app_scope.status_reason,
        **payload,
        "buffer": buffer_metadata(buffer),
    }


def _metrics_anchor(events: list[dict], source: str) -> int:
    """window를 어디에 붙일지. `timestamp_ns`는 perf_counter_ns로 프로세스 상대값이다.

    replay된 이벤트는 남의 프로세스 축이라 지금 perf_counter와 비교할 수 없다. 그대로
    쓰면 window가 벌어져 capture 전체가 밖으로 밀려나고 "blocking 없음, 트래픽 없음"이
    된다. capture는 자기 시간축으로 재야 한다.
    """
    if source == "live" or not events:
        return time.perf_counter_ns()
    return max(event.get("timestamp_ns") or 0 for event in events)


async def _handle_source(project_root: str | Path, params: dict[str, list[str]], send) -> None:
    """project root 밖은 읽지 않는다. 경계 판정은 asyncscope/source.py 하나뿐이다."""
    file = _one(params, "file")
    if not file:
        await _json_response(send, 400, {"error": "bad_request", "message": "file is required"})
        return
    try:
        line = int(_one(params, "line", "1"))
        radius = int(_one(params, "radius", "5"))
    except (TypeError, ValueError):
        await _json_response(
            send, 400, {"error": "bad_request", "message": "line and radius must be integers"}
        )
        return
    if line < 1 or not 0 <= radius <= MAX_RADIUS:
        await _json_response(
            send,
            400,
            {"error": "bad_request", "message": f"line must be >= 1 and radius <= {MAX_RADIUS}"},
        )
        return

    try:
        payload = read_snippet(project_root, file, line, radius)
    except PermissionError as exc:
        await _json_response(send, 403, {"error": "forbidden", "message": str(exc)})
        return
    except OSError:
        # 없는 파일과 디렉터리. 어느 쪽인지 알려 주면 root 안 구조가 새어 나간다.
        await _json_response(send, 404, {"error": "not_found"})
        return

    await _json_response(send, 200, payload)


async def _handle_events(buffer, params: dict[str, list[str]], scope, receive, send) -> None:
    try:
        await handle_sse(buffer, params, scope, receive, send)
    except QueryError as exc:
        await _json_response(send, 400, {"error": "bad_request", "message": str(exc)})


async def _handle_settings(app_scope, method: str, receive, send) -> None:
    if method == "GET":
        await _json_response(send, 200, settings_payload(app_scope))
        return
    if method == "PATCH":
        try:
            body = await _json_body(receive)
            payload = apply_settings_patch(app_scope, body)
        except QueryError as exc:
            await _json_response(send, 400, {"error": "bad_request", "message": str(exc)})
            return
        await _json_response(send, 200, payload)
        return
    await _json_response(send, 405, {"error": "method_not_allowed"})


async def _handle_replay(buffer, method: str, receive, send) -> None:
    if method != "POST":
        await _json_response(send, 405, {"error": "method_not_allowed"})
        return
    try:
        body = await _json_body(receive)
        payload = replay_into(buffer, body)
    except QueryError as exc:
        await _json_response(send, 400, {"error": "bad_request", "message": str(exc)})
        return
    await _json_response(send, 200, payload)


async def _handle_clear(buffer, method: str, send) -> None:
    """버퍼를 비운다. body가 없으므로 `_json_body`로 읽을 게 없다 — POST 확인만 한다."""
    if method != "POST":
        await _json_response(send, 405, {"error": "method_not_allowed"})
        return
    await _json_response(send, 200, clear_buffer(buffer))


async def _guarded(send, query) -> None:
    try:
        payload = query()
    except QueryError as exc:
        await _json_response(send, 400, {"error": "bad_request", "message": str(exc)})
        return
    await _json_response(send, 200, payload)


async def _detail_response(send, payload) -> None:
    if payload is None:
        await _json_response(send, 404, {"error": "not_found"})
        return
    await _json_response(send, 200, payload)


def _detail_id(path: str, collection: str) -> str | None:
    prefix = f"{collection}/"
    if not path.startswith(prefix) or path == prefix:
        return None
    return unquote(path.removeprefix(prefix))


def _query_params(scope) -> dict[str, list[str]]:
    raw = scope.get("query_string", b"")
    return parse_qs(raw.decode("utf-8"), keep_blank_values=True)


def _one(params: dict[str, list[str]], name: str, default: str | None = None) -> str | None:
    values = params.get(name)
    if not values:
        return default
    return values[-1]


async def _json_body(receive) -> dict:
    chunks = []
    more_body = True
    while more_body:
        message = await receive()
        if message.get("type") == "http.disconnect":
            raise QueryError("request body disconnected")
        chunks.append(message.get("body", b""))
        more_body = message.get("more_body", False)

    raw = b"".join(chunks).strip()
    if not raw:
        return {}
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise QueryError("request body must be valid JSON") from exc
    if not isinstance(payload, dict):
        raise QueryError("request body must be a JSON object")
    return payload


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
