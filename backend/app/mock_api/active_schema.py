"""The single in-memory source of truth for the mock API.

``ActiveSchema`` is deliberately independent from FastAPI's own OpenAPI
generation: both real request validation and ``/openapi.json`` are derived
from exactly this object, so they can never silently diverge.
"""
from __future__ import annotations

import copy
import threading
from dataclasses import dataclass, field
from typing import Any

JSONSchema = dict[str, Any]

ERROR_STYLES = {"clear", "vague", "none"}

FETCH_ENDPOINT = "/user/fetch"
UPDATE_ENDPOINT = "/user/update"


def obj_schema(properties: dict[str, JSONSchema], required: list[str] | None = None,
               additional: bool = False) -> JSONSchema:
    """Build a simple object JSON schema."""
    return {
        "type": "object",
        "properties": properties,
        "required": list(required) if required is not None else sorted(properties),
        "additionalProperties": additional,
    }


def string(description: str | None = None) -> JSONSchema:
    s: JSONSchema = {"type": "string"}
    if description:
        s["description"] = description
    return s


def integer(description: str | None = None) -> JSONSchema:
    s: JSONSchema = {"type": "integer"}
    if description:
        s["description"] = description
    return s


@dataclass
class HeaderRequirement:
    name: str
    format: str | None = None  # e.g. "opaque-token", "uuid", "non-empty-string"

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "format": self.format}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "HeaderRequirement":
        return cls(name=d["name"], format=d.get("format"))


@dataclass
class ActiveSchemaState:
    version: int
    request_schemas: dict[str, JSONSchema]
    required_headers: list[HeaderRequirement]
    response_schemas: dict[str, JSONSchema]
    error_style: str = "clear"
    missing_header_status: int = 401

    def to_dict(self) -> dict[str, Any]:
        return {
            "version": self.version,
            "request_schemas": copy.deepcopy(self.request_schemas),
            "required_headers": [h.to_dict() for h in self.required_headers],
            "response_schemas": copy.deepcopy(self.response_schemas),
            "error_style": self.error_style,
            "missing_header_status": self.missing_header_status,
        }

    def clone(self, **changes: Any) -> "ActiveSchemaState":
        data = self.to_dict()
        data.update(changes)
        return ActiveSchemaState.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ActiveSchemaState":
        return cls(
            version=data["version"],
            request_schemas=copy.deepcopy(data["request_schemas"]),
            required_headers=[HeaderRequirement.from_dict(h) for h in data["required_headers"]],
            response_schemas=copy.deepcopy(data["response_schemas"]),
            error_style=data.get("error_style", "clear"),
            missing_header_status=data.get("missing_header_status", 401),
        )


def initial_state(version: int = 1) -> ActiveSchemaState:
    """The starting schema (v1) used before any mutation."""
    request_schemas = {
        FETCH_ENDPOINT: obj_schema({"user_id": string("Identifier of the user to fetch")}),
        UPDATE_ENDPOINT: obj_schema(
            {
                "user_id": string("Identifier of the user to update"),
                "display_name": string("New display name"),
            }
        ),
    }
    response_schemas = {
        FETCH_ENDPOINT: obj_schema(
            {
                "data": obj_schema(
                    {"name": string(), "email": string()}, required=["name", "email"]
                )
            },
            required=["data"],
        ),
        UPDATE_ENDPOINT: obj_schema(
            {"data": obj_schema({"ok": {"type": "boolean"}}, required=["ok"])},
            required=["data"],
        ),
    }
    return ActiveSchemaState(
        version=version,
        request_schemas=request_schemas,
        required_headers=[],
        response_schemas=response_schemas,
        error_style="clear",
        missing_header_status=401,
    )


class ActiveSchema:
    """Thread-safe holder for the active schema state."""

    def __init__(self, state: ActiveSchemaState | None = None) -> None:
        self._lock = threading.RLock()
        self._state = state or initial_state()

    @classmethod
    def from_openapi(cls, spec: dict[str, Any], operation: str) -> "ActiveSchema":
        """Create an active contract from one JSON-body OpenAPI operation.

        ``operation`` is ``"METHOD /path"``.  Multipart and non-JSON bodies
        deliberately fail closed: this mock only validates JSON requests.
        """
        try:
            method, endpoint = operation.split(" ", 1)
            op = spec["paths"][endpoint][method.lower()]
            media = op["requestBody"]["content"]["application/json"]
        except (KeyError, ValueError, TypeError) as exc:
            raise ValueError(f"operation must expose an application/json body: {operation}") from exc
        schema = copy.deepcopy(media.get("schema", {}))
        if "$ref" in schema:
            ref = schema["$ref"]
            if not ref.startswith("#/components/schemas/"):
                raise ValueError("only local component references are supported")
            name = ref.rsplit("/", 1)[-1]
            try:
                schema = copy.deepcopy(spec["components"]["schemas"][name])
            except KeyError as exc:
                raise ValueError(f"missing component schema {name}") from exc
        headers = [HeaderRequirement(name=p["name"], format=p.get("schema", {}).get("format"))
                   for p in op.get("parameters", []) if p.get("in") == "header" and p.get("required")]
        response = (op.get("responses", {}).get("200", {}).get("content", {})
                    .get("application/json", {}).get("schema", {"type": "object"}))
        version = int(spec.get("x-schema-version", 1))
        return cls(ActiveSchemaState(version=version, request_schemas={endpoint: schema},
                                     required_headers=headers, response_schemas={endpoint: response}))

    def snapshot(self) -> ActiveSchemaState:
        with self._lock:
            return self._state.clone()

    @property
    def version(self) -> int:
        with self._lock:
            return self._state.version

    @property
    def error_style(self) -> str:
        with self._lock:
            return self._state.error_style

    def apply(self, new_state: ActiveSchemaState, *, require_version_bump: bool = True) -> ActiveSchemaState:
        """Atomically replace the state (used by mutations and reset)."""
        with self._lock:
            if require_version_bump and new_state.version <= self._state.version:
                raise ValueError(
                    f"version must increase: {new_state.version} <= {self._state.version}"
                )
            self._state = new_state.clone()
            return self._state.clone()

    def set_error_style(self, style: str) -> ActiveSchemaState:
        if style not in ERROR_STYLES:
            raise ValueError(f"unknown error style {style!r}")
        with self._lock:
            self._state = self._state.clone(error_style=style)
            return self._state.clone()

    def reset(self) -> ActiveSchemaState:
        """Reset to the initial schema, always with a strictly higher version."""
        with self._lock:
            next_version = self._state.version + 1
            self._state = initial_state(version=next_version)
            return self._state.clone()
