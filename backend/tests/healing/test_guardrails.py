"""Guardrail tests: budgets, breakers, provenance audit, fail-closed patching,
repair policies, and the operator rollback endpoint."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.registry.executor import CallResult
from app.healing import reason_codes as rc
from app.healing.hypothesize import CandidatePatch
from app.healing.llm_fallback import FakeRepairClient
from app.registry.tools import ToolDefinition
from app.security.budget import Breakers, RunBudget
from app.security.policy import load_security_policy
from app.security.repair_policies import check_repair_policies
from app.healing.schema_diff import diff_schemas
from tests.healing.test_llm_fallback import Env

from ..support.auth import login_operator


def policy_for(env_overrides: dict[str, str] | None = None):
    from app.config import load_settings

    env = {"ADMIN_KEY": "k"}
    env.update(env_overrides or {})
    settings = load_settings(env=env)
    return load_security_policy(settings, env=env)


# --- budget --------------------------------------------------------------------

def test_run_budget_loop_fingerprints():
    policy = policy_for()
    budget = RunBudget(policy)
    assert budget.check_loop("f1") is False
    assert budget.check_loop("f1") is True   # a repeat means a loop
    assert budget.check_loop("f2") is False


def test_run_budget_patch_and_retry_caps():
    policy = policy_for({"REFLEX_MAX_PATCH_ATTEMPTS": "2", "REFLEX_MAX_TOTAL_RETRIES": "3"})
    budget = RunBudget(policy)
    assert budget.register_patch() is True
    assert budget.register_patch() is True
    assert budget.register_patch() is False   # cap hit
    assert budget.register_retry() is True
    assert budget.register_retry() is True
    assert budget.register_retry() is True
    assert budget.register_retry() is False
    assert budget.time_exceeded(0.000001) is True


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path / "audit.jsonl")
    try:
        yield e
    finally:
        e.close()


# --- breaker state machine ------------------------------------------------------

def test_breaker_state_machine(monkeypatch):
    policy = policy_for({
        "REFLEX_BREAKER_THRESHOLD": "2", "REFLEX_BREAKER_COOLDOWN_S": "1",
        "REFLEX_BREAKER_WINDOW_S": "60",
    })

    class FakeTime:
        now = 1000.0

    monkeypatch.setattr("app.security.budget.time.monotonic", lambda: FakeTime.now)
    breaker = Breakers(policy)

    assert breaker.check_call("host1") == Breakers.CLOSED
    assert breaker.record_failure("host1") is False
    assert breaker.check_call("host1") == Breakers.CLOSED
    assert breaker.record_failure("host1") is True   # threshold reached -> opens
    assert breaker.check_call("host1") == Breakers.OPEN

    FakeTime.now += 1.5  # cooldown elapsed -> a half-open probe is allowed
    assert breaker.check_call("host1") == Breakers.HALF_OPEN
    assert breaker.check_call("host1") == Breakers.OPEN  # extra calls rejected during the probe

    breaker.record_success("host1")                      # probe succeeded -> closes
    assert breaker.check_call("host1") == Breakers.CLOSED

    breaker.record_failure("host1"); breaker.record_failure("host1")
    assert breaker.check_call("host1") == Breakers.OPEN   # re-opens on new failures


# --- healer-level guardrail refusals --------------------------------------------

class _StubBase:
    base_url = "http://test"

    def base_url(self) -> str:  # noqa: D102 - mirrors the real Executor API
        return "http://test"

    def request_url(self, prepared):
        return self.base_url() + prepared.endpoint


def test_healer_refuses_with_circuit_open_error(env):
    class CircuitExecutor(_StubBase):
        def call(self, prepared):
            return CallResult(status=None, ok=False, error_type="circuit_open",
                              raw_text="circuit breaker is open for host 'test'")

    env.mutate("M_RENAME")
    env.executor = CircuitExecutor()
    outcome, emitter = env.heal()
    assert outcome.outcome == "refused"
    assert outcome.reason_code == rc.CIRCUIT_OPEN
    assert env.registry.revision("fetch_user") == 1  # the breaker fires before any patch


def test_check_repair_policies_refuses_overbroad_patch():
    """The rule engine cannot produce overbroad patches by construction - this
    guard exists for LLM proposals and any future candidate source."""
    diff = diff_schemas(
        "/user/fetch",
        {"type": "object", "properties": {"user_id": {"type": "string"}}, "required": ["user_id"]},
        {"type": "object",
         "properties": {"target": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
         "required": ["target"]},
        old_headers=None, new_headers=None,
    )
    definition = ToolDefinition(
        name="t", endpoint="/user/fetch", method="POST",
        request_schema={"type": "object", "properties": {"user_id": {"type": "string"}}, "required": ["user_id"]},
        required_headers=[], response_schema={},
        bindings={"user_id": {"source": "arg", "arg": "user_id", "convert": None}},
        response_map={}, write=False, revision=1,
    )
    legit = CandidatePatch(
        tool="t",
        new_bindings={"target.id": {"source": "arg", "arg": "user_id", "convert": None}},
        new_required_headers=[],
        conversions={},
        evidence=["map user_id -> target.id"],
        confidence=0.7,
        healing_path="rule",
    )
    assert check_repair_policies(legit, definition, diff) is None

    overbroad = CandidatePatch(
        tool="t",
        new_bindings={
            "target.id": {"source": "arg", "arg": "user_id", "convert": None},
            "unrelated.field": {"source": "arg", "arg": "user_id", "convert": None},
        },
        new_required_headers=[{"name": "X-Not-In-Diff"}],
        conversions={"target.id": "str_to_int"},
        evidence=["llm overbroad"],
        confidence=0.5, healing_path="llm",
    )
    assert check_repair_policies(overbroad, definition, diff) == rc.OVERBROAD_PATCH


# --- provenance on patches -------------------------------------------------------

def test_applied_audit_records_provenance(env):
    env.mutate("M_RENAME")
    outcome, _ = env.heal()
    assert outcome.outcome == "recovered"
    entry = next(e for e in env.audit.read() if e["outcome"] == "applied")
    provenance = entry["provenance"]
    assert provenance["source_host"] == "testserver"  # the TestClient mock host name
    assert len(provenance["sha256"]) == 64
    assert provenance["spec_version"] == 2  # post-mutation version
    assert provenance["signature_verified"] in (True, False)


def test_fail_closed_patch_when_audit_write_fails(env):
    class FailingAudit:
        def append(self, entry):
            raise RuntimeError("audit backend down")

        def read(self, **kwargs):
            return []

        def add_secret(self, value):
            pass

        def verify_chain(self):
            return True, None

    env.mutate("M_RENAME")
    env.audit = FailingAudit()
    outcome, _ = env.heal()
    assert outcome.outcome == "refused"
    assert outcome.reason_code == rc.AUDIT_UNAVAILABLE
    assert env.registry.revision("fetch_user") == 1  # nothing changed, no partial state


# --- operator rollback endpoint --------------------------------------------------

@pytest.fixture(scope="module")
def app_control(tmp_path_factory):
    from app.config import load_settings
    from app.control_api.main import create_app
    from app.mock_api.main import create_app as create_mock_app

    tmp_path = tmp_path_factory.mktemp("rollback")
    settings = load_settings(env={
        "ADMIN_KEY": "test-admin-key",
        "MOCK_TENANT_TOKEN": "tenant-secret-value",
        "HEADER_X_TENANT_TOKEN": "tenant-secret-value",
        "AUDIT_LOG_PATH": str(tmp_path / "audit.jsonl"),
        "RESULTS_DIR": str(tmp_path / "results"),
        "DATABASE_URL": f"sqlite:///{(tmp_path / 'rollback.db').as_posix()}",
    })
    mock_client = TestClient(create_mock_app(settings))
    mock_client.__enter__()
    client = TestClient(create_app(settings, mock_client=mock_client))
    client.__enter__()
    login_operator(client)
    try:
        yield client
    finally:
        client.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


def test_rollback_flow_and_stale_guard(app_control):
    client = app_control
    # Produce a second revision with a real heal.
    client.post("/api/mutate", json={"mutation_id": "M_RENAME"})
    result = client.post("/api/sdk/call", json={"tool": "fetch_user", "args": {"user_id": "123"}})
    assert result.status_code == 200 and result.json()["outcome"] == "recovered"
    history = client.get("/api/registry", params={"tool": "fetch_user"}).json()["tools"]["fetch_user"]
    assert len(history) >= 2

    rollback = client.post("/api/registry/rollback",
                           json={"tool": "fetch_user", "current_revision": max(h["revision"] for h in history),
                                 "target_revision": 1})
    assert rollback.status_code == 200, rollback.text
    assert rollback.json()["new_revision"] == max(h["revision"] for h in history) + 1

    # A second rollback with the same stale current_revision is refused (409).
    stale = client.post("/api/registry/rollback",
                        json={"tool": "fetch_user", "current_revision": max(h["revision"] for h in history),
                              "target_revision": 1})
    assert stale.status_code == 409
    assert "moved on" in stale.json()["detail"]

    # Missing revisions are clean 404s.
    missing = client.post("/api/registry/rollback",
                          json={"tool": "fetch_user", "current_revision": max(h["revision"] for h in history) + 1,
                                "target_revision": 99})
    assert missing.status_code == 404

    # The rollback is on the audit chain.
    entries = client.get("/api/audit").json()["entries"]
    assert any(e["outcome"] == "applied" and e["reason_code"] == "rollback" for e in entries)


# --- boundary redaction ---------------------------------------------------------

def test_bearer_and_jwt_strings_are_masked_in_audit(env):
    """A planted credential-shaped string in the upstream error text must not
    reach the audit store."""
    jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJoZWxsbyJ9.dQw4w9WgXcQ"
    bearer = "Bearer rw_secret_agent_token_value"

    class TokenLeakingExecutor(_StubBase):
        def call(self, prepared):
            return CallResult(status=422, ok=False, body={"error": f"{bearer} for a request with {jwt}"})

    env.mutate("M_RENAME")
    env.executor = TokenLeakingExecutor()
    outcome, _ = env.heal()
    assert outcome.outcome == "refused"
    text = open(env.audit.path, encoding="utf-8").read()
    assert jwt not in text
    assert bearer.split()[-1] not in text
    assert "[REDACTED]" in text


# --- unsafe conversion via the offline dry-run path ------------------------------

def test_unsafe_conversion_is_refused_with_its_reason_code():
    from app.dryrun import engine

    def spec(schema_property: dict[str, str], version: str) -> dict[str, object]:
        return {
            "openapi": "3.1.0", "info": {"title": "Demo", "version": version},
            "paths": {"/user/fetch": {"post": {"requestBody": {"content": {"application/json": {
                "schema": {"type": "object", "properties": {"amount": schema_property}, "required": ["amount"]}}}}}}},
        }

    old_spec = spec({"type": "string", "x-precision": 2}, "1.0")
    new_spec = spec({"type": "number"}, "2.0")
    result = engine.analyze(
        old_spec_text=json.dumps(old_spec), new_spec_text=json.dumps(new_spec),
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"amount": "12.30"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
    )
    assert result["outcome"] == "refused"
    assert result["reason_code"] == rc.UNSAFE_CONVERSION
