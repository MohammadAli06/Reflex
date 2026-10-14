"""Verify Gemini API capability without ever printing the key (T0.3).

Reports PASS / BLOCKED. Never fabricates a live result. Run from ``backend/``::

    python scripts/verify_llm.py
"""
from __future__ import annotations

import json
import sys

from app.config import load_settings

try:
    from app.llm.gemini import GeminiClient, GeminiUnavailable
except Exception:  # pragma: no cover
    GeminiClient = None
    GeminiUnavailable = Exception


def main() -> int:
    settings = load_settings()
    report: dict[str, object] = {
        "model": settings.llm_model,
        "thinking_level": settings.llm_thinking_level,
        "key_present": bool(settings.google_api_key),
    }

    if not settings.google_api_key:
        report["status"] = "BLOCKED"
        report["reason"] = "GOOGLE_API_KEY is not set; core development uses the fake client"
        print(json.dumps(report, indent=2))
        return 1

    if GeminiClient is None:
        report["status"] = "BLOCKED"
        report["reason"] = "google-genai SDK not importable"
        print(json.dumps(report, indent=2))
        return 1

    tool = {
        "name": "echo",
        "description": "Echo a value back",
        "parameters": {"type": "object", "properties": {"value": {"type": "string"}}, "required": ["value"]},
    }
    try:
        client = GeminiClient(settings)
        result = client.generate(
            messages=[{"role": "user", "content": "Call the echo tool with value='ping'."}],
            tools=[tool],
        )
    except GeminiUnavailable as exc:
        report["status"] = "BLOCKED"
        report["reason"] = str(exc)
        print(json.dumps(report, indent=2))
        return 1
    except Exception as exc:  # quota / access / model-not-found
        report["status"] = "BLOCKED"
        report["reason"] = f"{type(exc).__name__}: {exc}"
        print(json.dumps(report, indent=2))
        return 1

    report["status"] = "PASS"
    report["tool_calls"] = [{"name": c.name, "arguments": c.arguments} for c in result.tool_calls]
    report["usage_reported"] = result.tokens_reported
    report["input_tokens"] = result.input_tokens
    report["output_tokens"] = result.output_tokens
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
