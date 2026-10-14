"""End-to-end smoke test against running servers (T10.2 helper).

Assumes the mock API (8000) and control API (8001) are running. Exercises the
real flow: status, consistency, mutation, a comparison run, SSE replay, audit
and metrics. Prints PASS/FAIL for each step.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402

CONTROL = "http://localhost:8001"


def check(name: str, ok: bool, detail: str = "") -> bool:
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    return ok


def main() -> int:
    results: list[bool] = []
    with httpx.Client(base_url=CONTROL, timeout=30.0) as client:
        status = client.get("/api/status").json()
        results.append(check("status", status["mock_api_reachable"] and status["control_api"] == "ok"))

        consistency = client.get("/api/consistency").json()
        results.append(check("consistency", consistency["pass"],
                             f"({len(consistency['checks'])} checks)"))

        mutated = client.post("/api/mutate", json={"mutation_id": "M_NEST_TYPE_HEADER"})
        results.append(check("mutate ps_demo", mutated.status_code == 200,
                             f"version={mutated.json().get('version')}"))

        started = client.post("/api/runs", json={"case_ids": ["ps_demo"], "repeats": 1})
        results.append(check("start run", started.status_code == 200))
        run_id = started.json()["run_id"]

        summary = {}
        deadline = time.time() + 20
        while time.time() < deadline:
            summary = client.get(f"/api/runs/{run_id}").json()
            if summary["status"] != "running":
                break
            time.sleep(0.3)
        records = summary.get("records", [])
        baseline = next((r for r in records if r["agent"] == "baseline"), {})
        healing = next((r for r in records if r["agent"] == "healing"), {})
        results.append(check("baseline failed honestly", baseline.get("outcome") == "failed",
                             f"outcome={baseline.get('outcome')}"))
        results.append(check("healing recovered", healing.get("outcome") == "recovered",
                             f"outcome={healing.get('outcome')} mttr={'%.3fs' % (healing['t_recovery'] - healing['t_break']) if healing.get('t_recovery') else 'n/a'}"))

        events = client.get(f"/api/runs/{run_id}/events")
        results.append(check("SSE stream", events.status_code == 200
                             and "text/event-stream" in events.headers.get("content-type", "")))

        audit = client.get("/api/audit", params={"limit": 5}).json()
        results.append(check("audit entries", len(audit["entries"]) >= 1))

        metrics = client.get("/api/metrics").json()
        results.append(check("metrics available", metrics.get("available") is True))

        scenario = client.post("/api/scenarios/missing_credential/run").json()
        results.append(check("refusal scenario", scenario["outcome"] == "refused",
                             f"reason={scenario['reason_code']}"))

        client.post("/api/reset")

    print(f"\n{sum(results)}/{len(results)} checks passed")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
