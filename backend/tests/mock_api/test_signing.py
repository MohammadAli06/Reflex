"""Schema provenance: a document that does not match its signature is refused.

Every test here is a negative test by design - the point of the feature is what
it refuses to do.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.healing.events import EventEmitter
from app.healing.healer import Healer
from app.healing.schema_fetch import UntrustedSchemaError, fetch_verified
from app.mock_api.main import create_app
from app.mock_api.signing import SchemaSigner, verify_signature
from app.registry.executor import Executor
from app.registry.tool_registry import ToolRegistry
from app.registry.tools import initial_definitions
from app.audit.audit_log import AuditLog
from app.healing.secrets import StaticSecretsProvider

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "tenant-secret-value"


@pytest.fixture
def mock(tmp_path):
    settings = load_settings(env={
        "ADMIN_KEY": ADMIN_KEY,
        "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
    })
    client = TestClient(create_app(settings))
    client.__enter__()
    try:
        yield client, settings, tmp_path
    finally:
        client.__exit__(None, None, None)


def _public_key(client) -> str:
    return client.get("/admin/catalog", headers={"X-Admin-Key": ADMIN_KEY}).json()["schema_public_key"]


def test_honest_document_verifies(mock):
    client, _, _ = mock
    verified = fetch_verified(client, pinned_public_key=_public_key(client),
                              require_signature=True)
    assert verified.signature_verified is True
    assert verified.key_fingerprint


def test_tampered_document_fails_and_fetches_refuse(mock):
    client, _, _ = mock
    key = _public_key(client)
    client.post("/admin/tamper", headers={"X-Admin-Key": ADMIN_KEY})

    with pytest.raises(UntrustedSchemaError):
        fetch_verified(client, pinned_public_key=key, require_signature=True)


def test_wrong_pinned_key_is_refused(mock):
    client, _, _ = mock
    other = SchemaSigner().public_key_hex  # a valid key, but not the signer's
    with pytest.raises(UntrustedSchemaError):
        fetch_verified(client, pinned_public_key=other, require_signature=True)


def test_missing_signature_is_refused(mock):
    client, _, _ = mock
    document = client.get("/openapi.json").json()
    status = verify_signature(_public_key(client), document, "")
    assert status.ok is False
    assert "missing signature" in (status.error or "")


def test_require_signature_without_a_pin_refuses_rather_than_trusting(mock):
    client, _, _ = mock
    with pytest.raises(UntrustedSchemaError):
        fetch_verified(client, pinned_public_key="", require_signature=True)


def test_signing_disabled_skips_verification(mock):
    client, _, _ = mock
    verified = fetch_verified(client, pinned_public_key="", require_signature=False)
    assert verified.signature_verified is False


def test_healer_refuses_untrusted_schema_and_never_patches(mock):
    """The whole point: a forged contract must not change the registry."""
    client, settings, tmp_path = mock
    key = _public_key(client)
    audit = AuditLog(tmp_path / "audit.jsonl")
    registry = ToolRegistry(initial_definitions())
    secrets = StaticSecretsProvider({"X-Tenant-Token": TENANT_TOKEN})
    executor = Executor(client, secrets)
    emitter = EventEmitter("run-tamper", "healing")

    # Drift the schema, then serve a forged document.
    client.post("/admin/mutate", json={"mutation_id": "M_NEST_TYPE_HEADER"},
                headers={"X-Admin-Key": ADMIN_KEY})
    client.post("/admin/tamper", headers={"X-Admin-Key": ADMIN_KEY})

    signed_settings = load_settings(env={
        "ADMIN_KEY": ADMIN_KEY,
        "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
        "SCHEMA_SIGNING_ENABLED": "true",
        "SCHEMA_PUBLIC_KEY": key,
    })
    healer = Healer(registry, executor, secrets, client, audit, signed_settings, emitter)
    before = registry.revision("fetch_user")
    outcome = healer.run("fetch_user", {"user_id": "123"})

    assert outcome.outcome == "refused"
    assert outcome.reason_code == "untrusted_schema"
    assert registry.revision("fetch_user") == before
    assert any(e.type == "refused" and e.data.get("reason_code") == "untrusted_schema"
               for e in emitter.events)
    entries = audit.read()
    assert entries[-1]["outcome"] == "refused"
    assert entries[-1]["reason_code"] == "untrusted_schema"
