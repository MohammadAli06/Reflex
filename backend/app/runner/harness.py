"""Shared runtime harness: wires the mock API, registry, executor, agents, audit.

Used by the control API's run manager and by the CLI fallback so both drive the
exact same real flow.
"""
from __future__ import annotations

from typing import Any, Callable

import httpx

from ..agents.base import AgentRunResult
from ..agents.baseline_agent import BaselineAgent
from ..agents.healing_agent import HealingAgent
from ..audit.audit_log import AuditLog
from ..config import Settings
from ..healing.events import EventEmitter, Redactor, TraceEvent
from ..healing.secrets import EmptySecretsProvider, EnvSecretsProvider, SecretsProvider
from ..llm.base import LLMClient
from ..llm.gemini import build_llm
from ..registry.executor import Executor
from ..registry.tasks import Task, get_task
from ..registry.tool_registry import ToolRegistry
from ..registry.tools import initial_definitions

Subscriber = Callable[[TraceEvent], None]


class Harness:
    def __init__(
        self,
        settings: Settings,
        *,
        client: httpx.Client | None = None,
        llm: LLMClient | None = None,
        secrets: SecretsProvider | None = None,
        audit: AuditLog | None = None,
        revision_sink=None,
        snapshot_sink=None,
        provenance_sink=None,
        provenance_error_sink=None,
        run_id: str | None = None,
        definitions: dict | None = None,
        tasks: dict | None = None,
        mock_public_key: str = "",
        repair_proposer=None,
        llm_gate=None,
    ) -> None:
        self.settings = settings
        self.client = client or httpx.Client(base_url=settings.mock_api_url, timeout=5.0)
        self.llm = llm or build_llm(settings)
        self.repair_proposer = repair_proposer
        self.llm_gate = llm_gate
        self.secrets = secrets or EnvSecretsProvider(settings)
        self.redactor = Redactor([s.value for s in settings.header_secrets.values()])
        self.audit = audit or AuditLog(settings.audit_log_path, redactor=self.redactor)
        self.executor = Executor(self.client, self.secrets)
        self._revision_sink = revision_sink
        self._snapshot_sink = snapshot_sink
        self._provenance_sink = provenance_sink
        self._provenance_error_sink = provenance_error_sink
        self._run_id = run_id
        self._definitions = definitions
        self._tasks = tasks
        self._mock_public_key = mock_public_key
        self.registry = self._fresh_registry()
        self.events: list[TraceEvent] = []
        self.subscribers: list[Subscriber] = []

    def _task(self, task_id: str):
        """Resolve a task, preferring this harness's own definitions."""
        if self._tasks is not None and task_id in self._tasks:
            return self._tasks[task_id]
        return get_task(task_id)

    def _fresh_registry(self) -> ToolRegistry:
        definitions = self._definitions if self._definitions is not None else initial_definitions()
        return ToolRegistry(definitions, on_commit=self._record_revision)

    def set_definitions(self, definitions: dict | None, tasks: dict | None = None) -> None:
        """Swap the tool/task set and start from a clean registry.

        Used by the real-spec harness so one harness can serve many cases whose
        starting contract is a different OpenAPI operation each time.
        """
        self._definitions = definitions
        if tasks is not None:
            self._tasks = tasks
        self.registry = self._fresh_registry()
        self.events = []

    def _record_revision(self, name: str, definition) -> None:
        if self._revision_sink is None:
            return
        self._revision_sink(name, definition.to_dict(), self._run_id)

    def on_event(self, callback: Subscriber) -> None:
        self.subscribers.append(callback)

    # --- admin plumbing ---------------------------------------------------
    @property
    def admin_headers(self) -> dict[str, str]:
        return {"X-Admin-Key": self.settings.require_admin_key()}

    def reset(self) -> dict[str, Any]:
        resp = self.client.post("/admin/reset", headers=self.admin_headers)
        resp.raise_for_status()
        self.registry = self._fresh_registry()
        self.events = []
        return resp.json()

    def reset_registry(self) -> None:
        """Fresh tool registry only - leaves the mock's mutated schema in place."""
        self.registry = self._fresh_registry()
        self.events = []

    def apply_mutation(self, mutation_id: str, error_style: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"mutation_id": mutation_id}
        if error_style:
            payload["error_style"] = error_style
        resp = self.client.post("/admin/mutate", json=payload, headers=self.admin_headers)
        resp.raise_for_status()
        return resp.json()

    def set_error_style(self, style: str) -> None:
        resp = self.client.post("/admin/style", json={"error_style": style}, headers=self.admin_headers)
        resp.raise_for_status()

    def set_fault(self, mode: str | None, timeout_ms: int | None = None) -> None:
        payload: dict[str, Any] = {"mode": mode}
        if timeout_ms is not None:
            payload["timeout_ms"] = timeout_ms
        self.client.post("/admin/fault", json=payload, headers=self.admin_headers)

    def state(self) -> dict[str, Any]:
        return self.client.get("/admin/state", headers=self.admin_headers).json()

    def server_payload(self, endpoint: str) -> dict[str, Any]:
        key = endpoint.lstrip("/")
        return self.client.get(f"/admin/last_payload/{key}", headers=self.admin_headers).json()

    def schema(self) -> dict[str, Any]:
        return self.client.get("/openapi.json", timeout=5.0).json()

    # --- emitters ---------------------------------------------------------
    def make_emitter(self, run_id: str, agent: str, subscribers: list[Subscriber] | None = None) -> EventEmitter:
        emitter = EventEmitter(run_id, agent, redactor=self.redactor, sink=self.events)
        for sub in list(self.subscribers) + list(subscribers or []):
            emitter.subscribe(sub)
        return emitter

    # --- agents -----------------------------------------------------------
    def run_healing(
        self, task_id: str, run_id: str, *, secrets: SecretsProvider | None = None,
        emitter: EventEmitter | None = None,
    ) -> AgentRunResult:
        task = self._task(task_id)
        agent = HealingAgent(
            self.registry, self.executor, secrets or self.secrets, self.client,
            self.audit, self.settings, snapshot_sink=self._snapshot_sink,
            provenance_sink=self._provenance_sink,
            provenance_error_sink=self._provenance_error_sink,
            mock_public_key=self._mock_public_key,
            repair_proposer=self.repair_proposer,
            llm_gate=self.llm_gate,
        )
        emitter = emitter or self.make_emitter(run_id, "healing")
        return agent.run(task, run_id, emitter=emitter)

    def run_healing_tool(
        self, tool: str, args: dict[str, Any], run_id: str, *,
        emitter: EventEmitter | None = None,
    ) -> AgentRunResult:
        """Run a caller-supplied invocation through the same healing agent."""
        definition = self.registry.get(tool)
        task = Task(id=f"sdk:{tool}", tool=tool, args=dict(args),
                    description="SDK invocation", write=definition.write)
        agent = HealingAgent(
            self.registry, self.executor, self.secrets, self.client,
            self.audit, self.settings, snapshot_sink=self._snapshot_sink,
            provenance_sink=self._provenance_sink,
            provenance_error_sink=self._provenance_error_sink,
            mock_public_key=self._mock_public_key,
            repair_proposer=self.repair_proposer,
            llm_gate=self.llm_gate,
        )
        emitter = emitter or self.make_emitter(run_id, "healing")
        return agent.run(task, run_id, emitter=emitter)

    def run_baseline(self, task_id: str, run_id: str, *, emitter: EventEmitter | None = None) -> AgentRunResult:
        task = self._task(task_id)
        agent = BaselineAgent(
            self.registry, self.executor, self.secrets, self.client, self.settings, self.llm
        )
        emitter = emitter or self.make_emitter(run_id, "baseline")
        return agent.run(task, run_id, emitter=emitter)

    def empty_secrets(self) -> SecretsProvider:
        return EmptySecretsProvider()
