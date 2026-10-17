"""Exchange recording: the 5-step flow is visible from stored events."""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from ..support.auth import login_operator

from app.config import load_settings
from app.control_api.main import create_app as create_control_app
from app.healing.exchange import BODY_CAP_BYTES, build_exchange, redact
from app.mock_api.main import create_app as create_mock_app

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "planted-tenant-secret"
API_KEY_VALUE = "planted-api-key-value"


@pytest.fixture
def clients(tmp_path):
    settings = load_settings(
        env={
            "ADMIN_KEY": ADMIN_KEY,
            "MOCK_TENANT_TOKEN": TENANT_TOKEN,
            "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
            "AUDIT_LOG_PATH": str(tmp_path / "audit.jsonl"),
            "RESULTS_DIR": str(tmp_path / "results"),
            "DATABASE_URL": f"sqlite:///{(tmp_path / 'reflex_test.db').as_posix()}",
        }
    )
    mock_client = TestClient(create_mock_app(settings))
    mock_client.__enter__()
    control_client = TestClient(create_control_app(settings, mock_client=mock_client))
    control_client.__enter__()
    login_operator(control_client)  # operator routes are session-gated
    try:
        yield control_client
    finally:
        control_client.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


def run_case(client, case_id: str) -> dict:
    resp = client.post("/api/runs", json={"case_ids": [case_id]})
    assert resp.status_code == 200, resp.text
    run_id = resp.json()["run_id"]
    for _ in range(200):
        time.sleep(0.05)
        final = client.get(f"/api/runs/{run_id}").json()
        if final["status"] != "running":
            return final
    raise AssertionError(f"run {run_id} never finished: {final.get('error')}")


def exchanges_of(summary: dict) -> list[dict]:
    return [e["data"] for e in summary.get("exchanges", [])]


def test_recovery_flow_has_baseline_spec_and_retry_exchanges(clients):
    """break -> baseline call -> spec fetch -> patch -> retry is all recorded."""
    final = run_case(clients, "ps_demo")
    assert final["status"] == "finished", final.get("error")

    steps = {e["step"] for e in exchanges_of(final)}
    assert "baseline_call" in steps
    assert "spec_fetch" in steps
    assert "retry_call" in steps

    by_step = {e["step"]: e for e in exchanges_of(final)}
    baseline = by_step["baseline_call"]
    fetch = by_step["spec_fetch"]

    assert baseline["url"].endswith("/user/fetch")
    assert baseline["response_status"] in (400, 401, 422)
    assert baseline["method"] == "POST"
    assert baseline["started_at"] and baseline["duration_ms"] is not None

    assert fetch["url"].endswith("/openapi.json")
    assert fetch["response_status"] == 200
    assert fetch["method"] == "GET" and fetch["request_body"] is None

    retry = by_step["retry_call"]
    assert retry["response_status"] == 200
    assert retry["attempt"] == 2


def test_mttr_computed_from_stored_timestamps(clients):
    final = run_case(clients, "ps_demo")
    by_step = {e["step"]: e for e in exchanges_of(final)}
    fail_t = datetime.fromisoformat(by_step["baseline_call"]["started_at"])
    retry_t = datetime.fromisoformat(by_step["retry_call"]["started_at"]) \
        + \
        timedelta(milliseconds=by_step["retry_call"]["duration_ms"] or 0)
    assert retry_t > fail_t


def test_planted_secrets_never_appear(clients):
    final = run_case(clients, "ps_demo")
    assert final["status"] == "finished", final.get("error")
    blob_events = json.dumps(
        clients.get(f"/api/runs/{final['run_id']}/events").text)
    blob_exchanges = json.dumps(exchanges_of(final))
    sse = json.dumps(clients.get(f"/api/runs/{final['run_id']}/events").text)
    blob_run = json.dumps(final)
    for blob in (blob_events, blob_exchanges, sse, blob_run):
        assert TENANT_TOKEN not in blob
        assert API_KEY_VALUE not in blob

    # The credential header is present but its value is redacted.
    redacted_headers = [e["request_headers"] for e in exchanges_of(final)
                        if isinstance(e.get("request_headers"), dict)]
    assert any("X-Tenant-Token" in (h or {}) for h in redacted_headers)


def test_redact_masks_sensitive_keys():
    payload = redact({
        "Authorization": "Bearer supersecretvalue",
        "Cookie": "session=abc",
        "X-API-Key": API_KEY_VALUE,
        "content-type": "application/json",
        "body_field": {"tenant_token": "abc123", "nested": {"api_secret": "xyz"}},
        "user_id": "123",
    })
    assert payload["Authorization"] == "[REDACTED]"
    assert payload["Cookie"] == "[REDACTED]"
    assert payload["X-API-Key"] == "[REDACTED]"
    assert payload["content-type"] == "application/json"
    assert payload["user_id"] == "123"
    assert payload["body_field"]["nested"]["api_secret"] == "[REDACTED]"
    assert payload["body_field"]["tenant_token"] == "[REDACTED]"
    blob = json.dumps(payload)
    assert "supersecretvalue" not in blob and "abc123" not in blob and "xyz" not in blob


def test_truncation_flag():
    huge = "x" * (BODY_CAP_BYTES + 500)
    record = build_exchange(step="unit", method="POST", url="/test",
                            response_status=200, response_body=huge)
    assert record["truncated"] is True
    assert len(record["response_body"]) == BODY_CAP_BYTES
    small = build_exchange(step="unit", method="GET", url="/test", response_status=200,
                           response_body={"ok": True})
    assert "truncated" not in small


def test_refusal_run_stores_diff_and_no_retry(clients):
    final = run_case(clients, "ambiguous_mapping")
    assert final["status"] == "finished", final.get("error")
    records = final["records"]
    healed = [r for r in records if r["agent"] == "healing"]
    assert healed and healed[0]["outcome"] == "refused"
    assert healed[0].get("reason_code") == "ambiguous_mapping"

    steps = {e["step"] for e in exchanges_of(final)}
    assert "spec_fetch" in steps
    assert "retry_call" not in steps, "refusal must not retry"

    events = clients.get(f"/api/runs/{final['run_id']}/events").text
    assert "schema_diff" in events
    assert "ambiguous_mapping" in events


def test_old_runs_without_exchanges_still_load(clients):
    final = run_case(clients, "normal_fetch")
    run_id = final["run_id"]
    after = clients.get(f"/api/runs/{run_id}").json()
    assert after["records"]
    assert isinstance(after.get("exchanges", []), list)


def test_mutate_returns_real_specs(clients):
    resp = clients.post("/api/mutate", json={"mutation_id": "M_RENAME"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["spec_before"]["request_schemas"]["/user/fetch"]["properties"].get("user_id")
    after_schema = body["spec_after"]["request_schemas"]["/user/fetch"]
    assert "uid" in after_schema["properties"]
    assert body["spec_before"]["version"] < body["spec_after"]["version"]
    assert body["spec_after"]["sha256"] != body["spec_before"]["sha256"]
    assert body["mutation"]["id"] == "M_RENAME"
