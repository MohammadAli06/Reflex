"""Generate ``/openapi.json`` from the live :class:`ActiveSchema`.

The document is rebuilt on every request. It includes the active version and a
structured ``x-active-schema`` block so the healing layer can read the verified
schema (request schemas, required headers, response schemas, error style).
Admin routes are never listed.
"""
from __future__ import annotations

import copy
from typing import Any

from .active_schema import ActiveSchemaState, FETCH_ENDPOINT, UPDATE_ENDPOINT


def _component_name(endpoint: str) -> str:
    return endpoint.strip("/").replace("/", "_") + "_request"


def build_openapi(state: ActiveSchemaState) -> dict[str, Any]:
    paths: dict[str, Any] = {}
    components: dict[str, Any] = {}

    for endpoint, schema in state.request_schemas.items():
        comp = _component_name(endpoint)
        components[comp] = copy.deepcopy(schema)
        paths[endpoint] = {
            "post": {
                "operationId": comp.replace("_request", ""),
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/json": {"schema": {"$ref": f"#/components/schemas/{comp}"}}
                    },
                },
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": copy.deepcopy(state.response_schemas.get(endpoint, {}))
                            }
                        },
                    },
                    str(state.missing_header_status): {"description": "Missing required header"},
                    "422": {"description": "Request body failed schema validation"},
                },
                "parameters": [
                    {
                        "name": h.name,
                        "in": "header",
                        "required": True,
                        "schema": {"type": "string"},
                        "description": f"Required credential header ({h.format})" if h.format else "Required credential header",
                    }
                    for h in state.required_headers
                ],
            }
        }

    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Mock Drift API",
            "version": str(state.version),
        },
        "x-schema-version": state.version,
        # Verified schema consumed by the healing layer. Generated, never stored stale.
        "x-active-schema": state.to_dict(),
        "paths": paths,
        "components": {"schemas": components},
    }


def known_endpoints() -> list[str]:
    return [FETCH_ENDPOINT, UPDATE_ENDPOINT]
