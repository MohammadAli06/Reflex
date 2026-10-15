"""Canonical JSON + SHA-256.

The hash tracks *change*. It is not proof of authenticity; the trusted source is
the mock API's ``/openapi.json``.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_hash(obj: Any) -> str:
    return hashlib.sha256(canonical_json(obj).encode("utf-8")).hexdigest()


def short_hash(value: str, length: int = 12) -> str:
    return value[:length]
