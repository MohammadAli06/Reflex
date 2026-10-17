"""Dry-run endpoint tests: offline pipeline only, never any outbound call."""
from __future__ import annotations

import copy
import json
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.control_api.main import create_app
from app.dryrun import engine
from app.dryrun.engine import DryRunError
from app.healing import reason_codes as rc
from app.mock_api.main import create_app as create_mock_app

from ..support.auth import login_operator

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "tenant-secret-value"


def spec(body_schema: dict[str, Any], *, with_header: bool = False, version: str = "1.0") -> dict[str, Any]:
    operation: dict[str, Any] = {
        "requestBody": {"content": {"application/json": {"schema": copy.deepcopy(body_schema)}}}
    }
    if with_header:
        operation["parameters"] = [{
            "name": "X-Tenant-Token", "in": "header", "required": True,
            "schema": {"type": "string"},
        }]
    return {
        "openapi": "3.1.0",
        "info": {"title": "Demo", "version": version},
        "paths": {"/user/fetch": {"post": operation}},
    }


RENAME_OLD = {
    "/user/fetch": {"type": "object", "properties": {"user_id": {"type": "string"}}, "required": ["user_id"]}
}
RENAME_NEW = {
    "/user/fetch": {
        "type": "object",
        "properties": {"account": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
        "required": ["account"],
    }
}

AMBIGUOUS_NEW = {
    "/user/fetch": {
        "type": "object",
        "properties": {
            "account": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
            "profile": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]},
        },
        "required": ["account", "profile"],
    }
}

MISSING_NEW = {
    "/user/fetch": {
        "type": "object",
        "properties": {
            "user_id": {"type": "string"},
            "profile": {"type": "object", "properties": {"ref": {"type": "string"}}, "required": ["ref"]},
        },
        "required": ["user_id", "profile"],
    }
}

TYPE_NEW = {
    "/user/fetch": {"type": "object", "properties": {"user_id": {"type": "integer"}}, "required": ["user_id"]}
}


def analyze_payload(
    old: dict[str, Any], new: dict[str, Any],
    *,
    body: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
    status: Any = 422,
    operation: str = "POST /user/fetch",
) -> dict[str, Any]:
    return {
        "old_spec": json.dumps(old),
        "new_spec": json.dumps(new),
        "operation": operation,
        "original_request": {
            "method": "POST",
            "path": "/user/fetch",
            "headers": headers or {},
            "body": body if body is not None else {"user_id": "123"},
        },
        "error": {"status": status, "body": {"error": "validation_failed"}},
    }
def simple_body(ops: dict[str, Any]) -> dict[str, Any]:
    return spec(ops["/user/fetch"])

