"""Server-side correctness checks.

A 200 status alone does not prove correctness: the values that reached the
server must match the original task arguments after conversion.
"""
from __future__ import annotations

from typing import Any

from ..healing.conversions import convert_value
from ..registry.tools import ToolDefinition
from ..schema_utils import get_in


def verify_payload(
    definition: ToolDefinition, server_payload: dict[str, Any] | None, args: dict[str, Any]
) -> tuple[bool, list[str]]:
    if not isinstance(server_payload, dict) or not isinstance(server_payload.get("body"), dict):
        return False, ["no server-side payload was recorded"]
    body = server_payload["body"]
    details: list[str] = []
    ok = True
    for path, binding in definition.bindings.items():
        if binding.get("source") != "arg":
            continue
        arg = binding.get("arg")
        if arg not in args:
            continue
        converted_ok, expected = convert_value(args[arg], binding.get("convert"))
        actual = get_in(body, path)
        if not converted_ok or actual != expected:
            ok = False
            details.append(f"{path}: expected {expected!r}, server saw {actual!r}")
    return ok, details
