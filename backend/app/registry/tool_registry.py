"""Versioned, concurrency-safe in-memory tool registry.

Updates use compare-and-swap against the revision a candidate was built from.
A stale update is rejected. Rollback restores the immediate previous revision
but cannot overwrite a newer one.
"""
from __future__ import annotations

import threading

from .tools import ToolDefinition


class StaleRevisionError(RuntimeError):
    """Raised when a compare-and-swap update used an out-of-date revision."""


class ToolRegistry:
    def __init__(self, definitions: dict[str, ToolDefinition] | None = None,
                 on_commit=None) -> None:
        self._lock = threading.RLock()
        self._current: dict[str, ToolDefinition] = {
            name: definition.copy_with() for name, definition in (definitions or {}).items()
        }
        self._previous: dict[str, ToolDefinition] = {}
        self.on_commit = on_commit

    def list_names(self) -> list[str]:
        with self._lock:
            return sorted(self._current)

    def get(self, name: str) -> ToolDefinition:
        with self._lock:
            if name not in self._current:
                raise KeyError(name)
            return self._current[name].copy_with()

    def has(self, name: str) -> bool:
        with self._lock:
            return name in self._current

    def revision(self, name: str) -> int:
        return self.get(name).revision

    def apply(self, name: str, expected_revision: int, new_definition: ToolDefinition) -> ToolDefinition:
        """Atomically replace a definition if the revision matches."""
        with self._lock:
            current = self._current.get(name)
            if current is None:
                raise KeyError(name)
            if current.revision != expected_revision:
                raise StaleRevisionError(
                    f"{name}: expected revision {expected_revision}, found {current.revision}"
                )
            applied = new_definition.copy_with(revision=current.revision + 1)
            self._previous[name] = current.copy_with()
            self._current[name] = applied
            if self.on_commit is not None:
                self.on_commit(name, applied)
            return applied.copy_with()

    def rollback(self, name: str, expected_revision: int) -> ToolDefinition:
        """Restore the previous definition as a NEW revision (never overwrites newer)."""
        with self._lock:
            current = self._current.get(name)
            if current is None:
                raise KeyError(name)
            if current.revision != expected_revision:
                raise StaleRevisionError(
                    f"{name}: expected revision {expected_revision}, found {current.revision}"
                )
            previous = self._previous.get(name)
            if previous is None:
                raise ValueError(f"{name}: no previous revision to roll back to")
            restored = previous.copy_with(revision=current.revision + 1)
            self._previous[name] = current.copy_with()
            self._current[name] = restored
            if self.on_commit is not None:
                self.on_commit(name, restored)
            return restored.copy_with()

    def snapshot(self) -> dict[str, dict]:
        with self._lock:
            return {name: d.to_dict() for name, d in self._current.items()}
