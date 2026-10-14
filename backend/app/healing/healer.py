"""The healing engine: classify -> fetch -> diff -> hypothesize -> validate ->
apply -> retry -> verify -> roll back on evidence.

Bounded by the shared schema-attempt cap. A failed candidate is never replayed;
a further candidate is only considered after a fresh schema fetch that reveals a
materially different change.
"""
from __future__ import annotations

import copy
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from ..audit.audit_log import AuditEntry, AuditLog
from ..config import Settings
from ..registry.executor import (
    CallResult,
    Executor,
    MissingCredentialError,
    MissingValueError,
    PreparedRequest,
    build_request,
)
from ..registry.tool_registry import ToolRegistry
from ..registry.tools import ToolDefinition
from ..schema_utils import get_in
from . import reason_codes as rc
from .classifier import Category, classify, describe
from .events import EventEmitter
from .hypothesize import CandidatePatch, apply_patch_to_definition, hypothesize
from .response_check import check_response
from .schema_diff import diff_schemas
from .schema_fetch import fetch_verified
from .secrets import SecretsProvider
from .validate import validate_patch

BACKOFF_S = 0.05


@dataclass
class HealOutcome:
    outcome: str  # recovered | refused | failed | not_drift_reported
    reason_code: str | None = None
    schema_attempts: int = 0
    infra_retries: int = 0
    attempts: int = 0
    t_break: float | None = None
    t_recovery: float | None = None
    definition: ToolDefinition | None = None
    final_result: CallResult | None = None
    response_data: dict[str, Any] | None = None
    healing_path: str = "rule"
    patch: CandidatePatch | None = None
    error_text: str = ""

    @property
    def recovered(self) -> bool:
        return self.outcome == "recovered"

    @property
    def mttr(self) -> float | None:
        if self.recovered and self.t_break is not None and self.t_recovery is not None:
            return self.t_recovery - self.t_break
        return None

    def to_event_data(self) -> dict[str, Any]:
        return {
            "outcome": self.outcome,
            "reason_code": self.reason_code,
            "schema_attempts": self.schema_attempts,
            "infra_retries": self.infra_retries,
            "attempts": self.attempts,
        }


def extract_response(definition: ToolDefinition, body: Any) -> dict[str, Any] | None:
    if not isinstance(body, dict):
        return None
    return {key: get_in(body, path) for key, path in definition.response_map.items()}


