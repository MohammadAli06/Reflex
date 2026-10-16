"""Real-spec evaluation harness: draft reviewed cases from vendored OpenAPI pairs.

The builder only *proposes* drafts (``reviewed: false``). A human must flip the
label after checking the expected outcome, so an auto-generated guess is never
presented as benchmark ground truth.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from ..healing.schema_diff import diff_schemas
from ..runner.cases import Case
from .spec_loader import extract_operation, load_spec

CASES_PATH = Path(__file__).parent / "cases.yaml"

REFUSE_KINDS = {"lossy_type", "ambiguous", "removed_without_source"}
RECOVERABLE_KINDS = {"field_renamed", "header_added", "header_removed", "type_changed"}


def classify_change(diff) -> str:
    """Collapse a SchemaDiff into reviewable change kind(s), joined with '+'.

    A real drift often changes more than one thing at once, so the kind is not
    forced into a single bucket.
    """
    kinds: list[str] = []
    if diff.removed and diff.added:
        kinds.append("field_renamed")
    elif diff.added:
        kinds.append("field_added_required")
    elif diff.removed:
        kinds.append("field_removed")
    if diff.type_changed:
        kinds.append("type_changed")
    if diff.added_headers:
        kinds.append("header_added")
    if diff.removed_headers:
        kinds.append("header_removed")
    return "+".join(kinds) if kinds else "none"


def propose_label(change_kind: str) -> str:
    """A draft label. Always reviewed by a human before it counts."""
    kinds = change_kind.split("+")
    if all(kind in RECOVERABLE_KINDS for kind in kinds):
        return "recoverable"
    return "refuse_expected"


def build_draft(api: str, operation: str, old_ref: str, new_ref: str,
                task_args: dict[str, Any]) -> dict[str, Any]:
    """Diff two vendored revisions and return one draft case row."""
    old = load_spec(api, old_ref)
    new = load_spec(api, new_ref)
    old_op = extract_operation(old, operation)
    new_op = extract_operation(new, operation)
    diff = diff_schemas(
        operation.split(" ", 1)[1],
        old_op["request_schema"], new_op["request_schema"],
        old_op["required_headers"], new_op["required_headers"],
    )
    change_kind = classify_change(diff)
    return {
        "id": f"{api}_{old_ref}_{new_ref}_{_slug(operation)}",
        "api": api,
        "operation": operation,
        "old_ref": old_ref,
        "new_ref": new_ref,
        "change_kind": change_kind,
        "label": propose_label(change_kind),
        "expected_reason": None if propose_label(change_kind) == "recoverable" else "no_evidence",
        "task_args": dict(task_args),
        "reviewed": False,
    }


def _slug(operation: str) -> str:
    return operation.lower().replace(" ", "_").replace("/", "_").replace("{", "").replace("}", "")


def load_rows(path: Path | None = None) -> list[dict[str, Any]]:
    path = path or CASES_PATH
    if not path.is_file():
        return []
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return list(data.get("cases", []))


def save_rows(rows: list[dict[str, Any]], path: Path | None = None) -> Path:
    path = path or CASES_PATH
    path.write_text(
        yaml.safe_dump({"cases": rows}, sort_keys=False, allow_unicode=True),
        encoding="utf-8",
    )
    return path


def load_cases(path: Path | None = None) -> list[Case]:
    """Turn reviewed YAML rows into runner cases."""
    cases: list[Case] = []
    for index, row in enumerate(load_rows(path)):
        label = row.get("label", "recoverable")
        cases.append(Case(
            id=str(row["id"]),
            task_id=str(row["id"]),
            expected_outcome="recovered" if label == "recoverable" else "refused",
            error_style=str(row.get("error_style", "clear")),
            expected_reason=row.get("expected_reason"),
            split="tuning",
            source="real",
            api=row.get("api"),
            operation=row.get("operation"),
            change_kind=row.get("change_kind"),
            reviewed=bool(row.get("reviewed", False)),
            old_ref=row.get("old_ref"),
            new_ref=row.get("new_ref"),
            task_args=dict(row.get("task_args") or {}),
            seed=index,
        ))
    return cases


def reviewed_cases(path: Path | None = None) -> list[Case]:
    return [case for case in load_cases(path) if case.reviewed]
