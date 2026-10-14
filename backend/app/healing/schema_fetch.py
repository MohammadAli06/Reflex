"""Fetch the verified schema from the trusted mock API and hash it."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from ..audit.canonical import canonical_hash


@dataclass
class VerifiedSchema:
    version: int
    sha256: str
    raw: dict[str, Any]
    request_schemas: dict[str, dict]
    required_headers: list[dict[str, Any]]
    response_schemas: dict[str, dict]
    error_style: str
    missing_header_status: int

    def request_schema(self, endpoint: str) -> dict:
        return self.request_schemas.get(endpoint, {})


def parse_verified(openapi: dict[str, Any]) -> VerifiedSchema:
    active = openapi.get("x-active-schema")
    if not active:
        raise ValueError("openapi document has no x-active-schema block")
    return VerifiedSchema(
        version=int(active.get("version", openapi.get("x-schema-version", 0))),
        sha256=canonical_hash(active),
        raw=openapi,
        request_schemas=active.get("request_schemas", {}),
        required_headers=active.get("required_headers", []),
        response_schemas=active.get("response_schemas", {}),
        error_style=active.get("error_style", "clear"),
        missing_header_status=active.get("missing_header_status", 401),
    )


def fetch_verified(client: httpx.Client, path: str = "/openapi.json") -> VerifiedSchema:
    response = client.get(path, timeout=5.0)
    response.raise_for_status()
    return parse_verified(response.json())
