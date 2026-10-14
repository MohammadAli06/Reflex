"""Runs a baseline+healing comparison in a background thread and tracks state.

Only one comparison run may be active at a time; starting another returns busy.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from ..config import Settings
from ..healing.events import TraceEvent
from ..runner.cases import get_case
from ..runner.harness import Harness
from ..runner.records import RunRecord
from ..runner.run_suite import run_single_case, save_results


class BusyError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class RunState:
    run_id: str
    case_ids: list[str]
    repeats: int = 1
    status: str = "running"  # running | finished | error
    records: list[RunRecord] = field(default_factory=list)
    events: list[TraceEvent] = field(default_factory=list)
    started_at: str = field(default_factory=_now)
    finished_at: str | None = None
    error: str | None = None

    def summary(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "status": self.status,
            "case_ids": self.case_ids,
            "repeats": self.repeats,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error": self.error,
            "records": [r.to_dict() for r in self.records],
            "event_count": len(self.events),
        }


class RunManager:
    def __init__(self, settings: Settings, harness_factory: Callable[[], Harness]) -> None:
        self._settings = settings
        self._harness_factory = harness_factory
        self._lock = threading.RLock()
        self._runs: dict[str, RunState] = {}
        self._current: str | None = None

    @property
    def busy(self) -> bool:
        with self._lock:
            current = self._runs.get(self._current) if self._current else None
            return bool(current and current.status == "running")

    def start(self, case_ids: list[str], repeats: int = 1) -> RunState:
        if not case_ids:
            raise ValueError("at least one case is required")
        for case_id in case_ids:
            get_case(case_id)  # raises KeyError for unknown cases
        with self._lock:
            if self.busy:
                raise BusyError("a run is already in progress")
            run_id = uuid.uuid4().hex[:12]
            state = RunState(run_id=run_id, case_ids=list(case_ids), repeats=max(1, repeats))
            self._runs[run_id] = state
            self._current = run_id
        thread = threading.Thread(target=self._execute, args=(state,), daemon=True)
        thread.start()
        return state

    def _execute(self, state: RunState) -> None:
        harness = self._harness_factory()
        harness.on_event(state.events.append)
        try:
            for case_id in state.case_ids:
                case = get_case(case_id)
                for repeat in range(1, state.repeats + 1):
                    run_single_case(
                        harness, case, run_id=state.run_id, repeat=repeat,
                        hook=state.records.append,
                    )
            save_results(state.records, self._settings.results_dir, state.run_id)
            state.status = "finished"
        except Exception as exc:  # surface the real error to the UI
            state.status = "error"
            state.error = str(exc)
        finally:
            state.finished_at = _now()

    def get(self, run_id: str) -> RunState | None:
        with self._lock:
            return self._runs.get(run_id)

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [r.summary() for r in sorted(self._runs.values(), key=lambda s: s.started_at, reverse=True)]

    def latest(self) -> RunState | None:
        with self._lock:
            if not self._runs:
                return None
            return max(self._runs.values(), key=lambda s: s.started_at)
