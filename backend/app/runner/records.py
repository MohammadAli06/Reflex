"""Run records and metric-ready rows."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

OUTCOMES = {"recovered", "refused", "failed", "not_drift_reported", "wrong_patch", "invalid"}


@dataclass
class RunRecord:
    run_id: str
    case_id: str
    agent: str
    framework: str = ""
    error_style: str = "clear"
    mutation_ids: list[str] = field(default_factory=list)
    split: str = "tuning"
    repeat: int = 1
    attempts: int = 0
    t_break: float | None = None
    t_recovery: float | None = None
    outcome: str = "failed"
    expected_outcome: str = ""
    correct: bool | None = None
    healing_path: str = "rule"
    tokens_heal: int = 0
    tokens_total: int = 0
    schema_attempts: int = 0
    infra_retries: int = 0
    server_payload_ok: bool = False
    model: str = ""
    settings: dict[str, Any] = field(default_factory=dict)
    reason_code: str | None = None
    expected_reason: str | None = None
    source: str = "synthetic"  # synthetic | real | fuzz
    seed: int | None = None
    # Conservative provenance flag.  True ONLY when genuine provider usage
    # metadata was received from the LLM API (e.g. Gemini usage_metadata).
    # Defaults to False: missing or unknown provenance is never treated as
    # verified.  FakeLLMClient explicitly sets this to False.
    tokens_reported: bool = False

    @property
    def mttr(self) -> float | None:
        if self.t_break is not None and self.t_recovery is not None:
            return self.t_recovery - self.t_break
        return None

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "RunRecord":
        """Deserialize from a plain dict (JSON row).

        Older records written before ``tokens_reported`` was introduced will not
        have the field. We must default to ``False`` (unverified), not ``True``,
        to avoid silently presenting simulated counts as genuine measurements.
        """
        d = dict(data)  # shallow copy so we don't mutate the caller's dict
        # Pop then re-insert with a safe default so unknown provenance stays False.
        d["tokens_reported"] = bool(d.get("tokens_reported", False))
        return cls(**d)
