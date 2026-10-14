"""Test cases: mutation, task, error style, expected outcome and split.

Held-out cases are separated and must not be inspected while tuning. Generated
variants exercise different names/values than the tuning cases.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Case:
    id: str
    task_id: str
    expected_outcome: str  # recovered | refused | not_drift_reported
    mutation_id: str | None = None
    error_style: str = "clear"
    expected_reason: str | None = None
    secrets_mode: str = "env"  # env | empty
    fault: str | None = None
    split: str = "tuning"  # tuning | held_out

    def to_dict(self) -> dict[str, Any]:
        return dict(self.__dict__)


CASES: list[Case] = [
    # --- tuning cases ---
    Case("normal_fetch", "normal_fetch", "recovered"),
    Case("rename", "normal_fetch", "recovered", mutation_id="M_RENAME"),
    Case("type_change", "normal_fetch", "recovered", mutation_id="M_TYPE"),
    Case("nesting", "normal_fetch", "recovered", mutation_id="M_NEST"),
    Case("new_header", "normal_fetch", "recovered", mutation_id="M_HEADER"),
    Case("rename_nest", "normal_fetch", "recovered", mutation_id="M_RENAME_NEST"),
    Case("ps_demo", "normal_fetch", "recovered", mutation_id="M_NEST_TYPE_HEADER"),
    Case("ps_demo_vague", "normal_fetch", "recovered", mutation_id="M_NEST_TYPE_HEADER",
         error_style="vague"),
    Case("ps_demo_no_hint", "normal_fetch", "recovered", mutation_id="M_NEST_TYPE_HEADER",
         error_style="none"),
    Case("lossy_conversion", "lossy_fetch", "refused", mutation_id="M_LOSSY_TYPE",
         expected_reason="lossy_conversion"),
    Case("ambiguous_mapping", "normal_fetch", "refused", mutation_id="M_AMBIGUOUS",
         expected_reason="ambiguous_mapping"),
    Case("missing_credential", "normal_fetch", "refused", mutation_id="M_HEADER",
         expected_reason="missing_credential", secrets_mode="empty"),
    Case("missing_required_value", "normal_fetch", "refused", mutation_id="M_REQUIRED_BODY",
         expected_reason="missing_required_value"),
    Case("not_drift_5xx", "normal_fetch", "not_drift_reported", fault="http500",
         expected_reason="not_drift"),
    Case("not_drift_bad_credential", "normal_fetch", "not_drift_reported",
         fault="reject_credential", expected_reason="auth_rejected"),
    Case("response_nesting", "normal_fetch", "recovered", mutation_id="M_RESP_NEST"),
    # --- held-out cases (different names/values, run once) ---
    Case("heldout_nest", "normal_fetch", "recovered", mutation_id="M_NEST", split="held_out"),
    Case("heldout_ps_demo", "normal_fetch", "recovered", mutation_id="M_NEST_TYPE_HEADER",
         split="held_out"),
    Case("heldout_ambiguous", "normal_fetch", "refused", mutation_id="M_AMBIGUOUS",
         expected_reason="ambiguous_mapping", split="held_out"),
]


def get_case(case_id: str) -> Case:
    for case in CASES:
        if case.id == case_id:
            return case
    raise KeyError(case_id)


def tuning_cases() -> list[Case]:
    return [c for c in CASES if c.split == "tuning"]


def held_out_cases() -> list[Case]:
    return [c for c in CASES if c.split == "held_out"]


def list_cases() -> list[dict[str, Any]]:
    return [c.to_dict() for c in CASES]
