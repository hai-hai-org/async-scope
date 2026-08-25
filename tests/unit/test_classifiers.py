"""adapter await 분류. 무엇을 기다리는지 아는 만큼만 이름 붙인다.

핵심은 오탐이다. adapter 진입점을 감싸고 contextvar만 보면, 그 adapter 호출 **아래에서**
도는 남의 suspend까지 같은 label을 받는다. 그래서 호출자의 span과 대조한다.
"""

import asyncio
import contextlib
import importlib
import inspect
import json
import re
import warnings
from importlib import metadata
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


@contextlib.contextmanager
def _stubbed_entry_point(module_name, class_name, method_name):
    """진입점을 async stub으로 바꾼다.

    실제 DB·Redis·WebSocket 서버 없이 수집 경로를 통과시키려는 것이다. 가짜인 건 상대편
    서버뿐이고, awaits.install()이 감싸는 것도 monitoring이 기록하는 것도 실제 코드다.
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            module = importlib.import_module(module_name)
    except ImportError:
        pytest.skip(f"{module_name} 미설치")

    owner = getattr(module, class_name, None)
    if owner is None or method_name not in vars(owner):
        pytest.skip(f"{module_name}.{class_name}.{method_name} 없음")

    original = vars(owner)[method_name]

    async def stub(self, *args, **kwargs):
        await asyncio.sleep(0)  # 실제 adapter처럼 loop에 한 번 양보한다
        return "stub"

    setattr(owner, method_name, stub)
    try:
        yield owner
    finally:
        setattr(owner, method_name, original)


@pytest.mark.parametrize(
    ("module_name", "class_name", "method_name", "library", "label"),
    awaits.ADAPTERS,
    ids=[f"{row[0]}.{row[2]}" for row in awaits.ADAPTERS],
)
async def test_adapter_entry_point_actually_emits_its_label(
    module_name, class_name, method_name, library, label
):
    """contracts/fixtures/adapter-awaits.json이 약속한 값을 collector가 실제로 낸다.

    진입점이 존재하는지는 test_each_library_has_a_live_entry_point가 본다. 여기서는
    그래서 label이 실제로 붙는지를 본다.
    """
    with _stubbed_entry_point(module_name, class_name, method_name) as owner:

        async def adapter_caller():
            """adapter를 직접 await하는 프로젝트 coroutine. 이 프레임만 labeled여야 한다."""
            # 실제 인스턴스를 만들면 반쯤 초기화된 Connection의 __del__이 시끄럽다.
            # wrapper는 self를 보지 않으므로 None이면 충분하다.
            return await getattr(owner, method_name)(None)

        with tracing(ROOT) as rows:
            awaits.install()
            try:
                assert await adapter_caller() == "stub"
            finally:
                awaits.uninstall()

    labeled = _suspends(rows, "adapter_caller")
    assert labeled, f"{library} 호출 프레임의 suspend가 수집되지 않았다"
    for row in labeled:
        assert row["library"] == library, row
        assert row["label"] == label, row
        assert row["evidence"] == "observed", row
        assert row["confidence"] is None, row


def test_adapter_fixture_matches_the_registry():
    """fixture와 registry가 어긋나면 UI가 collector가 내지 않는 label을 기다린다."""
    fixture = json.loads(
        (ROOT / "contracts" / "fixtures" / "adapter-awaits.json").read_text()
    )
    registry = {row[3]: row[4] for row in awaits.ADAPTERS}

    labeled = {
        event["library"]: event["label"]
        for event in fixture["events"]
        if event.get("library") is not None
    }
    assert labeled, "adapter fixture에 labeled suspend가 없다"
    assert labeled == {library: registry[library] for library in labeled}


# library -> 배포 이름. redis.asyncio는 redis 배포에 들어 있다.
DISTRIBUTIONS = {
    "asyncpg": "asyncpg",
    "httpx": "httpx",
    "redis.asyncio": "redis",
    "websockets": "websockets",
}


def _version_tuple(text: str) -> tuple[int, ...]:
    """ponytail: 선행 숫자 3개만 본다. packaging을 runtime 의존성으로 들이지 않는다
    (`dependencies = []`가 이 프로젝트의 전제다). rc/dev suffix 비교가 필요해지면 그때 올린다.
    """
    return tuple(int(part) for part in re.findall(r"\d+", text)[:3])


def test_every_adapter_declares_a_supported_version():
    """adapter를 추가하고 version을 빼먹으면 계약이 조용히 빈다."""
    assert set(awaits.SUPPORTED_VERSIONS) == {row[3] for row in awaits.ADAPTERS}

    for library, minimum in awaits.SUPPORTED_VERSIONS.items():
        assert _version_tuple(minimum), f"{library}의 하한 {minimum!r}을 읽을 수 없다"


@pytest.mark.parametrize("library", sorted(LIBRARIES))
def test_installed_adapter_meets_the_supported_minimum(library):
    """하한보다 낮은 version에서는 진입점 이름이 다를 수 있다. label이 조용히 안 붙는다."""
    distribution = DISTRIBUTIONS[library]
    try:
        installed = metadata.version(distribution)
    except metadata.PackageNotFoundError:
        pytest.skip(f"{distribution} 미설치")

    minimum = awaits.SUPPORTED_VERSIONS[library]
    assert _version_tuple(installed) >= _version_tuple(minimum), (
        f"{library} {installed} < 지원 하한 {minimum}"
    )
