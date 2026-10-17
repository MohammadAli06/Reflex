"""Executor: builds an HTTP request from the *current* registry definition.

It only calls - it never heals or patches. Values come from task arguments or
approved sources; the executor tracks each value's provenance.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from ..healing.conversions import convert_value
from ..healing.secrets import SecretsProvider
from ..schema_utils import set_in
from .tools import ToolDefinition


class MissingValueError(RuntimeError):
    """A required body field has no approved value source."""

    def __init__(self, path: str) -> None:
        super().__init__(f"no value source for body field {path!r}")
        self.path = path


class MissingCredentialError(RuntimeError):
    """A required header credential is not available in the secrets store."""

    def __init__(self, header_name: str) -> None:
        super().__init__(f"no credential available for header {header_name!r}")
        self.header_name = header_name


@dataclass
class PreparedRequest:
    endpoint: str
    method: str
    body: dict[str, Any]
    headers: dict[str, str]
    provenance: dict[str, str]
    write: bool = False
    dry_run: bool = False

    def redacted(self) -> dict[str, Any]:
        """Audit-safe view: header names only, no header values."""
        return {
            "endpoint": self.endpoint,
            "method": self.method,
            "body": self.body,
            "header_names": sorted(self.headers.keys()),
            "provenance": self.provenance,
            "write": self.write,
            "dry_run": self.dry_run,
        }


@dataclass
class CallResult:
    status: int | None
    ok: bool
    body: Any = None
    raw_text: str = ""
    error_type: str | None = None  # "timeout" | "connection" | None
    latency_s: float = 0.0
    header_names: list[str] = field(default_factory=list)

    def error_summary(self) -> str:
        if self.error_type:
            return self.error_type
        if isinstance(self.body, dict) and "error" in self.body:
            return str(self.body.get("error"))
        return self.raw_text[:200]


def build_request(
    definition: ToolDefinition,
    args: dict[str, Any],
    secrets: SecretsProvider,
    *,
    dry_run: bool = False,
) -> PreparedRequest:
    body: dict[str, Any] = {}
    provenance: dict[str, str] = {}
    for path, binding in definition.bindings.items():
        source = binding.get("source")
        if source == "arg":
            arg_name = binding.get("arg")
            if arg_name not in args:
                raise MissingValueError(path)
            raw = args[arg_name]
            origin = f"arg:{arg_name}"
        elif source == "const":
            raw = binding.get("value")
            origin = "const"
        else:
            raise MissingValueError(path)

        ok, value = convert_value(raw, binding.get("convert"))
        if not ok:
            raise MissingValueError(path)
        set_in(body, path, value)
        provenance[path] = origin

    headers: dict[str, str] = {}
    for header in definition.required_headers:
        name = header["name"]
        value = secrets.get(name)
        if value is None:
            raise MissingCredentialError(name)
        headers[name] = value

    if definition.write and dry_run:
        body["dry_run"] = True

    return PreparedRequest(
        endpoint=definition.endpoint,
        method=definition.method,
        body=body,
        headers=headers,
        provenance=provenance,
        write=definition.write,
        dry_run=dry_run,
    )


class Executor:
    def __init__(self, client: httpx.Client, secrets: SecretsProvider, timeout_s: float = 5.0) -> None:
        self._client = client
        self._secrets = secrets
        self._timeout_s = timeout_s

    def base_url(self) -> str:
        """Absolute base URL of the API this executor talks to."""
        return str(self._client.base_url)

    def request_url(self, prepared: PreparedRequest) -> str:
        """Full recorded URL for an exchange record (base + endpoint path)."""
        return self.base_url().rstrip("/") + prepared.endpoint

    def call(self, prepared: PreparedRequest) -> CallResult:
        started = time.perf_counter()
        try:
            response = self._client.request(
                prepared.method, prepared.endpoint, json=prepared.body, headers=prepared.headers,
                timeout=self._timeout_s,
            )
        except httpx.TimeoutException:
            return CallResult(status=None, ok=False, error_type="timeout",
                              latency_s=time.perf_counter() - started)
        except httpx.TransportError:
            return CallResult(status=None, ok=False, error_type="connection",
                              latency_s=time.perf_counter() - started)

        latency = time.perf_counter() - started
        try:
            parsed = response.json()
        except Exception:
            parsed = None
        return CallResult(
            status=response.status_code,
            ok=200 <= response.status_code < 300,
            body=parsed,
            raw_text=response.text,
            latency_s=latency,
            header_names=sorted(k for k in response.headers.keys()),
        )

    def execute(
        self, definition: ToolDefinition, args: dict[str, Any], *, dry_run: bool = False
    ) -> tuple[PreparedRequest, CallResult]:
        prepared = build_request(definition, args, self._secrets, dry_run=dry_run)
        return prepared, self.call(prepared)


def make_client(base_url: str) -> httpx.Client:
    return httpx.Client(base_url=base_url)
