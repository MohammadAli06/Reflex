"""Replaceable LLM interface.

Only ``llm/gemini.py`` imports the Gemini SDK. Token counts come from provider
usage fields; a client that cannot supply them reports 0 and flags itself.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass
class LLMResult:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    latency_s: float = 0.0
    model: str = ""
    # True ONLY when the LLM API supplied real usage metadata.
    # Conservative default: assume unverified unless explicitly confirmed.
    tokens_reported: bool = False

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class LLMClient(ABC):
    model: str = ""

    @abstractmethod
    def generate(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]] | None = None) -> LLMResult:
        raise NotImplementedError
