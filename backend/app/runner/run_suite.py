"""Repeated test runner: runs each case for both agents and records real rows."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any, Callable

import httpx

from ..agents.base import AgentRunResult
from ..healing.secrets import SecretsProvider
from ..registry.tasks import get_task
from .cases import CASES, Case, all_cases
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
        mutation_ids=(
            list(case.composed_mutations)
            if case.composed_mutations
            else ([case.mutation_id] if case.mutation_id
            else ([case.change_kind] if case.source == "real" and case.change_kind
            else []))
        ),
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
        source=case.source,
        seed=case.seed,
        tokens_reported=result.tokens_reported,
    )


def _check(harness: Harness, definition, args: dict[str, Any], endpoint: str) -> tuple[bool, bool]:
    payload = harness.server_payload(endpoint)
    ok, _details = verify_payload(definition, payload, args)
    return ok, bool(payload.get("ok"))


def _prepare_case(harness: Harness, case: Case) -> str:
    """Put the world into the state this case expects, and return the endpoint."""
    if case.source == "real":
        from .realworld import build_definitions, build_task, load_new_contract

        harness.set_definitions(build_definitions(case), {case.task_id: build_task(case)})
        load_new_contract(harness, case)
        harness.set_error_style(case.error_style)
        task = harness._task(case.task_id)
        return harness.registry.get(task.tool).endpoint

    harness.reset()
    if case.fault:
        harness.set_fault(case.fault)
    if case.composed_mutations:
        for index, mutation_id in enumerate(case.composed_mutations):
            last = index == len(case.composed_mutations) - 1
            harness.apply_mutation(
                mutation_id, error_style=case.error_style if last else None)
    elif case.mutation_id:
        harness.apply_mutation(case.mutation_id, error_style=case.error_style)
    else:
        harness.set_error_style(case.error_style)
    return harness.registry.get(get_task(case.task_id).tool).endpoint


def run_single_case(
    harness: Harness, case: Case, *, run_id: str, repeat: int = 1, hook: RecordHook | None = None
) -> list[RunRecord]:
    # Prepare first: a real case registers its own task, so resolving the task
    # before this point would raise KeyError.
    endpoint = _prepare_case(harness, case)
    task = harness._task(case.task_id)
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


# --- evaluation CLI -------------------------------------------------------

def select_cases(source: str = "all", split: str = "all", fuzz: int = 0,
                 seed: int = 0, replay_seed: int | None = None) -> list[Case]:
    """Pick the cases a run should evaluate."""
    if replay_seed is not None:
        from .fuzz import replay_case

        case = replay_case(replay_seed)
        return [case] if case else []

    cases: list[Case] = []
    if fuzz:
        from .fuzz import fuzz_cases

        cases.extend(fuzz_cases(fuzz, seed=seed))
    if source == "synthetic":
        cases.extend(CASES)
    elif source == "real":
        from ..realworld.case_builder import reviewed_cases

        cases.extend(reviewed_cases())
    elif source == "all":
        cases.extend(all_cases())
    if split != "all":
        cases = [case for case in cases if case.split == split]
    return cases


def case_verdict(case: Case, records: list[RunRecord]) -> str:
    """One word for the whole case: what actually happened, verified."""
    healing = next((r for r in records if r.agent == "healing"), None)
    if healing is None:
        return "failed"
    if healing.outcome == "recovered" and healing.correct is False:
        return "wrong_patch"
    if case.expected_outcome == "recovered":
        if healing.outcome == "recovered" and healing.correct is not False:
            return "recovered"
        return "failed"
    if case.expected_outcome == "refused":
        if healing.outcome != "refused":
            return "failed"
        if case.expected_reason and healing.reason_code != case.expected_reason:
            return "failed"
        return "correct_refusal"
    if healing.outcome == case.expected_outcome:
        return "not_drift"
    return "failed"


def _harness_for(settings, base_url: str | None) -> tuple[Harness, object]:
    """In-process mock by default so the CLI needs no running server."""
    if base_url:
        client = httpx.Client(base_url=base_url, timeout=5.0)
        return Harness(settings, client=client), client
    from fastapi.testclient import TestClient

    from ..mock_api.main import create_app as create_mock_app

    test_client = TestClient(create_mock_app(settings))
    test_client.__enter__()
    return Harness(settings, client=test_client), test_client


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Run Reflex evaluation cases.")
    parser.add_argument("--source", default=None,
                        choices=[None, "all", "synthetic", "real", "fuzz"],
                        help="defaults to fuzz when --fuzz/--replay-seed is used, else all")
    parser.add_argument("--split", default="all", choices=["all", "tuning", "held_out", "fuzz"])
    parser.add_argument("--fuzz", type=int, default=0, help="number of generated cases")
    parser.add_argument("--seed", type=int, default=0, help="fuzz seed")
    parser.add_argument("--replay-seed", type=int, default=None,
                        help="re-run exactly one previously recorded fuzz seed")
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--json", action="store_true", help="emit machine-readable JSON")
    parser.add_argument("--base-url", default=None,
                        help="use a running mock API instead of an in-process one")
    args = parser.parse_args(argv)

    from ..config import load_settings

    settings = load_settings()
    source = args.source
    if source is None:
        source = "fuzz" if (args.fuzz or args.replay_seed is not None) else "all"
    args.source = source
    cases = select_cases(source=source, split=args.split, fuzz=args.fuzz,
                         seed=args.seed, replay_seed=args.replay_seed)
    if not cases:
        print("No cases selected. Real-world cases must be reviewed before they run.")
        return 1

    harness, client = _harness_for(settings, args.base_url)
    run_id = uuid.uuid4().hex[:12]
    rows: list[dict[str, Any]] = []
    all_records: list[RunRecord] = []
    try:
        for case in cases:
            try:
                records = run_single_case(harness, case, run_id=run_id, repeat=args.repeats)
                all_records.extend(records)
                verdict = case_verdict(case, records)
            except Exception as exc:  # a broken composition must not hide the rest
                records, verdict = [], f"error: {exc}"
            healing = next((r for r in records if r.agent == "healing"), None)
            baseline = next((r for r in records if r.agent == "baseline"), None)
            rows.append({
                "case_id": case.id,
                "source": case.source,
                "split": case.split,
                "expected": case.expected_outcome,
                "baseline": baseline.outcome if baseline else None,
                "reflex": healing.outcome if healing else None,
                "reason": healing.reason_code if healing else None,
                "verdict": verdict,
                "seed": case.seed,
            })
        if all_records:
            save_results(all_records, settings.results_dir, run_id)
    finally:
        if args.base_url is None and client is not None:
            client.__exit__(None, None, None)

    wrong_patches = [row for row in rows if row["verdict"] == "wrong_patch"]
    failures = [row for row in rows if str(row["verdict"]).startswith(("failed", "error"))]

    if args.json:
        print(json.dumps({"run_id": run_id, "rows": rows,
                          "wrong_patches": len(wrong_patches),
                          "failures": len(failures)}, indent=2))
    else:
        print(f"\nrun {run_id}  cases={len(rows)}  source={args.source}  split={args.split}")
        print(f"{'case':<44} {'expected':<10} {'baseline':<10} {'reflex':<10} verdict")
        print("-" * 92)
        for row in rows:
            print(f"{row['case_id']:<44} {str(row['expected']):<10} "
                  f"{str(row['baseline']):<10} {str(row['reflex']):<10} {row['verdict']}")
        print("-" * 92)
        print(f"wrong_patches={len(wrong_patches)}  failures={len(failures)}")
        for row in failures:
            if row["seed"] is not None:
                print(f"replay: python -m app.runner.run_suite "
                      f"--replay-seed {row['seed']}   # {row['case_id']}")

    return 0 if not wrong_patches else 2


if __name__ == "__main__":
    import sys

    sys.exit(main())
