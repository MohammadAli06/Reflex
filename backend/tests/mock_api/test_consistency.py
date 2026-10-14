"""Schema consistency suite (T1.5).

After every mutation: the old payload is rejected, the new payload is accepted,
the exposed schema matches the active schema, header requirements behave, and
no route serves a different schema. A negative test proves the suite would fail
if the exposed schema ever diverged from the active one.
"""
from __future__ import annotations

import copy

import pytest

FETCH = "/user/fetch"

# A payload that is valid for the new schema produced by each mutation.
NEW_PAYLOADS = {
    "M_RENAME": {"uid": "123"},
    "M_TYPE": {"user_id": 123},
    "M_NEST": {"target": {"id": "123"}},
    "M_HEADER": {"user_id": "123"},
    "M_REQUIRED_BODY": {"user_id": "123", "tenant_id": "t1"},
    "M_RENAME_NEST": {"target": {"uid": "123"}},
    "M_NEST_TYPE_HEADER": {"target": {"id": 123}},
    "M_AMBIGUOUS": {"account": {"id": "123"}, "profile": {"id": "123"}},
    "M_LOSSY_TYPE": {"user_id": 123},
}
NEEDS_HEADER = {"M_HEADER", "M_NEST_TYPE_HEADER"}
OLD_PAYLOAD = {"user_id": "123"}


def schema_agreement(client, admin_headers) -> dict[str, bool]:
    """Checks 3 and 5: exposed schema equals active schema, single source."""
    openapi = client.get("/openapi.json").json()
    active = client.get("/admin/state", headers=admin_headers).json()["state"]
    return {
        "version_matches": openapi["x-schema-version"] == active["version"],
        "schemas_match": openapi["x-active-schema"] == active,
        "info_version_matches": openapi["info"]["version"] == str(active["version"]),
    }


def test_admin_routes_require_key(client):
    assert client.post("/admin/reset").status_code == 401
    assert client.get("/admin/state").status_code == 401


def test_initial_schema_valid_and_invalid(client):
    ok = client.post(FETCH, json={"user_id": "123"})
    assert ok.status_code == 200
    assert ok.json()["data"]["name"]

    bad = client.post(FETCH, json={"user_id": 5})
    assert bad.status_code == 422

    missing = client.post(FETCH, json={})
    assert missing.status_code == 422


@pytest.mark.parametrize("mutation_id", sorted(NEW_PAYLOADS))
def test_mutation_consistency(client, admin_headers, tenant_headers, mutation_id):
    before = client.get("/admin/state", headers=admin_headers).json()["state"]["version"]
    resp = client.post("/admin/mutate", json={"mutation_id": mutation_id}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    version = resp.json()["version"]
    assert version > before

    # 1. The old call (old payload, no new header) is rejected after the change.
    old = client.post(FETCH, json=OLD_PAYLOAD)
    assert old.status_code != 200, f"old payload still accepted: {old.text}"

    # 2 + 4. The new payload is accepted; headers enforced when required.
    new_body = NEW_PAYLOADS[mutation_id]
    if mutation_id in NEEDS_HEADER:
        without = client.post(FETCH, json=new_body)
        assert without.status_code == 401
        with_header = client.post(FETCH, json=new_body, headers=tenant_headers)
        assert with_header.status_code == 200, with_header.text
    else:
        with_body = client.post(FETCH, json=new_body, headers=tenant_headers)
        assert with_body.status_code == 200, with_body.text

    # 3 + 5. Exposed schema matches the active schema exactly.
    agreement = schema_agreement(client, admin_headers)
    assert all(agreement.values()), agreement


def test_fault_does_not_change_schema(client, admin_headers):
    before = client.get("/admin/state", headers=admin_headers).json()
    client.post("/admin/fault", json={"mode": "http500"}, headers=admin_headers)
    after = client.get("/admin/state", headers=admin_headers).json()
    assert before["version"] == after["version"]
    assert before["state"]["request_schemas"] == after["state"]["request_schemas"]
    faulted = client.post(FETCH, json={"user_id": "123"})
    assert faulted.status_code == 500
    client.post("/admin/fault", json={"mode": None}, headers=admin_headers)


def test_reset_bumps_version_and_restores_schema(client, admin_headers):
    client.post("/admin/mutate", json={"mutation_id": "M_NEST"}, headers=admin_headers)
    v = client.get("/admin/state", headers=admin_headers).json()["version"]
    reset = client.post("/admin/reset", headers=admin_headers).json()
    assert reset["version"] > v
    assert reset["state"]["request_schemas"][FETCH]["properties"] == {"user_id": {"type": "string", "description": "Identifier of the user to fetch"}}


def test_negative_agreement_detects_divergence(client, admin_headers, monkeypatch):
    """If the exposed schema diverges from the active one, the check must fail."""
    assert all(schema_agreement(client, admin_headers).values())

    # Simulate a bug where /openapi.json serves a stale version.
    import app.mock_api.main as mock_main
    from app.mock_api.openapi_gen import build_openapi as real_build

    def stale_build(state):
        doc = real_build(state)
        doc["x-schema-version"] = state.version - 1
        doc["x-active-schema"]["version"] = state.version - 1
        return doc

    monkeypatch.setattr(mock_main, "build_openapi", stale_build)
    agreement = schema_agreement(client, admin_headers)
    assert not agreement["schemas_match"], "suite failed to detect divergence"
    assert not agreement["version_matches"]
