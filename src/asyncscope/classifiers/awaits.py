"""지원 adapter가 무엇을 기다리는지 이름 붙인다.

`PY_YIELD`의 code object는 yield하는 쪽이고 awaitee가 아니다. 그래서 adapter 진입점을
감싸서 "지금 무엇을 기다리는 중인지"를 contextvar로 남기고, monitoring이 suspend를
기록할 때 읽는다. 실제 호출을 관측하므로 evidence는 `observed`다.

값에 호출자의 span_id를 함께 담는다. 대조하지 않으면 adapter 호출 아래에서 도는 남의
suspend까지 같은 label을 받는다 (테스트 하네스가 httpx로 요청을 보내면 그 아래 handler의
`asyncio.sleep`이 "await HTTPX request"가 된다).
"""

from __future__ import annotations

import functools
import sys

from ..collector.monitoring import awaiting, current_span_id

# (module, class, method, library, label)
# label 문자열은 contracts/fixtures/adapter-awaits.json이 고정한 값이다. 그대로 쓴다.
# ponytail: library당 진입점 하나로 시작한다. asyncpg의 fetchrow/fetchval 같은 건 행을
# 추가하면 끝나므로 필요해질 때 늘린다.
ADAPTERS = (
    ("asyncpg", "Connection", "fetch", "asyncpg", "await asyncpg fetch"),
    ("httpx", "AsyncClient", "request", "httpx", "await HTTPX request"),
    ("redis.asyncio", "Redis", "execute_command", "redis.asyncio", "await Redis command"),
    # websockets는 구현이 두 갈래다. recv를 실제로 정의하는 base class만 감싸면
    # client/server 양쪽이 덮인다.
    (
        "websockets.asyncio.connection", "Connection", "recv",
        "websockets", "await WebSocket receive",
    ),
    (
        "websockets.legacy.protocol", "WebSocketCommonProtocol", "recv",
        "websockets", "await WebSocket receive",
    ),
)

# library -> 진입점 이름을 확인한 최소 version. 상한은 두지 않는다 — 적어 두면 새 version이
# 나올 때마다 거짓이 된다. 하한 미만이 설치되면 진입점 이름이 다를 수 있고, 그때 label이
# 조용히 안 붙는다 (unknown await로 남을 뿐 오탐은 아니다).
#
# runtime에서 검사하지 않는다. 남의 앱 시작 비용과 로그를 늘리지 않는다. 계약은 문서와
# tests/unit/test_classifiers.py가 고정한다.
SUPPORTED_VERSIONS = {
    "asyncpg": "0.30",
    "httpx": "0.27",
    "redis.asyncio": "5.0",
    "websockets": "13.0",
}

_patched: list[tuple[type, str, object]] = []


def _wrap(original, library: str, label: str):
    @functools.wraps(original)
    async def wrapper(*args, **kwargs):
        # 진입 시점의 span top이 이 adapter를 직접 호출한 프로젝트 프레임이다.
        token = awaiting.set((current_span_id(), library, label))
        try:
            return await original(*args, **kwargs)
        finally:
            awaiting.reset(token)

    return wrapper


def install() -> None:
    """이미 import된 adapter만 감싼다. 여기서 import하지 않는다.

    ponytail: 대상 앱이 쓰지도 않는 라이브러리를 우리가 import하면 시작 비용과
    deprecation 경고를 남의 앱에 떠넘기게 된다. 대신 handler 안에서 지연 import하는
    앱은 놓친다. 그런 앱이 나오면 import hook으로 올린다.
    """
    if _patched:
        return
    for module_name, class_name, method_name, library, label in ADAPTERS:
        module = sys.modules.get(module_name)
        owner = getattr(module, class_name, None) if module is not None else None
        # 상속받은 메서드를 subclass에 덮어쓰면 base class 행과 이중으로 감싼다.
        # 자기가 정의한 것만 감싼다.
        if owner is None or method_name not in vars(owner):
            continue
        original = getattr(owner, method_name)
        setattr(owner, method_name, _wrap(original, library, label))
        _patched.append((owner, method_name, original))


def uninstall() -> None:
    """감싼 것을 전부 되돌린다. 끈 뒤에 우리 코드가 남으면 안 된다."""
    while _patched:
        owner, method_name, original = _patched.pop()
        setattr(owner, method_name, original)
