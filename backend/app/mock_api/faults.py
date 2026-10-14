"""Fault injection for the mock API.

Faults never change the schema or its version. They only affect how a user
endpoint responds, so the healing layer must learn to *not* patch them.
"""
from __future__ import annotations

import threading

FAULTS = {"http500", "timeout", "http429", "reject_credential"}
DEFAULT_TIMEOUT_MS = 1500


class FaultController:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._mode: str | None = None
        self._timeout_ms: int = DEFAULT_TIMEOUT_MS

    @property
    def mode(self) -> str | None:
        with self._lock:
            return self._mode

    @property
    def timeout_ms(self) -> int:
        with self._lock:
            return self._timeout_ms

    def set(self, mode: str | None, timeout_ms: int | None = None) -> None:
        with self._lock:
            if mode is not None and mode not in FAULTS:
                raise ValueError(f"unknown fault {mode!r}")
            self._mode = mode
            if timeout_ms is not None:
                self._timeout_ms = max(0, int(timeout_ms))

    def clear(self) -> None:
        self.set(None)


def list_faults() -> list[str]:
    return sorted(FAULTS)
