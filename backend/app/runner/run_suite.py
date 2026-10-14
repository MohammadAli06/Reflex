"""Repeated test runner: runs each case for both agents and records real rows."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Callable

from ..agents.base import AgentRunResult
from ..healing.secrets import SecretsProvider
from ..registry.tasks import get_task
from .cases import Case
from .correctness import verify_payload
from .harness import Harness
from .records import RunRecord

RecordHook = Callable[[RunRecord], None]


def _record_for(
    harness: Harness,
    case: Case,
    result: AgentRunResult,
    *,
    run_id: str,
    repeat: int,
    correct: bool | None,
    server_payload_ok: bool,
) -> RunRecord:
    return RunRecord(
        run_id=run_id,
        case_id=case.id,
        agent=result.agent,
        framework="plain-loop" if result.agent == "baseline" else "rule-based-healer",
        error_style=case.error_style,
        mutation_ids=[case.mutation_id] if case.mutation_id else [],
        split=case.split,
        repeat=repeat,
        attempts=result.attempts,
        t_break=result.t_break,
        t_recovery=result.t_recovery,
        outcome=result.outcome,
        expected_outcome=case.expected_outcome,
        correct=correct,
        healing_path=result.healing_path,
        tokens_heal=result.tokens_total if result.agent == "healing" else 0,
        tokens_total=result.tokens_total,
        schema_attempts=result.schema_attempts,
        infra_retries=result.infra_retries,
        server_payload_ok=server_payload_ok,
        model=result.model,
        settings=harness.settings.public_summary(),
        reason_code=result.reason_code,
        expected_reason=case.expected_reason,
    )


def _check(harness: Harness, definition, args: dict[str, Any], endpoint: str) -> tuple[bool, bool]:
    payload = harness.server_payload(endpoint)
    ok, _details = verify_payload(definition, payload, args)
    return ok, bool(payload.get("ok"))


def run_single_case(
    harness: Harness, case: Case, *, run_id: str, repeat: int = 1, hook: RecordHook | None = None
) -> list[RunRecord]:
    task = get_task(case.task_id)
    harness.reset()
    if case.fault:
        harness.set_fault(case.fault)
    if case.mutation_id:
        harness.apply_mutation(case.mutation_id, error_style=case.error_style)
    else:
        harness.set_error_style(case.error_style)

    endpoint = harness.registry.get(task.tool).endpoint
    records: list[RunRecord] = []

    # Baseline first, then a fresh registry for the healer - identical conditions.
    harness.reset_registry()
    base_def = harness.registry.get(task.tool)
    baseline = harness.run_baseline(case.task_id, f"{run_id}-baseline")
    b_ok, b_payload_ok = _check(harness, base_def, task.args, endpoint) if baseline.outcome == "recovered" else (False, False)
    baseline_record = _record_for(harness, case, baseline, run_id=run_id, repeat=repeat,
                                  correct=b_ok if baseline.outcome == "recovered" else None,
                                  server_payload_ok=b_payload_ok)
    records.append(baseline_record)
    if hook:
        hook(baseline_record)

    harness.reset_registry()
    secrets: SecretsProvider = harness.empty_secrets() if case.secrets_mode == "empty" else harness.secrets
    healing = harness.run_healing(case.task_id, f"{run_id}-healing", secrets=secrets)
    definition = harness.registry.get(task.tool)
    h_ok, h_payload_ok = _check(harness, definition, task.args, endpoint)
    healing_record = _record_for(harness, case, healing, run_id=run_id, repeat=repeat,
                                 correct=h_ok if healing.outcome == "recovered" else None,
                                 server_payload_ok=h_payload_ok)
    records.append(healing_record)
    if hook:
        hook(healing_record)

    harness.set_fault(None)
    return records


def run_cases(
    harness: Harness, cases: list[Case], *, repeats: int = 1, run_id: str | None = None,
    hook: RecordHook | None = None,
) -> list[RunRecord]:
    run_id = run_id or uuid.uuid4().hex[:12]
    records: list[RunRecord] = []
    for case in cases:
        for repeat in range(1, repeats + 1):
            records.extend(run_single_case(harness, case, run_id=run_id, repeat=repeat, hook=hook))
    return records


def save_results(records: list[RunRecord], results_dir: Path, run_id: str) -> Path:
    results_dir.mkdir(parents=True, exist_ok=True)
    path = results_dir / f"run_{run_id}.jsonl"
    with path.open("w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record.to_dict(), ensure_ascii=False) + "\n")
    return path


def load_records(results_dir: Path) -> list[RunRecord]:
    records: list[RunRecord] = []
    if not results_dir.exists():
        return records
    for path in sorted(results_dir.glob("run_*.jsonl")):
        with path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    records.append(RunRecord.from_dict(json.loads(line)))
    return records
