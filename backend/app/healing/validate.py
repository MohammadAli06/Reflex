"""Offline validation before any patch is applied (Architecture §10).

Validates the patched payload against the verified schema and confirms every
value has approved provenance. Write calls require ``dry_run`` or a human.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from jsonschema import Draft202012Validator

from ..registry.executor import (
    Executor,
    MissingCredentialError,
    MissingValueError,
    PreparedRequest,
    build_request,
)
from ..registry.tools import ToolDefinition
from . import reason_codes as rc
from .conversions import convert_value
from .secrets import SecretsProvider


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str] = field(default_factory=list)
    reason_code: str | None = None
    prepared: PreparedRequest | None = None
    needs_human: bool = False


def validate_patch(
    definition: ToolDefinition,
    verified_schema,
    args: dict[str, Any],
    secrets: SecretsProvider,
    *,
    dry_run: bool = False,
) -> ValidationResult:
    errors: list[str] = []

    # 1. Conversions must be lossless for the real argument values.
    for path, binding in definition.bindings.items():
        kind = binding.get("convert")
        if not kind:
            continue
        if binding.get("source") == "arg":
            arg_name = binding.get("arg")
            if arg_name not in args:
                return ValidationResult(False, [f"missing argument {arg_name}"], rc.VALIDATION_FAILED)
            ok, _ = convert_value(args[arg_name], kind)
            if not ok:
                return ValidationResult(
                    False, [f"conversion {kind} on {path} is lossy for its value"],
                    rc.LOSSY_CONVERSION,
                )

    # 2. Write safety: a write call needs dry_run, otherwise a human must decide.
    if definition.write and not dry_run:
        return ValidationResult(
            False, ["write call requires dry_run; flagged for human review"],
            rc.NEEDS_HUMAN_REVIEW, needs_human=True,
        )

    # 3. Build the payload (raises on missing value / credential).
    try:
        prepared = build_request(definition, args, secrets, dry_run=dry_run)
    except MissingCredentialError as exc:
        return ValidationResult(False, [str(exc)], rc.MISSING_CREDENTIAL)
    except MissingValueError as exc:
        return ValidationResult(False, [str(exc)], rc.MISSING_REQUIRED_VALUE)

    # 4. Offline schema check against the verified request schema.
    schema = verified_schema.request_schema(definition.endpoint)
    body = {k: v for k, v in prepared.body.items() if k != "dry_run"}
    validator = Draft202012Validator(schema)
    for err in sorted(validator.iter_errors(body), key=lambda e: list(e.path)):
        loc = "/".join(str(p) for p in err.path) or "<root>"
        errors.append(f"{loc}: {err.message}")
    if errors:
        return ValidationResult(False, errors, rc.VALIDATION_FAILED, prepared=prepared)

    return ValidationResult(True, [], None, prepared=prepared)
