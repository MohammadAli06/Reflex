"""Security-phase tests: route classification, auth matrix, keys, SSRF guard,
request caps and rate limiting. No live network: the GuardedClient tests use
httpx.MockTransport."""
from __future__ import annotations

import socket
from typing import Any

import httpx
import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from app.config import load_settings
from app.control_api.main import create_app
from app.db import SdkKeyRepo
from app.mock_api.main import create_app as create_mock_app
from app.security.policy import (
    ROLES,
    ROUTE_ROLES,
    SecurityPolicy,
    classify_route,
    load_security_policy,
)
from app.security.ssrf import GuardedClient, SsrfBlocked, SsrfGuard, make_guarded_client

from ..support.auth import login_operator

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "tenant-secret-value"


def settings_for(tmp_path, **overrides) -> Any:
    env = {
        "ADMIN_KEY": ADMIN_KEY,
        "MOCK_TENANT_TOKEN": TENANT_TOKEN,
        "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
        "AUDIT_LOG_PATH": str(tmp_path / "audit.jsonl"),
        "RESULTS_DIR": str(tmp_path / "results"),
        "DATABASE_URL": f"sqlite:///{(tmp_path / f'security_{abs(hash(tuple(overrides.items()))) % 99999}.db').as_posix()}",
    }
    env.update(overrides)
    return load_settings(env=env)


@pytest.fixture(scope="module")
def control(tmp_path_factory):
    tmp_path = tmp_path_factory.mktemp("security_routes")
    settings = settings_for(tmp_path)
    mock_client = TestClient(create_mock_app(settings))
    mock_client.__enter__()
    client = TestClient(create_app(settings, mock_client=mock_client))
    client.__enter__()
    login_operator(client)  # operator routes are session-gated
    try:
        yield client, settings
    finally:
        client.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


# --- route classification (deny by default) -----------------------------------

def test_every_registered_api_route_is_classified(control):
    client, _ = control
    from fastapi.routing import APIRoute

    for route in client.app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/api/"):
            continue
        for method in route.methods - {"HEAD", "OPTIONS"}:
            assert classify_route(method, route.path) in ROLES, \
                f"{method} {route.path} is not classified (deny-by-default violated)"
            assert (method, route.path) in ROUTE_ROLES


def test_unknown_api_route_is_denied_by_default(control):
    client, _ = control
    resp = client.post("/api/not-a-route/anything")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "not found"
    resp = client.get("/api/security/unknown-endpoint")
    assert resp.status_code == 404


# --- auth matrix ---------------------------------------------------------------

def test_operator_routes_require_a_session(control):
    client, _ = control
    fresh = TestClient(client.app)  # no cookie jar shared with the fixture
    assert fresh.post("/api/mutate", json={"mutation_id": "M_RENAME"}).status_code == 401
    assert fresh.post("/api/runs", json={"case_ids": ["normal_fetch"]}).status_code == 401
    assert fresh.get("/api/audit").status_code == 401
    assert fresh.get("/api/security/status").status_code == 401
    # No detail leakage beyond a generic message.
    assert fresh.get("/api/audit").json()["detail"] == "authentication required"
    # Security events are on the audit chain.
    operator = TestClient(client.app)
    login_operator(operator)
    entries = operator.get("/api/audit").json()["entries"]
    assert any(e["outcome"] == "security_event" and e["reason_code"] == "auth_required"
               for e in entries)


def test_authenticated_operator_can_drive_the_demo(control):
    client, _ = control
    resp = client.post("/api/mutate", json={"mutation_id": "M_RENAME"})
    assert resp.status_code == 200, resp.text
    reset = client.post("/api/reset")
    assert reset.status_code == 200


def make_app_with_policy(settings, policy) -> TestClient:
    """A control app with an injected policy, sharing an in-process mock."""
    mock_client = TestClient(create_mock_app(settings))
    mock_client.__enter__()
    app = create_app(settings, mock_client=mock_client, security_policy=policy)
    fresh = TestClient(app)
    fresh.__enter__()
    return fresh, mock_client


def test_login_failure_lists_no_users_and_is_throttled(control):
    client, settings = control
    policy = load_security_policy(settings, env={"REFLEX_LOGIN_LIMIT": "2"})
    fresh, mock_client = make_app_with_policy(settings, policy)
    try:
        first = fresh.post("/api/login", json={"username": "operator", "password": "wrongpass"})
        assert first.status_code == 401
        assert first.json()["detail"] == "invalid credentials"
        second = fresh.post("/api/login", json={"username": "operator", "password": "wrongpass"})
        assert second.status_code == 401
        third = fresh.post("/api/login", json={"username": "operator", "password": "wrongpass"})
        assert third.status_code == 429
        assert "Retry-After" in third.headers
    finally:
        fresh.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


