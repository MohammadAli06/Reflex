"""Fetch the verified schema from the trusted mock API and hash it.

The document is provenance-checked before it is trusted: a signature that does
not verify aborts the fetch, so nothing downstream can diff or patch against a
forged contract.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import httpx

from ..audit.canonical import canonical_hash
from ..mock_api.signing import SIGNATURE_HEADER

ExchangeSink = Callable[[dict[str, Any]], Any]


def _record_fetch_exchange(
    sink: ExchangeSink | None,
    *,
    url: str,
    response: httpx.Response | None,
    raw: dict[str, Any] | None,
    started: float,
    error: str | None = None,
) -> None:
    """Record the spec-fetch HTTP exchange; a failed fetch is recorded too."""
    if sink is None:
        return
    duration_s = time.perf_counter() - started
    headers: dict[str, str] = {}
    if response is not None:
        for name in ("content-type", SIGNATURE_HEADER):
            value = response.headers.get(name)
            if value is not None:
                headers[name] = value
    body = raw if raw is not None else (response.text if response is not None else None)
    record = {
        "step": "spec_fetch",
        "method": "GET",
        "url": url,
        "attempt": None,
        "request_headers": None,
        "request_body": None,
        "response_status": response.status_code if response is not None else None,
        "response_headers": headers or None,
        "response_body": body,
        "started_at": (
            datetime.now(timezone.utc) - timedelta(seconds=duration_s)
        ).isoformat(),
        "duration_ms": round(duration_s * 1000, 2),
        "error": error,
    }
    if body is not None and len(body if isinstance(body, str) else str(body)) > 4096:
        record["response_body"] = (
            body if isinstance(body, str) else str(body)
        )[:4096]
        record["truncated"] = True
    try:
        sink(record)
    except Exception:
        pass


class UntrustedSchemaError(RuntimeError):
    """The served schema could not be verified against the pinned key."""


def _template_matches(template: str, path: str) -> bool:
    """Match a concrete request path against an OpenAPI path template."""
    if template == path:
        return True
    parts = re.split(r"\{[^}]+\}", template)
    pattern = "[^/]+".join(re.escape(part) for part in parts)
    return re.fullmatch(pattern, path) is not None


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
    signature_verified: bool = False
    key_fingerprint: str = ""

    def request_schema(self, endpoint: str) -> dict:
        """Look up a request schema, resolving templated operation paths.

        The registry holds a *concrete* endpoint (path params substituted) while
        the served document keys schemas by template, so both must resolve.
        """
        schema = self.request_schemas.get(endpoint)
        if schema is not None:
            return schema
        for template, candidate in self.request_schemas.items():
            if "{" in template and _template_matches(template, endpoint):
                return candidate
        return {}


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


def fetch_verified(
    client: httpx.Client,
    path: str = "/openapi.json",
    *,
    pinned_public_key: str | None = None,
    require_signature: bool = False,
    exchange_sink: ExchangeSink | None = None,
) -> VerifiedSchema:
    """Fetch ``/openapi.json`` and optionally require a valid signature.

    ``pinned_public_key`` None/empty means "no pin configured": the signature is
    then accepted as unverified but the fetch still succeeds. When
    ``require_signature`` is set and no pin exists, the fetch refuses rather
    than silently trusting an unverifiable document.

    When ``exchange_sink`` is given, the HTTP exchange is reported to it (the
    spec fetch otherwise left no trace at all). A raw full-body text is
    included but capped, with ``truncated`` when the cap cut it.
    """
    url = str(client.base_url)
    if url.endswith("/"):
        url = url[:-1]
    url += path if path.startswith("/") else f"/{path}"
    started = time.perf_counter()
    try:
        response = client.get(path, timeout=5.0)
    except Exception as exc:
        _record_fetch_exchange(sink=exchange_sink, url=url, response=None, raw=None,
                               started=started, error=str(exc))
        raise

    try:
        response.raise_for_status()
    except Exception as exc:
        _record_fetch_exchange(sink=exchange_sink, url=url, response=response,
                               raw=None, started=started, error=str(exc))
        raise

    verified = parse_verified(response.json())
    _record_fetch_exchange(sink=exchange_sink, url=url, response=response,
                           raw=verified.raw, started=started, error=None)

    if not require_signature:
        return verified
    if not pinned_public_key:
        raise UntrustedSchemaError("no pinned public key configured; refusing an unverifiable schema")

    from ..mock_api.signing import verify_signature

    status = verify_signature(
        pinned_public_key, verified.raw, response.headers.get(SIGNATURE_HEADER, ""))
    if not status.ok:
        raise UntrustedSchemaError(status.error or "signature verification failed")
    verified.signature_verified = True
    verified.key_fingerprint = status.fingerprint
    return verified
