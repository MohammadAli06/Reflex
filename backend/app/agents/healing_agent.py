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
    ) -> None:
        self._registry = registry
        self._executor = executor
        self._secrets = secrets
        self._schema_client = schema_client
        self._audit = audit
        self._settings = settings
        self._snapshot_sink = snapshot_sink

    def run(self, task: Task, run_id: str, *, emitter: EventEmitter | None = None) -> AgentRunResult:
        emitter = emitter or EventEmitter(run_id, "healing")
        emitter.emit("run_started", agent="healing", task_id=task.id, tool=task.tool)
        emitter.emit("task_started", task_id=task.id, args=task.args, write=task.write)

        healer = Healer(
            self._registry, self._executor, self._secrets, self._schema_client,
            self._audit, self._settings, emitter,
            snapshot_sink=self._snapshot_sink,
        )
        outcome = healer.run(task.tool, task.args, case_id=task.id, dry_run=task.write)

        emitter.emit("run_finished", agent="healing", **outcome.to_event_data())

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
            tokens_input=0,
            tokens_output=0,
            healing_path="rule",
            response_data=outcome.response_data,
            error_text=outcome.error_text,
            model="rule-based",
            tokens_reported=True,
        )
