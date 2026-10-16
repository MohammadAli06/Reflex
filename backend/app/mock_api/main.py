"""The mock "third-party" API (port 8000).

Validation and ``/openapi.json`` both come from a single :class:`ActiveSchema`.
Admin routes (mutate/reset/fault) require the backend-only admin key, are not
listed in ``/openapi.json``, and are never reachable by agents.
"""
from __future__ import annotations

import asyncio
import copy
from dataclasses import dataclass, field
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from ..config import Settings, get_settings
from .active_schema import ActiveSchema, ActiveSchemaState, FETCH_ENDPOINT, UPDATE_ENDPOINT
from .faults import FaultController, list_faults
from .mutations import apply_mutation, list_mutations
from .openapi_gen import build_openapi
from .signing import SIGNATURE_HEADER, SchemaSigner
from .validator import sample_response, validate_request

MUTABLE_ENDPOINTS = {FETCH_ENDPOINT, UPDATE_ENDPOINT}


@dataclass
class MockState:
    schema: ActiveSchema = field(default_factory=ActiveSchema)
    faults: FaultController = field(default_factory=FaultController)
    last_payloads: dict[str, dict[str, Any]] = field(default_factory=dict)
    call_counts: dict[str, int] = field(default_factory=dict)
    signer: SchemaSigner = field(default_factory=SchemaSigner)
    tampered: bool = False
    tamper_document: dict[str, Any] | None = None

    def record_payload(self, endpoint: str, body: Any, header_names: list[str], dry_run: bool) -> None:
        self.last_payloads[endpoint] = {
            "endpoint": endpoint,
            "body": body,
            "header_names": sorted(header_names),
            "dry_run": dry_run,
            "ok": True,
        }
        self.call_counts[endpoint] = self.call_counts.get(endpoint, 0) + 1

    @property
    def mutable_endpoints(self) -> set[str]:
        """Every endpoint the active schema validates, not just the built-ins."""
        return set(self.schema.snapshot().request_schemas)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    state = MockState()
    app = FastAPI(title="Mock Drift API", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.mock = state

    def require_admin(x_admin_key: str | None = Header(default=None)) -> None:
        if not settings.admin_key or x_admin_key != settings.admin_key:
            raise HTTPException(status_code=401, detail="invalid admin key")

    async def _read_json(request: Request) -> Any:
        try:
            return await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="body is not valid JSON")

    async def _fault_response(endpoint: str):
        """Return a fault response, or ``None`` to continue normally."""
        mode = state.faults.mode
        if mode is None or endpoint not in state.mutable_endpoints:
            return None
        if mode == "http500":
            return JSONResponse(status_code=500, content={"error": "internal_error"})
        if mode == "http429":
            return JSONResponse(
                status_code=429, content={"error": "rate_limited"}, headers={"Retry-After": "1"}
            )
        if mode == "reject_credential":
            return JSONResponse(status_code=401, content={"error": "invalid_credential"})
        if mode == "timeout":
            delay = state.faults.timeout_ms / 1000.0
            if delay:
                await asyncio.sleep(delay)
            return JSONResponse(status_code=504, content={"error": "gateway_timeout"})
        return None

    async def _handle_endpoint(endpoint: str, request: Request, *, strip_dry_run: bool = False,
                               record_key: str | None = None):
        """Validate and serve one active endpoint. Used by real spec-loaded routes.

        ``endpoint`` is the schema key (a path template for spec operations);
        ``record_key`` is the concrete request path callers read back, so the
        runner can look up the payload it actually sent.
        """
        fault = await _fault_response(endpoint)
        if fault is not None:
            return fault
        body = await _read_json(request)
        dry_run = False
        if strip_dry_run and isinstance(body, dict) and "dry_run" in body:
            dry_run = bool(body.get("dry_run"))
            body = {k: v for k, v in body.items() if k != "dry_run"}
        active = state.schema.snapshot()
        outcome = validate_request(active, endpoint, body, dict(request.headers))
        if not outcome.ok:
            return JSONResponse(status_code=outcome.status, content=outcome.error_body(active.error_style))
        state.record_payload(record_key or endpoint, body, list(request.headers.keys()), dry_run)
        response = sample_response(active.response_schemas.get(endpoint, {}))
        if strip_dry_run and isinstance(response, dict) and isinstance(response.get("data"), dict):
            response["data"]["dry_run"] = dry_run
        return response

    async def _handle_fetch(request: Request):
        return await _handle_endpoint(FETCH_ENDPOINT, request)

    async def _handle_update(request: Request):
        return await _handle_endpoint(UPDATE_ENDPOINT, request, strip_dry_run=True)

    def _make_spec_handler(path: str):
        async def _handler(request: Request):
            return await _handle_endpoint(path, request, record_key=request.url.path)
        return _handler

    @app.post(FETCH_ENDPOINT)
    async def fetch(request: Request):
        return await _handle_fetch(request)

    @app.post(UPDATE_ENDPOINT)
    async def update(request: Request):
        return await _handle_update(request)

    @app.get("/health")
    async def health():
        return {"status": "ok", "version": state.schema.version}

    @app.get("/openapi.json")
    async def openapi():
        """Serve the active document, signed.

        The signature is always taken over the *honest* document. When the
        controlled tamper demo is on, the body served diverges from what was
        signed - exactly what an attacker who can rewrite a response but does
        not hold the private key can achieve.
        """
        honest = build_openapi(state.schema.snapshot())
        signature = state.signer.sign(honest)
        document = state.tamper_document or honest
        return JSONResponse(content=document, headers={SIGNATURE_HEADER: signature})

    # --- admin routes (not in /openapi.json, backend key only) ------------
    @app.post("/admin/mutate", dependencies=[Depends(require_admin)])
    async def admin_mutate(payload: dict):
        mutation_id = payload.get("mutation_id")
        if not mutation_id:
            raise HTTPException(status_code=400, detail="mutation_id is required")
        active = state.schema.snapshot()
        try:
            new_state = apply_mutation(active, mutation_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        applied = state.schema.apply(new_state)
        style = payload.get("error_style")
        if style:
            applied = state.schema.set_error_style(style)
        state.faults.clear()
        return {"version": applied.version, "state": applied.to_dict()}

    @app.post("/admin/reset", dependencies=[Depends(require_admin)])
    async def admin_reset():
        state.faults.clear()
        reset_state = state.schema.reset()
        return {"version": reset_state.version, "state": reset_state.to_dict()}

    @app.post("/admin/fault", dependencies=[Depends(require_admin)])
    async def admin_fault(payload: dict | None = None):
        payload = payload or {}
        state.faults.set(payload.get("mode"), payload.get("timeout_ms"))
        return {"fault": state.faults.mode}

    @app.post("/admin/style", dependencies=[Depends(require_admin)])
    async def admin_style(payload: dict):
        style = payload.get("error_style")
        if not style:
            raise HTTPException(status_code=400, detail="error_style is required")
        try:
            updated = state.schema.set_error_style(style)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        return {"error_style": updated.error_style}

    @app.post("/admin/load_openapi", dependencies=[Depends(require_admin)])
    async def admin_load_openapi(payload: dict):
        """Serve one operation from a real OpenAPI document (real-world harness)."""
        spec = payload.get("spec")
        operation = payload.get("operation")
        if not isinstance(spec, dict) or not operation:
            raise HTTPException(status_code=400, detail="spec and operation are required")
        try:
            loaded = ActiveSchema.from_openapi(spec, operation)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        # The served version must always move forward, so a case can be re-run
        # against the same vendored spec without weakening the bump invariant.
        loaded = ActiveSchema(loaded.snapshot().clone(
            version=state.schema.version + 1))
        method, endpoint = operation.split(" ", 1)
        if method.upper() != "POST":
            raise HTTPException(status_code=400, detail="only POST operations are served")
        state.faults.clear()
        state.tamper_document = None
        state.tampered = False
        try:
            applied = state.schema.apply(loaded.snapshot())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        if not any(getattr(route, "path", None) == endpoint for route in app.routes):
            app.add_api_route(endpoint, _make_spec_handler(endpoint), methods=["POST"])
        return {"version": applied.version, "endpoint": endpoint,
                "state": applied.to_dict()}

    @app.post("/admin/tamper", dependencies=[Depends(require_admin)])
    async def admin_tamper(payload: dict | None = None):
        """Controlled demo: serve a document whose signature cannot be verified.

        Validation keeps using the real active schema, so a caller that trusts
        the served document would patch against a lie. The healer must refuse.
        """
        payload = payload or {}
        if payload.get("revert"):
            state.tamper_document = None
            state.tampered = False
            return {"tampered": False}
        honest = build_openapi(state.schema.snapshot())
        forged = copy.deepcopy(honest)
        for schema in forged.get("x-active-schema", {}).get("request_schemas", {}).values():
            if isinstance(schema, dict):
                schema["properties"] = {"attacker_injected_field": {"type": "string"}}
                schema["required"] = ["attacker_injected_field"]
        forged["x-schema-version"] = int(forged.get("x-schema-version", 1)) + 1
        state.tamper_document = forged
        state.tampered = True
        return {"tampered": True, "served_version": forged["x-schema-version"]}

    @app.get("/admin/state", dependencies=[Depends(require_admin)])
    async def admin_state():
        active: ActiveSchemaState = state.schema.snapshot()
        return {
            "version": active.version,
            "fault": state.faults.mode,
            "error_style": active.error_style,
            "call_counts": dict(state.call_counts),
            "state": active.to_dict(),
        }

    @app.get("/admin/last_payload/{endpoint:path}", dependencies=[Depends(require_admin)])
    async def admin_last_payload(endpoint: str):
        key = "/" + endpoint.lstrip("/")
        return state.last_payloads.get(key, {})

    @app.get("/admin/catalog", dependencies=[Depends(require_admin)])
    async def admin_catalog():
        return {"mutations": list_mutations(), "faults": list_faults(),
                "schema_public_key": state.signer.public_key_hex,
                "schema_key_fingerprint": state.signer.fingerprint}

    return app


app = create_app()
