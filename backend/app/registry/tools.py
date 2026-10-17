"""Tool definition model and initial definitions.

A tool definition describes *how to build a request* from task arguments. It
contains bindings (mappings/conversions) only - never values.

``bindings`` maps a request body leaf path to a source:
    {"source": "arg", "arg": "user_id", "convert": null}
    {"source": "const", "value": "..."}          # approved non-secret source
Header credentials are never stored here; they are resolved from the secrets
provider at call time.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from ..mock_api.active_schema import (
    FETCH_ENDPOINT,
    UPDATE_ENDPOINT,
    obj_schema,
    string,
)


@dataclass
class ToolDefinition:
    name: str
    endpoint: str
    method: str
    request_schema: dict[str, Any]
    required_headers: list[dict[str, Any]]
    response_schema: dict[str, Any]
    bindings: dict[str, dict[str, Any]]
    response_map: dict[str, str]
    write: bool = False
    revision: int = 1

    def to_dict(self) -> dict[str, Any]:
        return copy.deepcopy(self.__dict__)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ToolDefinition":
        return cls(**copy.deepcopy(data))

    def copy_with(self, **changes: Any) -> "ToolDefinition":
        data = self.to_dict()
        data.update(changes)
        return ToolDefinition.from_dict(data)


def definition_snapshot(definition: "ToolDefinition") -> dict[str, Any]:
    """Record the definition as it was at run start (the stale view)."""
    return {
        "name": definition.name,
        "revision": definition.revision,
        "endpoint": definition.endpoint,
        "method": definition.method,
        "request_schema": definition.request_schema,
        "required_headers": [h.get("name") for h in definition.required_headers],
    }


def _fetch_definition() -> ToolDefinition:
    return ToolDefinition(
        name="fetch_user",
        endpoint=FETCH_ENDPOINT,
        method="POST",
        request_schema=obj_schema({"user_id": string("Identifier of the user to fetch")}),
        required_headers=[],
        response_schema=obj_schema(
            {"data": obj_schema({"name": string(), "email": string()}, required=["name", "email"])},
            required=["data"],
        ),
        bindings={"user_id": {"source": "arg", "arg": "user_id", "convert": None}},
        response_map={"name": "data.name", "email": "data.email"},
        write=False,
        revision=1,
    )


def _update_definition() -> ToolDefinition:
    return ToolDefinition(
        name="update_user",
        endpoint=UPDATE_ENDPOINT,
        method="POST",
        request_schema=obj_schema(
            {
                "user_id": string("Identifier of the user to update"),
                "display_name": string("New display name"),
            }
        ),
        required_headers=[],
        response_schema=obj_schema(
            {"data": obj_schema({"ok": {"type": "boolean"}}, required=["ok"])}, required=["data"]
        ),
        bindings={
            "user_id": {"source": "arg", "arg": "user_id", "convert": None},
            "display_name": {"source": "arg", "arg": "display_name", "convert": None},
        },
        response_map={"ok": "data.ok"},
        write=True,
        revision=1,
    )


def initial_definitions() -> dict[str, ToolDefinition]:
    fetch = _fetch_definition()
    update = _update_definition()
    return {fetch.name: fetch, update.name: update}