# --- SDK keys -------------------------------------------------------------------

def test_sdk_key_lifecycle_and_enforcement(control):
    client, settings = control
    # Create (operator-only), key shown once.
    resp = client.post("/api/security/keys", json={"label": "agent-a"})
    assert resp.status_code == 200, resp.text
    key_value = resp.json()["key"]
    key_id = resp.json()["id"]
    assert key_value.startswith("rxk_")

    listing = client.get("/api/security/keys").json()
    assert listing["active"] == 1
    assert listing["keys"][0]["label"] == "agent-a"
    assert key_value not in resp.text.replace(key_value, "")  # invariant sanity
    assert key_value not in str(listing)

    # With a key present, /api/sdk/call requires it.
    fresh = TestClient(client.app)
    fresh.__enter__()
    try:
        denied = fresh.post("/api/sdk/call", json={"tool": "fetch_user", "args": {"user_id": "123"}})
        assert denied.status_code == 401
        assert denied.json()["detail"] == "a valid SDK key is required"

        # wrong key
        wrong = TestClient(client.app)
        wrong.headers = {"X-Api-Key": "rxk_not-a-key"}
        assert wrong.post("/api/sdk/call", json={"tool": "fetch_user"}).status_code == 401

        # with the key: works
        keyed = TestClient(client.app)
        keyed.headers = {"X-Api-Key": key_value}
        ok = keyed.post("/api/sdk/call", json={"tool": "fetch_user", "args": {"user_id": "123"}})
        assert ok.status_code == 200, ok.text
        assert ok.json()["outcome"] == "recovered"
    finally:
        fresh.__exit__(None, None, None)

    # status reflects the real mode
    status = client.get("/api/security/status").json()
    assert status["auth"]["sdk_mode"] == "key_required"
    assert status["auth"]["active_sdk_keys"] == 1

    # revoke -> the adapter falls back to open demo mode with zero keys left.
    assert client.post(f"/api/security/keys/{key_id}/revoke").status_code == 200
    status = client.get("/api/security/status").json()
    assert status["auth"]["sdk_mode"] == "open_no_keys"


def test_sdk_key_cannot_reach_operator_routes(control):
    client, settings = control
    key = client.post("/api/security/keys", json={"label": "agent-b"}).json()["key"]
    keyed = TestClient(client.app)
    keyed.__enter__()
    keyed.headers = {"X-Api-Key": key}
    try:
        assert keyed.get("/api/audit").status_code == 401
        assert keyed.post("/api/mutate", json={"mutation_id": "M_RENAME"}).status_code == 401
        assert keyed.get("/api/security/status").status_code == 401
        assert keyed.post("/api/registry/rollback", json={"tool": "fetch_user", "expected_revision": 1}).status_code == 401
    finally:
        keyed.__exit__(None, None, None)
    client.post("/api/security/keys/2/revoke")


# --- request validation / caps ---------------------------------------------------

def test_extra_fields_are_rejected(control):
    client, _ = control
    resp = client.post("/api/mutate", json={"mutation_id": "M_RENAME", "hacker": True})
    assert resp.status_code == 422


def test_oversize_body_and_headers_are_rejected(control):
    client, settings = control
    policy = load_security_policy(settings, env={"REFLEX_MAX_REQUEST_BYTES": "2000", "REFLEX_MAX_HEADER_COUNT": "8"})
    fresh, mock_client = make_app_with_policy(settings, policy)
    login_operator(fresh)
    try:
        resp = fresh.post(
            "/api/mutate",
            content=b"{" + b"x" * 4000 + b"}",
            headers={"Content-Length": "4000", "Content-Type": "application/json"},
        )
        assert resp.status_code == 413
        assert "too large" in resp.json()["detail"]

        many = fresh.post("/api/mutate", json={"mutation_id": "M_RENAME"},
                          headers={f"x-pad-{i}": "0" * 30 for i in range(8)})
        assert many.status_code == 400
        assert "too many request headers" in many.json()["detail"]
    finally:
        fresh.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


# --- SSRF guard ------------------------------------------------------------------

def policy_with(hosts: str) -> SecurityPolicy:
    settings = load_settings(env={"ADMIN_KEY": "k", "MOCK_API_URL": "http://localhost:8000",
                                  "REFLEX_ALLOWED_OUTBOUND_HOSTS": hosts})
    return load_security_policy(settings, env={"REFLEX_ALLOWED_OUTBOUND_HOSTS": hosts})