class Healer:
    def __init__(
        self,
        registry: ToolRegistry,
        executor: Executor,
        secrets: SecretsProvider,
        schema_client: httpx.Client,
        audit: AuditLog,
        settings: Settings,
        emitter: EventEmitter,
    ) -> None:
        self._registry = registry
        self._executor = executor
        self._secrets = secrets
        self._schema_client = schema_client
        self._audit = audit
        self._settings = settings
        self._emitter = emitter

    def _record_audit(
        self,
        definition: ToolDefinition,
        outcome: str,
        reason_code: str | None,
        *,
        verified_version: int | None,
        verified_hash: str | None,
        old_definition: dict | None,
        new_definition: dict | None,
        evidence: list[str],
        confidence: float,
        error: dict[str, Any],
        healing_path: str = "rule",
    ) -> None:
        entry = AuditEntry(
            run_id=self._emitter.run_id,
            tool=definition.name,
            error=error,
            classification=outcome,
            schema_version_before=verified_version,
            schema_version_after=verified_version,
            schema_sha256=verified_hash or "",
            old_definition=old_definition,
            new_definition=new_definition,
            evidence=evidence,
            confidence=confidence,
            outcome=outcome,
            reason_code=reason_code,
            healing_path=healing_path,
        )
        self._audit.append(entry)

    def run(
        self,
        tool_name: str,
        args: dict[str, Any],
        *,
        case_id: str = "",
        dry_run: bool = False,
    ) -> HealOutcome:
        definition = self._registry.get(tool_name)
        if definition.write:
            dry_run = True

        emitter = self._emitter
        max_schema = self._settings.max_schema_attempts
        max_infra = self._settings.max_infra_retries

        outcome = HealOutcome(outcome="failed", definition=definition)
        t_break: float | None = None
        patched_once = False
        last_error_text = ""

        # Initial attempt.
        try:
            prepared = build_request(definition, args, self._secrets, dry_run=dry_run)
        except MissingCredentialError as exc:
            emitter.emit("refused", reason_code=rc.MISSING_CREDENTIAL, detail=str(exc))
            self._record_audit(definition, "refused", rc.MISSING_CREDENTIAL,
                               verified_version=None, verified_hash=None, old_definition=None,
                               new_definition=None, evidence=[str(exc)], confidence=0.0,
                               error={"status": None, "body": str(exc)})
            outcome.outcome, outcome.reason_code = "refused", rc.MISSING_CREDENTIAL
            outcome.definition = definition
            return outcome
        except MissingValueError as exc:
            emitter.emit("refused", reason_code=rc.MISSING_REQUIRED_VALUE, detail=str(exc))
            self._record_audit(definition, "refused", rc.MISSING_REQUIRED_VALUE,
                               verified_version=None, verified_hash=None, old_definition=None,
                               new_definition=None, evidence=[str(exc)], confidence=0.0,
                               error={"status": None, "body": str(exc)})
            outcome.outcome, outcome.reason_code = "refused", rc.MISSING_REQUIRED_VALUE
            outcome.definition = definition
            return outcome

        emitter.emit("call_attempt", endpoint=definition.endpoint, body=prepared.body,
                     header_names=sorted(prepared.headers))
        outcome.attempts += 1
        result = self._executor.call(prepared)

        while True:
            if result.ok:
                return self._finish_success(definition, result, outcome, t_break)

            category = classify(result.status, result.error_type)
            emitter.emit("error_detected", status=result.status, error_type=result.error_type,
                         summary=result.error_summary())
            emitter.emit("error_classified", category=category.value, explanation=describe(category))
            last_error_text = result.error_summary()

            if category in (Category.POSSIBLE_DRIFT, Category.AUTH):
                should_heal = category is Category.POSSIBLE_DRIFT
                verified = None
                diff = None
                if category is Category.AUTH:
                    # Only a missing required header (with an available credential) is healable.
                    verified = self._fetch_schema(emitter, outcome)
                    diff = self._diff(definition, verified, emitter)
                    if not diff.added_headers:
                        emitter.emit("not_drift", reason_code=rc.AUTH_REJECTED)
                        self._record_audit(definition, "not_drift", rc.AUTH_REJECTED,
                                           verified_version=verified.version,
                                           verified_hash=verified.sha256, old_definition=None,
                                           new_definition=None, evidence=["auth error, no header delta"],
                                           confidence=0.0,
                                           error={"status": result.status, "body": result.error_summary()})
                        outcome.outcome, outcome.reason_code = "not_drift_reported", rc.AUTH_REJECTED
                        outcome.t_break = t_break or time.perf_counter()
                        outcome.definition = definition
                        outcome.error_text = last_error_text
                        return outcome
                    should_heal = True

                if t_break is None:
                    t_break = time.perf_counter()

                if outcome.schema_attempts >= max_schema:
                    emitter.emit("refused", reason_code=rc.RETRY_CAP_REACHED)
                    outcome.outcome, outcome.reason_code = "refused", rc.RETRY_CAP_REACHED
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.error_text = last_error_text
                    return outcome

                outcome.schema_attempts += 1
                if verified is None:
                    verified = self._fetch_schema(emitter, outcome)
                if diff is None:
                    diff = self._diff(definition, verified, emitter)

                if diff.is_empty:
                    if patched_once:
                        # The patch did not help: evidence says it was wrong -> roll back.
                        rolled = self._registry.rollback(definition.name, definition.revision)
                        emitter.emit("rollback", tool=rolled.name, revision=rolled.revision,
                                     reason="same error after patch")
                        self._record_audit(rolled, "rolled_back", rc.VALIDATION_FAILED,
                                           verified_version=verified.version,
                                           verified_hash=verified.sha256,
                                           old_definition=definition.to_dict(),
                                           new_definition=rolled.to_dict(),
                                           evidence=["same error after patch; no new schema delta"],
                                           confidence=0.0,
                                           error={"status": result.status, "body": result.error_summary()})
                        outcome.outcome, outcome.reason_code = "refused", rc.VALIDATION_FAILED
                        outcome.t_break = t_break
                        outcome.definition = rolled
                        outcome.error_text = last_error_text
                        return outcome
                    emitter.emit("refused", reason_code=rc.NO_EVIDENCE)
                    self._record_audit(definition, "refused", rc.NO_EVIDENCE,
                                       verified_version=verified.version,
                                       verified_hash=verified.sha256,
                                       old_definition=definition.to_dict(), new_definition=None,
                                       evidence=["no relevant schema delta explains the error"],
                                       confidence=0.0,
                                       error={"status": result.status, "body": result.error_summary()})
                    outcome.outcome, outcome.reason_code = "refused", rc.NO_EVIDENCE
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.error_text = last_error_text
                    return outcome

                patch = hypothesize(definition, verified, diff, self._secrets, args)
                emitter.emit("candidate_patch", tool=definition.name, evidence=patch.evidence,
                             confidence=patch.confidence, refused=patch.refused,
                             reason_code=patch.reason_code,
                             conversions=patch.conversions)
                if patch.refused:
                    emitter.emit("refused", reason_code=patch.reason_code)
                    self._record_audit(definition, "refused", patch.reason_code,
                                       verified_version=verified.version,
                                       verified_hash=verified.sha256,
                                       old_definition=definition.to_dict(), new_definition=None,
                                       evidence=patch.evidence, confidence=patch.confidence,
                                       error={"status": result.status, "body": result.error_summary()})
                    outcome.outcome, outcome.reason_code = "refused", patch.reason_code
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.patch = patch
                    outcome.error_text = last_error_text
                    return outcome

                patched_def = apply_patch_to_definition(definition, patch, verified)
                validation = validate_patch(patched_def, verified, args, self._secrets, dry_run=dry_run)
                emitter.emit("validation_result", ok=validation.ok, errors=validation.errors,
                             reason_code=validation.reason_code)
                if not validation.ok:
                    audit_outcome = "needs_human_review" if validation.needs_human else "refused"
                    emitter.emit("needs_human_review" if validation.needs_human else "refused",
                                 reason_code=validation.reason_code, errors=validation.errors)
                    self._record_audit(definition, audit_outcome, validation.reason_code,
                                       verified_version=verified.version,
                                       verified_hash=verified.sha256,
                                       old_definition=definition.to_dict(),
                                       new_definition=patched_def.to_dict(),
                                       evidence=patch.evidence, confidence=patch.confidence,
                                       error={"status": result.status, "body": result.error_summary()})
                    outcome.outcome = "refused"
                    outcome.reason_code = validation.reason_code
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.patch = patch
                    outcome.error_text = last_error_text
                    return outcome

                # Apply with compare-and-swap.
                old_def_dict = definition.to_dict()
                try:
                    definition = self._registry.apply(
                        definition.name, definition.revision, patched_def
                    )
                except Exception as exc:  # stale revision -> discard, re-diff next loop
                    emitter.emit("refused", reason_code=rc.NO_EVIDENCE, detail=f"stale registry revision: {exc}")
                    outcome.outcome, outcome.reason_code = "refused", rc.NO_EVIDENCE
                    outcome.definition = definition
                    return outcome

                patched_once = True
                emitter.emit("patch_applied", tool=definition.name, revision=definition.revision,
                             conversions=patch.conversions, header_names=[h["name"] for h in definition.required_headers])
                self._record_audit(definition, "applied", None,
                                   verified_version=verified.version,
                                   verified_hash=verified.sha256,
                                   old_definition=old_def_dict,
                                   new_definition=definition.to_dict(),
                                   evidence=patch.evidence, confidence=patch.confidence,
                                   error={"status": result.status, "body": result.error_summary()})

                emitter.emit("retry", attempt=outcome.attempts + 1, revision=definition.revision)
                try:
                    prepared = build_request(definition, args, self._secrets, dry_run=dry_run)
                except MissingCredentialError as exc:
                    outcome.outcome, outcome.reason_code = "refused", rc.MISSING_CREDENTIAL
                    outcome.error_text = str(exc)
                    return outcome
                outcome.attempts += 1
                result = self._executor.call(prepared)
                continue

            if category is Category.INFRA:
                outcome.infra_retries += 1
                if outcome.infra_retries > max_infra:
                    emitter.emit("not_drift", reason_code=rc.NOT_DRIFT, detail=last_error_text)
                    self._record_audit(definition, "not_drift", rc.NOT_DRIFT,
                                       verified_version=None, verified_hash=None,
                                       old_definition=None, new_definition=None,
                                       evidence=["infrastructure failure after retry budget"],
                                       confidence=0.0,
                                       error={"status": result.status, "body": last_error_text})
                    outcome.outcome, outcome.reason_code = "not_drift_reported", rc.NOT_DRIFT
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.error_text = last_error_text
                    return outcome
                emitter.emit("retry", attempt=outcome.attempts + 1, infrastructure=True)
                time.sleep(BACKOFF_S)
                outcome.attempts += 1
                result = self._executor.call(prepared)
                continue

            # RATE_LIMIT and OTHER -> report as not drift, no patch.
            emitter.emit("not_drift", reason_code=rc.NOT_DRIFT, detail=last_error_text)
            self._record_audit(definition, "not_drift", rc.NOT_DRIFT,
                               verified_version=None, verified_hash=None, old_definition=None,
                               new_definition=None,
                               evidence=[f"classified as {category.value}"], confidence=0.0,
                               error={"status": result.status, "body": last_error_text})
            outcome.outcome, outcome.reason_code = "not_drift_reported", rc.NOT_DRIFT
            outcome.t_break = t_break
            outcome.definition = definition
            outcome.error_text = last_error_text
            return outcome

    # --- helpers ----------------------------------------------------------
    def _finish_success(
        self, definition: ToolDefinition, result: CallResult, outcome: HealOutcome,
        t_break: float | None,
    ) -> HealOutcome:
        emitter = self._emitter
        data = extract_response(definition, result.body)
        if data and any(v is None for v in data.values()):
            verified = fetch_verified(self._schema_client)
            check = check_response(definition, result.body, verified)
            emitter.emit("response_check", ok=check.ok, reason_code=check.reason_code,
                         evidence=check.evidence)
            if not check.ok:
                self._record_audit(definition, "refused", check.reason_code,
                                   verified_version=verified.version,
                                   verified_hash=verified.sha256,
                                   old_definition=definition.to_dict(), new_definition=None,
                                   evidence=check.evidence, confidence=0.0,
                                   error={"status": result.status, "body": "response shape changed"})
                outcome.outcome, outcome.reason_code = "refused", check.reason_code
                outcome.t_break = t_break
                outcome.definition = definition
                outcome.final_result = result
                return outcome
            if check.adapted_map and check.adapted_map != definition.response_map:
                try:
                    definition = self._registry.apply(
                        definition.name, definition.revision,
                        definition.copy_with(response_map=check.adapted_map),
                    )
                    emitter.emit("patch_applied", tool=definition.name,
                                 revision=definition.revision, response_map=check.adapted_map)
                except Exception:
                    pass
            data = check.data

        emitter.emit("verified", status=result.status, response=data)
        outcome.outcome = "recovered"
        outcome.reason_code = None
        outcome.definition = definition
        outcome.final_result = result
        outcome.response_data = data
        outcome.t_break = t_break
        outcome.t_recovery = time.perf_counter()
        return outcome

    def _fetch_schema(self, emitter: EventEmitter, outcome: HealOutcome):
        verified = fetch_verified(self._schema_client)
        emitter.emit("schema_fetched", version=verified.version, sha256=verified.sha256,
                     error_style=verified.error_style)
        return verified

    def _diff(self, definition: ToolDefinition, verified, emitter: EventEmitter):
        diff = diff_schemas(
            definition.endpoint,
            definition.request_schema,
            verified.request_schema(definition.endpoint),
            definition.required_headers,
            verified.required_headers,
        )
        emitter.emit("schema_diff", **diff.to_event_data())
        return diff
