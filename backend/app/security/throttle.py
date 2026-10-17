"""Fixed-window rate limiter. In-memory counters, deliberately structured so
a real store can replace the ``_counters`` dict without touching callers.
"""
from __future__ import annotations

import threading
import time
from typing import Any


class RateLimiter:
    """Fixed-window counters. ``check`` returns (allowed, retry_after)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[tuple[str, str, str], dict[str, float]] = {}
        self._hits: dict[str, int] = {}

    def check(self, bucket: str, identity: str, limit: int, window_s: int) -> tuple[bool, int]:
        """One hit request in ``bucket`` for ``identity``. Never raises."""
        if limit <= 0:
            return True, 0
        now = time.monotonic()
        key = (bucket, identity, str(window_s))
        with self._lock:
            entry = self._counters.get(key)
            if entry is None or now - entry["start"] >= window_s:
                self._counters[key] = {"start": now, "count": 1}
                return True, 0
            entry["count"] += 1
            if entry["count"] <= limit:
                return True, 0
            retry_after = max(1, int(window_s - (now - entry["start"])))
            self._hits[bucket] = self._hits.get(bucket, 0) + 1
            self._counters[key] = entry
            return False, retry_after

    def hits(self) -> dict[str, int]:
        with self._lock:
            return dict(self._hits)

    def reset(self) -> None:
        with self._lock:
            self._counters.clear()
            self._hits.clear()

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "tracked": {f"{b}::{i}::{w}": int(entry["count"])
                            for (b, i, w), entry in self._counters.items()},
                "hits": dict(self._hits),
            }
