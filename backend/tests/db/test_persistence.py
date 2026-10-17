"""DB-backed persistence tests: audit chain, registry CAS, restart recovery,
SSE replay from SQLite, and session auth."""
from __future__ import annotations

import json
import threading
import time

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.control_api.main import create_app as create_control_app
from app.db import AuditRepo, ToolRevisionRepo, UserRepo, init_db, session_scope
from app.db.models import AuditEntryRow
from app.mock_api.main import create_app as create_mock_app
from app.registry.tool_registry import StaleRevisionError
from app.registry.tools import initial_definitions

from ..support.auth import login_operator

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "tenant-secret-value"


@pytest.fixture
def db_settings(tmp_path):
    return load_settings(
        env={
            "ADMIN_KEY": ADMIN_KEY,
            "MOCK_TENANT_TOKEN": TENANT_TOKEN,
            "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
            "AUDIT_LOG_PATH": str(tmp_path / "audit.jsonl"),
            "RESULTS_DIR": str(tmp_path / "results"),
            "DATABASE_URL": f"sqlite:///{(tmp_path / 'reflex_db_test.db').as_posix()}",
        }
    )


@pytest.fixture
def apps(db_settings):
    mock_client = TestClient(create_mock_app(db_settings))
    mock_client.__enter__()
    control_client = TestClient(create_control_app(db_settings, mock_client=mock_client))
    control_client.__enter__()
    login_operator(control_client)  # operator routes are session-gated
    try:
        yield control_client, db_settings
    finally:
        control_client.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


def test_audit_chain_verifies_and_names_tampered_entry(db_settings):
    init_db(db_settings.database_url)
    repo = AuditRepo(db_settings.database_url)
    repo.append({"run_id": "r1", "outcome": "applied"})
    repo.append({"run_id": "r1", "outcome": "refused"})
    ok, broken = repo.verify_chain()
    assert ok is True and broken is None

    with session_scope(db_settings.database_url) as session:
        row = session.query(AuditEntryRow).order_by(AuditEntryRow.id).all()[0]
        tampered = json.loads(row.entry_json)
        tampered["outcome"] = "applied!"
        row.entry_json = json.dumps(tampered)
        broken_id = row.id

    ok, broken = repo.verify_chain()
    assert ok is False
    assert broken == broken_id


def test_concurrent_cas_exactly_one_wins(db_settings):
    init_db(db_settings.database_url)
    repo = ToolRevisionRepo(db_settings.database_url)
    definition = initial_definitions()["fetch_user"].to_dict()
    repo.seed_initial({"fetch_user": definition})

    results: list = []

    def writer(tag: str):
        try:
            rev = repo.insert_cas("fetch_user", 1, definition,
                                  created_by_run=tag, reason="race")
            results.append((tag, rev))
        except StaleRevisionError:
            results.append((tag, "stale"))

    threads = [threading.Thread(target=writer, args=(f"t{i}",)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    wins = [r for r in results if r[1] != "stale"]
    losses = [r for r in results if r[1] == "stale"]
    assert len(wins) == 1 and len(losses) == 1
    assert wins[0][1] == 2
    assert repo.max_revision("fetch_user") == 2


def test_runs_audit_registry_survive_restart(apps):
    control, settings = apps
    started = control.post("/api/runs", json={"case_ids": ["normal_fetch"], "repeats": 1})
    assert started.status_code == 200, started.text
    run_id = started.json()["run_id"]

    deadline = time.time() + 15
    while time.time() < deadline:
        final = control.get(f"/api/runs/{run_id}").json()
        if final["status"] != "running":
            break
        time.sleep(0.1)
    assert final["status"] == "finished"

    audit_before = control.get("/api/audit").json()["entries"]
    registry_before = control.get("/api/registry").json()

    # Simulate a Control API restart: new app instance, same DB file.
    mock_client = TestClient(create_mock_app(settings))
    mock_client.__enter__()
    try:
        restarted = TestClient(create_control_app(settings, mock_client=mock_client))
        restarted.__enter__()
        login_operator(restarted)
        try:
            assert restarted.get(f"/api/runs/{run_id}").json()["status"] == "finished"
            assert restarted.get(f"/api/runs/{run_id}").json()["records"]
            assert restarted.get("/api/audit").json()["entries"] == audit_before
            assert restarted.get("/api/registry").json() == registry_before
            assert restarted.get("/api/audit/verify").json()["ok"] is True
            metrics = restarted.get("/api/metrics").json()
            assert metrics["available"] is True

            events = restarted.get(
                f"/api/runs/{run_id}/events", headers={"Last-Event-ID": "0"})
            assert events.status_code == 200
            assert "text/event-stream" in events.headers["content-type"]
            assert "data:" in events.text
        finally:
            restarted.__exit__(None, None, None)
    finally:
        mock_client.__exit__(None, None, None)


def test_sse_replay_from_last_event_id(apps):
    control, _ = apps
    started = control.post("/api/runs", json={"case_ids": ["normal_fetch"], "repeats": 1})
    run_id = started.json()["run_id"]
    deadline = time.time() + 15
    while time.time() < deadline:
        if control.get(f"/api/runs/{run_id}").json()["status"] != "running":
            break
        time.sleep(0.1)

    full = control.get(f"/api/runs/{run_id}/events").text
    assert "event: end" in full
    partial = control.get(f"/api/runs/{run_id}/events",
                          headers={"Last-Event-ID": "1"}).text
    assert "event: end" in partial
    assert partial.count("data:") <= full.count("data:")
    assert partial.count("data:") >= 1


def test_login_sets_session_cookie_and_me(apps):
    control, _ = apps
    # The fixture logs in; this test deliberately starts from a fresh client.
    assert control.get("/api/me").status_code == 200
    assert control.post("/api/logout").status_code == 200
    assert control.get("/api/me").status_code == 401

    bad = control.post("/api/login", json={"username": "operator", "password": "wrong"})
    assert bad.status_code == 401

    fresh = TestClient(control.app)
    good = fresh.post("/api/login",
                      json={"username": "operator", "password": "reflex2026"})
    assert good.status_code == 200, good.text
    assert "reflex_session=" in good.headers.get("set-cookie", "")
    assert "HttpOnly" in good.headers.get("set-cookie", "")

    assert fresh.get("/api/me").json()["username"] == "operator"
    assert fresh.post("/api/logout").status_code == 200
    assert fresh.get("/api/me").status_code == 401


def test_seed_does_not_overwrite_admin_password(db_settings):
    init_db(db_settings.database_url)
    repo = UserRepo(db_settings.database_url)
    user, created = repo.ensure_user("operator", "reflex2026")
    assert created is True
    same, created_again = repo.ensure_user("operator", "something-else")
    assert created_again is False
    assert repo.authenticate("operator", "reflex2026") is not None
    assert repo.authenticate("operator", "something-else") is None
