"""CLI demo tests: every drive-induced state through httpx.MockTransport only.

No live servers. The fake "control" and "mock" handlers exercise the same
routes the CLI prints from.
"""
from __future__ import annotations

import json

import httpx
import pytest

from reflex_sdk.demo import build_arg_parser, run_demo

ADMIN_KEY = "test-admin-key"


def tool_definition() -> dict:
    return {
        "name": "fetch_user",
        "endpoint": "/user/fetch",
        "method": "POST",
        "request_schema": {"type": "object", "properties": {"user_id": {"type": "string"}}, "required": ["user_id"]},
        "required_headers": [],
        "response_schema": {},
        "bindings": {"user_id": {"source": "arg", "arg": "user_id", "convert": None}},
        "response_map": {},
        "write": False,
        "revision": 1,
    }


def sdk_response(payload: dict) -> dict:
    base = {
        "run_id": "run-abc", "outcome": "recovered", "healed": True, "data": {"name": "Ada"},
        "reason_code": None, "error": None, "attempts": 2, "schema_attempts": 1, "healing_path": "rule",
    }
    return {**base, **payload}


class Handlers:
    def __init__(self) -> None:
        self.control_calls: list[tuple[str, str]] = []
        self.mock_calls: list[tuple[str, str, dict]] = []
        self.state: dict = {
            "sdk_payload": sdk_response({}),
            "mutate_success": True,
            "admin_key": ADMIN_KEY,
            "registry_revision": 1,
        }

    def control(self, request: httpx.Request) -> httpx.Response:
        self.control_calls.append((request.method, str(request.url)))
        path = request.url.path
        if path == "/api/health":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/api/mutations":
            return httpx.Response(200, json={"mutations": [{"id": "M_RENAME", "label": "Rename field"}]})
        if path == "/api/sdk/tools":
            return httpx.Response(200, json={"tools": [tool_definition()]})
        if path == "/api/sdk/call":
            # A healed run advances the registry revision, like the real engine.
            payload = self.state["sdk_payload"]
            if payload["healed"]:
                self.state["registry_revision"] = 2
            return httpx.Response(200, json=payload)
        if path.startswith("/api/runs/"):
            return httpx.Response(200, json={
                "run_id": "run-abc", "status": "finished", "records": [
                    {"agent": "healing", "t_break": 0.01, "t_recovery": 0.51},
                ],
            })
        if path == "/api/registry":
            rev = self.state["registry_revision"]
            return httpx.Response(200, json={"tools": {"fetch_user": [
                {"revision": i} for i in range(1, rev + 1)
            ]}})
        return httpx.Response(404, json={"detail": "not found"})

    def mock(self, request: httpx.Request) -> httpx.Response:
        body = {}
        try:
            body = json.loads(request.content.decode("utf-8") or "{}")
        except Exception:
            body = {}
        self.mock_calls.append((request.method, str(request.url), body))
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/admin/mutate":
            if request.headers.get("x-admin-key") != self.state["admin_key"]:
                return httpx.Response(401, json={"detail": "invalid admin key"})
            if not self.state["mutate_success"]:
                return httpx.Response(400, json={"detail": "unknown mutation"})
            return httpx.Response(200, json={"version": 2})
        if path == "/admin/reset":
            return httpx.Response(200, json={"version": 1})
        if path == "/user/fetch":
            return httpx.Response(422, json={"error": "validation_failed", "detail": "user_id missing"})
        return httpx.Response(404, json={"detail": "not found"})


def make_clients(handlers: Handlers):
    control = httpx.Client(base_url="http://control.test", transport=httpx.MockTransport(handlers.control))
    mock = httpx.Client(base_url="http://mock.test", transport=httpx.MockTransport(handlers.mock))
    return control, mock


def options(**overrides) -> dict:
    base = {
        "mutation": "M_RENAME",
        "tool": "fetch_user",
        "admin_key": ADMIN_KEY,
        "mock_url": "http://mock.test",
        "header_secrets": {},
        "reset": False,
    }
    base.update(overrides)
    return base


