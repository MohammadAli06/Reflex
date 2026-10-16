"""Thin HTTP client; the server remains the only healing implementation."""
from __future__ import annotations

from typing import Any

import httpx

from .errors import (ReflexConnectionError, ReflexExecutionError, ReflexTimeoutError,
                     ReflexValidationError)
from .models import ReflexResult, ToolInfo


class ReflexClient:
    def __init__(self, base_url: str = "http://localhost:8001", *, timeout: float = 10.0,
                 client: httpx.Client | None = None) -> None:
        if not base_url.startswith(("http://", "https://")):
            raise ReflexValidationError("base_url must be an http(s) URL")
        if timeout <= 0:
            raise ReflexValidationError("timeout must be positive")
        self._owns_client = client is None
        self._client = client or httpx.Client(base_url=base_url.rstrip("/"), timeout=timeout)

    def __enter__(self) -> "ReflexClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def list_tools(self) -> list[ToolInfo]:
        payload = self._request("GET", "/api/sdk/tools")
        tools = payload.get("tools")
        if not isinstance(tools, list):
            raise ReflexExecutionError("malformed tools response from Reflex")
        return [ToolInfo.from_dict(item) for item in tools if isinstance(item, dict)]

    def load_tool(self, name: str) -> ToolInfo:
        if not name:
            raise ReflexValidationError("tool name is required")
        for tool in self.list_tools():
            if tool.name == name:
                return tool
        raise ReflexValidationError(f"unknown Reflex tool: {name}")

    def call(self, tool: str, /, **args: Any) -> ReflexResult:
        if not tool:
            raise ReflexValidationError("tool name is required")
        payload = self._request("POST", "/api/sdk/call", json={"tool": tool, "args": args})
        try:
            return ReflexResult.from_dict(payload)
        except (KeyError, TypeError, ValueError) as exc:
            raise ReflexExecutionError("malformed execution response from Reflex") from exc

    def _request(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = self._client.request(method, path, **kwargs)
        except httpx.TimeoutException as exc:
            raise ReflexTimeoutError("Reflex Control API timed out") from exc
        except httpx.TransportError as exc:
            raise ReflexConnectionError("could not connect to Reflex Control API") from exc
        if response.status_code == 404:
            raise ReflexValidationError("unknown Reflex resource or tool")
        if response.status_code >= 400:
            raise ReflexExecutionError(f"Reflex Control API returned HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise ReflexExecutionError("Reflex Control API returned invalid JSON") from exc
        if not isinstance(payload, dict):
            raise ReflexExecutionError("Reflex Control API returned an invalid response")
        return payload
