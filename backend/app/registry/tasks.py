"""Task definitions: what the agent is asked to do.

``args`` are the *original* argument values. They carry an implicit provenance
of "task_argument" which the healer must preserve when building a patch.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class Task:
    id: str
    tool: str
    args: dict[str, Any]
    description: str = ""
    write: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "tool": self.tool, "args": self.args,
                "description": self.description, "write": self.write}


TASKS: dict[str, Task] = {
    "normal_fetch": Task(
        id="normal_fetch",
        tool="fetch_user",
        args={"user_id": "123"},
        description="Fetch a user by id (idempotent, safe to retry)",
    ),
    "lossy_fetch": Task(
        id="lossy_fetch",
        tool="fetch_user",
        args={"user_id": "00123"},
        description="Fetch a user whose id has a leading zero (lossy if coerced)",
    ),
    "normal_update": Task(
        id="normal_update",
        tool="update_user",
        args={"user_id": "123", "display_name": "Grace Hopper"},
        description="Update a user's display name (write; uses dry_run)",
        write=True,
    ),
}


def get_task(task_id: str) -> Task:
    if task_id not in TASKS:
        raise KeyError(task_id)
    return TASKS[task_id]


def list_tasks() -> list[dict[str, Any]]:
    return [t.to_dict() for t in TASKS.values()]