def test_success_path_after_patched_service():
    handlers = Handlers()
    control, mock = make_clients(handlers)
    with control as c, mock as m:
        exit_code, report = run_demo(options(), control=c, mock=m)
    assert exit_code == 0, report
    assert report["health"] == {"control": True, "mock": True}
    baseline = report["baseline"]
    assert baseline["ok"] is False
    assert baseline["status"] == 422
    assert baseline["error"] == "validation_failed"
    assert baseline["url"] == "http://mock.test/user/fetch"
    reflex = report["reflex"]
    assert reflex["outcome"] == "recovered"
    assert reflex["healing_path"] == "rule"
    assert reflex["revision_before"] == 1 and reflex["revision_after"] == 2
    assert reflex["recorded_recovery_s"] == pytest.approx(0.50)
    assert not report["reset_applied"]


def test_refusal_exits_nonzero_with_reason():
    handlers = Handlers()
    handlers.state["sdk_payload"] = sdk_response({
        "outcome": "refused", "healed": False, "reason_code": "ambiguous_mapping", "healing_path": "rule",
    })
    control, mock = make_clients(handlers)
    with control as c, mock as m:
        exit_code, report = run_demo(options(), control=c, mock=m)
    assert exit_code == 1
    assert report["reflex"]["outcome"] == "refused"
    assert report["reflex"]["reason_code"] == "ambiguous_mapping"
    assert report["error"] is None  # a refusal is a result, not a crash


def test_unreachable_control_reports_that_service_without_traceback():
    def dead_handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    with httpx.Client(base_url="http://control.test", transport=httpx.MockTransport(dead_handler)) as control, \
            httpx.Client(base_url="http://mock.test", transport=httpx.MockTransport(Handlers().mock)) as mock:
        exit_code, report = run_demo(options(), control=control, mock=mock)
    assert exit_code == 1
    assert "Control API is not reachable on http://control.test" in report["error"]
    assert report["health"]["control"] is None


def test_missing_admin_key_blocks_the_mutation_step():
    handlers = Handlers()
    handlers.state["admin_key"] = "different-key"
    control, mock = make_clients(handlers)
    with control as c, mock as m:
        exit_code, report = run_demo(options(admin_key=""), control=c, mock=m)
    assert exit_code == 1
    assert "ADMIN_KEY" in report["error"]
    assert report["reflex"] is None


def test_reset_flag_restores_the_mock():
    handlers = Handlers()
    control, mock = make_clients(handlers)
    with control as c, mock as m:
        exit_code, report = run_demo(options(reset=True), control=c, mock=m)
    assert exit_code == 0
    assert report["reset_applied"] is True
    assert any(path.endswith("/admin/reset") for _, path, _ in handlers.mock_calls)


def test_default_mutation_is_the_first_listed():
    handlers = Handlers()
    control, mock = make_clients(handlers)
    with control as c, mock as m:
        exit_code, report = run_demo(options(mutation=None), control=c, mock=m)
    assert exit_code == 0
    assert report["mutation"]["id"] == "M_RENAME"
    applied = [body for _, path, body in handlers.mock_calls if path.endswith("/admin/mutate")]
    assert applied and applied[0]["mutation_id"] == "M_RENAME"


def test_json_report_has_the_documented_shape():
    handlers = Handlers()
    control, mock = make_clients(handlers)
    with control as c, mock as m:
        exit_code, report = run_demo(options(), control=c, mock=m)
    assert exit_code == 0
    assert set(report) == {"health", "mutation", "baseline", "reflex", "reset_applied", "error"}
    assert set(report["reflex"]) == {
        "run_id", "outcome", "healed", "reason_code", "healing_path",
        "attempts", "schema_attempts", "revision_before", "revision_after",
        "recorded_recovery_s", "error",
    }


def test_arg_parser_accepts_the_documented_flags():
    args = build_arg_parser().parse_args([
        "demo", "--mutation", "M_NEST", "--control-url", "http://x", "--json", "--no-color", "--reset",
    ])
    assert args.mutation == "M_NEST"
    assert args.control_url == "http://x"
    assert args.json is True
    assert args.no_color is True
    assert args.reset is True
