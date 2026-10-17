"""Shared agent result shape."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class AgentRunResult:
    agent: str
    task_id: str
    outcome: str  # recovered | refused | failed | not_drift_reported
    reason_code: str | None = None
    attempts: int = 0
    schema_attempts: int = 0
    infra_retries: int = 0
    t_break: float | None = None
    t_recovery: float | None = None
    mttr: float | None = None
    tokens_input: int = 0
    tokens_output: int = 0
    healing_path: str = "rule"
    response_data: dict[str, Any] | None = None
    error_text: str = ""
    model: str = ""
    # Conservative provenance: True only when the LLM API supplied real usage
    # metadata, or zero LLM calls were made (0 is an exact measurement).
    tokens_reported: bool = False

    @property
    def tokens_total(self) -> int:
        return self.tokens_input + self.tokens_output

    def to_dict(self) -> dict[str, Any]:
        data = dict(self.__dict__)
        data["tokens_total"] = self.tokens_total
        return data