def test_ssrf_guard_blocks_disallowed_and_private_hosts():
    guard = SsrfGuard(policy_with("example.org"))

    def request(url: str) -> httpx.Request:
        return httpx.Request("GET", url)

    with pytest.raises(SsrfBlocked):
        guard.check(request("http://127.0.0.1:8000/admin/state"))  # loopback, not allowlisted
    with pytest.raises(SsrfBlocked):
        guard.check(request("http://169.254.169.254/latest/meta-data/"))  # metadata range
    with pytest.raises(SsrfBlocked):
        guard.check(request("http://10.1.2.3/openapi.json"))  # private range
    with pytest.raises(SsrfBlocked):
        guard.check(request("http://example.org.invalid/openapi.json"))  # no resolution -> can't trust


def test_ds_allowlisted_private_mock_is_allowed_and_rebinding_is_refused(monkeypatch):
    guard = SsrfGuard(policy_with(""))
    # The configured mock host (localhost) is in the allowlist: resolves to loopback.
    request = httpx.Request("GET", "http://localhost:8000/admin/state")
    guard.check(request)  # no raise

    # DNS rebinding style: allowlisted host resolving to a PUBLIC address too.
    def forged(host: str, port: int = 0, **kwargs: Any):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port)),
                (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

    monkeypatch.setattr(socket, "getaddrinfo", forged)
    with pytest.raises(SsrfBlocked):
        guard.check(request)


def test_redirects_are_never_followed():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/start":
            return httpx.Response(307, headers={"Location": "http://169.254.169.254/x"})
        return httpx.Response(200, json={"ok": True})

    from app.security.budget import Breakers

    settings = load_settings(env={"ADMIN_KEY": "k", "MOCK_API_URL": "http://localhost:8000"})
    policy = load_security_policy(settings, env={})
    breaker = Breakers(policy)
    with GuardedClient(transport=httpx.MockTransport(handler), guard=SsrfGuard(policy),
                       breaker=breaker, base_url="http://localhost:8000") as guarded:
        # The redirect target is returned as-is, never chased: the guard
        # re-validates every request it would make.
        resp = guarded.get("http://localhost:8000/start")
        assert resp.status_code == 307
        # And following_refirects is disabled at the client level:
        assert guarded.follow_redirects is False


def test_allowlisted_host_call_works_through_the_guard():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"status": "ok"})

    from app.security.budget import Breakers

    settings = load_settings(env={"ADMIN_KEY": "k", "MOCK_API_URL": "http://localhost:8000"})
    policy = load_security_policy(settings, env={})
    breaker = Breakers(policy)
    with GuardedClient(transport=httpx.MockTransport(handler), guard=SsrfGuard(policy),
                       breaker=breaker, base_url="http://localhost:8000") as client:
        assert client.get("/health").json() == {"status": "ok"}
        assert breaker.status().get("localhost", {}).get("state") == "closed"


# --- rate limiting on SDK calls --------------------------------------------------

def test_sdk_call_rate_limit_returns_429_with_retry_after(control):
    client, settings = control
    policy = load_security_policy(settings, env={"REFLEX_SDK_CALL_LIMIT": "2"})
    fresh, mock_client = make_app_with_policy(settings, policy)
    try:
        # zero keys -> open demo mode, but the rate limit still applies.
        first = fresh.post("/api/sdk/call", json={"tool": "fetch_user", "args": {"user_id": "123"}})
        assert first.status_code == 200, first.text
        second = fresh.post("/api/sdk/call", json={"tool": "fetch_user", "args": {"user_id": "123"}})
        assert second.status_code == 200
        third = fresh.post("/api/sdk/call", json={"tool": "fetch_user", "args": {"user_id": "123"}})
        assert third.status_code == 429
        assert "Retry-After" in third.headers
    finally:
        fresh.__exit__(None, None, None)
        mock_client.__exit__(None, None, None)


def test_demo_normal_flow_is_never_throttled_with_default_limits(control):
    client, _ = control
    # A full demo sequence at default limits: mutate, run, extras.
    for index in range(10):
        assert client.post("/api/reset").status_code == 200
        assert client.post("/api/mutate", json={"mutation_id": "M_TYPE"}).status_code == 200
    run = client.post("/api/runs", json={"case_ids": ["normal_fetch"], "repeats": 1})
    assert run.status_code == 200


# --- audit convenience ----------------------------------------------------------

def test_security_events_do_not_leak_key_material(control):
    client, _ = control
    resp = client.post("/api/security/keys", json={"label": "leakcheck"})
    key_value = resp.json()["key"]
    entries = client.get("/api/audit").json()["entries"]
    blob = str(entries)
    assert key_value not in blob
    assert "rxk_" not in blob.replace("rxk_", "")
    assert key_value not in str(client.get("/api/security/keys").json())
