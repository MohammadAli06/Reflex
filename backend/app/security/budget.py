"""Healing run budgets and per-host circuit breakers.

In-memory by design (hardened demo scope); both classes expose the same
surface a real store would implement, so nothing downstream needs changes.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Iterable

from .policy import SecurityPolicy


class RunBudget:
    """Per-run caps: retry/patch attempts, total calls, wall time, loops.

    The fingerprints map records every (endpoint, payload, status, error)
    combination; a repeat means the same call yields the same failure with no
    change in between - a loop by definition.
    """

    def __init__(self, policy: SecurityPolicy) -> None:
        self.policy = policy
        self.total_calls = 0
        self.total_retries = 0
        self.patches = 0
        self.fingerprints: list[str] = []
        self.started_at = time.monotonic()
        self._lock = threading.Lock()

    def register_call(self) -> None:
        with self._lock:
            self.total_calls += 1

    def register_retry(self) -> bool:
        with self._lock:
            self.total_retries += 1
            return self.total_retries <= self.policy.max_total_retries

    def register_patch(self) -> bool:
        """One LLM/rule patch attempt per failure event is the default."""
        with self._lock:
            self.patches += 1
            return self.patches <= self.policy.max_patch_attempts

    def check_loop(self, fingerprint: str) -> bool:
        """True once this exact failure shape has been seen before."""
        with self._lock:
            repeated = fingerprint in self.fingerprints
            if not repeated:
                self.fingerprints.append(fingerprint)
            return repeated

    def time_exceeded(self, max_wall_s: float) -> bool:
        return (time.monotonic() - self.started_at) > max_wall_s


class Breakers:
    """Per-host circuit breaker.

    Consecutive network-layer/5xx failures within a window trip the breaker;
    a half-open probe is allowed after the cooldown and closes on success.
    Transport-level failures are recorded by the guarded client; outcomes are
    recorded explicitly so ``422`` drift never trips a breaker.
    """

    OPEN, CLOSED, HALF_OPEN = "open", "closed", "half_open"

    def __init__(self, policy: SecurityPolicy) -> None:
        self.policy = policy
        self._lock = threading.Lock()
        self._state: dict[str, dict[str, Any]] = {}

    def _entry(self, host: str) -> dict[str, Any]:
        with self._lock:
            entry = self._state.get(host)
            if entry is None:
                entry = {"failures": [], "opened_at": None, "state": self.CLOSED}
                self._state[host] = entry
            return entry

    def check_call(self, host: str) -> str:
        """Return the state for a call about to happen (fast reject on open)."""
        now = time.monotonic()
        entry = self._entry(host)
        with self._lock:
            if entry["state"] == self.OPEN:
                if entry["opened_at"] is not None and \
                        now - entry["opened_at"] >= self.policy.breaker_cooldown_s:
                    entry["state"] = self.HALF_OPEN
                    entry["probing"] = True
                    return self.HALF_OPEN  # exactly one probe call
                return self.OPEN
            if entry["state"] == self.HALF_OPEN:
                if entry.get("probing"):
                    return self.OPEN  # probe already in flight: reject extras
                entry["probing"] = True
            return entry["state"]

    def record_success(self, host: str) -> None:
        entry = self._entry(host)
        with self._lock:
            entry["failures"] = []
            entry["opened_at"] = None
            entry["probing"] = False
            entry["state"] = self.CLOSED

    def record_failure(self, host: str) -> bool:
        """Record one infra failure. Returns True when the breaker just opened."""
        now = time.monotonic()
        entry = self._entry(host)
        with self._lock:
            entry["failures"].append(now)
            entry["failures"] = [t for t in entry["failures"]
                                 if now - t <= self.policy.breaker_window_s]
            if len(entry["failures"]) < self.policy.breaker_threshold:
                return False
            if entry["state"] != self.OPEN:
                entry["state"] = self.OPEN  # covers CLOSED and a failed half-open probe
                entry["opened_at"] = now
                return True
            entry["opened_at"] = entry["opened_at"] or now
            return False

    def record_probe_success(self, host: str) -> None:
        self.record_success(host)

    def transition(self, host: str) -> str:
        with self._lock:
            entry = self._state.get(host)
        return (entry or {}).get("state", self.CLOSED)

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {host: {
                "state": entry["state"],
                "recent_failures": len(entry["failures"]),
            } for host, entry in self._state.items()}

    def open_hosts(self) -> Iterable[str]:
        return [h for h, entry in self.status().items() if entry["state"] == self.OPEN]
