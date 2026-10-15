"""Append-only, redacted JSONL audit log.

One entry per patch, refusal, rollback, human-review case and not-drift
decision. Secrets are redacted before serialization; raw credentials are never
written.
"""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..healing.events import Redactor

OUTCOMES = {"applied", "refused", "rolled_back", "needs_human_review", "not_drift", "verified"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class AuditEntry:
    run_id: str = ""
    case_id: str = ""
    tool: str = ""
    error: dict[str, Any] = field(default_factory=dict)
    classification: str = ""
    schema_version_before: int | None = None
    schema_version_after: int | None = None
    schema_sha256: str = ""
    old_definition: dict[str, Any] | None = None
    new_definition: dict[str, Any] | None = None
    evidence: list[str] = field(default_factory=list)
    confidence: float = 0.0
    outcome: str = "refused"
    reason_code: str | None = None
    healing_path: str = "rule"
    llm_tokens: dict[str, int] = field(default_factory=lambda: {"input": 0, "output": 0})
    ts: str = field(default_factory=_now)

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


class AuditLog:
    def __init__(self, path: Path, redactor: Redactor | None = None) -> None:
        self._path = Path(path)
        self._redactor = redactor or Redactor()
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)

    @property
    def path(self) -> Path:
        return self._path

    def add_secret(self, value: str | None) -> None:
        self._redactor.add(value)

    def append(self, entry: AuditEntry | dict[str, Any]) -> dict[str, Any]:
        payload = entry.to_dict() if isinstance(entry, AuditEntry) else dict(entry)
        safe = self._redactor.redact(payload)
        line = json.dumps(safe, ensure_ascii=False)
        with self._lock:
            with self._path.open("a", encoding="utf-8") as fh:
                fh.write(line + "\n")
        return safe

    def read(self, *, outcome: str | None = None, run_id: str | None = None,
             limit: int | None = None) -> list[dict[str, Any]]:
        if not self._path.exists():
            return []
        entries: list[dict[str, Any]] = []
        with self._path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if outcome and item.get("outcome") != outcome:
                    continue
                if run_id and item.get("run_id") != run_id:
                    continue
                entries.append(item)
        if limit is not None:
            entries = entries[-limit:]
        return entries
