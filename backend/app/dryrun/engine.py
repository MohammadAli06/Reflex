"""Offline dry-run analysis: what WOULD the Reflex healer do with this drift?

Everything here is pure: pasted (never fetched) OpenAPI documents are parsed
with bounded inputs (size caps, JSON depth, local-only ``$ref``), the actual
rule pipeline is reused as functions (``classify``, ``diff_schemas``,
``hypothesize``, ``validate_patch``), and the result is returned - nothing is
persisted, audited, counted or sent anywhere.
"""
from __future__ import annotations

import copy
import json
from types import SimpleNamespace
from typing import Any

import yaml

from ..healing import reason_codes as rc
from ..healing.classifier import Category, classify
from ..healing.exchange import redact
from ..healing.hypothesize import CandidatePatch, apply_patch_to_definition, hypothesize
from ..healing.llm_fallback import (
    ProposerMeta,
    RepairProposer,
    build_repair_context_for_prompt,
    proposal_to_candidate_patch,
)
from ..healing.schema_diff import SchemaDiff, diff_schemas
from ..healing.schema_fetch import VerifiedSchema
from ..healing.secrets import StaticSecretsProvider
from ..healing.validate import validate_patch
from ..registry.executor import PreparedRequest
from ..registry.tools import ToolDefinition
from ..schema_utils import leaf_paths

DRYRUN_SPEC_MAX_BYTES = 524288          # 512 KB per document
DRYRUN_PAYLOAD_MAX_BYTES = 65536        # 64 KB per request/response body
MAX_JSON_DEPTH = 64

_LONGEST_REF_WALK = 200  # hard stop against reference cycles


class DryRunError(Exception):
    """Clean handler error carried through to a 4xx response."""

    def __init__(self, code: str, detail: str) -> None:
        self.code, self.detail = code, detail
        super().__init__(detail)


