"""adapter await 분류. 무엇을 기다리는지 아는 만큼만 이름 붙인다.

핵심은 오탐이다. adapter 진입점을 감싸고 contextvar만 보면, 그 adapter 호출 **아래에서**
도는 남의 suspend까지 같은 label을 받는다. 그래서 호출자의 span과 대조한다.
"""

import importlib
import inspect
import warnings
from pathlib import Path

import httpx
import pytest

from asyncscope.classifiers import awaits, blocking
from asyncscope.collector.monitoring import tracing

ROOT = Path(__file__).resolve().parent.parent.parent
LIBRARIES = {"asyncpg", "httpx", "redis.asyncio", "websockets"}


async def http_caller(client, url):
    """httpx를 직접 await하는 프로젝트 coroutine. 이 프레임의 suspend만 labeled여야 한다."""
    return await client.get(url)


async def _collect(path, caller=None):
    """demo app에 요청 하나를 보내고 수집된 이벤트를 돌려준다."""
    from examples.demo import app

    with tracing(ROOT) as rows:
        awaits.install()
        try:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://t") as client:
                if caller is None:
                    await client.get(path)
                else:
                    await caller(client, path)
        finally:
            awaits.uninstall()
    return rows


def _suspends(rows, function):
    return [
        row for row in rows
        if row["type"] == "coroutine.suspend"
        and (row["source"] or {}).get("function") == function
    ]


async def test_adapter_await_is_labeled_for_the_calling_frame():
    rows = await _collect("/demo/non-blocking", caller=http_caller)

    labeled = _suspends(rows, "http_caller")
    assert labeled
    for row in labeled:
        assert row["library"] == "httpx", row
        assert row["label"] == "await HTTPX request", row
        assert row["evidence"] == "observed", row
        assert row["confidence"] is None, row


async def test_adapter_label_does_not_leak_to_frames_underneath():
    """adapter 호출 아래에서 도는 handler는 자기 await를 기다린다. 남의 label을 쓰면 거짓말이다."""
    rows = await _collect("/demo/non-blocking", caller=http_caller)

    inner = _suspends(rows, "non_blocking") + _suspends(rows, "_step")
    assert inner, "handler의 suspend가 수집되지 않아 검사가 공허하다"
    for row in inner:
        assert row["library"] is None, row
        assert row["label"] == "unknown await", row


async def test_unsupported_await_stays_unknown():
    rows = await _collect("/demo/unknown-await")

    suspends = _suspends(rows, "unknown_await")
    assert suspends
    for row in suspends:
        assert row["library"] is None, row
        assert row["label"] == "unknown await", row


def test_uninstall_restores_the_original_entry_points():
    """끈 뒤에 우리 코드가 남으면 안 된다 — install 검사의 원칙."""
    original = httpx.AsyncClient.request

    awaits.install()
    try:
        assert httpx.AsyncClient.request is not original
        assert awaits._patched
    finally:
        awaits.uninstall()

    assert httpx.AsyncClient.request is original
    assert not awaits._patched


@pytest.mark.parametrize("library", sorted(LIBRARIES))
def test_each_library_has_a_live_entry_point(library):
    """오타 난 registry는 조용히 아무것도 못 잡는다. 실제 속성 경로를 확인한다."""
    pytest.importorskip(library, reason=f"{library} 미설치")

    rows = [row for row in awaits.ADAPTERS if row[3] == library]
    assert rows, f"{library} 항목이 ADAPTERS에 없다"

    resolved = []
    for module_name, class_name, method_name, _, _ in rows:
        try:
            # 구버전 갈래(websockets.legacy)는 import만 해도 경고를 낸다. 일부러 보는 것이다.
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", DeprecationWarning)
                module = importlib.import_module(module_name)
        except ImportError:
            continue  # 같은 library의 다른 구현 갈래 (websockets legacy/asyncio)
        owner = getattr(module, class_name, None)
        if owner is None or method_name not in vars(owner):
            continue
        assert inspect.iscoroutinefunction(getattr(owner, method_name)), (
            f"{module_name}.{class_name}.{method_name}가 async가 아니다"
        )
        resolved.append(module_name)

    assert resolved, f"{library}의 진입점을 하나도 찾지 못했다: {rows}"


def _resolve(dotted):
    """가장 긴 import 가능한 prefix를 import하고 나머지를 getattr로 따라간다."""
    parts = dotted.split(".")
    module = None
    for cut in range(len(parts) - 1, 0, -1):
        try:
            module = importlib.import_module(".".join(parts[:cut]))
        except ImportError:
            continue
        target = module
        for part in parts[cut:]:
            target = getattr(target, part)
        return target
    raise ImportError(dotted)


@pytest.mark.parametrize("dotted", sorted(blocking.KNOWN_BLOCKING))
def test_known_blocking_paths_resolve(dotted):
    """오타 난 registry는 조용히 아무것도 못 잡는다."""
    try:
        target = _resolve(dotted)
    except ImportError:
        pytest.skip(f"{dotted} 미설치")
    assert callable(target), dotted

    label, alternative = blocking.KNOWN_BLOCKING[dotted]
    assert label and alternative, dotted
