"""Real healing demo: ``python -m reflex_sdk demo``.

Every printed number comes from a real response or a persisted run record —
there is no stopwatch and no scripted output. Sequence:

1. health checks for the Control API and the mock API,
2. apply a chosen mutation to the mock API (needs ADMIN_KEY on the backend),
3. a real baseline call direct against the mock (old schema, no healing),
4. a real ``/api/sdk/call`` through the engine, printing the recorded outcome,
   reason code, registry revision change and the recorded recovery time,
5. optional ``--reset`` to restore the mock afterwards.

Exit code 0 only when Reflex recovers and no step errored; ``--json`` prints
the same data machine-readable.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any

import httpx

from .client import ReflexClient
from .errors import ReflexError


class Style:
    """ANSI styling only when the terminal says it can take it."""

    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled

    def ok(self, text: str) -> str:
        return f"\033[32m{text}\033[0m" if self.enabled else text

    def warn(self, text: str) -> str:
        return f"\033[33m{text}\033[0m" if self.enabled else text

    def bad(self, text: str) -> str:
        return f"\033[31m{text}\033[0m" if self.enabled else text


def _body_error(body: Any) -> str:
    if isinstance(body, dict):
        for key in ("error", "detail"):
            value = body.get(key)
            if value:
                return str(value)
    if isinstance(body, str) and body:
        return body[:200]
    return "[response body not readable]"


def run_demo(
    options: dict[str, Any],
    *,
    control: httpx.Client,
    mock: httpx.Client,
) -> tuple[int, dict[str, Any]]:
    """Run the demo sequence against real clients. Returns (exit_code, report).

    ``options`` keys: ``mutation``, ``tool``, ``admin_key``, ``mock_url``,
    ``header_secrets``, ``reset``. Tests inject ``httpx.MockTransport`` clients
    for both services; nothing here depends on a live network target.
    """
    tool = options.get("tool") or "fetch_user"
    report: dict[str, Any] = {
        "health": {"control": None, "mock": None},
        "mutation": None,
        "baseline": None,
        "reflex": None,
        "reset_applied": False,
        "error": None,
    }

    def fail(message: str) -> tuple[int, dict[str, Any]]:
        report["error"] = message
        return 1, report

    # --- 1. health ---------------------------------------------------------
    try:
        control.get("/api/health", timeout=5.0).raise_for_status()
        report["health"]["control"] = True
    except Exception as exc:
        return fail(f"Control API is not reachable on {control.base_url}: {exc}")
    try:
        mock.get("/health", timeout=5.0).raise_for_status()
        report["health"]["mock"] = True
    except Exception as exc:
        return fail(f"Mock API is not reachable on {mock.base_url}: {exc}")

    # --- 2. mutation -------------------------------------------------------
    mutation_id = options.get("mutation")
    if not mutation_id:
        try:
            mutations = control.get("/api/mutations", timeout=5.0).json().get("mutations") or []
            if not mutations:
                return fail("no mutations are available from the Control API")
            mutation_id = mutations[0]["id"]
        except Exception as exc:
            return fail(f"cannot list mutations from the Control API: {exc}")
    admin_key = options.get("admin_key") or ""
    try:
        mutate = mock.post(
            "/admin/mutate",
            json={"mutation_id": mutation_id},
            headers={"X-Admin-Key": admin_key},
            timeout=5.0,
        )
        if mutate.status_code >= 400:
            body = _safe_json(mutate)
            detail = _body_error(body)
            if not admin_key or "invalid admin key" in detail:
                return fail(
                    f"mutation {mutation_id!r} needs the backend ADMIN_KEY"
                    " (copy .env.example to .env and set it)"
                )
            return fail(f"mutation {mutation_id!r} failed against the mock API: {detail}")
        report["mutation"] = {"id": mutation_id, "version": _safe_json(mutate).get("version")}
    except Exception as exc:
        return fail(f"mutation {mutation_id!r} failed against the mock API: {exc}")

    # --- 3. baseline call --------------------------------------------------
    definition: dict[str, Any] = {}
    args: dict[str, Any] = {}
    url = ""
    try:
        tools = control.get("/api/sdk/tools", timeout=5.0).json().get("tools") or []
        definition = next((t for t in tools if t.get("name") == tool), None) or {}
        if not definition:
            return fail(f"unknown tool {tool!r} in /api/sdk/tools")
        args = _sample_args(definition)
        headers = _headers_for(definition, options.get("header_secrets") or {})
        url = (options.get("mock_url") or str(mock.base_url)).rstrip("/") + definition.get("endpoint", "")
        baseline = mock.request(
            definition.get("method") or "POST",
            definition.get("endpoint"),
            json=args,
            headers=headers,
            timeout=5.0,
        )
        ok = 200 <= baseline.status_code < 300
        error_text = None if ok else _body_error(_safe_json(baseline))
        report["baseline"] = {
            "method": definition.get("method") or "POST",
            "url": url,
            "status": baseline.status_code,
            "ok": ok,
            "body": _safe_json(baseline) if ok else None,
            "error": error_text,
        }
    except Exception as exc:
        report["baseline"] = {
            "method": definition.get("method") or "POST",
            "url": url,
            "status": None,
            "ok": False,
            "body": None,
            "error": str(exc),
        }

    # --- 4. Reflex call ----------------------------------------------------
    revision_before = _last_revision(control, tool)
    try:
        # Reuse the caller's control client (test harnesses inject MockTransport).
        with ReflexClient(base_url=str(control.base_url), client=control) as client:
            result = client.call(tool, **args)
        revision_after = _last_revision(control, tool)
        healing_record = None
        try:
            run_detail = control.get(f"/api/runs/{result.run_id}", timeout=5.0).json()
            records = run_detail.get("records") or []
            healing_record = next((r for r in records if r.get("agent") == "healing"), None)
        except Exception:
            healing_record = None
        recorded = None
        if healing_record and healing_record.get("t_break") is not None \
                and healing_record.get("t_recovery") is not None:
            recorded = healing_record["t_recovery"] - healing_record["t_break"]
        report["reflex"] = {
            "run_id": result.run_id,
            "outcome": result.outcome,
            "healed": result.healed,
            "reason_code": result.reason_code,
            "healing_path": getattr(result, "healing_path", None),
            "attempts": result.attempts,
            "schema_attempts": result.schema_attempts,
            "revision_before": revision_before,
            "revision_after": revision_after,
            "recorded_recovery_s": recorded,
            "error": result.error,
        }
        exit_code = 0 if result.ok else 1
    except (ReflexError, Exception) as exc:  # noqa: BLE001 - clean CLI error, never a traceback
        report["reflex"] = {"error": str(exc)}
        return fail(f"Reflex call failed: {exc}")

    # --- 5. optional reset (flagged; --reset restores the mock) -------------
    if options.get("reset"):
        try:
            reset = mock.post("/admin/reset", headers={"X-Admin-Key": admin_key}, timeout=5.0)
            if reset.status_code < 400:
                report["reset_applied"] = True
            else:
                report["error"] = _body_error(_safe_json(reset))
                exit_code = 1
        except Exception as exc:
            report["error"] = f"reset failed: {exc}"
            exit_code = 1

    return exit_code, report


def _safe_json(response: httpx.Response) -> Any:
    try:
        return response.json()
    except Exception:
        return None


def _last_revision(control: httpx.Client, tool: str) -> int | None:
    """Highest revision for one tool, from the real registry history."""
    try:
        history = control.get("/api/registry", params={"tool": tool}, timeout=5.0).json()
        rows = (history.get("tools") or {}).get(tool) or []
        revisions = [r.get("revision") for r in rows if isinstance(r, dict) and r.get("revision") is not None]
        return max(revisions) if revisions else None
    except Exception:
        return None


def _headers_for(definition: dict[str, Any], secret_values: dict[str, str]) -> dict[str, str]:
    """Headers from the recorded tool table; values only from real secrets."""
    headers: dict[str, str] = {"Content-Type": "application/json"}
    for header in definition.get("required_headers") or []:
        name = header.get("name")
        if name and name.lower() in secret_values:
            headers[name] = secret_values[name.lower()]
    return headers


def _sample_args(definition: dict[str, Any]) -> dict[str, Any]:
    """Sample body values derived from the recorded binding table."""
    args: dict[str, Any] = {}
    for path, binding in (definition.get("bindings") or {}).items():
        if not isinstance(binding, dict) or binding.get("source") != "arg":
            continue
        name = str(binding.get("arg") or path)
        if name not in args:
            args[name] = "123" if name == "user_id" else f"{name}-sample"
    return args


def print_report(report: dict[str, Any], style: Style) -> None:
    print(style.warn("== Reflex live demo =="))
    health = report.get("health") or {}
    print(style.ok("[ok]") if health.get("control") else style.bad("[fail]"), "Control API reachable")
    print(style.ok("[ok]") if health.get("mock") else style.bad("[fail]"), "Mock API reachable")
    mutation = report.get("mutation") or {}
    if mutation:
        print(f"Mutation {mutation.get('id')!r}: applied, mock schema version {mutation.get('version')}")
    baseline = report.get("baseline")
    if baseline:
        if baseline.get("ok"):
            print(style.ok("[ok]"), f"Baseline {baseline['method']} {baseline['url']} -> HTTP {baseline['status']}")
        else:
            print(style.bad("[break]"),
                  f"Baseline {baseline.get('method')} {baseline.get('url')} -> HTTP"
                  f" {baseline.get('status') if baseline.get('status') is not None else 'unreachable'}:"
                  f" {baseline.get('error')}")
    reflex = report.get("reflex")
    if reflex and not reflex.get("error"):
        revision = "registry revision" if reflex.get("revision_before") is None \
            else f"rev {reflex.get('revision_before')} -> {reflex.get('revision_after')}"
        recovery = reflex.get("recorded_recovery_s")
        recovery_text = "-" if recovery is None else f"{recovery:.3f}s"
        marker = style.ok("[healed]") if reflex.get("healed") else style.bad("[refused]")
        print(marker, f"outcome {reflex.get('outcome')}, reason {reflex.get('reason_code') or '-'},"
                      f" path {reflex.get('healing_path') or '-'}, attempts {reflex.get('attempts')},"
                      f" {revision}, recorded recovery {recovery_text}, run {reflex.get('run_id')}")
    elif reflex:
        print(style.bad("[error]"), f"Reflex call failed: {reflex.get('error')}")
    if report.get("error"):
        print(style.bad("[fail]"), report.get("error"))
    if report.get("reset_applied"):
        print(style.warn("[reset]"), "mock schema restored")


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="reflex_sdk demo",
        description="Drive the live Reflex healing flow against real services.",
    )
    parser.add_argument("command", nargs="?", default="demo", choices=["demo"])
    parser.add_argument("--mutation", default=None, help="mutation id (default: first available)")
    parser.add_argument("--tool", default="fetch_user")
    parser.add_argument("--control-url", default=None, help="Control API base (default: settings)")
    parser.add_argument("--json", action="store_true", help="machine-readable output of the same data")
    parser.add_argument("--no-color", action="store_true")
    parser.add_argument("--reset", action="store_true", help="reset the mock mutation afterwards")
    return parser


def main(argv: list[str] | None = None) -> int:
    os.environ.setdefault("PYTHONUTF8", "1")
    args = build_arg_parser().parse_args(argv)

    from app.config import load_settings

    try:
        settings = load_settings()
    except Exception as exc:
        print(f"BLOCKED: cannot load backend settings: {exc}")
        return 1

    control_base = (args.control_url or settings.control_api_url).rstrip("/")
    style = Style(sys.stdout.isatty() and not args.no_color and not os.environ.get("NO_COLOR"))

    with httpx.Client(base_url=control_base, timeout=10.0) as control_client, \
            httpx.Client(base_url=settings.mock_api_url, timeout=10.0) as mock_client:
        options = {
            "mutation": args.mutation,
            "tool": args.tool,
            "admin_key": settings.admin_key,
            "mock_url": settings.mock_api_url,
            "header_secrets": {k.lower(): v.value for k, v in settings.header_secrets.items()},
            "reset": args.reset,
        }
        try:
            exit_code, report = run_demo(options, control=control_client, mock=mock_client)
        except ReflexError as exc:
            print(f"Control API is not reachable on {control_base}: {exc}")
            return 1

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print_report(report, style)
    return exit_code
