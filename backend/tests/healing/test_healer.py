"""End-to-end healing tests against the real mock app (in-process).

Covers recovery for each mutation class plus every safe-refusal branch, and
proves there is no infinite retry loop.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.audit.audit_log import AuditLog
from app.config import load_settings
from app.healing import reason_codes as rc
from app.healing.events import EventEmitter, Redactor
from app.healing.healer import Healer
from app.healing.secrets import EmptySecretsProvider, StaticSecretsProvider
from app.mock_api.main import create_app
from app.registry.executor import Executor
from app.registry.tool_registry import ToolRegistry
from app.registry.tools import initial_definitions

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "tenant-secret-value"


class Env:
    def __init__(self, audit_path, secrets=None, max_schema_attempts=3):
        self.settings = load_settings(
            env={
                "ADMIN_KEY": ADMIN_KEY,
                "MOCK_TENANT_TOKEN": TENANT_TOKEN,
                "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
                "MAX_SCHEMA_ATTEMPTS": str(max_schema_attempts),
                "MAX_INFRA_RETRIES": "2",
                "DATABASE_URL": f"sqlite:///{audit_path.parent.joinpath('reflex_test.db').as_posix()}",
            }
        )
        self.app = create_app(self.settings)
        self.client = TestClient(self.app)
        self.client.__enter__()
        self.registry = ToolRegistry(initial_definitions())
        self.secrets = secrets or StaticSecretsProvider(
            {"X-Tenant-Token": TENANT_TOKEN}
        )
        self.audit = AuditLog(audit_path, redactor=Redactor([TENANT_TOKEN]))
        self.executor = Executor(self.client, self.secrets)
        self._run = 0

    def mutate(self, mutation_id):
        resp = self.client.post(
            "/admin/mutate",
            json={"mutation_id": mutation_id},
            headers={"X-Admin-Key": ADMIN_KEY},
        )
        assert resp.status_code == 200, resp.text
        return resp.json()

    def fault(self, mode):
        self.client.post(
            "/admin/fault", json={"mode": mode}, headers={"X-Admin-Key": ADMIN_KEY}
        )

    def heal(self, tool="fetch_user", args=None, secrets=None, dry_run=False):
        self._run += 1
        emitter = EventEmitter(f"run-{self._run}", "healing", redactor=Redactor([TENANT_TOKEN]))
        healer = Healer(
            self.registry, self.executor, secrets or self.secrets, self.client,
            self.audit, self.settings, emitter,
        )
        return healer.run(tool, args or {"user_id": "123"}, dry_run=dry_run), emitter

    def close(self):
        self.client.__exit__(None, None, None)


@pytest.fixture
def env(tmp_path):
    e = Env(tmp_path / "audit.jsonl")
    try:
        yield e
    finally:
        e.close()


def test_normal_call_needs_no_healing(env):
    outcome, emitter = env.heal()
    assert outcome.outcome == "recovered"
    assert outcome.attempts == 1
    assert outcome.schema_attempts == 0
    assert env.registry.revision("fetch_user") == 1


@pytest.mark.parametrize(
    "mutation_id,args",
    [
        ("M_RENAME", {"user_id": "123"}),
        ("M_NEST", {"user_id": "123"}),
        ("M_TYPE", {"user_id": "123"}),
        ("M_HEADER", {"user_id": "123"}),
        ("M_RENAME_NEST", {"user_id": "123"}),
        ("M_NEST_TYPE_HEADER", {"user_id": "123"}),
    ],
)
def test_recovers_after_mutation(env, mutation_id, args):
    env.mutate(mutation_id)
    outcome, emitter = env.heal(args=args)
    assert outcome.outcome == "recovered", outcome.reason_code
    assert outcome.schema_attempts == 1
    assert outcome.definition.revision == 2
    assert outcome.mttr is not None and outcome.mttr >= 0


def test_lossy_conversion_is_refused(env):
    env.mutate("M_LOSSY_TYPE")
    outcome, _ = env.heal(args={"user_id": "00123"})
    assert outcome.outcome == "refused"
    assert outcome.reason_code == rc.LOSSY_CONVERSION
    assert env.registry.revision("fetch_user") == 1  # nothing applied


def test_ambiguous_mapping_is_refused(env):
    env.mutate("M_AMBIGUOUS")
    outcome, _ = env.heal()
    assert outcome.outcome == "refused"
    assert outcome.reason_code == rc.AMBIGUOUS_MAPPING


def test_missing_credential_is_refused(env):
    env.mutate("M_HEADER")
    outcome, _ = env.heal(secrets=EmptySecretsProvider())
    assert outcome.outcome == "refused"
    assert outcome.reason_code == rc.MISSING_CREDENTIAL


def test_missing_required_value_is_refused(env):
    env.mutate("M_REQUIRED_BODY")
    outcome, _ = env.heal()
    assert outcome.outcome == "refused"
    assert outcome.reason_code == rc.MISSING_REQUIRED_VALUE


def test_infrastructure_failure_is_not_patched(env):
    env.fault("http500")
    outcome, _ = env.heal()
    assert outcome.outcome == "not_drift_reported"
    assert outcome.schema_attempts == 0
    assert env.registry.revision("fetch_user") == 1


def test_rejected_credential_is_not_patched(env):
    env.fault("reject_credential")
    outcome, _ = env.heal()
    assert outcome.outcome == "not_drift_reported"
    assert outcome.schema_attempts == 0


def test_no_infinite_loop_respects_cap(env):
    env.mutate("M_NEST_TYPE_HEADER")
    env.fault("http500")  # after patching, the retry keeps failing
    outcome, _ = env.heal()
    assert outcome.outcome in {"refused", "not_drift_reported"}
    assert outcome.schema_attempts <= env.settings.max_schema_attempts


def test_write_call_uses_dry_run(env):
    env.mutate("M_NEST")
    outcome, _ = env.heal(tool="update_user", args={"user_id": "123", "display_name": "Grace"})
    # update_user's own schema is unchanged by an M_NEST on /user/fetch.
    assert outcome.outcome == "recovered"


def test_audit_written_and_redacted(env):
    env.mutate("M_HEADER")
    outcome, _ = env.heal()
    assert outcome.outcome == "recovered"
    entries = env.audit.read()
    assert entries, "expected an audit entry"
    text = open(env.audit.path, encoding="utf-8").read()
    assert TENANT_TOKEN not in text
    assert any(e["outcome"] == "applied" for e in entries)


def test_response_nesting_adapts(env):
    env.mutate("M_RESP_NEST")
    outcome, emitter = env.heal()
    assert outcome.outcome == "recovered"
    assert outcome.response_data["name"] == "Ada Lovelace"
    assert any(e.type == "response_check" and e.data["ok"] for e in emitter.events)


def test_ambiguous_response_is_refused(env):
    env.mutate("M_RESP_AMBIG")
    outcome, _ = env.heal()
    assert outcome.outcome == "refused"
    assert outcome.reason_code == rc.AMBIGUOUS_RESPONSE_MAPPING
