"""Safety demonstration scenarios (design.md §3.7)."""
from __future__ import annotations

from typing import Any

from ..healing import reason_codes as rc
from ..runner.cases import get_case
from ..runner.harness import Harness
from .run_manager import _now

SCENARIOS: list[dict[str, str]] = [
    {
        "id": "recover_ps_demo",
        "label": "Recovery after a schema change (PS demo)",
        "case_id": "ps_demo",
        "description": "Nesting + type change + a new required header; recovers with no restart.",
    },
    {
        "id": "missing_credential",
        "label": "Refusal: missing credential",
        "case_id": "missing_credential",
        "description": "A required credential header has no value; refuses instead of inventing one.",
    },
    {
        "id": "ambiguous_mapping",
        "label": "Refusal: ambiguous mapping",
        "case_id": "ambiguous_mapping",
        "description": "Two equally plausible candidates; refuses rather than guess.",
    },
    {
        "id": "not_drift_5xx",
        "label": "Not schema drift: 5xx",
        "case_id": "not_drift_5xx",
        "description": "Server failure is classified as not drift and never patched.",
    },
    {
        "id": "not_drift_bad_credential",
        "label": "Not schema drift: rejected credential",
        "case_id": "not_drift_bad_credential",
        "description": "A rejected credential is not bypassed.",
    },
    {
        "id": "tampered_schema",
        "label": "Refusal: untrusted schema",
        "case_id": "ps_demo",
        "description": "A forged schema document fails provenance checks and is never diffed or patched.",
    },
]

_PROVENANCE_SCENARIOS = {"tampered_schema"}

_EXPLANATIONS = {
    "recovered": "Detected the change, applied a validated patch, and completed the task without a restart.",
    rc.NOT_DRIFT: "Classified as not schema drift. No patch was applied.",
    rc.AUTH_REJECTED: "Authentication was rejected. The system does not bypass authentication.",
    rc.AMBIGUOUS_MAPPING: "Two or more candidates were equally plausible, so it refused rather than guess.",
    rc.MISSING_CREDENTIAL: "A required credential header had no value in the secrets store, so it refused rather than invent one.",
    rc.MISSING_REQUIRED_VALUE: "A newly required field had no approved value source, so it refused rather than invent a default.",
    rc.LOSSY_CONVERSION: "The type conversion would have changed the value's meaning, so it refused.",
    rc.VALIDATION_FAILED: "The candidate patch failed validation, so it was not applied (rolled back if needed).",
    rc.AMBIGUOUS_RESPONSE_MAPPING: "The response shape changed ambiguously, so no data was returned.",
    rc.RETRY_CAP_REACHED: "The retry cap was reached without a safe fix.",
    rc.NO_EVIDENCE: "No relevant schema change explained the error, so it refused.",
    rc.NEEDS_HUMAN_REVIEW: "The change could not be applied safely; a human must review it.",
    rc.UNTRUSTED_SCHEMA: "The served schema could not be verified against the pinned key, so it was never trusted.",
}


def explain(outcome: str, reason_code: str | None) -> str:
    if outcome == "recovered":
        return _EXPLANATIONS["recovered"]
    return _EXPLANATIONS.get(reason_code or "", "Stopped safely and logged the decision.")


def list_scenarios() -> list[dict[str, str]]:
    return [dict(s) for s in SCENARIOS]


def get_scenario(scenario_id: str) -> dict[str, str]:
    for scenario in SCENARIOS:
        if scenario["id"] == scenario_id:
            return scenario
    raise KeyError(scenario_id)


def run_scenario(harness: Harness, scenario_id: str) -> dict[str, Any]:
    scenario = get_scenario(scenario_id)
    case = get_case(scenario["case_id"])
    if scenario_id in _PROVENANCE_SCENARIOS:
        return _run_provenance_scenario(harness, scenario, case)

    harness.reset()
    if case.fault:
        harness.set_fault(case.fault)
    if case.mutation_id:
        harness.apply_mutation(case.mutation_id, error_style=case.error_style)
    else:
        harness.set_error_style(case.error_style)
    harness.reset_registry()

    secrets = harness.empty_secrets() if case.secrets_mode == "empty" else harness.secrets
    emitter = harness.make_emitter(f"scenario-{scenario_id}", "healing")
    result = harness.run_healing(case.task_id, f"scenario-{scenario_id}", secrets=secrets, emitter=emitter)
    harness.set_fault(None)

    return _scenario_result(scenario, case, result, emitter)


def _run_provenance_scenario(harness: Harness, scenario: dict[str, str], case) -> dict[str, Any]:
    """Drift the schema, then serve a forged document and prove it is refused.

    The drift is what forces a schema fetch in the first place; the forgery is
    whatever the fetch then returns.
    """
    tampered = False
    try:
        harness.reset()
        if case.mutation_id:
            harness.apply_mutation(case.mutation_id, error_style=case.error_style)
        response = harness.client.post("/admin/tamper", headers=harness.admin_headers)
        response.raise_for_status()
        tampered = True
        harness.reset_registry()
        emitter = harness.make_emitter(f"scenario-{scenario['id']}", "healing")
        result = harness.run_healing(case.task_id, f"scenario-{scenario['id']}",
                                    secrets=harness.secrets, emitter=emitter)
    finally:
        if tampered:
            try:
                harness.client.post("/admin/tamper", json={"revert": True},
                                    headers=harness.admin_headers)
            except Exception:
                pass
    return _scenario_result(scenario, case, result, emitter)


def _scenario_result(scenario: dict[str, str], case, result, emitter) -> dict[str, Any]:
    return {
        "scenario_id": scenario["id"],
        "label": scenario["label"],
        "case_id": case.id,
        "outcome": result.outcome,
        "reason_code": result.reason_code,
        "explanation": explain(result.outcome, result.reason_code),
        "agent": "healing",
        "attempts": result.attempts,
        "schema_attempts": result.schema_attempts,
        "mttr": result.mttr,
        "response_data": result.response_data,
        "finished_at": _now(),
        "events": [e.to_dict() for e in emitter.events],
    }
