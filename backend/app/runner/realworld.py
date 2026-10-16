"""Run vendored real-spec cases through the same baseline/healing harness.

A real case is prepared in three steps:
1. load the NEW revision into the mock so the served contract has drifted;
2. build the tool registry from the OLD revision, so the agent starts correct;
3. hand the agent the operation's task arguments.

Everything after that is the normal pipeline - no special-casing inside the
healer or the executor.
"""
from __future__ import annotations

import re
from typing import Any

from ..realworld.spec_loader import extract_operation, load_spec
from ..registry.tasks import Task
from ..registry.tools import ToolDefinition
from .cases import Case

_PATH_PARAM = re.compile(r"\{([^}]+)\}")


def concrete_endpoint(operation: str, task_args: dict[str, Any]) -> str:
    """Substitute path parameters so the executor can call a real URL."""
    _, path = operation.split(" ", 1)
    missing: list[str] = []

    def substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in task_args:
            missing.append(name)
            return match.group(0)
        return str(task_args[name])

    endpoint = _PATH_PARAM.sub(substitute, path)
    if missing:
        raise ValueError(f"operation {operation} needs path args: {', '.join(missing)}")
    return endpoint


def tool_name(case: Case) -> str:
    return f"real_{case.id}"


def build_task(case: Case) -> Task:
    return Task(
        id=case.task_id,
        tool=tool_name(case),
        args=dict(case.task_args),
        description=f"{case.api} {case.operation} ({case.change_kind})",
        write=False,
    )


def build_definitions(case: Case) -> dict[str, ToolDefinition]:
    """The agent's starting point: the contract as it was BEFORE the drift."""
    if not case.old_ref or not case.api or not case.operation:
        raise ValueError(f"real case {case.id} is missing api/operation/old_ref")
    spec = load_spec(case.api, case.old_ref)
    extracted = extract_operation(spec, case.operation)
    endpoint = concrete_endpoint(case.operation, case.task_args)
    request_schema = extracted["request_schema"]

    bindings: dict[str, dict[str, Any]] = {}
    for field in sorted(request_schema.get("properties", {})):
        if field in case.task_args:
            bindings[field] = {"source": "arg", "arg": field, "convert": None}

    response_schema = _response_schema(spec, case.operation)
    definition = ToolDefinition(
        name=tool_name(case),
        endpoint=endpoint,
        method="POST",
        request_schema=request_schema,
        required_headers=list(extracted["required_headers"]),
        response_schema=response_schema,
        bindings=bindings,
        response_map={},
        write=False,
        revision=1,
    )
    return {definition.name: definition}


def _response_schema(spec: dict[str, Any], operation: str) -> dict[str, Any]:
    method, path = operation.split(" ", 1)
    item = spec["paths"][path][method.lower()]
    return (item.get("responses", {}).get("200", {})
            .get("content", {}).get("application/json", {})
            .get("schema", {"type": "object"}))


def load_new_contract(harness, case: Case) -> dict[str, Any]:
    """Point the mock at the NEW revision for this case."""
    if not case.new_ref or not case.api or not case.operation:
        raise ValueError(f"real case {case.id} is missing api/operation/new_ref")
    spec = load_spec(case.api, case.new_ref)
    response = harness.client.post(
        "/admin/load_openapi",
        json={"spec": spec, "operation": case.operation},
        headers=harness.admin_headers,
    )
    response.raise_for_status()
    return response.json()
