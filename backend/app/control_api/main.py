"""Control API (port 8001) - the only backend the browser talks to.

Privileged operations use the mock's admin key server-side. The browser never
holds the admin key, the Gemini key or header credentials.
"""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from ..audit.audit_log import AuditLog
from ..audit.canonical import canonical_hash, canonical_json, short_hash
from ..config import Settings, get_settings
from ..db import (
    AuditRepo,
    RunRecordRepo,
    RunRepo,
    SchemaSnapshotRepo,
    SessionRepo,
    ToolRevisionRepo,
    TraceEventRepo,
    UserRepo,
    init_db,
)
from ..healing.events import Redactor
from ..mock_api.mutations import list_mutations
from ..runner.cases import list_cases
from ..runner.harness import Harness
from ..runner.metrics import compute_metrics
from ..runner.records import RunRecord
from ..runner.run_suite import load_records
from ..schema_utils import sample_instance
from .models import LoginRequest, MutateRequest, RunRequest
from .run_manager import BusyError, RunManager
from .scenarios import list_scenarios, run_scenario
from .sse import stream_events

ALLOWED_ORIGINS_LOCAL = {"http://localhost:5173", "http://127.0.0.1:5173"}

SESSION_COOKIE = "reflex_session"


def _initial_tool_dicts() -> dict[str, dict[str, Any]]:
    from ..registry.tools import initial_definitions
    return {name: d.to_dict() for name, d in initial_definitions().items()}


def create_app(settings: Settings | None = None, mock_client: httpx.Client | None = None) -> FastAPI:
    settings = settings or get_settings()
    mock = mock_client or httpx.Client(base_url=settings.mock_api_url, timeout=5.0)
    try:
        init_db(settings.database_url)
    except Exception:
        pass
    audit_repo = AuditRepo(settings.database_url)
    run_repo = RunRepo(settings.database_url)
    record_repo = RunRecordRepo(settings.database_url)
    event_repo = TraceEventRepo(settings.database_url)
    revision_repo = ToolRevisionRepo(settings.database_url)
    snapshot_repo = SchemaSnapshotRepo(settings.database_url)
    user_repo = UserRepo(settings.database_url)
    session_repo = SessionRepo(settings.database_url)
    try:
        user_repo.ensure_user(settings.admin_username, settings.admin_password)
    except Exception:
        pass
    audit = AuditLog(settings.audit_log_path, redactor=Redactor(
        [s.value for s in settings.header_secrets.values()]
    ), audit_repo=audit_repo)
    app = FastAPI(title="Control API", docs_url=None, redoc_url=None)
    app.state.repos = {
        "audit": audit_repo, "run": run_repo, "record": record_repo,
        "event": event_repo, "revision": revision_repo,
        "snapshot": snapshot_repo, "user": user_repo, "session": session_repo,
    }

    allowed_origins = sorted({settings.frontend_origin, *ALLOWED_ORIGINS_LOCAL})
    app.add_middleware(
        CORSMiddleware, allow_origins=allowed_origins, allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )

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

    def new_harness() -> Harness:
        return Harness(settings, client=mock, audit=audit,
                       revision_sink=record_revision, snapshot_sink=record_snapshot)

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
        resp = mock.post("/admin/mutate", json=payload.model_dump(exclude_none=True),
                         headers=admin_headers(), timeout=5.0)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        check = run_consistency()
        if not check["pass"]:
            raise HTTPException(status_code=500, detail={"message": "consistency check failed", **check})
        return {"version": check["version"], "consistency": check}

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
        return state.summary()

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

    @app.post("/api/scenarios/{scenario_id}/run")
    async def run_scenario_route(scenario_id: str):
        try:
            return run_scenario(new_harness(), scenario_id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"unknown scenario: {scenario_id}")

    return app


app = create_app()
