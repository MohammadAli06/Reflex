"""Real-source runs through the Control API - the path /console/real-world uses.

One client pair is shared for the whole module. Each ``TestClient`` starts an
anyio portal, and on this Windows build ``asyncio`` creates its self-pipe through
``socket.socketpair()``'s loopback-TCP fallback; a fresh pair per test exhausts
the ephemeral socket buffers and fails the suite with ``WinError 10055``. Sharing
keeps the tests honest while creating two clients instead of ten.

The assertions below are therefore order-independent: they never assume the
database is empty, they compare a state before and after their own run.
"""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.control_api.main import create_app as create_control_app
from app.mock_api.main import create_app as create_mock_app

from ..support.auth import login_operator
from app.realworld.case_builder import reviewed_cases
from app.runner.cases import all_cases

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "tenant-secret-value"


@pytest.fixture(scope="module")
def control(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp("realworld_routes")
    settings = load_settings(env={
        "ADMIN_KEY": ADMIN_KEY,
        "MOCK_TENANT_TOKEN": TENANT_TOKEN,
        "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
        "AUDIT_LOG_PATH": str(tmp_path / "audit.jsonl"),
        "RESULTS_DIR": str(tmp_path / "results"),
        "DATABASE_URL": f"sqlite:///{(tmp_path / 'rw_routes.db').as_posix()}",
    })
    mock_client = TestClient(create_mock_app(settings))
    mock_client.__enter__()
    client = TestClient(create_control_app(settings, mock_client=mock_client))
    client.__enter__()
    login_operator(client)  # operator routes are session-gated
    try:
        yield client
    finally:
        client.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


def _await_run(client: TestClient, run_id: str, timeout_s: float = 30.0) -> dict:
    deadline = time.time() + timeout_s
    summary = client.get(f"/api/runs/{run_id}").json()
    while summary["status"] == "running" and time.time() < deadline:
        time.sleep(0.05)
        summary = client.get(f"/api/runs/{run_id}").json()
    return summary


def test_starting_a_real_source_run_returns_a_run_id_and_real_records(control):
    case_ids = [case.id for case in reviewed_cases()]

    started = control.post("/api/runs", json={"case_ids": case_ids, "repeats": 1})
    assert started.status_code == 200, started.text
    body = started.json()
    assert body["run_id"]
    # The run is asynchronous, so the POST cannot already carry outcomes.
    assert body["status"] == "running"
    assert body["records"] == []

    final = _await_run(control, body["run_id"])
    assert final["status"] == "finished", final.get("error")
    assert len(final["records"]) == len(case_ids) * 2  # baseline + healing each
    assert {record["agent"] for record in final["records"]} == {"baseline", "healing"}
    assert all(record["source"] == "real" for record in final["records"])
    assert all(record["case_id"] in case_ids for record in final["records"])
    assert all(record["run_id"] == body["run_id"] for record in final["records"])


def test_realworld_cases_endpoint_reports_outcomes_after_a_run(control):
    """This is exactly the refresh the page performs once a run finishes."""
    case_ids = [case.id for case in reviewed_cases()]
    run_id = control.post("/api/runs", json={"case_ids": case_ids}).json()["run_id"]
    assert _await_run(control, run_id)["status"] == "finished"

    after = control.get("/api/realworld/cases").json()
    row = next(c for c in after["cases"] if c["id"] == case_ids[0])
    assert row["baseline_outcome"] == "failed"
    assert row["reflex_outcome"] == "recovered"
    assert row["reflex_correct"] is True
    # The Trace link needs a persisted run id, which only exists post-run.
    assert row["run_id"] == run_id

    # `evaluated` counts distinct cases, not runs, so it equals the reviewed
    # set even after several runs.
    summary = after["summary"]
    assert summary["reviewed"] == len(case_ids)
    assert summary["evaluated"] == len(case_ids)
    assert summary["recovered"] == len(case_ids)
    assert summary["wrong_patches"] == 0


def test_real_run_record_is_grouped_under_the_real_source(control):
    started = control.post("/api/runs", json={
        "case_ids": [reviewed_cases()[0].id], "repeats": 1,
    })
    assert _await_run(control, started.json()["run_id"])["status"] == "finished"

    metrics = control.get("/api/metrics").json()
    assert metrics["available"] is True
    by_source = metrics["agents"]["healing"]["by_source"]
    assert "real" in by_source
    assert by_source["real"]["recovered"] >= 1


def test_unreviewed_drafts_are_not_runnable(control):
    """A draft is a proposal: neither the API nor the CLI may run it."""
    for case in all_cases():
        if case.source == "real":
            assert case.reviewed, f"{case.id} is registered without review"
    assert all(case.reviewed for case in reviewed_cases())

    refused = control.post("/api/runs", json={"case_ids": ["draft_only"]})
    assert refused.status_code == 400
    assert "unknown case" in refused.text
