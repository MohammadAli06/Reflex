"""Control API (port 8001) - the only backend the browser talks to.

Privileged operations use the mock's admin key server-side. The browser never
holds the admin key, the Gemini key or header credentials.
"""
from __future__ import annotations

from datetime import datetime, timezone
import threading
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from ..audit.audit_log import AuditEntry, AuditLog
from ..audit.canonical import canonical_hash, canonical_json, short_hash
from ..config import Settings, get_settings
from ..db import (
    AuditRepo,
    RunRecordRepo,
    RunRepo,
    SdkKeyRepo,
    SchemaSnapshotRepo,
    SessionRepo,
    ToolRevisionRepo,
    TraceEventRepo,
    UserRepo,
    init_db,
)
from ..healing.events import Redactor
from ..dryrun.engine import DryRunError
from ..mock_api.signing import fingerprint
from ..mock_api.mutations import list_mutations
from ..registry.tool_registry import StaleRevisionError
from ..runner.cases import list_cases
from ..runner.harness import Harness
from ..runner.metrics import compute_metrics
from ..runner.records import RunRecord
from ..runner.run_suite import load_records
from ..schema_utils import sample_instance
from ..security.budget import Breakers
from ..security.policy import ROUTE_ROLES, classify_route, load_security_policy
from ..security.ssrf import SsrfBlocked, make_guarded_client
from ..security.throttle import RateLimiter
from .models import (
    DryRunAnalyzeRequest,
    DryRunParseRequest,
    LoginRequest,
    MutateRequest,
    RollbackRequest,
    RunRequest,
    SDKCallRequest,
    SdkKeyCreateRequest,
)
from .run_manager import BusyError, RunManager
from .scenarios import list_scenarios, run_scenario
from .sse import stream_events

ALLOWED_ORIGINS_LOCAL = {"http://localhost:5173", "http://127.0.0.1:5173"}

SESSION_COOKIE = "reflex_session"


def _initial_tool_dicts() -> dict[str, dict[str, Any]]:
    from ..registry.tools import initial_definitions
    return {name: d.to_dict() for name, d in initial_definitions().items()}


def _spec_view(openapi: dict[str, Any]) -> dict[str, Any]:
    """The real mock OpenAPI contract view: active block + demo operation."""
    active = openapi.get("x-active-schema", {})
    return {
        "version": active.get("version"),
        "sha256": canonical_hash(active) if active else None,
        "request_schemas": active.get("request_schemas", {}),
        "required_headers": active.get("required_headers", []),
        "response_schemas": active.get("response_schemas", {}),
        "error_style": active.get("error_style"),
        "operation": (openapi.get("paths", {}).get("/user/fetch", {}) or {}).get("post"),
    }


