"""Typed trace events and secret redaction.

Events are emitted by the real engine and agents. They never contain secrets or
header values - :class:`Redactor` is a safety net on top of that discipline.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

from .exchange import REDACTED, is_sensitive_key, redact as redact_value  # single reusable redaction

EVENT_TYPES = {
    "run_started",
    "task_started",
    "http_exchange",
    "call_attempt",
    "error_detected",
    "error_classified",
    "schema_fetched",
    "schema_diff",
    "candidate_patch",
    "validation_result",
    "patch_applied",
    "retry",
    "verified",
    "rollback",
    "refused",
    "needs_human_review",
    "response_check",
    "not_drift",
    "run_finished",
}


class Redactor:
    """Key-name redaction plus planted-secret value masking.

    Key rules live in :func:`healing.exchange.redact` — the one reusable
    redaction entry point.
    """

    def __init__(self, secret_values: Iterable[str] = ()) -> None:
        self._values: set[str] = {v for v in secret_values if v}

    def add(self, value: str | None) -> None:
        if value:
            self._values.add(value)

    def redact_text(self, text: str) -> str:
        out = text
        for value in self._values:
            if value and value in out:
                out = out.replace(value, REDACTED)
        return out

    def redact(self, obj: Any) -> Any:
        return redact_value(obj) if not self._values else self._redact_with_values(obj)

    def _redact_with_values(self, obj: Any) -> Any:
        if isinstance(obj, dict):
            result = {}
            for key, value in obj.items():
                if is_sensitive_key(key) and value not in (None, [], {}):
                    result[key] = REDACTED
                else:
                    result[key] = self._redact_with_values(value)
            return result
        if isinstance(obj, list):
            return [self._redact_with_values(v) for v in obj]
        if isinstance(obj, str):
            return self.redact_text(obj)
        return obj


@dataclass
class TraceEvent:
    run_id: str
    seq: int
    ts: str
    agent: str
    type: str
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "seq": self.seq,
            "ts": self.ts,
            "agent": self.agent,
            "type": self.type,
            "data": self.data,
        }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class EventEmitter:
    """Ordered, sequence-numbered emitter for one agent within one run."""

    def __init__(self, run_id: str, agent: str, redactor: Redactor | None = None,
                 sink: list[TraceEvent] | None = None) -> None:
        self.run_id = run_id
        self.agent = agent
        self._redactor = redactor or Redactor()
        self._seq = 0
        self.events: list[TraceEvent] = sink if sink is not None else []
        self._watchers: list = []

    def subscribe(self, callback) -> None:
        self._watchers.append(callback)

    def emit(self, event_type: str, **data: Any) -> TraceEvent:
        if event_type not in EVENT_TYPES:
            raise ValueError(f"unknown event type {event_type!r}")
        self._seq += 1
        event = TraceEvent(
            run_id=self.run_id,
            seq=self._seq,
            ts=_now(),
            agent=self.agent,
            type=event_type,
            data=self._redactor.redact(data),
        )
        self.events.append(event)
        for callback in self._watchers:
            callback(event)
        return event

    @property
    def seq(self) -> int:
        return self._seq
