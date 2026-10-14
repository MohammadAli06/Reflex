"""Rule-based candidate patch generation (generic, diff-driven).

Produces *mappings and conversions only* - never values. Rules work on schema
diffs; no field names are hardcoded.
"""
from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from typing import Any

from ..registry.tools import ToolDefinition
from ..schema_utils import leaf_paths, required_leaf_paths
from . import reason_codes as rc
from .schema_diff import SchemaDiff
from .secrets import SecretsProvider

# A margin below this means two candidates are "near-equal" -> ambiguous.
_AMBIGUITY_TIE = 0.10
_UNIQUE_BY_ELIMINATION_CONFIDENCE = 0.7
_MAX_CONFIDENCE = 0.99


@dataclass
class CandidatePatch:
    tool: str
    new_bindings: dict[str, dict[str, Any]] = field(default_factory=dict)
    new_required_headers: list[dict[str, Any]] = field(default_factory=list)
    conversions: dict[str, str] = field(default_factory=dict)
    evidence: list[str] = field(default_factory=list)
    confidence: float = 0.0
    healing_path: str = "rule"
    refused: bool = False
    reason_code: str | None = None
    needs_human: bool = False


def _tokens(path: str) -> set[str]:
    return {t for t in re.split(r"[._]", path) if t}


def _score(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _convert_kind(from_type: str | None, to_type: str | None) -> tuple[bool, str | None]:
    if from_type == to_type:
        return True, None
    if (from_type, to_type) == ("string", "integer"):
        return True, "str_to_int"
    if (from_type, to_type) == ("integer", "string"):
        return True, "int_to_str"
    return False, None


def _refuse(tool: str, code: str, evidence: list[str], *, needs_human: bool = False) -> CandidatePatch:
    return CandidatePatch(
        tool=tool, evidence=list(evidence), refused=True,
        reason_code=code, needs_human=needs_human, confidence=0.0,
    )


def _match(
    removed: list[str],
    added: list[str],
    old_leaves: dict[str, Any],
    new_leaves: dict[str, Any],
) -> tuple[list[tuple[str, str, str | None, float]] | None, str | None]:
    """Return (pairs, None) or (None, reason_code)."""
    def compatible(old_p: str, new_p: str) -> tuple[bool, str | None]:
        return _convert_kind(old_leaves[old_p]["type"], new_leaves[new_p]["type"])

    if len(removed) == 1 and len(added) == 1:
        old_p, new_p = removed[0], added[0]
        ok, kind = compatible(old_p, new_p)
        if not ok:
            return None, rc.NO_EVIDENCE
        return [(old_p, new_p, kind, _UNIQUE_BY_ELIMINATION_CONFIDENCE)], None

    pairs: list[tuple[str, str, str | None, float]] = []
    for old_p in removed:
        scored = []
        for new_p in added:
            ok, kind = compatible(old_p, new_p)
            if ok:
                scored.append((_score(old_p, new_p), new_p, kind))
        if not scored:
            return None, rc.NO_EVIDENCE
        scored.sort(key=lambda t: t[0], reverse=True)
        if len(scored) > 1 and (scored[0][0] - scored[1][0]) < _AMBIGUITY_TIE:
            return None, rc.AMBIGUOUS_MAPPING
        best = scored[0]
        pairs.append((old_p, best[1], best[2], max(0.6, best[0])))
    return pairs, None


def hypothesize(
    definition: ToolDefinition,
    verified_schema,
    diff: SchemaDiff,
    secrets: SecretsProvider,
    args: dict[str, Any],
) -> CandidatePatch:
    tool = definition.name
    new_schema = verified_schema.request_schema(definition.endpoint)
    old_leaves = leaf_paths(definition.request_schema)
    new_leaves = leaf_paths(new_schema)

    bindings = copy.deepcopy(definition.bindings)
    evidence: list[str] = []
    conversions: dict[str, str] = {}
    confidence = 0.0

    # 1. Type changes at an unchanged path.
    for path, from_t, to_t in diff.type_changed:
        if path not in bindings:
            continue
        ok, kind = _convert_kind(from_t, to_t)
        if not ok:
            return _refuse(tool, rc.NO_EVIDENCE, evidence)
        if kind:
            bindings[path] = {**bindings[path], "convert": kind}
            conversions[path] = kind
        evidence.append(f"type change {path}: {from_t} -> {to_t}" + (f" via {kind}" if kind else ""))
        confidence = max(confidence, 0.9)

    # 2. Removed + added leaves -> mapping (rename / nesting).
    removed = [p for p in diff.removed if p in bindings]
    if removed and diff.added:
        pairs, code = _match(removed, list(diff.added), old_leaves, new_leaves)
        if code:
            return _refuse(tool, code, evidence)
        assert pairs is not None
        for old_p, new_p, kind, score in pairs:
            binding = copy.deepcopy(bindings.pop(old_p))
            if kind:
                binding["convert"] = kind
                conversions[new_p] = kind
            bindings[new_p] = binding
            evidence.append(f"map {old_p} -> {new_p}" + (f" via {kind}" if kind else ""))
            confidence = max(confidence, score)

    # 3. Every new required leaf must have an approved value source.
    for path in required_leaf_paths(new_schema):
        if path in bindings:
            continue
        if path in args:
            bindings[path] = {"source": "arg", "arg": path, "convert": None}
            evidence.append(f"new required field {path} bound to original argument {path}")
            confidence = max(confidence, 0.6)
        else:
            return _refuse(
                tool, rc.MISSING_REQUIRED_VALUE,
                evidence + [f"required field {path} has no approved value source"],
            )

    # 4. Required headers come from the verified schema; values from secrets.
    new_headers = list(definition.required_headers)
    for header in diff.added_headers:
        name = header["name"]
        if secrets.get(name) is None:
            return _refuse(
                tool, rc.MISSING_CREDENTIAL,
                evidence + [f"required header {name} has no available credential"],
            )
        new_headers.append({"name": name, "format": header.get("format")})
        evidence.append(f"new required header {name} (value from secrets store)")
        confidence = max(confidence, 0.95)

    # Drop any leftover bindings for fields that no longer exist.
    for path in removed:
        bindings.pop(path, None)

    if not evidence:
        return _refuse(tool, rc.NO_EVIDENCE, evidence)

    return CandidatePatch(
        tool=tool,
        new_bindings=bindings,
        new_required_headers=new_headers,
        conversions=conversions,
        evidence=evidence,
        confidence=min(confidence, _MAX_CONFIDENCE),
    )


def apply_patch_to_definition(definition: ToolDefinition, patch: CandidatePatch, verified_schema) -> ToolDefinition:
    """Return a patched copy of the definition (bindings + headers only)."""
    new_schema = verified_schema.request_schema(definition.endpoint)
    return definition.copy_with(
        request_schema=copy.deepcopy(new_schema),
        required_headers=copy.deepcopy(patch.new_required_headers),
        bindings=copy.deepcopy(patch.new_bindings),
    )
