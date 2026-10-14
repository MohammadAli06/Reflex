"""Meaning-preserving value conversions (rules.md §C).

Only conversions that can round-trip exactly are allowed. Anything that could
change meaning returns ``(False, None)`` so the caller refuses.
"""
from __future__ import annotations

from typing import Any

MAX_SAFE_INT = 2**53

CONVERSIONS = {"str_to_int", "int_to_str"}


def str_to_int(value: str) -> tuple[bool, int | None]:
    if not isinstance(value, str):
        return False, None
    if not value or value.strip() != value:
        return False, None
    digits = value[1:] if value.startswith("-") else value
    if not digits.isdigit():
        return False, None
    try:
        number = int(value)
    except ValueError:
        return False, None
    if abs(number) > MAX_SAFE_INT:
        return False, None
    # Lossless only if converting back gives the exact original string.
    # This rejects "00123", "+1", " 12", "12.0", "1e3", "-0".
    if str(number) != value:
        return False, None
    return True, number


def int_to_str(value: int) -> tuple[bool, str | None]:
    if not isinstance(value, int) or isinstance(value, bool):
        return False, None
    if abs(value) > MAX_SAFE_INT:
        return False, None
    return True, str(value)


def convert_value(value: Any, kind: str | None) -> tuple[bool, Any]:
    """Apply a named conversion. ``kind=None`` passes the value through."""
    if kind is None:
        return True, value
    if kind == "str_to_int":
        return str_to_int(value)
    if kind == "int_to_str":
        return int_to_str(value)
    return False, None


def conversion_is_lossless(value: Any, kind: str | None) -> bool:
    ok, _ = convert_value(value, kind)
    return ok
