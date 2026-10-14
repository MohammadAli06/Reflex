"""CLI fallback demo (design.md §8).

Runs the same real backend flow in the terminal: consistency check, a normal
run, the PS mutation, baseline vs self-healing, an audit tail, a refusal case
and a results table. Requires the mock API to be running (port 8000).

    python cli/demo.py
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

from app.config import load_settings  # noqa: E402
from app.runner.cases import get_case  # noqa: E402
from app.runner.harness import Harness  # noqa: E402
from app.runner.metrics import compute_metrics  # noqa: E402
from app.runner.run_suite import load_records, run_single_case  # noqa: E402


def _line(title: str) -> None:
    print("\n" + "=" * 68)
    print(title)
    print("=" * 68)


def main() -> int:
    settings = load_settings()
    if not settings.admin_key:
        print("BLOCKED: ADMIN_KEY is not set. Copy .env.example to .env and fill it in.")
        return 1

    client = httpx.Client(base_url=settings.mock_api_url, timeout=5.0)
    try:
        client.get("/health", timeout=3.0).raise_for_status()
    except Exception:
        print(f"BLOCKED: mock API not reachable at {settings.mock_api_url}. Start it first.")
        return 1

    harness = Harness(settings, client=client)

    _line("1. Schema consistency")
    state = harness.state()
    openapi = harness.schema()
    agree = openapi.get("x-active-schema") == state["state"]
    print(f"version={state['version']}  exposed==active: {agree}")

    _line("2. Normal run - both agents")
    for record in run_single_case(harness, get_case("normal_fetch"), run_id="cli-normal"):
        print(f"  {record.agent:<9} outcome={record.outcome:<10} correct={record.correct}")

    _line("3. Apply PS demo mutation (nesting + type change + new header)")
    mutated = harness.apply_mutation("M_NEST_TYPE_HEADER")
    print(f"  new schema version: {mutated['version']}")

    _line("4. Baseline vs self-healing")
    for record in run_single_case(harness, get_case("ps_demo"), run_id="cli-ps"):
        mttr = f"{record.mttr:.3f}s" if record.mttr is not None else "n/a"
        print(f"  {record.agent:<9} outcome={record.outcome:<10} attempts={record.attempts} mttr={mttr}")

    _line("5. Audit tail")
    for entry in harness.audit.read(limit=5):
        print(f"  {entry['outcome']:<10} tool={entry.get('tool'):<11} reason={entry.get('reason_code')}")

    _line("6. Refusal case (missing credential)")
    from app.control_api.scenarios import run_scenario  # local import: CLI-only

    result = run_scenario(harness, "missing_credential")
    print(f"  outcome={result['outcome']} reason={result['reason_code']}")
    print(f"  {result['explanation']}")

    _line("7. Results table (from results/)")
    records = load_records(settings.results_dir)
    metrics = compute_metrics(records)
    if not metrics.get("available"):
        print("  No results yet. Run the suite from the UI (Compare page).")
    else:
        for agent, data in metrics["agents"].items():
            overall = data["overall"]
            print(f"  {agent:<9} n={overall['n']} ztar={overall['ztar']} "
                  f"wrong_patches={overall['wrong_patches']} refusals={overall['correct_refusals']}")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONUTF8", "1")
    sys.exit(main())
