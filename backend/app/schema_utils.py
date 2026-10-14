"""Small, generic JSON-Schema helpers used by the executor and healer.

These work on schema structure only. No field names are hardcoded here.
"""
from __future__ import annotations

from typing import Any, Iterator

Path = str


def is_object(schema: dict[str, Any] | None) -> bool:
    return bool(schema) and schema.get("type") == "object" and "properties" in schema


def walk_leaves(
    schema: dict[str, Any],
    prefix: str = "",
    parent_required: bool = True,
) -> Iterator[tuple[Path, dict[str, Any], bool]]:
    """Yield ``(path, subschema, required)`` for every node, leaves included.

    Object nodes are yielded too (their path points at the object), which lets a
    nesting change be described as "field X became object Y".
    """
    props = (schema or {}).get("properties") or {}
    required = set((schema or {}).get("required") or [])
    for name, sub in props.items():
        path = f"{prefix}.{name}" if prefix else name
        is_required = parent_required and name in required
        if is_object(sub):
            yield from walk_leaves(sub, path, is_required)
        yield path, sub, is_required


def collect_paths(schema: dict[str, Any]) -> dict[Path, dict[str, Any]]:
    """Return ``{path: {"schema", "type", "required"}}`` for all nodes."""
    out: dict[Path, dict[str, Any]] = {}
    for path, sub, required in walk_leaves(schema):
        out[path] = {"schema": sub, "type": sub.get("type"), "required": required}
    return out


def leaf_paths(schema: dict[str, Any]) -> dict[Path, dict[str, Any]]:
    """Only non-object nodes (values)."""
    return {
        path: info
        for path, info in collect_paths(schema).items()
        if info["type"] != "object" and "properties" not in (info["schema"] or {})
    }


def required_leaf_paths(schema: dict[str, Any]) -> list[Path]:
    return [p for p, info in leaf_paths(schema).items() if info["required"]]


def get_type(schema: dict[str, Any], path: Path) -> str | None:
    info = collect_paths(schema).get(path)
    return info["type"] if info else None


def get_in(obj: Any, path: Path) -> Any:
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def set_in(obj: dict[str, Any], path: Path, value: Any) -> None:
    parts = path.split(".")
    cur = obj
    for part in parts[:-1]:
        nxt = cur.get(part)
        if not isinstance(nxt, dict):
            nxt = {}
            cur[part] = nxt
        cur = nxt
    cur[parts[-1]] = value


def path_exists(obj: Any, path: Path) -> bool:
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return False
        cur = cur[part]
    return True


def sample_instance(schema: dict[str, Any]) -> Any:
    """Build a valid example instance from a JSON schema (for consistency checks)."""

    def fill(name: str, sub: dict[str, Any]) -> Any:
        if sub.get("type") == "object" or "properties" in sub:
            return {key: fill(key, value) for key, value in sub.get("properties", {}).items()}
        if sub.get("type") == "boolean":
            return True
        if sub.get("type") == "integer":
            return 1
        if sub.get("type") == "number":
            return 1.0
        if sub.get("type") == "array":
            return []
        return f"{name}-value"

    return fill("root", schema)
