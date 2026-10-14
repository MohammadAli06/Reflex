"""Generic schema diff - no hardcoded field names.

Compares the current tool request schema with the verified schema and reports
removed/added leaves, type changes and required-header changes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from ..schema_utils import leaf_paths


@dataclass
class SchemaDiff:
    endpoint: str
    removed: list[str] = field(default_factory=list)
    added: list[str] = field(default_factory=list)
    type_changed: list[tuple[str, str | None, str | None]] = field(default_factory=list)
    added_headers: list[dict[str, Any]] = field(default_factory=list)
    removed_headers: list[dict[str, Any]] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not any(
            [self.removed, self.added, self.type_changed, self.added_headers, self.removed_headers]
        )

    def to_event_data(self) -> dict[str, Any]:
        return {
            "endpoint": self.endpoint,
            "removed": self.removed,
            "added": self.added,
            "type_changed": [
                {"path": p, "from": a, "to": b} for p, a, b in self.type_changed
            ],
            "added_headers": self.added_headers,
            "removed_headers": self.removed_headers,
        }


def diff_schemas(
    endpoint: str,
    old_schema: dict[str, Any],
    new_schema: dict[str, Any],
    old_headers: list[dict[str, Any]] | None = None,
    new_headers: list[dict[str, Any]] | None = None,
) -> SchemaDiff:
    old_leaves = leaf_paths(old_schema)
    new_leaves = leaf_paths(new_schema)

    removed = sorted(set(old_leaves) - set(new_leaves))
    added = sorted(set(new_leaves) - set(old_leaves))

    type_changed: list[tuple[str, str | None, str | None]] = []
    for path in sorted(set(old_leaves) & set(new_leaves)):
        old_type = old_leaves[path]["type"]
        new_type = new_leaves[path]["type"]
        if old_type != new_type:
            type_changed.append((path, old_type, new_type))

    old_h = {h["name"].lower(): h for h in (old_headers or [])}
    new_h = {h["name"].lower(): h for h in (new_headers or [])}
    added_headers = [new_h[k] for k in new_h if k not in old_h]
    removed_headers = [old_h[k] for k in old_h if k not in new_h]

    return SchemaDiff(
        endpoint=endpoint,
        removed=removed,
        added=added,
        type_changed=type_changed,
        added_headers=added_headers,
        removed_headers=removed_headers,
    )
