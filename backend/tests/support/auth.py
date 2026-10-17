"""Shared test helpers for authenticated fixtures.

Operator routes are session-gated since the security phase; every fixture
that exercises them logs in with the seeded credentials for its settings.
"""
from __future__ import annotations

from fastapi.testclient import TestClient


def login_operator(client: TestClient, username: str = "operator",
                   password: str = "reflex2026") -> None:
    """POST /api/login once; the TestClient keeps the session cookie."""
    resp = client.post("/api/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
