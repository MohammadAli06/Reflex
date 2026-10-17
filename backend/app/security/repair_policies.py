"""Post-validation repair policies, run in the healer right before the
registry compare-and-swap. These extend (not replace) ``validate_patch``.

Every violation yields a refusal reason code; nothing here invents values.
"""
from __future__ import annotations

from ..healing import reason_codes as rc
from ..healing.conversions import CONVERSIONS
from ..healing.hypothesize import CandidatePatch
from ..healing.schema_diff import SchemaDiff
from ..registry.tools import ToolDefinition


def check_repair_policies(
    patch: CandidatePatch,
    definition: ToolDefinition,
    diff: SchemaDiff,
) -> str | None:
    """Return a refusal reason code when the patch exceeds the evidence."""
    # Minimal-change: everything the patch changes must be explained by the
    # observed diff (added / removed / type-changed leaves and added headers).
    changed_keys = {
        path for path, binding in patch.new_bindings.items()
        if definition.bindings.get(path) != binding
    }
    removed_keys = set(definition.bindings) - set(patch.new_bindings)
    allowed_paths = set(diff.added) | set(diff.removed) | {p for p, _f, _t in diff.type_changed}
    if (changed_keys | removed_keys) - allowed_paths:
        return rc.OVERBROAD_PATCH

    old_headers = {h["name"] for h in definition.required_headers}
    allowed_headers = {h["name"] for h in diff.added_headers}
    for header in patch.new_required_headers:
        if header["name"] not in old_headers and header["name"] not in allowed_headers:
            return rc.OVERBROAD_PATCH

    # Conversions stay within the lossless table; anything else is unsafe.
    for kind in patch.conversions.values():
        if kind is not None and kind not in CONVERSIONS:
            return rc.UNSAFE_CONVERSION
    return None
