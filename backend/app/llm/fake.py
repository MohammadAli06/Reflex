"""Deterministic fake LLM client so core tests run with no API key.

Token counts are clearly labelled (``tokens_reported=False``) - they are
deterministic stand-ins, never presented as real provider usage.
"""
from __future__ import annotations

import time
from typing import Any

from .base import LLMClient, LLMResult, ToolCall


class FakeLLMClient(LLMClient):
    def __init__(self, model: str = "fake-deterministic") -> None:
        self.model = model
        self.calls = 0

    def generate(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None) -> LLMResult:
        started = time.perf_counter()
        self.calls += 1
        text = " ".join(str(m.get("content", "")) for m in messages)
        # Deterministic stand-in counts (word based), explicitly not real usage.
        input_tokens = len(text.split())
        tool_calls: list[ToolCall] = []
        if tools:
            first = tools[0]
            name = first.get("name") if isinstance(first, dict) else None
            if name:
                tool_calls.append(ToolCall(name=name, arguments={}))
        output_text = "acknowledged; no schema change proposed"
        return LLMResult(
            text=output_text,
            tool_calls=tool_calls,
            input_tokens=input_tokens,
            output_tokens=len(output_text.split()),
            latency_s=time.perf_counter() - started,
            model=self.model,
            tokens_reported=False,
        )
