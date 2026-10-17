"""Self-healing agent: joins task execution, healing, trace events and audit.

Rule-based healing uses no LLM tokens, so ``T_heal`` is reported as 0 and the
path is flagged ``rule_based`` (measured, not estimated).
"""
from __future__ import annotations

import httpx

from ..audit.audit_log import AuditLog
from ..config import Settings
from ..healing.events import EventEmitter
from ..healing.healer import Healer
from ..healing.secrets import SecretsProvider
from ..registry.executor import Executor
from ..registry.tasks import Task
from ..registry.tool_registry import ToolRegistry
from ..registry.tools import definition_snapshot
from .base import AgentRunResult


class HealingAgent:
    def __init__(
        self,
        registry: ToolRegistry,
        executor: Executor,
        secrets: SecretsProvider,
        schema_client: httpx.Client,
        audit: AuditLog,
        settings: Settings,
        snapshot_sink=None,
        provenance_sink=None,
        provenance_error_sink=None,
        mock_public_key: str = "",
        repair_proposer=None,
        llm_gate=None,
    ) -> None:
        self._registry = registry
        self._executor = executor
        self._secrets = secrets
        self._schema_client = schema_client
        self._audit = audit
        self._settings = settings
        self._snapshot_sink = snapshot_sink
        self._provenance_sink = provenance_sink
        self._provenance_error_sink = provenance_error_sink
        self._mock_public_key = mock_public_key
        self._repair_proposer = repair_proposer
        self._llm_gate = llm_gate

    def run(self, task: Task, run_id: str, *, emitter: EventEmitter | None = None) -> AgentRunResult:
        emitter = emitter or EventEmitter(run_id, "healing")
        definition = self._registry.get(task.tool)
        emitter.emit("run_started", agent="healing", task_id=task.id, tool=task.tool,
                     tool_definition=definition_snapshot(definition))
        emitter.emit("task_started", task_id=task.id, args=task.args, write=task.write)

        healer = Healer(
            self._registry, self._executor, self._secrets, self._schema_client,
            self._audit, self._settings, emitter,
            snapshot_sink=self._snapshot_sink,
            provenance_sink=self._provenance_sink,
            provenance_error_sink=self._provenance_error_sink,
            mock_public_key=self._mock_public_key,
            repair_proposer=self._repair_proposer,
            llm_gate=self._llm_gate,
        )
        outcome = healer.run(task.tool, task.args, case_id=task.id, dry_run=task.write)

        emitter.emit("run_finished", agent="healing", **outcome.to_event_data())

        llm_tokens = outcome.llm_tokens or {}
        return AgentRunResult(
            agent="healing",
            task_id=task.id,
            outcome=outcome.outcome,
            reason_code=outcome.reason_code,
            attempts=outcome.attempts,
            schema_attempts=outcome.schema_attempts,
            infra_retries=outcome.infra_retries,
            t_break=outcome.t_break,
            t_recovery=outcome.t_recovery,
            mttr=outcome.mttr,
            tokens_input=int(llm_tokens.get("input", 0) or 0),
            tokens_output=int(llm_tokens.get("output", 0) or 0),
            healing_path=outcome.healing_path,
            response_data=outcome.response_data,
            error_text=outcome.error_text,
            model=outcome.model or "rule-based",
            tokens_reported=True,
        )
