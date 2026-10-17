"""HTTP exchange records: what was really sent and received, stored redacted.

One reusable :func:`redact` covers everything (trace events, exchanges, audit).
Large payloads are capped with a ``truncated`` flag instead of being dropped.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

# Exact sensitive header/field names plus substring rules for anything else.
_SENSITIVE_HEADERS = {"authorization", "cookie", "x-api-key", "proxy-authorization"}
_SENSITIVE_KEY_PARTS = (
    "token", "secret", "password", "api_key", "api-key", "apikey",
    "authorization", "credential", "cookie", "key",
)
REDACTED = "[REDACTED]"

#: Per-field byte cap for exchange text fields.
BODY_CAP_BYTES = 4096


def is_sensitive_key(key: str) -> bool:
    lowered = str(key).lower()
    if lowered in _SENSITIVE_HEADERS:
        return True
    return any(part in lowered for part in _SENSITIVE_KEY_PARTS)


def redact(obj: Any) -> Any:
    """Deep-redact sensitive keys and string values. One reusable entry point."""
    if isinstance(obj, dict):
        result = {}
        for key, value in obj.items():
            if is_sensitive_key(key) and value not in (None, [], {}):
                result[key] = REDACTED
            else:
                result[key] = redact(value)
        return result
    if isinstance(obj, list):
        return [redact(value) for value in obj]
    return obj


def cap_text(value: Any, cap: int = BODY_CAP_BYTES) -> tuple[Any, bool]:
    """Cap a text-ish field; oversized values become a truncated string."""
    if value is None:
        return None, False
    if isinstance(value, str):
        if len(value) > cap:
            return value[:cap], True
        return value, False
    text = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
    if len(text) > cap:
        return text[:cap], True
    return value, False


def build_exchange(
    *,
    step: str,
    method: str,
    url: str,
    attempt: int | None = None,
    request_headers: dict[str, str] | None = None,
    request_body: Any = None,
    response_status: int | None = None,
    response_headers: dict[str, str] | None = None,
    response_body: Any = None,
    duration_s: float = 0.0,
    error: str | None = None,
    cap: int = BODY_CAP_BYTES,
) -> dict[str, Any]:
    """Build one exchange record; every secret is redacted BEFORE storage.

    ``started_at`` is derived from the observed wall clock minus the measured
    duration, so the timestamp always matches the real request window.
    """
    req_headers, trunc_h = cap_text(redact(request_headers or {}), cap)
    req_body, trunc_b = cap_text(redact(request_body), cap)
    resp_body, trunc_r = cap_text(redact(response_body), cap)
    duration_ms = round(duration_s * 1000, 2) if duration_s else None
    record: dict[str, Any] = {
        "step": step,
        "method": method or "—",
        "url": redact(url) if url else None,
        "attempt": attempt,
        "request_headers": req_headers if req_headers else None,
        "request_body": req_body if req_body is not None else None,
        "response_status": response_status,
        "response_headers": redact(response_headers) if response_headers else None,
        "response_body": resp_body if resp_body is not None else None,
        "started_at": (
            datetime.now(timezone.utc) - timedelta(seconds=duration_s or 0)
        ).isoformat() if (response_status is not None or error) else None,
        "duration_ms": duration_ms,
        "error": redact(error) if error else None,
    }
    if trunc_h or trunc_b or trunc_r:
        record["truncated"] = True
    return record


def build_call_exchange(
    *,
    step: str,
    base_url: str,
    prepared: Any,
    result: Any,
    attempt: int | None = None,
    cap: int = BODY_CAP_BYTES,
) -> dict[str, Any]:
    """Build an exchange record from a real request/response pair."""
    url = ""
    if base_url:
        url = base_url.rstrip("/") + (prepared.endpoint or "")
    body = result.body if getattr(result, "body", None) is not None else None
    if body is None and getattr(result, "raw_text", ""):
        body = result.raw_text
    return build_exchange(
        step=step,
        method=getattr(prepared, "method", None),
        url=url,
        attempt=attempt,
        request_headers=dict(getattr(prepared, "headers", {}) or {}),
        request_body=dict(getattr(prepared, "body", {}) or {}),
        response_status=getattr(result, "status", None),
        response_body=body,
        duration_s=getattr(result, "latency_s", 0.0) or 0.0,
        error=getattr(result, "error_type", None),
        cap=cap,
    )


def redact_event_payload(obj: Any) -> Any:
    """Redaction used by the trace-event pipeline (kept for compatibility)."""
    return redact(obj)