def create_app(
    settings: Settings | None = None,
    mock_client: httpx.Client | None = None,
    *,
    security_policy=None,
) -> FastAPI:
    settings = settings or get_settings()
    policy = security_policy or load_security_policy(settings)
    throttle = RateLimiter()
    breakers = Breakers(policy)
    mock = mock_client or make_guarded_client(settings.mock_api_url, policy, breakers, timeout=5.0)
    db_error: str | None = None
    try:
        init_db(settings.database_url)
    except Exception as exc:  # surfaced in /api/status and /api/security/status
        db_error = f"{type(exc).__name__}: {exc}"
    audit_repo = AuditRepo(settings.database_url)
    run_repo = RunRepo(settings.database_url)
    record_repo = RunRecordRepo(settings.database_url)
    event_repo = TraceEventRepo(settings.database_url)
    revision_repo = ToolRevisionRepo(settings.database_url)
    snapshot_repo = SchemaSnapshotRepo(settings.database_url)
    user_repo = UserRepo(settings.database_url)
    session_repo = SessionRepo(settings.database_url)
    key_repo = SdkKeyRepo(settings.database_url)
    try:
        user_repo.ensure_user(settings.admin_username, settings.admin_password)
    except Exception as exc:
        db_error = db_error or f"{type(exc).__name__}: {exc}"
    audit = AuditLog(settings.audit_log_path, redactor=Redactor(
        [s.value for s in settings.header_secrets.values()]
    ), audit_repo=audit_repo)
    app = FastAPI(title="Control API", docs_url=None, redoc_url=None)
    app.state.repos = {
        "audit": audit_repo, "run": run_repo, "record": record_repo,
        "event": event_repo, "revision": revision_repo,
        "snapshot": snapshot_repo, "user": user_repo, "session": session_repo,
        "keys": key_repo,
    }
    app.state.security = {
        "policy": policy, "throttle": throttle, "breakers": breakers,
        "key_repo": key_repo,
    }
    app.state.provenance = {
        "ok": None, "verified_at": None, "version": None, "sha256": None,
        "signature_verified": False, "key_fingerprint": "", "error": None,
    }
    app.state.db_error = db_error

    allowed_origins = sorted({settings.frontend_origin, *ALLOWED_ORIGINS_LOCAL})
    app.add_middleware(
        CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )

    # --- security guard: route classification, auth, throttling ------------
    # Registered before the origin guard so it runs closer to the transport.
    def _client_ip(request: Request) -> str:
        return request.client.host if request.client else "unknown"

    def _match_template(path: str) -> str | None:
        """Map a concrete /api path onto one of the classified templates.

        ROUTE_ROLES items are ((method, template), role): sort by template
        length and unpack the key tuple explicitly.
        """
        path_parts = path.split("/")
        for key in sorted(ROUTE_ROLES, key=lambda k: len(k[1])):
            _, template = key
            parts = template.split("/")
            if len(parts) != len(path_parts):
                continue
            for actual, wanted in zip(path_parts, parts):
                if actual != wanted and not wanted.startswith("{"):
                    break
            else:
                return template
        return None

    def _security_event(reason_code: str, summary: str) -> None:
        """Security events ride the real audit chain; never block on write."""
        entry = AuditEntry(
            run_id="", tool=summary[:64], error={"summary": summary[:256]},
            classification="security_event", schema_version_before=None,
            schema_version_after=None, schema_sha256="", old_definition=None,
            new_definition=None, evidence=[summary[:256]], confidence=0.0,
            outcome="security_event", reason_code=reason_code,
            healing_path="security",
        )
        try:
            audit.append(entry)
        except Exception:
            pass  # an audit outage is surfaced by /api/security/status chain check

    def _deny_429(retry_after: int) -> JSONResponse:
        return JSONResponse(
            status_code=429, content={"detail": "rate limit exceeded"},
            headers={"Retry-After": str(max(1, retry_after))},
        )

    @app.middleware("http")
    async def security_guard(request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api/"):
            return await call_next(request)
        method = request.method.upper()
        template = _match_template(path)
        role = classify_route(method, template) if template else ""
        if not role:
            # Deny by default: unclassified /api routes do not exist.
            return JSONResponse(status_code=404, content={"detail": "not found"})
        identity = _client_ip(request)

        # Request-shape caps, enforced at the boundary (every /api route).
        if method in {"POST", "PUT", "PATCH", "DELETE"}:
            declared = request.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > policy.max_request_bytes:
                _security_event("payload_too_large", f"{method} {path}")
                return JSONResponse(status_code=413, content={"detail": "request body too large"})
            if len(request.headers) > policy.max_header_count:
                return JSONResponse(status_code=400, content={"detail": "too many request headers"})
            header_bytes = sum(len(k) + len(v) for k, v in request.headers.items())
            if header_bytes > policy.max_header_bytes:
                return JSONResponse(status_code=400, content={"detail": "request headers too large"})

        if role == "public":
            if template == "/api/login":
                allowed, retry_after = throttle.check(
                    "login", identity, policy.login_limit, policy.rate_window_s)
                if not allowed:
                    return _deny_429(retry_after)
            return await call_next(request)

        if role == "operator":
            allowed, retry_after = throttle.check(
                "operator", identity, policy.operator_limit, policy.rate_window_s)
            if not allowed:
                _security_event("rate_limited", f"{method} {path}")
                return _deny_429(retry_after)
            if template == "/api/dryrun/parse" or template == "/api/dryrun/analyze":
                allowed, retry_after = throttle.check(
                    "dryrun", identity, policy.dryrun_limit, policy.rate_window_s)
                if not allowed:
                    _security_event("rate_limited", f"{method} {path}")
                    return _deny_429(retry_after)
            user = _current_user(request)
            if user is None:
                _security_event("auth_required", f"{method} {path}")
                return JSONResponse(status_code=401, content={"detail": "authentication required"})
            request.state.actor = user["username"]
            return await call_next(request)

        # sdk role: calls are open while zero keys exist (demo-friendly), and
        # enforced the moment any key has been created.
        allowed, retry_after = throttle.check(
            "sdk_call", identity, policy.sdk_call_limit, policy.rate_window_s)
        if not allowed:
            _security_event("rate_limited", f"{method} {path}")
            return _deny_429(retry_after)
        if key_repo.count_active():
            presented = request.headers.get("x-api-key") or ""
            key = key_repo.find_active(presented)
            if key is None:
                _security_event("sdk_key_required", f"{method} {path}")
                return JSONResponse(status_code=401, content={"detail": "a valid SDK key is required"})
            key_repo.touch_last_used(key["id"])
            request.state.actor = f"sdk:{key['id']} (label {key['label'] or 'unnamed'})"
        return await call_next(request)


    def record_revision(name: str, definition: dict[str, Any], run_id: str | None) -> None:
        try:
            revision_repo.insert_cas(name, definition.get("revision", 1) - 1, definition,
                                     created_by_run=run_id, reason="heal-apply")
        except Exception:
            pass

    def record_snapshot(verified) -> None:
        try:
            snapshot_repo.insert_if_new(
                verified.version, verified.sha256,
                canonical_json(verified.raw), verified.error_style)
        except Exception:
            pass

    def record_provenance(verified) -> None:
        """Remember the last schema we authenticated, for the security page."""
        app.state.provenance = {
            "ok": True,
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "version": verified.version,
            "sha256": verified.sha256,
            "signature_verified": bool(getattr(verified, "signature_verified", False)),
            "key_fingerprint": getattr(verified, "key_fingerprint", ""),
            "error": None,
        }

    def record_provenance_failure(exc: Exception) -> None:
        """A failed provenance check must be visible, not just absent."""
        app.state.provenance = {
            "ok": False,
            "verified_at": datetime.now(timezone.utc).isoformat(),
            "version": None,
            "sha256": None,
            "signature_verified": False,
            "key_fingerprint": "",
            "error": str(exc),
        }

    def resolved_public_key() -> str:
        """The pinned key, or the mock's own key when running unpinned (dev)."""
        if settings.pinned_schema_public_key:
            return settings.pinned_schema_public_key
        try:
            catalog = mock.get("/admin/catalog", headers=admin_headers(), timeout=3.0).json()
            return str(catalog.get("schema_public_key", ""))
        except Exception:
            return ""

    # The LLM fallback is constructed whenever the flag is on; without an API
    # key its one attempt refuses with llm_unavailable instead of healing.
    repair_proposer = None
    if settings.llm_repair_enabled:
        from ..healing.llm_fallback import GeminiRepairProposer

        repair_proposer = GeminiRepairProposer(settings)

    def new_harness() -> Harness:
        return Harness(settings, client=mock, audit=audit,
                       revision_sink=record_revision, snapshot_sink=record_snapshot,
                       provenance_sink=record_provenance,
                       provenance_error_sink=record_provenance_failure,
                       mock_public_key=resolved_public_key(),
                       repair_proposer=repair_proposer)

    try:
        revision_repo.seed_initial(_initial_tool_dicts())
    except Exception:
        pass
    run_manager = RunManager(settings, new_harness, run_repo=run_repo,
                             record_repo=record_repo, event_repo=event_repo,
                             revision_repo=revision_repo, snapshot_repo=snapshot_repo)
    app.state.run_manager = run_manager

    @app.middleware("http")
    async def origin_guard(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            if origin and origin not in allowed_origins:
                return JSONResponse(status_code=403, content={"detail": "origin not allowed"})
        return await call_next(request)

    def admin_headers() -> dict[str, str]:
        try:
            return {"X-Admin-Key": settings.require_admin_key()}
        except Exception:
            raise HTTPException(status_code=500, detail="ADMIN_KEY is not configured on the backend")

    def run_consistency() -> dict[str, Any]:
        openapi = mock.get("/openapi.json", timeout=5.0).json()
        state = mock.get("/admin/state", headers=admin_headers(), timeout=5.0).json()
        active = state["state"]
        checks: list[dict[str, Any]] = []

        def add(name: str, ok: bool, detail: str = "") -> None:
            checks.append({"name": name, "ok": bool(ok), "detail": detail})

        add("schema_version_matches", openapi.get("x-schema-version") == active["version"])
        add("exposed_schema_matches_active", openapi.get("x-active-schema") == active)
        add("info_version_matches", openapi.get("info", {}).get("version") == str(active["version"]))

        for endpoint, schema in active["request_schemas"].items():
            body = sample_instance(schema)
            for header in active["required_headers"]:
                missing = mock.post(endpoint, json=body, timeout=5.0)
                add(f"missing_header_rejected:{endpoint}", missing.status_code != 200,
                    f"{header['name']} -> {missing.status_code}")
            header_values = {
                h["name"]: (settings.get_header_secret(h["name"]).value
                            if settings.get_header_secret(h["name"]) else "unavailable")
                for h in active["required_headers"]
            }
            valid = mock.post(endpoint, json=body, headers=header_values, timeout=5.0)
            add(f"valid_payload_accepted:{endpoint}", valid.status_code == 200, str(valid.status_code))

        return {"pass": all(c["ok"] for c in checks), "version": active["version"], "checks": checks}

    # --- routes -----------------------------------------------------------
    @app.get("/api/health")
    async def health():
        return {"status": "ok", "llm_configured": settings.llm_configured}

    @app.get("/api/status")
    async def status():
        reachable = True
        version = None
        schema_hash = None
        try:
            mock.get("/health", timeout=3.0).raise_for_status()
            openapi = mock.get("/openapi.json", timeout=3.0).json()
            active = openapi.get("x-active-schema", {})
            version = active.get("version")
            schema_hash = short_hash(canonical_hash(active))
        except Exception:
            reachable = False
        latest = run_manager.latest()
        return {
            "mock_api_reachable": reachable,
            "control_api": "ok",
            "schema_version": version,
            "schema_hash": schema_hash,
            "llm_configured": settings.llm_configured,
            "busy": run_manager.busy,
            "last_run": latest.summary() if latest else None,
            # Repair policy: safe, non-secret values the settings page reports.
            "llm_model": settings.llm_model,
            "llm_thinking_level": settings.llm_thinking_level,
            "llm_repair_enabled": settings.llm_repair_enabled,
            "max_schema_attempts": settings.max_schema_attempts,
            "max_infra_retries": settings.max_infra_retries,
            "schema_signing_enabled": settings.schema_signing_enabled,
            "schema_key_pinned": bool(settings.pinned_schema_public_key),
            "spec_watch_interval_s": settings.spec_watch_interval_s,
            "persistence_error": app.state.db_error,
        }

    @app.get("/api/schema")
    async def schema():
        openapi = mock.get("/openapi.json", timeout=5.0).json()
        active = openapi.get("x-active-schema", {})
        return {
            "version": active.get("version"),
            "sha256": canonical_hash(active),
            "short_hash": short_hash(canonical_hash(active)),
            "request_schemas": active.get("request_schemas", {}),
            "required_headers": active.get("required_headers", []),
            "response_schemas": active.get("response_schemas", {}),
            "error_style": active.get("error_style", "clear"),
        }

    @app.get("/api/mutations")
    async def mutations():
        return {"mutations": list_mutations()}

    @app.get("/api/cases")
    async def cases():
        return {"cases": list_cases()}

    @app.get("/api/consistency")
    async def consistency():
        return run_consistency()

    @app.post("/api/mutate")
    async def mutate(payload: MutateRequest):
        try:
            before_doc = mock.get("/openapi.json", timeout=5.0).json()
        except Exception:
            before_doc = None
        resp = mock.post("/admin/mutate", json=payload.model_dump(exclude_none=True),
                         headers=admin_headers(), timeout=5.0)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        try:
            after_doc = mock.get("/openapi.json", timeout=5.0).json()
        except Exception:
            after_doc = None
        check = run_consistency()
        if not check["pass"]:
            raise HTTPException(status_code=500, detail={"message": "consistency check failed", **check})
        mutation = next(
            (m for m in list_mutations() if m.get("id") == payload.mutation_id), None)
        return {
            "version": check["version"],
            "consistency": check,
            "mutation": None if mutation is None else {
                "id": mutation.get("id"),
                "description": mutation.get("description"),
            },
            "spec_before": None if before_doc is None else _spec_view(before_doc),
            "spec_after": None if after_doc is None else _spec_view(after_doc),
        }

    @app.post("/api/reset")
    async def reset():
        resp = mock.post("/admin/reset", headers=admin_headers(), timeout=5.0)
        resp.raise_for_status()
        try:
            for name, definition in _initial_tool_dicts().items():
                try:
                    revision_repo.insert_next(name, definition, reason="reset")
                except Exception:
                    pass
        except Exception:
            pass
        check = run_consistency()
        if not check["pass"]:
            raise HTTPException(status_code=500, detail={"message": "consistency check failed", **check})
        return {"version": check["version"], "consistency": check}

    @app.post("/api/runs")
    async def start_run(payload: RunRequest):
        try:
            state = run_manager.start(payload.case_ids, payload.repeats)
        except BusyError:
            raise HTTPException(status_code=409, detail="a run is already in progress")
        except KeyError as exc:
            raise HTTPException(status_code=400, detail=f"unknown case: {exc}")
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return state.summary()

    @app.get("/api/runs")
    async def list_runs():
        return {"runs": run_manager.list()}

    @app.get("/api/runs/{run_id}")
    async def get_run(run_id: str):
        state = run_manager.get(run_id)
        if state is None:
            raise HTTPException(status_code=404, detail="run not found")
        summary = state.summary()
        summary["exchanges"] = [e.to_dict() for e in state.events if e.type == "http_exchange"]
        return summary

    @app.get("/api/runs/{run_id}/exchanges")
    async def run_exchanges(run_id: str):
        state = run_manager.get(run_id)
        if state is None:
            raise HTTPException(status_code=404, detail="run not found")
        return {
            "run_id": run_id,
            "exchanges": [e.to_dict() for e in state.events if e.type == "http_exchange"],
        }

    @app.get("/api/runs/{run_id}/events")
    async def run_events(run_id: str, request: Request):
        state = run_manager.get(run_id)
        if state is None:
            raise HTTPException(status_code=404, detail="run not found")
        last_event_id = request.headers.get("last-event-id")
        start = int(last_event_id) if last_event_id and last_event_id.isdigit() else 0
        return StreamingResponse(stream_events(state, start, event_repo=event_repo),
                                 media_type="text/event-stream")

    @app.get("/api/audit")
    async def get_audit(outcome: str | None = None, run_id: str | None = None, limit: int | None = None):
        return {"entries": audit.read(outcome=outcome, run_id=run_id, limit=limit)}

    @app.get("/api/audit/verify")
    async def verify_audit():
        ok, broken_id = audit.verify_chain()
        result: dict[str, Any] = {"ok": ok}
        if not ok:
            result["broken_entry_id"] = broken_id
        return result

    @app.get("/api/metrics")
    async def metrics():
        try:
            stored = record_repo.list_all()
            if stored:
                return compute_metrics([RunRecord.from_dict(d) for d in stored])
        except Exception:
            pass
        records = load_records(settings.results_dir)
        return compute_metrics(records)

    @app.get("/api/scenarios")
    async def scenarios():
        return {"scenarios": list_scenarios()}

    # --- real-world benchmark --------------------------------------------
    @app.get("/api/realworld/cases")
    async def realworld_cases():
        from ..realworld.case_builder import load_rows

        rows = load_rows()
        try:
            stored = record_repo.list_all()
        except Exception:
            stored = []
        records = [RunRecord.from_dict(d) for d in stored]
        for row in rows:
            case_id = str(row.get("id", ""))
            baseline = next((r for r in reversed(records)
                             if r.case_id == case_id and r.agent == "baseline"), None)
            reflex = next((r for r in reversed(records)
                           if r.case_id == case_id and r.agent == "healing"), None)
            row["baseline_outcome"] = baseline.outcome if baseline else None
            row["reflex_outcome"] = reflex.outcome if reflex else None
            row["reflex_correct"] = reflex.correct if reflex else None
            row["server_payload_ok"] = reflex.server_payload_ok if reflex else None
            row["run_id"] = reflex.run_id if reflex else None
        reviewed = [r for r in rows if r.get("reviewed")]
        evaluated = [r for r in rows if r.get("reflex_outcome")]
        return {
            "cases": rows,
            "summary": {
                "registered": len(rows),
                "reviewed": len(reviewed),
                "evaluated": len(evaluated),
                "recovered": sum(1 for r in evaluated
                                 if r.get("reflex_outcome") == "recovered"
                                 and r.get("reflex_correct") is not False),
                "correct_refusals": sum(1 for r in evaluated
                                        if r.get("reflex_outcome") == "refused"
                                        and r.get("label") == "refuse_expected"),
                "wrong_patches": sum(1 for r in evaluated
                                     if r.get("reflex_outcome") == "recovered"
                                     and r.get("reflex_correct") is False),
                "failed": sum(1 for r in evaluated
                              if r.get("reflex_outcome") == "failed"),
            },
        }

    @app.post("/api/realworld/build")
    async def realworld_build():
        """Propose draft case rows from the vendored spec pairs (unreviewed)."""
        from ..realworld.case_builder import build_draft, load_spec, save_rows
        from ..realworld.case_builder import load_rows as _rows

        drafts = []
        for api, old_ref, new_ref, operation, args in (
            ("github", "old", "new", "POST /repos/{owner}/{repo}/issues",
             {"owner": "acme", "repo": "widgets", "title": "Draft from builder"}),
        ):
            try:
                load_spec(api, old_ref)
                load_spec(api, new_ref)
            except FileNotFoundError:
                continue
            drafts.append(build_draft(api, operation, old_ref, new_ref, args))
        existing = _rows()
        known = {row.get("id") for row in existing}
        merged = existing + [d for d in drafts if d["id"] not in known]
        try:
            save_rows(merged)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"could not write cases.yaml: {exc}")
        return {"drafts": drafts, "total": len(merged), "reviewed": sum(
            1 for row in merged if row.get("reviewed"))}

    # --- evaluation -------------------------------------------------------
    @app.get("/api/evaluation/config")
    async def evaluation_config():
        from ..mock_api.active_schema import ERROR_STYLES
        from ..runner.fuzz import FUZZABLE, PROFILES

        real = []
        try:
            from ..realworld.case_builder import reviewed_cases

            real = [c.id for c in reviewed_cases()]
        except Exception:
            pass
        return {
            "splits": ["tuning", "held_out", "fuzz"],
            "error_styles": sorted(ERROR_STYLES),
            "fuzzable_mutations": sorted(FUZZABLE),
            "refuse_type_mutations": sorted(m for m, p in PROFILES.items() if not p.recoverable),
            "reviewed_real_cases": real,
        }

    # --- security ---------------------------------------------------------
    scenario_lock = threading.Lock()

    @app.get("/api/security/status")
    async def security_status():
        try:
            ok, broken_id = audit.verify_chain()
            checked = audit_repo.count()
        except Exception as exc:
            ok, broken_id, checked = None, None, 0
            app.state.provenance = {**app.state.provenance, "error": str(exc)}
        key = resolved_public_key()
        provenance = dict(app.state.provenance)
        provenance["key_configured"] = bool(key)
        provenance["key_pinned_in_settings"] = bool(settings.pinned_schema_public_key)
        provenance["fingerprint"] = provenance.get("key_fingerprint") or (
            fingerprint(key) if key else "")
        active_keys = key_repo.count_active()
        return {
            "chain": {"ok": ok, "checked": checked, "first_broken_id": broken_id},
            "provenance": provenance,
            "signing_enabled": settings.schema_signing_enabled,
            "persistence_error": app.state.db_error,
            "auth": {
                "roles": ["operator", "sdk"],
                "sdk_mode": "key_required" if active_keys else "open_no_keys",
                "active_sdk_keys": active_keys,
            },
            "limits": policy.summary(),
            "throttle_hits": throttle.hits(),
            "breakers": breakers.status(),
            "hosts": list(policy.allowed_hosts),
        }

    @app.post("/api/security/keys")
    async def security_create_key(payload: SdkKeyCreateRequest):
        """Create an SDK key. The plaintext appears exactly once, here."""
        created = key_repo.create(label=payload.label)
        _security_event("sdk_key_created", f"sdk key #{created['id']} created (label {payload.label!r})")
        return {
            "key": created["key"],  # shown once; never stored or returned again
            "id": created["id"],
            "label": created["label"],
            "created_at": created["created_at"],
        }

    @app.get("/api/security/keys")
    async def security_list_keys():
        """Metadata only: ids, labels, last usage. Never key material."""
        return {"keys": key_repo.list_active(), "active": key_repo.count_active()}

    @app.post("/api/security/keys/{key_id}/revoke")
    async def security_revoke_key(key_id: int):
        if not key_repo.revoke(key_id):
            raise HTTPException(status_code=404, detail="key not found (or already revoked)")
        _security_event("sdk_key_revoked", f"sdk key #{key_id} revoked")
        return {"revoked": key_id}

    @app.post("/api/security/tamper")
    async def security_tamper(payload: dict | None = None):
        """Controlled demo of the provenance gate. Mock-only, reverts afterwards.

        Delegates to the ``tampered_schema`` scenario so the route and the Safety
        page exercise one implementation, including the schema drift that forces
        a fetch in the first place.
        """
        if scenario_lock.locked():
            raise HTTPException(status_code=409, detail="a scenario is already running")
        if not settings.schema_signing_enabled:
            raise HTTPException(
                status_code=409,
                detail="schema signing is disabled; the tamper demo cannot show a refusal",
            )
        with scenario_lock:
            try:
                result = run_scenario(new_harness(), "tampered_schema")
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"tamper demo failed: {exc}")
        return {
            "tamper": {"tampered": result.get("outcome") == "refused"},
            "heal_attempt": {"outcome": result.get("outcome"),
                             "reason_code": result.get("reason_code")},
            "scenario": result,
        }

    @app.get("/api/security/sessions")
    async def security_sessions(request: Request):
        if _current_user(request) is None:
            raise HTTPException(status_code=401, detail="not authenticated")
        try:
            return {"sessions": session_repo.list_active()}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    @app.post("/api/security/sessions/{session_id}/revoke")
    async def security_revoke_session(session_id: int, request: Request):
        user = _current_user(request)
        if user is None:
            raise HTTPException(status_code=401, detail="not authenticated")
        removed = session_repo.revoke(session_id)
        if not removed:
            raise HTTPException(status_code=404, detail="session not found")
        return {"revoked": session_id}

    # --- auth -------------------------------------------------------------
    def _current_user(request: Request) -> dict[str, Any] | None:
        token = request.cookies.get(SESSION_COOKIE)
        if not token:
            return None
        try:
            return session_repo.get_valid(token)
        except Exception:
            return None

    @app.post("/api/login")
    async def login(payload: LoginRequest):
        try:
            user = user_repo.authenticate(payload.username, payload.password)
        except Exception:
            user = None
        if user is None:
            raise HTTPException(status_code=401, detail="invalid credentials")
        try:
            created = session_repo.create(user["id"])
        except Exception:
            raise HTTPException(status_code=500, detail="could not create session")
        response = JSONResponse({"username": user["username"]})
        response.set_cookie(SESSION_COOKIE, created["token"], httponly=True,
                            samesite="lax", path="/")
        return response

    @app.post("/api/logout")
    async def logout(request: Request):
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            try:
                session_repo.delete(token)
            except Exception:
                pass
        response = JSONResponse({"status": "ok"})
        response.delete_cookie(SESSION_COOKIE, path="/")
        return response

    @app.get("/api/me")
    async def me(request: Request):
        user = _current_user(request)
        if user is None:
            raise HTTPException(status_code=401, detail="not authenticated")
        return {"username": user["username"]}

    @app.get("/api/registry")
    async def registry_history(tool: str | None = None):
        from ..registry.tools import initial_definitions
        names = [tool] if tool else sorted(initial_definitions())
        try:
            return {"tools": {n: revision_repo.history(n) for n in names}}
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc))

    @app.post("/api/registry/rollback")
    async def registry_rollback(payload: RollbackRequest):
        """Operator-only rollback: CAS on ``current_revision`` (the revision the
        operator last saw) and restore ``target_revision``'s definition. A stale
        or unknown revision is refused with a clear error and no partial state.
        Audited BEFORE the write (fail-closed)."""
        current = revision_repo.latest(payload.tool)
        if current is None:
            raise HTTPException(status_code=404, detail=f"tool {payload.tool!r} has no recorded revisions")
        target = revision_repo.definition_at(payload.tool, payload.target_revision)
        if target is None:
            raise HTTPException(
                status_code=404,
                detail=f"revision {payload.target_revision} does not exist for {payload.tool!r}",
            )
        if current["revision"] != payload.current_revision:
            raise HTTPException(
                status_code=409,
                detail=(f"registry moved on since you read it: current revision "
                        f"{current['revision']}, you sent {payload.current_revision}; rollback rejected"),
            )
        try:
            restored = dict(target)
            restored["revision"] = current["revision"] + 1
            # Audit-first: if this write fails, nothing changes (fail-closed).
            audit.append(AuditEntry(
                run_id="", tool=payload.tool, error={"summary": "operator rollback"},
                classification="rollback", schema_version_before=current["revision"],
                schema_version_after=current["revision"] + 1, schema_sha256="",
                old_definition=current["definition"], new_definition=restored,
                evidence=[f"operator rollback to revision {payload.target_revision}; audited before the write"],
                confidence=0.0, outcome="applied", reason_code="rollback",
                healing_path="security",
            ))
            new_revision = revision_repo.insert_cas(
                payload.tool, payload.current_revision, restored, reason="operator-rollback")
        except StaleRevisionError as exc:
            raise HTTPException(
                status_code=409,
                detail=f"registry moved on; rollback rejected: {exc}",
            )
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"audit write failed; rollback not applied: {exc}",
            )
        return {
            "tool": payload.tool,
            "rolled_back_to": payload.target_revision,
            "new_revision": new_revision,
        }

    # --- public SDK adapter ---------------------------------------------
    @app.get("/api/sdk/tools")
    async def sdk_tools():
        """Discover engine-owned tools; SDK clients cannot mutate definitions."""
        from ..registry.tools import initial_definitions
        return {"tools": [definition.to_dict() for definition in initial_definitions().values()]}

    @app.post("/api/sdk/call")
    async def sdk_call(payload: SDKCallRequest):
        try:
            state, result = run_manager.execute_sdk(payload.tool, payload.args)
        except BusyError:
            raise HTTPException(status_code=409, detail="a run is already in progress")
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown tool: {payload.tool}")
        except Exception as exc:
            # Do not echo target errors or request values through the adapter.
            raise HTTPException(status_code=502, detail="SDK execution could not complete") from exc
        return {
            "run_id": state.run_id,
            "outcome": result.outcome,
            "healed": result.schema_attempts > 0,
            "data": result.response_data,
            "reason_code": result.reason_code,
            "error": result.error_text or None,
            "attempts": result.attempts,
            "schema_attempts": result.schema_attempts,
            "healing_path": result.healing_path,
        }

    # --- public dry-run (pasted specs; strictly offline) ------------------
    DRYRUN_ERROR_STATUS = {
        "invalid_spec": 400,
        "unsupported_external_ref": 400,
        "payload_too_large": 413,
        "payload_too_deep": 413,
        "unknown_operation": 422,
    }

    def _dryrun_http(exc: Exception) -> HTTPException:
        if isinstance(exc, DryRunError):
            return HTTPException(
                status_code=DRYRUN_ERROR_STATUS.get(exc.code, 400),
                detail={"message": exc.detail, "code": exc.code},
            )
        return HTTPException(status_code=400, detail={"message": str(exc), "code": "invalid_spec"})

    @app.post("/api/dryrun/parse")
    async def dryrun_parse(payload: DryRunParseRequest):
        """List the real operations in the two pasted documents (auto-fill)."""
        from ..dryrun import engine as dryrun_engine

        try:
            old_ops = dryrun_engine.list_operations(dryrun_engine.parse_spec_text(payload.old_spec, "old_spec"))
            new_ops = dryrun_engine.list_operations(dryrun_engine.parse_spec_text(payload.new_spec, "new_spec"))
        except Exception as exc:
            raise _dryrun_http(exc)
        return {
            "kind": "dryrun",
            "old_operations": old_ops,
            "new_operations": new_ops,
            "shared_operations": [
                old for old in old_ops
                for new in new_ops
                if old["path"] == new["path"] and old["method"] == new["method"]
            ],
        }

    @app.post("/api/dryrun/analyze")
    async def dryrun_analyze(payload: DryRunAnalyzeRequest):
        """What WOULD Reflex do here? Pure pipeline, zero persistence, zero calls."""
        from ..dryrun import engine as dryrun_engine

        proposer = repair_proposer  # gate lives inside the healer logic
        try:
            result = dryrun_engine.analyze(
                old_spec_text=payload.old_spec,
                new_spec_text=payload.new_spec,
                operation=payload.operation,
                original_request=payload.original_request,
                error=payload.error,
                proposer=proposer,
            )
        except Exception as exc:
            raise _dryrun_http(exc)
        return result

    @app.post("/api/scenarios/{scenario_id}/run")
    async def run_scenario_route(scenario_id: str):
        if scenario_lock.locked():
            raise HTTPException(status_code=409, detail="a scenario is already running")
        with scenario_lock:
            try:
                return run_scenario(new_harness(), scenario_id)
            except KeyError:
                raise HTTPException(status_code=404, detail=f"unknown scenario: {scenario_id}")

    return app


app = create_app()
