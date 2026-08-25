"""blocking finding의 해결 안내.

`loop.blocked`에는 원인이 없고 suspect의 `source.function`은 coroutine 이름이지 막은
호출이 아니다. 그래서 suspect 함수의 소스를 `ast`로 읽어 `KNOWN_BLOCKING`에 있는 호출을
찾는다. 정적 분석이므로 그 호출이 실제로 실행됐다는 증거는 아니다 — `certainty`는 항상
`candidate`다.

지목하지 못하면 해결책을 단정하지 않고 다음 측정 방법만 준다.

ponytail: 정적 분석이 천장이다. classifiers/awaits.py처럼 실행 경로를 감싸면 `observed`
증거로 올라가지만 새 event type이 필요하고, 이벤트 종류는 m/z가 함께 정하는 항목이다
(implementation-ownership.md). 합의되면 여기 매칭을 그 이벤트로 바꾼다.
"""

from __future__ import annotations

import ast
import functools
from pathlib import Path
from typing import Any

from ..classifiers.blocking import KNOWN_BLOCKING
from ..source import project_file

# 해결책을 단정할 수 없을 때 주는 다음 측정 방법. 고치는 법이 아니라 좁히는 법이다.
MEASURE_STEPS = {
    "blocking": [
        "의심 지점 함수 안에서 동기 호출을 찾는다. 파일 I/O, 동기 DB driver, CPU 위주 계산이 후보다.",
        "threshold를 낮춰 다시 측정한다. 짧고 잦은 지연은 지금 값을 넘지 못했을 수 있다.",
        "같은 시각의 다른 request와 대조해 이 request 고유 문제인지 확인한다.",
    ],
    "long_wait": [
        "label로 무엇을 기다렸는지 확인한다. `unknown await`면 adapter 미지원이라 대상을 모른다.",
        "상대 서비스나 쿼리의 응답 시간을 그쪽에서 따로 측정한다. 여기서는 기다린 시간만 안다.",
        "timeout을 걸어 무한 대기를 막는다. 지금은 상대가 응답할 때까지 request가 살아 있다.",
    ],
    "unattributed": [
        "project root 설정을 확인한다. 프로젝트 밖 코드(framework, driver)가 돈 시간은 수집되지 않는다.",
        "buffer 상한을 늘려 request 앞부분이 밀려나지 않았는지 확인한다.",
        "request 안에서 만든 Task가 프로젝트 coroutine으로 시작했는지 확인한다.",
    ],
}


def recommend(finding: dict[str, Any], project_root: str | Path | None = None) -> dict[str, Any]:
    """finding 하나에 대한 해결 안내. 항상 무언가를 돌려준다."""

    if finding.get("type") == "blocking" and project_root is not None:
        steps = _known_call_steps(finding.get("suspect"), project_root)
        if steps:
            return {
                "kind": "known_blocking_call",
                "certainty": "candidate",
                "steps": steps,
            }

    return {
        "kind": "measure",
        "certainty": "unknown",
        "steps": [
            {"text": text, "source": None}
            for text in MEASURE_STEPS.get(finding.get("type"), MEASURE_STEPS["blocking"])
        ],
    }


def _known_call_steps(
    suspect: dict[str, Any] | None,
    project_root: str | Path,
) -> list[dict[str, Any]]:
    source = (suspect or {}).get("source")
    if not isinstance(source, dict) or not source.get("file"):
        return []

    try:
        tree = _parse(project_file(project_root, source["file"]))
    except (OSError, PermissionError, SyntaxError, ValueError):
        # 소스를 못 읽는 건 finding을 못 내는 이유가 아니다. 측정 안내로 떨어진다.
        return []

    function = _enclosing_function(tree, source.get("function"), source.get("line"))
    if function is None:
        return []

    steps = []
    for call_name, lineno in _direct_calls(function):
        known = KNOWN_BLOCKING.get(call_name)
        if known is None:
            continue
        name, fix = known
        steps.append(
            {
                "text": f"{name} — event loop를 막는 동기 호출이다. {fix}",
                "source": {"file": source["file"], "line": lineno},
            }
        )
    return steps


def _enclosing_function(tree: ast.AST, name: str | None, line: int | None) -> ast.AST | None:
    """`co_firstlineno`는 decorator 줄을 가리킨다. node.lineno만 비교하면 못 찾는다."""
    if not name:
        return None
    candidates = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and node.name == name
    ]
    if line is not None:
        for node in candidates:
            start = min([node.lineno, *(d.lineno for d in node.decorator_list)])
            if start <= line <= (node.end_lineno or node.lineno):
                return node
    # 이름이 하나뿐이면 줄이 어긋나도 그 함수다 (파일이 수정됐을 수 있다).
    return candidates[0] if len(candidates) == 1 else None


def _direct_calls(function: ast.AST):
    """중첩 함수·lambda·클래스 안으로는 내려가지 않는다. 그건 다른 프레임이다."""
    stack = list(function.body)
    while stack:
        node = stack.pop()
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.Lambda | ast.ClassDef):
            continue
        if isinstance(node, ast.Call) and (dotted := _dotted_name(node.func)) is not None:
            yield dotted, node.lineno
        stack.extend(ast.iter_child_nodes(node))


def _dotted_name(node: ast.AST) -> str | None:
    parts = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if not isinstance(node, ast.Name):
        return None
    parts.append(node.id)
    return ".".join(reversed(parts))


def _parse(path: Path) -> ast.AST:
    return _parse_cached(str(path), path.stat().st_mtime_ns)


@functools.lru_cache(maxsize=64)
def _parse_cached(path: str, _mtime_ns: int) -> ast.AST:
    return ast.parse(Path(path).read_text(encoding="utf-8", errors="replace"))
