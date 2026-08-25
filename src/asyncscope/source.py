"""Project source 경계. project root 안 `.py`만 읽는다.

web(source viewer)과 analysis(recommendation) 둘 다 여기를 지난다. 경계 판정이 두 벌이
되면 한쪽만 고쳐진 채로 남는다.
"""

from __future__ import annotations

from pathlib import Path


def project_file(project_root: str | Path, path: str) -> Path:
    """root 안의 .py만 통과시킨다. resolve()가 symlink를 풀어내므로 탈출도 여기서 걸린다."""
    root = Path(project_root).resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root):
        raise PermissionError(f"outside project root: {path}")
    if target.suffix != ".py":
        raise PermissionError(f"not a Python source file: {path}")
    return target


def read_snippet(project_root: str | Path, path: str, line: int, radius: int = 5) -> dict:
    target = project_file(project_root, path)
    root = Path(project_root).resolve()
    lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
    start = max(1, line - radius)
    end = min(len(lines), line + radius)
    return {
        "file": str(target.relative_to(root)),
        "start_line": start,
        "lines": lines[start - 1 : end],
    }
