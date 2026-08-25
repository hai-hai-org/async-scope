"""query API가 공유하는 helper.

Requests와 Analyzer가 같은 오류 타입, 같은 filter 문법, 같은 pagination 응답을 쓴다.
새 module을 만들지 않고 비어 있던 package __init__을 그대로 쓴다.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


class QueryError(ValueError):
    """사용자가 고칠 수 있는 query parameter 오류."""


def parse_positive_int(value: int | str, name: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise QueryError(f"{name} must be an integer") from exc
    if parsed < 1:
        raise QueryError(f"{name} must be >= 1")
    return parsed


def filter_values(
    value: str | Iterable[str] | None,
    *,
    uppercase: bool = False,
) -> set[str] | None:
    """`?status=a&status=b`와 `?status=a,b`를 같은 집합으로 본다. 없으면 None(=필터 안 함)."""
    if value is None:
        return None
    values = [value] if isinstance(value, str) else list(value)
    normalized = {
        item.strip().upper() if uppercase else item.strip()
        for raw in values
        for item in str(raw).split(",")
        if item.strip()
    }
    return normalized or None


def paginate(
    items: list[Any],
    page: int | str = DEFAULT_PAGE,
    page_size: int | str = DEFAULT_PAGE_SIZE,
) -> dict[str, Any]:
    page = parse_positive_int(page, "page")
    page_size = parse_positive_int(page_size, "page_size")
    if page_size > MAX_PAGE_SIZE:
        raise QueryError(f"page_size must be <= {MAX_PAGE_SIZE}")

    total = len(items)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "items": items[start:end],
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_next": end < total,
    }
