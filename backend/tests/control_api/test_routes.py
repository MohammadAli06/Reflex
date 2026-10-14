"""Control API route tests with an in-process mock wired in."""
from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.control_api.main import create_app as create_control_app
from app.mock_api.main import create_app as create_mock_app

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "tenant-secret-value"


@pytest.fixture
def clients(tmp_path):
    settings = load_settings(
        env={
            "ADMIN_KEY": ADMIN_KEY,
            "MOCK_TENANT_TOKEN": TENANT_TOKEN,
            "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
            "AUDIT_LOG_PATH": str(tmp_path / "audit.jsonl"),
            "RESULTS_DIR": str(tmp_path / "results"),
        }
    )
    mock_client = TestClient(create_mock_app(settings))
    mock_client.__enter__()
    control_client = TestClient(create_control_app(settings, mock_client=mock_client))
    control_client.__enter__()
    try:
        yield control_client
    finally:
        control_client.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


def test_health_and_status(clients):
    assert clients.get("/api/health").json()["status"] == "ok"
    status = clients.get("/api/status").json()
    assert status["mock_api_reachable"] is True
    assert status["schema_version"] == 1
    assert status["schema_hash"]


def test_schema_and_consistency(clients):
    assert clients.get("/api/schema").json()["version"] == 1
    consistency = clients.get("/api/consistency").json()
    assert consistency["pass"] is True
    assert len(consistency["checks"]) >= 5


def test_mutate_then_consistency(clients):
    resp = clients.post("/api/mutate", json={"mutation_id": "M_NEST"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["version"] == 2
    assert clients.get("/api/consistency").json()["pass"] is True


def test_catalogs(clients):
    assert clients.get("/api/mutations").json()["mutations"]
    assert clients.get("/api/cases").json()["cases"]
    assert len(clients.get("/api/scenarios").json()["scenarios"]) == 5


def test_scenario_refusal(clients):
    result = clients.post("/api/scenarios/ambiguous_mapping/run").json()
    assert result["outcome"] == "refused"
    assert result["reason_code"] == "ambiguous_mapping"
    assert result["explanation"]
    assert any(e["type"] == "refused" for e in result["events"])


def test_scenario_recovery(clients):
    result = clients.post("/api/scenarios/recover_ps_demo/run").json()
    assert result["outcome"] == "recovered"
    assert any(e["type"] == "patch_applied" for e in result["events"])


def test_origin_guard_rejects_untrusted(clients):
    resp = clients.post("/api/mutate", json={"mutation_id": "M_NEST"},
                        headers={"Origin": "http://evil.example"})
    assert resp.status_code == 403


def test_run_lifecycle_and_metrics(clients):
    started = clients.post("/api/runs", json={"case_ids": ["normal_fetch"], "repeats": 1})
    assert started.status_code == 200, started.text
    run_id = started.json()["run_id"]

    deadline = time.time() + 10
    final = started.json()
    while time.time() < deadline:
        final = clients.get(f"/api/runs/{run_id}").json()
        if final["status"] != "running":
            break
        time.sleep(0.1)
    assert final["status"] == "finished"
    assert len(final["records"]) == 2  # baseline + healing

    events = clients.get(f"/api/runs/{run_id}/events")
    assert events.status_code == 200
    assert events.headers["content-type"].startswith("text/event-stream")

    metrics = clients.get("/api/metrics").json()
    assert metrics["available"] is True
    assert "healing" in metrics["agents"]


def test_concurrent_run_returns_409(clients):
    clients.post("/api/runs", json={"case_ids": ["normal_fetch"], "repeats": 1})
    second = clients.post("/api/runs", json={"case_ids": ["normal_fetch"], "repeats": 1})
    assert second.status_code == 409