@pytest.fixture(scope="module")
def control(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp("dryrun_routes")
    settings = load_settings(env={
        "ADMIN_KEY": ADMIN_KEY,
        "MOCK_TENANT_TOKEN": TENANT_TOKEN,
        "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
        "AUDIT_LOG_PATH": str(tmp_path / "audit.jsonl"),
        "RESULTS_DIR": str(tmp_path / "results"),
        "DATABASE_URL": f"sqlite:///{(tmp_path / 'dryrun.db').as_posix()}",
    })
    mock_client = TestClient(create_mock_app(settings))
    mock_client.__enter__()
    client = TestClient(create_app(settings, mock_client=mock_client))
    client.__enter__()
    login_operator(client)  # operator routes are session-gated
    try:
        yield client
    finally:
        client.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


def post_analyze(control: TestClient, payload: dict[str, Any]):
    return control.post("/api/dryrun/analyze", json=payload)


# --- engine-level cases -------------------------------------------------------

def test_rename_nest_type_and_header_each_propose():
    rename = engine.analyze(
        old_spec_text=json.dumps(simple_body(RENAME_OLD)), new_spec_text=json.dumps(simple_body(RENAME_NEW)),
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"user_id": "123"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
    )
    assert rename["outcome"] == "proposed"
    assert rename["source"] == "rule"
    assert rename["corrected_request"]["body"] == {"account": {"id": "123"}}
    assert rename["validation"]["ok"] is True

    type_change = engine.analyze(
        old_spec_text=json.dumps(simple_body(RENAME_OLD)), new_spec_text=json.dumps(simple_body(TYPE_NEW)),
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"user_id": "123"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
    )
    assert type_change["outcome"] == "proposed"
    assert type_change["candidate"]["conversions"] == {"user_id": "str_to_int"}

    header_added = engine.analyze(
        old_spec_text=json.dumps(spec(RENAME_OLD["/user/fetch"], version="1")),
        new_spec_text=json.dumps(spec(RENAME_OLD["/user/fetch"], with_header=True, version="2")),
        operation="POST /user/fetch",
        original_request={"headers": {"X-Tenant-Token": "supplied-value"}, "body": {"user_id": "123"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
    )
    assert header_added["outcome"] == "proposed"
    assert header_added["corrected_request"]["path"] == "/user/fetch"


def test_ambiguous_and_lossy_refuse_with_reason_code():
    ambiguous = engine.analyze(
        old_spec_text=json.dumps(simple_body(RENAME_OLD)), new_spec_text=json.dumps(simple_body(AMBIGUOUS_NEW)),
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"user_id": "123"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
    )
    assert ambiguous["outcome"] == "refused"
    assert ambiguous["reason_code"] == rc.AMBIGUOUS_MAPPING
    assert ambiguous["candidate"] is None

    lossy = engine.analyze(
        old_spec_text=json.dumps(simple_body(RENAME_OLD)), new_spec_text=json.dumps(simple_body(TYPE_NEW)),
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"user_id": "00123"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
    )
    assert lossy["outcome"] == "refused"
    assert lossy["reason_code"] == rc.LOSSY_CONVERSION

    missing = engine.analyze(
        old_spec_text=json.dumps(simple_body(RENAME_OLD)), new_spec_text=json.dumps(simple_body(MISSING_NEW)),
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"user_id": "123"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
    )
    assert missing["outcome"] == "refused"
    assert missing["reason_code"] == rc.MISSING_REQUIRED_VALUE
    assert "profile" in json.dumps(missing["missing_values"]) or missing["missing_values"]


def test_no_drift_cases_return_detection_without_diff():
    same = json.dumps(simple_body(RENAME_OLD))
    no_change = engine.analyze(
        old_spec_text=same, new_spec_text=same,
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"user_id": "123"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
    )
    assert no_change["outcome"] == "no_drift"
    assert no_change["diff"] is None

    outage = engine.analyze(
        old_spec_text=same, new_spec_text=json.dumps(simple_body(RENAME_NEW)),
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"user_id": "123"}},
        error={"status": 500, "body": {"error": "server error"}},
    )
    assert outage["outcome"] == "no_drift"
    assert outage["drift_classification"] != "possible_drift"


def test_input_validation_errors_are_clean():
    for old, new, expected_code in [
        ("{ broken", json.dumps(simple_body(RENAME_OLD)), "invalid_spec"),
        (json.dumps(simple_body(RENAME_OLD)), json.dumps({"openapi": "3.1.0", "paths": {}}), "unknown_operation"),
    ]:
        with pytest.raises(DryRunError) as exc_info:
            engine.analyze(
                old_spec_text=old, new_spec_text=new,
                operation="POST /user/fetch",
                original_request={"headers": {}, "body": {"user_id": "123"}},
                error={"status": 422, "body": {}},
            )
        assert exc_info.value.code == expected_code

    with pytest.raises(DryRunError) as oversize:
        engine.analyze(
            old_spec_text=json.dumps(simple_body(RENAME_OLD)) + " " * 520 * 1024,
            new_spec_text=json.dumps(simple_body(RENAME_NEW)),
            operation="POST /user/fetch",
            original_request={"headers": {}, "body": {"user_id": "123"}},
            error={"status": 422, "body": {}},
        )
    assert oversize.value.code == "payload_too_large"


def test_external_ref_refused_without_fetching():
    new = simple_body(RENAME_NEW)
    new["paths"]["/user/fetch"]["post"]["requestBody"]["content"]["application/json"]["schema"]["properties"]["extra"] = \
        {"$ref": "https://exfil.example/s.json"}
    with pytest.raises(DryRunError) as exc_info:
        engine.analyze(
            old_spec_text=json.dumps(simple_body(RENAME_OLD)), new_spec_text=json.dumps(new),
            operation="POST /user/fetch",
            original_request={"headers": {}, "body": {"user_id": "123"}},
            error={"status": 422, "body": {}},
        )
    assert exc_info.value.code == "unsupported_external_ref"


def test_llm_gate_routes_through_the_shared_fallback_path():
    settings = load_settings(env={"GOOGLE_API_KEY": "", "LLM_REPAIR_ENABLED": "true"})
    from app.healing.llm_fallback import GeminiRepairProposer

    proposer = GeminiRepairProposer(settings)
    result = engine.analyze(
        old_spec_text=json.dumps(simple_body(RENAME_OLD)),
        new_spec_text=json.dumps(simple_body(AMBIGUOUS_NEW)),
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"user_id": "123"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
        proposer=proposer,
    )
    assert result["outcome"] == "refused"
    assert result["source"] == "llm"
    assert result["reason_code"] == rc.LLM_UNAVAILABLE

    flag_off = engine.analyze(
        old_spec_text=json.dumps(simple_body(RENAME_OLD)),
        new_spec_text=json.dumps(simple_body(AMBIGUOUS_NEW)),
        operation="POST /user/fetch",
        original_request={"headers": {}, "body": {"user_id": "123"}},
        error={"status": 422, "body": {"error": "validation_failed"}},
        proposer=None,
    )
    assert flag_off["source"] == "rule"
    assert flag_off["reason_code"] == rc.AMBIGUOUS_MAPPING


# --- route-level cases --------------------------------------------------------

def _block_all_http(monkeypatch) -> None:
    """Block ONLY real network transports; the in-process TestClient uses ASGI."""

    def forbidden(*args: Any, **kwargs: Any) -> None:  # noqa: ANN002
        raise AssertionError("the dry-run must never make an outbound HTTP call")

    monkeypatch.setattr("httpx._transports.default.HTTPTransport.handle_request", forbidden)


def test_route_proposes_rename(monkeypatch, control):
    _block_all_http(monkeypatch)
    resp = post_analyze(control, analyze_payload(simple_body(RENAME_OLD), simple_body(RENAME_NEW)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["kind"] == "dryrun"
    assert body["outcome"] == "proposed"
    assert body["source"] == "rule"
    assert body["corrected_request"]["body"] == {"account": {"id": "123"}}


def test_route_maps_errors_to_clean_status_codes(monkeypatch, control):
    _block_all_http(monkeypatch)
    bad = post_analyze(control, analyze_payload("{ broken", simple_body(RENAME_NEW)))
    assert bad.status_code == 400
    assert bad.json()["detail"]["code"] == "invalid_spec"

    unknown = post_analyze(control, analyze_payload(simple_body(RENAME_OLD), simple_body(RENAME_NEW), operation="DELETE /nope"))
    assert unknown.status_code == 422
    assert unknown.json()["detail"]["code"] == "unknown_operation"

    oversize = post_analyze(control, analyze_payload(
        json.dumps(simple_body(RENAME_OLD)) + " " * 520 * 1024, simple_body(RENAME_NEW)))
    assert oversize.status_code == 413

    external = simple_body(RENAME_NEW)
    external["paths"]["/user/fetch"]["post"]["requestBody"]["content"]["application/json"]["schema"]["properties"]["extra"] = \
        {"$ref": "https://exfil.example/s.json"}
    refused = post_analyze(control, analyze_payload(simple_body(RENAME_OLD), external))
    assert refused.status_code == 400
    assert refused.json()["detail"]["code"] == "unsupported_external_ref"


def test_route_never_schema_outbound(monkeypatch, control):
    _block_all_http(monkeypatch)
    resp = post_analyze(control, analyze_payload(simple_body(RENAME_OLD), simple_body(AMBIGUOUS_NEW)))
    assert resp.status_code == 200
    assert resp.json()["reason_code"] == "ambiguous_mapping"


def test_planted_secret_never_appears_in_the_response(monkeypatch, control):
    _block_all_http(monkeypatch)
    planted = "tenant-secret-value-99"
    payload = analyze_payload(
        simple_body(RENAME_OLD),
        simple_body(RENAME_OLD),  # identical specs: no drift, nothing to echo
        headers={"X-Tenant-Token": planted},
        body={"user_id": "123"},
        status=422,
    )
    resp = post_analyze(control, payload)
    assert resp.status_code == 200, resp.text
    assert planted not in resp.text

    # Same case but with a real proposal: the planted secret is a HEADER value,
    # which must never be echoed (corrected headers carry names/provenance only).
    # Payload values ARE derivable from the original request and belong there.
    proposed = analyze_payload(simple_body(RENAME_OLD), simple_body(RENAME_NEW),
                               headers={"X-Tenant-Token": planted})
    resp = post_analyze(control, proposed)
    assert resp.status_code == 200, resp.text
    assert planted not in resp.text
    assert resp.json()["corrected_request"]["body"] == {"account": {"id": "123"}}


def test_dry_run_leaves_metrics_and_runs_untouched(monkeypatch, control):
    _block_all_http(monkeypatch)
    before_metrics = control.get("/api/metrics").json()
    before_runs = control.get("/api/runs").json()
    resp = post_analyze(control, analyze_payload(simple_body(RENAME_OLD), simple_body(RENAME_NEW)))
    assert resp.status_code == 200
    assert control.get("/api/metrics").json() == before_metrics
    assert control.get("/api/runs").json() == before_runs
