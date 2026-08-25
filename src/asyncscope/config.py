"""Runtime Settings API model and validation."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .analysis import QueryError

MIN_THRESHOLD_S = 0.001
MAX_THRESHOLD_S = 10.0
MIN_INTERVAL_S = 0.001
MAX_INTERVAL_S = 10.0
MIN_BUFFER_SIZE = 1
MAX_BUFFER_SIZE = 100_000

LIVE_FIELDS = {"threshold_s", "interval_s"}
RESTART_FIELDS = {"buffer_size", "project_root"}
SETTING_FIELDS = LIVE_FIELDS | RESTART_FIELDS


FEEDBACK_KINDS = ("acknowledged", "false_positive")


@dataclass
class FeedbackState:
    """finding에 대한 사용자 표시. process-local이고 재시작하면 사라진다.

    ponytail: buffer에서 밀려난 finding id가 집합에 남는다. 메모리에만 있고 작아서 지금은
    문제되지 않는다. 디스크에 persist하게 되면 정리 정책이 필요하다.
    """

    acknowledged: set[str] = field(default_factory=set)
    false_positive: set[str] = field(default_factory=set)

    def record(self, finding_id: str, kind: str) -> None:
        """같은 finding에 두 kind를 다 표시할 수 있다 — 인지했고 오탐이다."""
        if kind not in FEEDBACK_KINDS:
            raise QueryError(f"kind must be one of {sorted(FEEDBACK_KINDS)}")
        getattr(self, kind).add(finding_id)

    def marks(self, finding_id: str) -> dict[str, bool]:
        return {kind: finding_id in getattr(self, kind) for kind in FEEDBACK_KINDS}

    def summary(self) -> dict[str, int]:
        return {kind: len(getattr(self, kind)) for kind in FEEDBACK_KINDS}


@dataclass
class SettingsState:
    """Per-AsyncScope pending settings that require restart."""

    pending_restart: dict[str, Any] = field(default_factory=dict)
    feedback: FeedbackState = field(default_factory=FeedbackState)


def settings_payload(app_scope) -> dict[str, Any]:
    """Return the shape consumed by Settings UI."""

    state = settings_state(app_scope)
    return {
        "tracing": app_scope.installed,
        "persisted": False,
        "settings": current_settings(app_scope),
        "pending_restart": dict(state.pending_restart),
        "limits": limits(),
        "feedback": state.feedback.summary(),
    }


def current_settings(app_scope) -> dict[str, Any]:
    return {
        "threshold_s": app_scope.threshold,
        "interval_s": app_scope.interval,
        "buffer_size": app_scope.buffer.max_events,
        "project_root": str(Path(app_scope.project_root).resolve()),
    }


def apply_settings_patch(app_scope, patch: dict[str, Any]) -> dict[str, Any]:
    """Validate and apply a PATCH body, returning a fresh settings payload."""

    if not isinstance(patch, dict):
        raise QueryError("settings payload must be an object")

    unknown = set(patch) - SETTING_FIELDS
    if unknown:
        raise QueryError(f"unsupported setting: {sorted(unknown)}")

    updates = validate_patch(patch)
    state = settings_state(app_scope)

    if "threshold_s" in updates:
        app_scope.threshold = updates["threshold_s"]
    if "interval_s" in updates:
        app_scope.interval = updates["interval_s"]
    if LIVE_FIELDS & updates.keys():
        app_scope.restart_heartbeat()

    if "buffer_size" in updates:
        _set_pending(
            state,
            "buffer_size",
            updates["buffer_size"],
            app_scope.buffer.max_events,
        )
    if "project_root" in updates:
        _set_pending(
            state,
            "project_root",
            updates["project_root"],
            str(Path(app_scope.project_root).resolve()),
        )

    return settings_payload(app_scope)


def validate_patch(patch: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(patch, dict):
        raise QueryError("settings payload must be an object")

    unknown = set(patch) - SETTING_FIELDS
    if unknown:
        raise QueryError(f"unsupported setting: {sorted(unknown)}")

    updates = {}
    if "threshold_s" in patch:
        updates["threshold_s"] = _float_in_range(
            patch["threshold_s"],
            "threshold_s",
            MIN_THRESHOLD_S,
            MAX_THRESHOLD_S,
        )
    if "interval_s" in patch:
        updates["interval_s"] = _float_in_range(
            patch["interval_s"],
            "interval_s",
            MIN_INTERVAL_S,
            MAX_INTERVAL_S,
        )
    if "buffer_size" in patch:
        updates["buffer_size"] = _int_in_range(
            patch["buffer_size"],
            "buffer_size",
            MIN_BUFFER_SIZE,
            MAX_BUFFER_SIZE,
        )
    if "project_root" in patch:
        updates["project_root"] = _project_root(patch["project_root"])
    return updates


def limits() -> dict[str, Any]:
    return {
        "threshold_s": {"min": MIN_THRESHOLD_S, "max": MAX_THRESHOLD_S},
        "interval_s": {"min": MIN_INTERVAL_S, "max": MAX_INTERVAL_S},
        "buffer_size": {"min": MIN_BUFFER_SIZE, "max": MAX_BUFFER_SIZE},
        "project_root": {"must_exist": True, "must_be_directory": True},
    }


def settings_state(app_scope) -> SettingsState:
    state = getattr(app_scope, "settings_state", None)
    if state is None:
        state = SettingsState()
        app_scope.settings_state = state
    return state


def _set_pending(
    state: SettingsState,
    name: str,
    value: Any,
    current_value: Any,
) -> None:
    if value == current_value:
        state.pending_restart.pop(name, None)
    else:
        state.pending_restart[name] = value


def _float_in_range(value: Any, name: str, minimum: float, maximum: float) -> float:
    if isinstance(value, bool):
        raise QueryError(f"{name} must be a number")
    try:
        parsed = float(value)
    except (TypeError, ValueError) as exc:
        raise QueryError(f"{name} must be a number") from exc
    if not minimum <= parsed <= maximum:
        raise QueryError(f"{name} must be between {minimum} and {maximum}")
    return parsed


def _int_in_range(value: Any, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool):
        raise QueryError(f"{name} must be an integer")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = int(value)
        except ValueError as exc:
            raise QueryError(f"{name} must be an integer") from exc
    else:
        raise QueryError(f"{name} must be an integer")
    if not minimum <= parsed <= maximum:
        raise QueryError(f"{name} must be between {minimum} and {maximum}")
    return parsed


def _project_root(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise QueryError("project_root must be a non-empty string")
    root = Path(value).expanduser().resolve()
    if not root.exists() or not root.is_dir():
        raise QueryError("project_root must be an existing directory")
    return str(root)
