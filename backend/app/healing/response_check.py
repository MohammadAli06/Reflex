"""Minimal response validation and clear 1-to-1 path adaptation (Phase 7).

Only fields the tool actually uses are checked. A clear one-to-one path move is
adapted; ambiguity refuses and returns no data to the agent.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from ..registry.tools import ToolDefinition
from ..schema_utils import get_in, leaf_paths, path_exists
from . import reason_codes as rc


@dataclass
class ResponseCheckResult:
    ok: bool
    data: dict[str, Any] | None = None
    reason_code: str | None = None
    adapted_map: dict[str, str] | None = None
    evidence: list[str] = field(default_factory=list)


def _tokens(path: str) -> set[str]:
    return {t for t in re.split(r"[._]", path) if t}


def _score(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def check_response(
    definition: ToolDefinition,
    body: Any,
    verified_schema=None,
) -> ResponseCheckResult:
    if not isinstance(body, dict):
        return ResponseCheckResult(False, None, rc.AMBIGUOUS_RESPONSE_MAPPING,
                                   evidence=["response body is not an object"])

    missing = [k for k, path in definition.response_map.items() if not path_exists(body, path)]
    if not missing:
        return ResponseCheckResult(
            True, {k: get_in(body, p) for k, p in definition.response_map.items()}
        )

    if verified_schema is None:
        return ResponseCheckResult(
            False, None, rc.AMBIGUOUS_RESPONSE_MAPPING,
            evidence=["response shape changed but no verified schema available"],
        )

    resp_schema = verified_schema.response_schemas.get(definition.endpoint, {})
    new_leaves = leaf_paths(resp_schema) if resp_schema else {}
    if not new_leaves:
        return ResponseCheckResult(False, None, rc.AMBIGUOUS_RESPONSE_MAPPING,
                                   evidence=["no response schema to adapt against"])

    adapted = dict(definition.response_map)
    evidence: list[str] = []
    for key, old_path in definition.response_map.items():
        if path_exists(body, old_path):
            continue
        candidates = sorted(
            ((_score(old_path, np), np) for np in new_leaves if _score(old_path, np) > 0),
            reverse=True,
        )
        if not candidates:
            return ResponseCheckResult(
                False, None, rc.AMBIGUOUS_RESPONSE_MAPPING,
                evidence=[f"no candidate path for {old_path}"],
            )
        if len(candidates) > 1 and (candidates[0][0] - candidates[1][0]) < 0.10:
            return ResponseCheckResult(
                False, None, rc.AMBIGUOUS_RESPONSE_MAPPING,
                evidence=[f"ambiguous response mapping for {old_path}: "
                          f"{candidates[0][1]} vs {candidates[1][1]}"],
            )
        adapted[key] = candidates[0][1]
        evidence.append(f"response {old_path} -> {candidates[0][1]}")

    data = {k: get_in(body, p) for k, p in adapted.items()}
    if any(v is None for v in data.values()):
        return ResponseCheckResult(False, None, rc.AMBIGUOUS_RESPONSE_MAPPING, evidence=evidence)
    return ResponseCheckResult(True, data, adapted_map=adapted, evidence=evidence)
