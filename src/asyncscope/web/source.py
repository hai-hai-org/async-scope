"""Source snippet 경계. project root 밖 파일은 읽지 않는다."""

from __future__ import annotations

from pathlib import Path


def read_snippet(project_root: str | Path, path: str, line: int, radius: int = 5) -> dict:
    """root 안의 .py만 읽는다. resolve()가 symlink를 풀어내므로 탈출도 여기서 걸린다."""
    root = Path(project_root).resolve()
    target = (root / path).resolve()
    if not target.is_relative_to(root):
        raise PermissionError(f"outside project root: {path}")
    if target.suffix != ".py":
        raise PermissionError(f"not a Python source file: {path}")
    lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
    start = max(1, line - radius)
    end = min(len(lines), line + radius)
    return {
        "file": str(target.relative_to(root)),
        "start_line": start,
        "lines": lines[start - 1 : end],
    }
