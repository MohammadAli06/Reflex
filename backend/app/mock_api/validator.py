"""Raw-body and header validation driven by :class:`ActiveSchema`.

No Pydantic body models are used for the mutable endpoints: bodies are read
as raw JSON and validated with ``jsonschema`` against the active schema.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from jsonschema import Draft202012Validator

from .active_schema import ActiveSchemaState


@dataclass
class ValidationOutcome:
    ok: bool
    status: int
    detail: str
    errors: list[str]

    def error_body(self, style: str) -> dict[str, Any]:
        """Shape the error body according to the active error style."""
        if self.ok:
            return {}
        if style == "clear":
            return {"error": "validation_failed", "detail": self.detail, "errors": self.errors}
        if style == "vague":
            return {"error": "request_rejected"}
        # "none" -> minimal/empty hint
        return {}


def _header_lookup(headers: dict[str, str], name: str) -> str | None:
    for key, value in headers.items():
        if key.lower() == name.lower():
            return value
    return None


def check_headers(state: ActiveSchemaState, headers: dict[str, str]) -> ValidationOutcome:
    missing = []
    for req in state.required_headers:
        value = _header_lookup(headers, req.name)
        if value is None or value.strip() == "":
            missing.append(req.name)
    if missing:
        return ValidationOutcome(
            ok=False,
            status=state.missing_header_status,
            detail="missing required header(s): " + ", ".join(missing),
            errors=[f"header {name} is required" for name in missing],
        )
    return ValidationOutcome(ok=True, status=200, detail="", errors=[])


def validate_body(state: ActiveSchemaState, endpoint: str, body: Any) -> ValidationOutcome:
    schema = state.request_schemas.get(endpoint)
    if schema is None:
        return ValidationOutcome(
            ok=False, status=404, detail=f"unknown endpoint {endpoint}", errors=[]
        )
    validator = Draft202012Validator(schema)
    errors = sorted(validator.iter_errors(body), key=lambda e: list(e.path))
    if errors:
        details = []
        for err in errors:
            loc = "/".join(str(p) for p in err.path) or "<root>"
            details.append(f"{loc}: {err.message}")
        return ValidationOutcome(
            ok=False,
            status=422,
            detail="request body does not match the active schema",
            errors=details,
        )
    return ValidationOutcome(ok=True, status=200, detail="", errors=[])


def validate_request(
    state: ActiveSchemaState,
    endpoint: str,
    body: Any,
    headers: dict[str, str],
) -> ValidationOutcome:
    """Validate headers first, then the body, against the active schema."""
    header_outcome = check_headers(state, headers)
    if not header_outcome.ok:
        return header_outcome
    return validate_body(state, endpoint, body)


def sample_response(schema: dict[str, Any]) -> Any:
    """Build a valid example response instance from a response schema.

    Field meaning is inferred from the leaf name so that response nesting
    mutations actually change the shape returned to the caller.
    """

    def fill(name: str, sub: dict[str, Any]) -> Any:
        if sub.get("type") == "object" or "properties" in sub:
            return {key: fill(key, value) for key, value in sub.get("properties", {}).items()}
        if sub.get("type") == "boolean":
            return True
        if sub.get("type") == "integer":
            return 1
        if sub.get("type") == "number":
            return 1.0
        if sub.get("type") == "array":
            return []
        lowered = name.lower()
        if "email" in lowered:
            return "ada@example.com"
        if "name" in lowered:
            return "Ada Lovelace"
        return f"{name}-value"

    return fill("root", schema)