def check_depth(node: Any, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise DryRunError("payload_too_deep", f"input nests deeper than {MAX_JSON_DEPTH} levels")
    if isinstance(node, dict):
        for value in node.values():
            check_depth(value, depth + 1)
    elif isinstance(node, list):
        for value in node:
            check_depth(value, depth + 1)


def parse_spec_text(text: str, label: str) -> dict[str, Any]:
    """Parse a pasted OpenAPI document (JSON or YAML, safe_load only)."""
    if len(text.encode("utf-8")) > DRYRUN_SPEC_MAX_BYTES:
        raise DryRunError("payload_too_large", f"{label} exceeds {DRYRUN_SPEC_MAX_BYTES} bytes")
    spec: Any = None
    if text.strip().startswith("{"):
        try:
            spec = json.loads(text)
        except json.JSONDecodeError:
            raise DryRunError("invalid_spec", f"{label} is not valid JSON")
    else:
        try:
            spec = yaml.safe_load(text)
        except yaml.YAMLError as exc:
            raise DryRunError("invalid_spec", f"{label} could not be parsed as YAML: {exc}")
    if not isinstance(spec, dict):
        raise DryRunError("invalid_spec", f"{label} is not an OpenAPI object")
    try:
        check_depth(spec)
    except DryRunError as exc:
        raise DryRunError("payload_too_deep", f"{label}: {exc.detail}") from exc
    return spec


def _resolve_ref(spec: dict[str, Any], ref: str, seen: int = 0) -> dict[str, Any]:
    """Local-only reference resolution; remote refs are never fetched."""
    if ref.startswith("#/components/schemas/"):
        name = ref.rsplit("/", 1)[-1]
        schema = spec.get("components", {}).get("schemas", {}).get(name)
        if not isinstance(schema, dict):
            raise DryRunError("invalid_spec", f"unknown local reference {ref!r}")
        if seen >= _LONGEST_REF_WALK:
            raise DryRunError("payload_too_deep", "reference cycle detected while resolving")
        return _resolve_schema(spec, schema, seen + 1)
    if ref.startswith("#/"):
        raise DryRunError("unsupported_external_ref", f"only component schemas can be referenced: {ref!r}")
    raise DryRunError("unsupported_external_ref", f"remote reference {ref!r} would require a fetch - refused")


def _resolve_schema(spec: dict[str, Any], schema: dict[str, Any], seen: int = 0) -> dict[str, Any]:
    if "$ref" in schema:
        return _resolve_ref(spec, str(schema["$ref"]), seen)
    resolved = copy.deepcopy(schema)
    for key, value in list(resolved.items()):
        if isinstance(value, str):
            continue
        if key == "items" and isinstance(value, dict):
            resolved[key] = _resolve_schema(spec, value, seen + 1)
        elif key == "properties" and isinstance(value, dict):
            resolved[key] = {name: _resolve_schema(spec, child, seen + 1) for name, child in value.items()}
    return resolved


def list_operations(spec: dict[str, Any]) -> list[dict[str, str]]:
    """Every operation carrying a JSON request body: METHOD /path pairs."""
    out: list[dict[str, str]] = []
    paths = spec.get("paths")
    if not isinstance(paths, dict):
        return out
    for path, item in paths.items():
        if not isinstance(item, dict):
            continue
        for method, operation in item.items():
            if method.upper() not in {"GET", "POST", "PUT", "PATCH", "DELETE"}:
                continue
            if not isinstance(operation, dict):
                continue
            content = (operation.get("requestBody") or {}).get("content") if isinstance(operation.get("requestBody"), dict) else {}
            out.append({"method": method.upper(), "path": path, "has_json_body": "application/json" in content})
    return out


def extract_operation(spec: dict[str, Any], operation: str, *, require_body: bool = True) -> dict[str, Any]:
    """Resolve one 'METHOD /path' operation into schema + required headers."""
    if len(" ".join(operation.split())) != len(operation) or " " not in operation.strip():
        raise DryRunError("unknown_operation", f"operation must be 'METHOD /path': {operation!r}")
    method, _, path = operation.strip().partition(" ")
    method = method.upper()
    item = (spec.get("paths") or {}).get(path)
    if not isinstance(item, dict) or method.lower() not in item:
        available = [f"{l['method']} {l['path']}" for l in list_operations(spec)]
        hint = f" (available: {', '.join(available[:8])})" if available else ""
        raise DryRunError("unknown_operation", f"{method} {path} is not in the document{hint}")
    op = item[method.lower()]
    content = (op.get("requestBody") or {}).get("content")
    if require_body and (not isinstance(content, dict) or "application/json" not in content):
        raise DryRunError("unknown_operation", f"{method} {path} does not use an application/json request body")
    request_schema = {}
    if isinstance(content, dict) and "application/json" in content:
        raw_schema = content["application/json"].get("schema", {})
        request_schema = _resolve_schema(spec, raw_schema if isinstance(raw_schema, dict) else {})
    headers = [
        {"name": param.get("name"), "required": True, "schema": _resolve_schema(spec, param.get("schema") or {})}
        for param in op.get("parameters", []) or []
        if isinstance(param, dict) and param.get("in") == "header" and param.get("required")
    ]
    return {"method": method, "path": path, "request_schema": request_schema, "required_headers": headers}


def build_definition(name: str, old: dict[str, Any]) -> ToolDefinition:
    """The tool as it was BEFORE the drift, mirroring runner/realworld.build_definitions."""
    endpoint = old["path"]
    schema = old["request_schema"]
    props = schema.get("properties", {}) if isinstance(schema, dict) else {}
    bindings = {
        field: {"source": "arg", "arg": field, "convert": None}
        for field in sorted(props.keys())
    }
    return ToolDefinition(
        name=name,
        endpoint=endpoint,
        method="POST",
        request_schema=schema,
        required_headers=list(old["required_headers"]),
        response_schema={},
        bindings=bindings,
        response_map={},
        write=False,
        revision=1,
    )


def offline_verified_schema(endpoint: str, new_op: dict[str, Any]) -> VerifiedSchema:
    """A VerifiedSchema created from a pasted document; no fetch ever happens."""
    return VerifiedSchema(
        version=1,
        sha256="dryrun",
        raw={},
        request_schemas={endpoint: new_op["request_schema"]},
        required_headers=list(new_op["required_headers"]),
        response_schemas={},
        error_style="clear",
        missing_header_status=422,
    )


def flatten_args(schema: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """Leaf-path -> value map of the ORIGINAL request body (never invented)."""
    args: dict[str, Any] = {}
    for path in leaf_paths(schema):
        segments = path.split(".")
        cursor: Any = body
        for segment in segments:
            if not isinstance(cursor, dict) or segment not in cursor:
                break
            cursor = cursor[segment]
        else:
            args[path] = cursor
    return args


def check_payload_size(text: str, label: str) -> None:
    if len(text.encode("utf-8")) > DRYRUN_PAYLOAD_MAX_BYTES:
        raise DryRunError("payload_too_large", f"{label} exceeds {DRYRUN_PAYLOAD_MAX_BYTES} bytes")


def _candidate_view(patch: CandidatePatch) -> dict[str, Any]:
    return {
        "new_bindings": patch.new_bindings,
        "new_required_headers": patch.new_required_headers,
        "conversions": patch.conversions,
        "evidence": patch.evidence,
        "confidence": patch.confidence,
    }


def _refuse_view(outcome: str, reason_code: str | None, patch: CandidatePatch | None,
                 classification: str, diff: SchemaDiff | None,
                 validation: dict[str, Any] | None, source: str = "rule",
                 missing_values: list[str] | None = None) -> dict[str, Any]:
    return {
        "kind": "dryrun",
        "outcome": outcome,
        "source": source,
        "reason_code": reason_code,
        "drift_classification": classification,
        "diff": diff.to_event_data() if diff else None,
        "candidate": _candidate_view(patch) if patch and not patch.refused else None,
        "validation": validation,
        "corrected_request": None,
        "missing_values": missing_values or [],
    }


def _llm_provider_call(
    proposer: RepairProposer | None,
    definition: ToolDefinition,
    verified: VerifiedSchema,
    diff: SchemaDiff,
    error_status: Any,
    error_body: Any,
    args: dict[str, Any],
    secret_values: list[str],
) -> tuple[CandidatePatch | None, str | None, dict[str, Any] | None, list[str]]:
    """One gated LLM proposal attempt; returns (patch, refusal, meta, detail)."""
    if proposer is None:
        return None, None, None, []
    if error_status is None:
        return None, None, None, []
    call = SimpleNamespace(status=error_status, ok=False, body=error_body, raw_text="", error_type=None)
    context = build_repair_context_for_prompt(
        definition, verified, diff, call, args=args, secret_values=secret_values,
    )
    outcome = proposer.propose_repair(context)
    meta = (outcome.meta or ProposerMeta()).to_dict()
    meta["source"] = "llm"
    if outcome.proposal is None:
        return None, outcome.reason_code or rc.LLM_UNAVAILABLE, meta, [outcome.detail]
    patch, refusal, errors = proposal_to_candidate_patch(outcome.proposal, definition, verified, args)
    if patch is None:
        return None, refusal, meta, errors
    return patch, None, meta, []


def analyze(
    *,
    old_spec_text: str,
    new_spec_text: str,
    operation: str,
    original_request: dict[str, Any],
    error: dict[str, Any],
    proposer: RepairProposer | None = None,
) -> dict[str, Any]:
    """Full offline analysis; raises DryRunError for clean 4xx mapping."""
    old_spec = parse_spec_text(old_spec_text, "old_spec")
    new_spec = parse_spec_text(new_spec_text, "new_spec")

    request_text = json.dumps(original_request.get("body"), ensure_ascii=False) if original_request.get("body") is not None else ""
    error_text = json.dumps(error.get("body"), ensure_ascii=False) if error.get("body") is not None else ""
    check_payload_size(request_text, "original request body")
    check_payload_size(error_text, "error body")

    old_op = extract_operation(old_spec, operation)
    new_op = extract_operation(new_spec, operation)
    endpoint = old_op["path"]

    definition = build_definition("dryrun_tool", old_op)
    args = flatten_args(old_op["request_schema"], original_request.get("body") or {})
    original_headers = original_request.get("headers") or {}
    secrets = StaticSecretsProvider(
        {str(name).lower(): str(value) for name, value in original_headers.items()}
    )
    secret_values = [str(v) for v in original_headers.values()]

    classification = classify(error.get("status"), error.get("error_type")).value
    verified = offline_verified_schema(endpoint, new_op)

    if classification not in (Category.POSSIBLE_DRIFT.value, Category.AUTH.value):
        return _refuse_view("no_drift", rc.NOT_DRIFT, None, classification, None, None)

    diff = diff_schemas(
        endpoint, definition.request_schema, verified.request_schema(endpoint),
        definition.required_headers, verified.required_headers,
    )
    if diff.is_empty:
        return _refuse_view("no_drift", rc.NOT_DRIFT, None, classification, None, None)

    candidate = hypothesize(definition, verified, diff, secrets, args)
    source = "rule"
    llm_meta: dict[str, Any] | None = None

    if candidate.refused:
        missing_values: list[str] = []
        if candidate.reason_code == rc.MISSING_REQUIRED_VALUE:
            missing_values = [
                item.split("required field ", 1)[1].split(" has", 1)[0]
                for item in candidate.evidence
                if "has no approved value source" in item
            ]
        if candidate.reason_code in rc.LLM_ELIGIBLE_CODES:
            llm_patch, llm_refusal, llm_meta, llm_errors = _llm_provider_call(
                proposer, definition, verified, diff, error.get("status"),
                error.get("body"), args, secret_values,
            )
            if llm_patch is not None:
                candidate = llm_patch
                source = "llm"
                if llm_meta:
                    llm_meta["verdict"] = "proposed"
            elif llm_refusal:
                return _refuse_view(
                    "refused", llm_refusal, None, classification, diff, None,
                    source="llm", missing_values=[],
                ) | {"llm_meta": llm_meta, "detail": llm_errors}
        refused = _refuse_view(
            "refused", candidate.reason_code, None, classification, diff, None,
            missing_values=missing_values,
        )
        return refused

    patched_def = apply_patch_to_definition(definition, candidate, verified)
    validation = validate_patch(patched_def, verified, args, secrets, dry_run=True)
    validation_view = {
        "ok": validation.ok,
        "errors": validation.errors,
        "reason_code": validation.reason_code,
        "needs_human": validation.needs_human,
    }
    if not validation.ok:
        refused = _refuse_view(
            "refused", validation.reason_code, candidate, classification, diff, validation_view,
            source=source,
        )
        if source == "llm" and llm_meta:
            llm_meta["verdict"] = "validation_failed"
            refused["llm_meta"] = llm_meta
        return refused

    prepared: PreparedRequest = validation.prepared  # type: ignore[assignment]
    corrected = {
        "method": prepared.method,
        "path": prepared.endpoint,
        "headers": prepared.redacted(),  # names + provenance, no values
        "body": redact(prepared.body),
    }
    proposed = {
        "kind": "dryrun",
        "outcome": "proposed",
        "source": source,
        "reason_code": None,
        "drift_classification": classification,
        "diff": diff.to_event_data(),
        "candidate": _candidate_view(candidate),
        "validation": validation_view,
        "corrected_request": corrected,
        "missing_values": [],
        "before_definition": redact(definition.to_dict()),
        "after_definition": redact(patched_def.to_dict()),
    }
    if source == "llm" and llm_meta:
        llm_meta["verdict"] = "applied"
        proposed["llm_meta"] = llm_meta
    return proposed
