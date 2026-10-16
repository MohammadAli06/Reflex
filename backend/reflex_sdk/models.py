"""Stable response models exposed by :mod:`reflex_sdk`."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ToolInfo:
    name: str
    description: str = ""
    method: str = ""
    endpoint: str = ""
    write: bool = False
    revision: int = 1

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ToolInfo":
        return cls(name=str(data["name"]), method=str(data.get("method", "")),
                   endpoint=str(data.get("endpoint", "")), write=bool(data.get("write", False)),
                   revision=int(data.get("revision", 1)))


@dataclass(frozen=True)
class ReflexResult:
    """A completed engine decision.

    ``ok`` means the target operation completed and its response was verified.
    A refusal is deliberately returned as ``ok=False`` with a stable reason code.
    ``run_id`` links directly to the existing Trace and Audit UI data.
    """
    run_id: str
    outcome: str
    healed: bool
    data: dict[str, Any] | None
    reason_code: str | None
    error: str | None
    attempts: int
    schema_attempts: int

    @property
    def ok(self) -> bool:
        return self.outcome == "recovered"

    @property
    def refused(self) -> bool:
        return self.outcome == "refused"

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ReflexResult":
        return cls(
            run_id=str(data["run_id"]), outcome=str(data["outcome"]),
            healed=bool(data.get("healed", False)),
            data=data.get("data") if isinstance(data.get("data"), dict) else None,
            reason_code=data.get("reason_code"), error=data.get("error"),
            attempts=int(data.get("attempts", 0)),
            schema_attempts=int(data.get("schema_attempts", 0)),
        )
