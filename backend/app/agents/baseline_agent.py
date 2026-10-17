"""Baseline agent: a plain tool-calling loop with a FIXED tool schema.

It uses the same model, tasks, mock API, error text, ``/openapi.json`` access and
retry cap as the healer, but has no healing layer and never patches its tool
schema. A plain loop is used instead of LangChain (documented in the parity
report); the baseline is not weakened and its failures are reported honestly.
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from ..config import Settings
from ..healing.events import EventEmitter
from ..healing.exchange import build_call_exchange, build_exchange
from ..llm.base import LLMClient
from ..registry.executor import (
    CallResult,
    Executor,
    MissingCredentialError,
    MissingValueError,
    build_request,
)
from ..healing.secrets import SecretsProvider
from ..registry.tasks import Task
from ..registry.tool_registry import ToolRegistry
from ..registry.tools import ToolDefinition, definition_snapshot
from .base import AgentRunResult

FETCH_SCHEMA_TOOL = {
    "name": "fetch_schema",
    "description": "Read the API's current /openapi.json schema",
    "parameters": {"type": "object", "properties": {}, "required": []},
}


class BaselineAgent:
    def __init__(
        self,
        registry: ToolRegistry,
        executor: Executor,
        secrets: SecretsProvider,
        schema_client: httpx.Client,
        settings: Settings,
        llm: LLMClient,
    ) -> None:
        self._executor = executor
        self._secrets = secrets
        self._schema_client = schema_client
        self._settings = settings
        self._llm = llm
        # Freeze the definitions exactly as they are at run start.
        self._frozen: dict[str, ToolDefinition] = {
            name: registry.get(name) for name in registry.list_names()
        }

    def _schema_text(self, emitter: EventEmitter | None = None) -> str:
        started = time.perf_counter()
        url = str(self._schema_client.base_url).rstrip("/") + "/openapi.json"
        try:
            text = self._schema_client.get("/openapi.json", timeout=5.0).text
            if emitter is not None:
                emitter.emit("http_exchange", **build_exchange(
                    step="schema_probe", method="GET", url=url,
                    response_status=200, response_body=text[:800],
                    duration_s=time.perf_counter() - started))
            return text
        except Exception as exc:
            if emitter is not None:
                emitter.emit("http_exchange", **build_exchange(
                    step="schema_probe", method="GET", url=url, error=str(exc),
                    duration_s=time.perf_counter() - started))
            return ""

    def _tool_schema(self, definition: ToolDefinition) -> dict[str, Any]:
        return {
            "name": definition.name,
            "description": f"Call {definition.endpoint}",
            "parameters": definition.request_schema,
        }

    def run(self, task: Task, run_id: str, *, emitter: EventEmitter | None = None) -> AgentRunResult:
        emitter = emitter or EventEmitter(run_id, "baseline")
        definition = self._frozen[task.tool]
        emitter.emit("run_started", agent="baseline", task_id=task.id, tool=task.tool,
                     tool_definition=definition_snapshot(definition))
        emitter.emit("task_started", task_id=task.id, args=task.args, write=task.write)

        tokens_in = tokens_out = 0
        attempts = 0
        t_break: float | None = None
        max_attempts = self._settings.max_schema_attempts
        last_error = ""

        result: CallResult | None = None
        for _ in range(max_attempts):
            try:
                prepared = build_request(definition, task.args, self._secrets, dry_run=task.write)
            except (MissingValueError, MissingCredentialError) as exc:
                last_error = str(exc)
                break
            emitter.emit("call_attempt", endpoint=definition.endpoint, body=prepared.body)
            attempts += 1
            result = self._executor.call(prepared)
            emitter.emit("http_exchange", **build_call_exchange(
                step="baseline_call", base_url=self._executor.base_url(),
                prepared=prepared, result=result, attempt=attempts))
            if result.ok:
                return self._success(definition, result, task, emitter, attempts, t_break,
                                     tokens_in, tokens_out)
            if t_break is None:
                t_break = time.perf_counter()
            last_error = result.error_summary()
            emitter.emit("error_detected", status=result.status, error_type=result.error_type,
                         summary=last_error)
            # The baseline may consult the LLM and the schema, but its tool schema is fixed,
            # so it can only retry the same payload. A provider failure never
            # takes the run down: the consult only feeds token accounting, and
            # the baseline keeps its fixed-schema retry loop regardless.
            try:
                llm_result = self._llm.generate(
                    messages=[
                        {"role": "system", "content": "You are a tool-calling agent. Fix the call."},
                        {"role": "user", "content":
                            f"Tool {definition.name} failed with: {last_error}. "
                            f"Current schema: {self._schema_text()[:2000]}"},
                    ],
                    tools=[self._tool_schema(definition), FETCH_SCHEMA_TOOL],
                )
                tokens_in += llm_result.input_tokens
                tokens_out += llm_result.output_tokens
            except Exception as exc:  # noqa: BLE001 - provider errors are not run failures
                emitter.emit("retry", note=f"llm consult failed: {exc}")
                emitter.emit("retry", attempt=attempts + 1, note="baseline retries the same payload")
                continue
            emitter.emit("retry", attempt=attempts + 1, note="baseline retries the same payload")

        emitter.emit("run_finished", agent="baseline", outcome="failed",
                     reason_code="retry_cap_reached", attempts=attempts)
        return AgentRunResult(
            agent="baseline",
            task_id=task.id,
            outcome="failed",
            reason_code="retry_cap_reached",
            attempts=attempts,
            schema_attempts=attempts,
            t_break=t_break,
            t_recovery=None,
            mttr=None,
            tokens_input=tokens_in,
            tokens_output=tokens_out,
            healing_path="none",
            error_text=last_error,
            model=self._llm.model,
            tokens_reported=True,
        )

    def _success(self, definition, result, task, emitter, attempts, t_break, tokens_in, tokens_out):
        emitter.emit("verified", status=result.status)
        emitter.emit("run_finished", agent="baseline", outcome="recovered", attempts=attempts)
        t_recovery = time.perf_counter()
        return AgentRunResult(
            agent="baseline",
            task_id=task.id,
            outcome="recovered",
            attempts=attempts,
            t_break=t_break,
            t_recovery=t_recovery,
            mttr=(t_recovery - t_break) if t_break is not None else None,
            tokens_input=tokens_in,
            tokens_output=tokens_out,
            healing_path="none",
            model=self._llm.model,
            tokens_reported=True,
        )
