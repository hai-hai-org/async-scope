"""빌드된 대시보드를 `/__asyncscope__/`에서 서빙한다.

Starlette의 StaticFiles를 쓰지 않는다. runtime dependency를 0으로 유지하는 게 이
프로젝트의 결정이고(`routes.py` 참고), 여기서 필요한 건 stdlib으로 충분하다.
"""

from __future__ import annotations

import mimetypes
from pathlib import Path

UI_PREFIX = "/__asyncscope__"

# vite build의 outDir. 개발 중에는 비어 있을 수 있다 (gitignore 대상).
STATIC_DIR = Path(__file__).parent / "static"

NOT_BUILT = (
    b"AsyncScope dashboard is not built.\n"
    b"Run `make dashboard` in the repository, or install a released wheel.\n"
)


async def handle_static(path: str, method: str | None, send) -> bool:
    """`/__asyncscope__/...`를 응답한다. prefix는 이미 우리 것이므로 항상 True."""

    if method not in ("GET", "HEAD"):
        await _respond(send, 405, b"text/plain; charset=utf-8", b"method not allowed")
        return True

    if path == UI_PREFIX:
        # 번들은 상대 경로(base "./")를 쓴다. 끝 슬래시가 없으면 asset이 한 단계
        # 위에서 풀려 404가 나므로, 기준점을 만들어 주고 다시 보낸다.
        await _respond(
            send,
            307,
            b"text/plain",
            b"",
            extra=[(b"location", f"{UI_PREFIX}/".encode())],
        )
        return True

    root = STATIC_DIR.resolve()
    target = (root / (path[len(UI_PREFIX) + 1 :] or "index.html")).resolve()
    # 패키지 밖은 읽지 않는다. `..`가 섞여 들어와도 여기서 걸린다.
    if not target.is_relative_to(root) or not target.is_file():
        body = NOT_BUILT if not (root / "index.html").is_file() else b"not found"
        await _respond(send, 404, b"text/plain; charset=utf-8", body)
        return True

    # ponytail: 동기 read. 개발용 도구의 번들 몇 개다. 파일이 커지면 to_thread로 옮긴다.
    body = target.read_bytes()
    media = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    # assets/*는 파일명에 content hash가 박혀 있어 영구 캐시해도 안전하다.
    cache = (
        b"public, max-age=31536000, immutable"
        if target.parent == root / "assets"
        else b"no-cache"
    )
    await _respond(
        send,
        200,
        media.encode(),
        b"" if method == "HEAD" else body,
        extra=[(b"cache-control", cache), (b"content-length", str(len(body)).encode())],
    )
    return True


async def _respond(send, status: int, media: bytes, body: bytes, extra=()) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [(b"content-type", media), *extra],
        }
    )
    await send({"type": "http.response.body", "body": body})
