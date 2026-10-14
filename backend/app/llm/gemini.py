"""Gemini adapter - the only module that imports ``google.genai``.

Settings come from one typed config object. For ``gemini-3.8-flash`` we send
only supported ``thinking_level`` values and never ``temperature``/``top_p``/
``top_k``.
"""
from __future__ import annotations

import time
from typing import Any

from ..config import Settings
from .base import LLMClient, LLMResult, ToolCall


class GeminiUnavailable(RuntimeError):
    pass


class GeminiClient(LLMClient):
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.model = settings.llm_model
        self._client = None

    def _ensure_client(self):
        if self._client is not None:
            return self._client
        if not self._settings.google_api_key:
            raise GeminiUnavailable("GOOGLE_API_KEY is not configured")
        try:
            from google import genai  # local import: SDK stays in this module
        except Exception as exc:  # pragma: no cover - depends on env
            raise GeminiUnavailable(f"google-genai SDK not importable: {exc}") from exc
        self._client = genai.Client(api_key=self._settings.google_api_key)
        return self._client

    def generate(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None) -> LLMResult:
        from google.genai import types  # local import

        client = self._ensure_client()
        started = time.perf_counter()

        system = [m["content"] for m in messages if m.get("role") == "system"]
        contents = [
            types.Content(role="user" if m.get("role") != "assistant" else "model",
                          parts=[types.Part(text=str(m.get("content", "")))])
            for m in messages
            if m.get("role") != "system"
        ]

        config = types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(
                thinking_level=self._settings.llm_thinking_level
            ),
            system_instruction="\n".join(system) or None,
        )
        if tools:
            config.tools = [types.Tool(function_declarations=tools)]

        response = client.models.generate_content(
            model=self._settings.llm_model, contents=contents, config=config,
        )

        tool_calls: list[ToolCall] = []
        for candidate in getattr(response, "candidates", []) or []:
            for part in getattr(candidate.content, "parts", []) or []:
                fc = getattr(part, "function_call", None)
                if fc:
                    tool_calls.append(ToolCall(name=fc.name, arguments=dict(fc.args or {})))

        usage = getattr(response, "usage_metadata", None)
        input_tokens = int(getattr(usage, "prompt_token_count", 0) or 0)
        output_tokens = int(getattr(usage, "candidates_token_count", 0) or 0)

        return LLMResult(
            text=getattr(response, "text", "") or "",
            tool_calls=tool_calls,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_s=time.perf_counter() - started,
            model=self._settings.llm_model,
            tokens_reported=usage is not None,
        )


def build_llm(settings: Settings, *, prefer_fake: bool = False) -> LLMClient:
    """Return a Gemini client when configured, else the deterministic fake."""
    from .fake import FakeLLMClient

    if prefer_fake or not settings.llm_configured:
        return FakeLLMClient()
    return GeminiClient(settings)
