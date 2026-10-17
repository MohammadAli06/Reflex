"""The healing engine: classify -> fetch -> diff -> hypothesize -> validate ->
apply -> retry -> verify -> roll back on evidence.

Bounded by the shared schema-attempt cap. A failed candidate is never replayed;
a further candidate is only considered after a fresh schema fetch that reveals a
materially different change.
"""
from __future__ import annotations

import copy
import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlsplit

import httpx

from ..audit.audit_log import AuditEntry, AuditLog
from ..config import Settings
from ..healing.exchange import build_call_exchange
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
from .llm_fallback import (
    ProposerMeta,
    RepairOutcome,
    RepairProposer,
    build_repair_context_for_prompt,
    proposal_to_candidate_patch,
)
from .response_check import check_response
from .schema_diff import diff_schemas
from .schema_fetch import UntrustedSchemaError, fetch_verified
from .secrets import SecretsProvider
from .validate import validate_patch
from ..security.budget import RunBudget
from ..security.policy import load_security_policy
from ..security.repair_policies import check_repair_policies

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
    llm_tokens: dict[str, int] = field(default_factory=lambda: {"input": 0, "output": 0})
    llm_meta: dict[str, Any] | None = None
    model: str = ""

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
        snapshot_sink=None,
        provenance_sink=None,
        provenance_error_sink=None,
        mock_public_key: str = "",
        repair_proposer: RepairProposer | None = None,
        policy=None,
        llm_gate=None,
    ) -> None:
        self._registry = registry
        self._executor = executor
        self._secrets = secrets
        self._schema_client = schema_client
        self._audit = audit
        self._settings = settings
        self._emitter = emitter
        self._snapshot_sink = snapshot_sink
        self._provenance_sink = provenance_sink
        self._provenance_error_sink = provenance_error_sink
        self._mock_public_key = mock_public_key
        self._repair_proposer = repair_proposer
        if llm_gate is None:
            self._llm_gate = lambda: settings.llm_repair_enabled
        else:
            self._llm_gate = llm_gate
        self._policy = policy or load_security_policy(settings, env={})

    def _verified(self) -> "VerifiedSchema":
        """Fetch the schema with provenance checks applied when enabled.

        Verification is only enforced when a public key is actually resolvable
        (pinned in settings, or discovered from the mock). With the flag on and
        no key anywhere, the fetch refuses rather than trusting blindly.
        """
        key = self._settings.pinned_schema_public_key or self._mock_public_key
        return fetch_verified(
            self._schema_client,
            pinned_public_key=key,
            require_signature=self._settings.schema_signing_enabled and bool(key),
            exchange_sink=lambda exchange: self._emitter.emit("http_exchange", **exchange),
        )

    def _refuse_untrusted(self, outcome: "HealOutcome", definition: ToolDefinition,
                          exc: Exception) -> None:
        """A schema we cannot authenticate is never diffed or patched."""
        self._emitter.emit("refused", reason_code=rc.UNTRUSTED_SCHEMA, detail=str(exc))
        if self._provenance_error_sink is not None:
            try:
                self._provenance_error_sink(exc)
            except Exception:
                pass
        self._record_audit(definition, "refused", rc.UNTRUSTED_SCHEMA,
                           verified_version=None, verified_hash=None,
                           old_definition=None, new_definition=None,
                           evidence=[f"schema provenance check failed: {exc}"],
                           confidence=0.0, error={"status": None, "body": str(exc)})
        outcome.outcome, outcome.reason_code = "refused", rc.UNTRUSTED_SCHEMA
        outcome.definition = definition
        outcome.error_text = str(exc)

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
        llm_usage: dict[str, int] | None = None,
        llm_meta: dict[str, Any] | None = None,
        provenance: dict[str, Any] | None = None,
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
            llm_usage=llm_usage or {"input": 0, "output": 0},
            llm_meta=llm_meta,
            provenance=provenance,
        )
        self._audit.append(entry)

    def _provenance(self, verified: Any) -> dict[str, Any]:
        """Provenance of the spec a patch was built from (host names only)."""
        try:
            host = urlsplit(str(self._schema_client.base_url)).hostname or ""
        except Exception:
            host = ""
        return {
            "source_host": host,
            "sha256": getattr(verified, "sha256", None),
            "spec_version": getattr(verified, "version", None),
            "signature_verified": bool(getattr(verified, "signature_verified", False)),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }

    def _llm_fallback(
        self,
        definition: ToolDefinition,
        verified: Any,
        diff: Any,
        result: CallResult,
        args: dict[str, Any],
        rule_reason: str,
    ) -> RepairOutcome | None:
        """Attempt one LLM proposal; None means the fallback was not consulted.

        Consulted only between *no-candidate* rule refusals. A rule refusal in
        ``FINAL_REFUSAL_CODES`` (lossy conversion, missing values/credentials,
        policy blocks, etc.) is final and never overridden here.
        """
        if self._repair_proposer is None or not self._llm_gate():
            return None
        if rule_reason not in rc.LLM_ELIGIBLE_CODES:
            return None
        context = build_repair_context_for_prompt(
            definition, verified, diff, result,
            args=args,
            secret_values=[s.value for s in self._settings.header_secrets.values()],
        )
        try:
            return self._repair_proposer.propose_repair(context)
        except Exception as exc:
            # The proposer must never crash the run: any provider error
            # becomes a plain LLM_UNAVAILABLE refusal.
            return RepairOutcome(
                refused=True,
                reason_code=rc.LLM_UNAVAILABLE,
                detail=f"llm provider error: {exc}",
                meta=ProposerMeta(model=self._repair_proposer.model, tokens_reported=False),
            )

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
        budget = RunBudget(self._policy)

        outcome = HealOutcome(outcome="failed", definition=definition)
        t_break: float | None = None
        patched_once = False
        last_error_text = ""

        def _fingerprint(current_prepared: PreparedRequest, current_result: CallResult) -> str:
            """Loop detector key: identical payload + error shape, sent again."""
            try:
                body_repr = json.dumps(current_prepared.body, sort_keys=True, default=str)
            except Exception:
                body_repr = "<unserializable>"
            return (f"{current_prepared.method}|{current_prepared.endpoint}|{body_repr}|"
                    f"{current_result.status}|{current_result.error_summary()}")

        def _refuse_budget(code: str, detail: str) -> HealOutcome:
            emitter.emit("refused", reason_code=code, detail=detail)
            try:
                self._record_audit(definition, "refused", code,
                                   verified_version=None, verified_hash=None,
                                   old_definition=None, new_definition=None,
                                   evidence=[detail], confidence=0.0,
                                   error={"status": None, "body": detail})
            except Exception:
                pass
            outcome.outcome, outcome.reason_code = "refused", code
            outcome.t_break = t_break or time.perf_counter()
            outcome.definition = definition
            outcome.error_text = detail
            return outcome

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
        emitter.emit("http_exchange", **build_call_exchange(
            step="healing_call", base_url=self._executor.base_url(),
            prepared=prepared, result=result, attempt=outcome.attempts))

        while True:
            if result.ok:
                return self._finish_success(definition, result, outcome, t_break)

            # Guardrail fast-paths: the breaker- and guard-level error types
            # never go through drift classification.
            if result.error_type == "circuit_open":
                emitter.emit("refused", reason_code=rc.CIRCUIT_OPEN,
                             detail=result.error_summary())
                self._record_audit(definition, "refused", rc.CIRCUIT_OPEN,
                                   verified_version=None, verified_hash=None,
                                   old_definition=None, new_definition=None,
                                   evidence=[result.error_summary() or "circuit breaker open"],
                                   confidence=0.0,
                                   error={"status": None, "body": result.error_summary()})
                outcome.outcome, outcome.reason_code = "refused", rc.CIRCUIT_OPEN
                outcome.t_break = t_break or time.perf_counter()
                outcome.definition = definition
                outcome.error_text = result.error_summary()
                return outcome
            if result.error_type in ("ssrf_blocked", "response_too_large"):
                emitter.emit("refused", reason_code=rc.NOT_DRIFT,
                             detail=result.error_summary())
                self._record_audit(definition, "refused", rc.NOT_DRIFT,
                                   verified_version=None, verified_hash=None,
                                   old_definition=None, new_definition=None,
                                   evidence=[result.error_summary() or "outbound call blocked"],
                                   confidence=0.0,
                                   error={"status": None, "body": result.error_summary()})
                outcome.outcome, outcome.reason_code = "not_drift_reported", rc.NOT_DRIFT
                outcome.t_break = t_break or time.perf_counter()
                outcome.definition = definition
                outcome.error_text = result.error_summary()
                return outcome

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
                    if verified is None:
                        outcome.t_break = t_break
                        return outcome
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

                # Loop detection: the same payload producing the same error
                # shape means nothing changed - stop instead of repeating.
                if budget.check_loop(_fingerprint(prepared, result)):
                    outcome.t_break = t_break
                    return _refuse_budget(rc.LOOP_DETECTED, "same payload produced the same error again; no change made")
                if budget.time_exceeded(self._policy.max_run_seconds):
                    outcome.t_break = t_break
                    return _refuse_budget(rc.RETRY_BUDGET_EXCEEDED,
                                          f"run exceeded {self._policy.max_run_seconds}s wall time budget")

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
                    if verified is None:
                        outcome.t_break = t_break
                        return outcome
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
                                           error={"status": result.status, "body": result.error_summary()},
                                           healing_path=outcome.healing_path,
                                           llm_usage=outcome.llm_tokens if outcome.healing_path == "llm" else None,
                                           llm_meta=({**(outcome.llm_meta or {}), "verdict": "rolled_back"}
                                                     if outcome.healing_path == "llm" else None))
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
                llm_used = False
                if patch.refused:
                    # Rules give up here. The LLM is consulted ONLY on the
                    # no-candidate codes (unrecognized or ambiguous drift);
                    # safety refusals above are final and never overridden.
                    llm_outcome = self._llm_fallback(
                        definition, verified, diff, result, args, patch.reason_code,
                    )
                    if llm_outcome is not None:
                        llm_used = True
                        meta = llm_outcome.meta or ProposerMeta()
                        outcome.model = meta.model
                        outcome.healing_path = "llm"
                        tokens = {"input": meta.input_tokens, "output": meta.output_tokens}
                        outcome.llm_tokens = tokens
                        if llm_outcome.proposal is not None:
                            llm_patch, llm_refusal, llm_errors = proposal_to_candidate_patch(
                                llm_outcome.proposal, definition, verified, args,
                            )
                            if llm_patch is None:
                                outcome.llm_meta = {**meta.to_dict(), "verdict": "refused", "reason_code": llm_refusal}
                                reason = llm_refusal
                                emitter.emit("llm_refused", reason_code=reason,
                                             detail=(llm_errors or ["proposal not usable"])[0],
                                             model=meta.model)
                            else:
                                outcome.llm_meta = {**meta.to_dict()}
                                emitter.emit("llm_proposal", model=meta.model,
                                             prompt_sha256=meta.prompt_sha256,
                                             input_tokens=meta.input_tokens,
                                             output_tokens=meta.output_tokens,
                                             latency_s=meta.latency_s, confidence=meta.confidence,
                                             rationale=llm_outcome.proposal.rationale)
                                patch = llm_patch
                        else:
                            reason = llm_outcome.reason_code or rc.LLM_UNAVAILABLE
                            outcome.llm_meta = {**meta.to_dict(), "verdict": "refused"}
                            emitter.emit("llm_refused", reason_code=reason,
                                         detail=llm_outcome.detail, model=meta.model)
                        if patch.refused:
                            emitter.emit("refused", reason_code=reason)
                            self._record_audit(definition, "refused", reason,
                                               verified_version=verified.version,
                                               verified_hash=verified.sha256,
                                               old_definition=definition.to_dict(), new_definition=None,
                                               evidence=patch.evidence, confidence=0.0,
                                               error={"status": result.status, "body": result.error_summary()},
                                               healing_path="llm",
                                               llm_usage=tokens, llm_meta=outcome.llm_meta)
                            outcome.outcome, outcome.reason_code = "refused", reason
                            outcome.t_break = t_break
                            outcome.definition = definition
                            outcome.patch = patch
                            outcome.error_text = last_error_text
                            return outcome
                    else:
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
                    refusal_reason = validation.reason_code
                    if llm_used and not validation.needs_human:
                        refusal_reason = rc.LLM_VALIDATION_FAILED
                    emitter.emit("needs_human_review" if validation.needs_human else "refused",
                                 reason_code=refusal_reason, errors=validation.errors)
                    self._record_audit(definition, audit_outcome, refusal_reason,
                                       verified_version=verified.version,
                                       verified_hash=verified.sha256,
                                       old_definition=definition.to_dict(),
                                       new_definition=patched_def.to_dict(),
                                       evidence=patch.evidence + validation.errors,
                                       confidence=patch.confidence,
                                       error={"status": result.status, "body": result.error_summary()},
                                       healing_path=patch.healing_path,
                                       llm_usage=outcome.llm_tokens if llm_used else None,
                                       llm_meta=({**(outcome.llm_meta or {}), "verdict": "validation_failed"}
                                                 if llm_used else None))
                    outcome.outcome = "refused"
                    outcome.reason_code = refusal_reason
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.patch = patch
                    outcome.error_text = last_error_text
                    return outcome

                # Safe-repair policies extend the validator: the patch may not
                # touch anything the observed diff does not explain.
                policy_refusal = check_repair_policies(patch, definition, diff)
                if policy_refusal:
                    emitter.emit("refused", reason_code=policy_refusal, errors=[])
                    self._record_audit(definition, "refused", policy_refusal,
                                       verified_version=verified.version,
                                       verified_hash=verified.sha256,
                                       old_definition=definition.to_dict(),
                                       new_definition=patched_def.to_dict(),
                                       evidence=patch.evidence, confidence=0.0,
                                       error={"status": result.status, "body": result.error_summary()},
                                       healing_path=patch.healing_path,
                                       llm_usage=outcome.llm_tokens if llm_used else None)
                    outcome.outcome, outcome.reason_code = "refused", policy_refusal
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.patch = patch
                    outcome.error_text = last_error_text
                    return outcome

                if not budget.register_patch():
                    emitter.emit("refused", reason_code=rc.RETRY_BUDGET_EXCEEDED,
                                 detail="patch attempt budget exhausted")
                    self._record_audit(definition, "refused", rc.RETRY_BUDGET_EXCEEDED,
                                       verified_version=verified.version,
                                       verified_hash=verified.sha256,
                                       old_definition=definition.to_dict(), new_definition=None,
                                       evidence=["patch budget exhausted before apply"],
                                       confidence=0.0,
                                       error={"status": result.status, "body": result.error_summary()})
                    outcome.outcome, outcome.reason_code = "refused", rc.RETRY_BUDGET_EXCEEDED
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.error_text = last_error_text
                    return outcome

                # Apply with compare-and-swap. Audit-first (fail-closed): if the
                # audit write cannot be made, the patch is not applied.
                old_def_dict = definition.to_dict()
                old_revision = definition.revision
                if llm_used and outcome.llm_meta is not None:
                    outcome.llm_meta["verdict"] = "applied"
                try:
                    self._record_audit(definition, "applied", None,
                                       verified_version=verified.version,
                                       verified_hash=verified.sha256,
                                       old_definition=old_def_dict,
                                       new_definition=patched_def.to_dict(),
                                       evidence=patch.evidence, confidence=patch.confidence,
                                       error={"status": result.status, "body": result.error_summary()},
                                       healing_path=patch.healing_path,
                                       llm_usage=outcome.llm_tokens if llm_used else None,
                                       llm_meta=outcome.llm_meta if llm_used else None,
                                       provenance=self._provenance(verified))
                except Exception as exc:
                    emitter.emit("refused", reason_code=rc.AUDIT_UNAVAILABLE, detail=str(exc))
                    try:
                        self._record_audit(definition, "refused", rc.AUDIT_UNAVAILABLE,
                                           verified_version=verified.version,
                                           verified_hash=verified.sha256,
                                           old_definition=old_def_dict,
                                           new_definition=patched_def.to_dict(),
                                           evidence=[f"audit write failed; patch not applied: {exc}"],
                                           confidence=0.0,
                                           error={"status": result.status, "body": last_error_text},
                                           healing_path=patch.healing_path,
                                           llm_usage=outcome.llm_tokens if llm_used else None)
                    except Exception:
                        pass
                    outcome.outcome, outcome.reason_code = "refused", rc.AUDIT_UNAVAILABLE
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.patch = patch
                    outcome.error_text = last_error_text
                    return outcome
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
                             revision_before=old_revision,
                             conversions=patch.conversions, header_names=[h["name"] for h in definition.required_headers])

                if not budget.register_retry():
                    emitter.emit("refused", reason_code=rc.RETRY_BUDGET_EXCEEDED,
                                 detail="retry budget exhausted before the retry call")
                    self._record_audit(definition, "refused", rc.RETRY_BUDGET_EXCEEDED,
                                       verified_version=verified.version,
                                       verified_hash=verified.sha256,
                                       old_definition=old_def_dict,
                                       new_definition=definition.to_dict(),
                                       evidence=["retries exhausted; patched definition stays, no further calls"],
                                       confidence=0.0,
                                       error={"status": result.status, "body": result.error_summary()},
                                       healing_path=patch.healing_path,
                                       llm_usage=outcome.llm_tokens if llm_used else None)
                    outcome.outcome, outcome.reason_code = "refused", rc.RETRY_BUDGET_EXCEEDED
                    outcome.t_break = t_break
                    outcome.definition = definition
                    outcome.error_text = last_error_text
                    return outcome
                emitter.emit("retry", attempt=outcome.attempts + 1, revision=definition.revision)
                try:
                    prepared = build_request(definition, args, self._secrets, dry_run=dry_run)
                except MissingCredentialError as exc:
                    outcome.outcome, outcome.reason_code = "refused", rc.MISSING_CREDENTIAL
                    outcome.error_text = str(exc)
                    return outcome
                outcome.attempts += 1
                result = self._executor.call(prepared)
                emitter.emit("http_exchange", **build_call_exchange(
                    step="retry_call", base_url=self._executor.base_url(),
                    prepared=prepared, result=result, attempt=outcome.attempts))
                continue

            if category is Category.INFRA:
                if not budget.register_retry():
                    outcome.t_break = t_break or time.perf_counter()
                    return _refuse_budget(rc.RETRY_BUDGET_EXCEEDED, "retry budget exhausted on infra retries")
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
                emitter.emit("http_exchange", **build_call_exchange(
                    step="infra_retry", base_url=self._executor.base_url(),
                    prepared=prepared, result=result, attempt=outcome.attempts))
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
            try:
                verified = self._verified()
            except UntrustedSchemaError as exc:
                self._refuse_untrusted(outcome, definition, exc)
                outcome.t_break = t_break
                outcome.final_result = result
                return outcome
            if self._snapshot_sink is not None:
                try:
                    self._snapshot_sink(verified)
                except Exception:
                    pass
            if self._provenance_sink is not None:
                try:
                    self._provenance_sink(verified)
                except Exception:
                    pass
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
                before_revision = definition.revision
                try:
                    definition = self._registry.apply(
                        definition.name, definition.revision,
                        definition.copy_with(response_map=check.adapted_map),
                    )
                    emitter.emit("patch_applied", tool=definition.name,
                                 revision=definition.revision, revision_before=before_revision,
                                 response_map=check.adapted_map)
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
        try:
            verified = self._verified()
        except UntrustedSchemaError as exc:
            self._refuse_untrusted(outcome, outcome.definition, exc)
            return None
        if self._snapshot_sink is not None:
            try:
                self._snapshot_sink(verified)
            except Exception:
                pass
        if self._provenance_sink is not None:
            try:
                self._provenance_sink(verified)
            except Exception:
                pass
        emitter.emit("schema_fetched", version=verified.version, sha256=verified.sha256,
                     error_style=verified.error_style,
                     signature_verified=verified.signature_verified,
                     key_fingerprint=verified.key_fingerprint)
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
