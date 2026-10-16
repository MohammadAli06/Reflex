"""Runs a baseline+healing comparison in a background thread and tracks state.

Only one comparison run may be active at a time; starting another returns busy.
Finished state persists in SQLite so history survives restarts.
"""
from __future__ import annotations

import json
import threading
import time
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

EVENT_FLUSH_EVERY = 20


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
    def __init__(self, settings: Settings, harness_factory: Callable[[], Harness],
                 run_repo=None, record_repo=None, event_repo=None,
                 revision_repo=None, snapshot_repo=None) -> None:
        self._settings = settings
        self._harness_factory = harness_factory
        self._lock = threading.RLock()
        self._runs: dict[str, RunState] = {}
        self._current: str | None = None
        self._run_repo = run_repo
        self._record_repo = record_repo
        self._event_repo = event_repo
        self._revision_repo = revision_repo
        self._snapshot_repo = snapshot_repo
        if self._run_repo is not None:
            try:
                crashed = self._run_repo.mark_crashed()
                if crashed:
                    for row in self._run_repo.list_all():
                        if row["status"] == "error" and row["error"] == "control API restarted mid-run":
                            state = RunState(
                                run_id=row["run_id"], case_ids=row["case_ids"],
                                repeats=row["repeats"], status="error",
                                started_at=row["started_at"],
                                finished_at=row["finished_at"], error=row["error"],
                            )
                            if self._record_repo is not None:
                                state.records = [RunRecord.from_dict(d)
                                                 for d in self._record_repo.list_for_run(row["run_id"])]
                            if self._event_repo is not None:
                                state.events = [_event_from_dict(d)
                                                for d in self._event_repo.list_for_run(row["run_id"])]
                            self._runs[row["run_id"]] = state
            except Exception:
                pass

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
        if self._run_repo is not None:
            try:
                self._run_repo.create(run_id, state.case_ids, state.repeats)
            except Exception:
                pass
        thread = threading.Thread(target=self._execute, args=(state,), daemon=True)
        thread.start()
        return state

    def execute_sdk(self, tool: str, args: dict[str, Any]) -> tuple[RunState, Any]:
        """Execute one SDK call and persist its real trace in the normal stores."""
        # Reject before allocating a run: the SDK cannot introduce definitions
        # outside the engine-owned registry.
        from ..registry.tools import initial_definitions
        if tool not in initial_definitions():
            raise KeyError(tool)
        with self._lock:
            if self.busy:
                raise BusyError("a run is already in progress")
            run_id = uuid.uuid4().hex[:12]
            state = RunState(run_id=run_id, case_ids=[f"sdk:{tool}"], repeats=1)
            self._runs[run_id] = state
            self._current = run_id
        if self._run_repo is not None:
            self._run_repo.create(run_id, state.case_ids, 1)
        try:
            harness = self._harness_factory()
            if hasattr(harness, "_run_id"):
                harness._run_id = run_id
            harness.on_event(lambda event: self._on_event(state, event))
            result = harness.run_healing_tool(tool, args, run_id)
            record = RunRecord(
                run_id=run_id, case_id=f"sdk:{tool}", agent="healing",
                framework="sdk", attempts=result.attempts, t_break=result.t_break,
                t_recovery=result.t_recovery, outcome=result.outcome,
                healing_path=result.healing_path, tokens_heal=result.tokens_total,
                tokens_total=result.tokens_total, schema_attempts=result.schema_attempts,
                infra_retries=result.infra_retries, model=result.model,
                reason_code=result.reason_code, source="sdk",
            )
            self._on_record(state, record)
            self._flush_records(state, 0)
            self._flush_events(state, force=True)
            state.status = "finished"
            return state, result
        except Exception as exc:
            state.status, state.error = "error", str(exc)
            raise
        finally:
            state.finished_at = _now()
            if self._run_repo is not None:
                self._run_repo.set_finished(state.run_id, state.status, state.finished_at, state.error)

    def _execute(self, state: RunState) -> None:
        harness = self._harness_factory()
        if hasattr(harness, "_run_id"):
            harness._run_id = state.run_id
        harness.on_event(lambda event: self._on_event(state, event))
        records_flushed = 0
        try:
            for case_id in state.case_ids:
                case = get_case(case_id)
                for repeat in range(1, state.repeats + 1):
                    run_single_case(
                        harness, case, run_id=state.run_id, repeat=repeat,
                        hook=lambda record: self._on_record(state, record),
                    )
                    self._flush_records(state, records_flushed)
                    records_flushed = len(state.records)
            save_results(state.records, self._settings.results_dir, state.run_id)
            self._flush_records(state, records_flushed)
            self._flush_events(state, force=True)
            state.status = "finished"
        except Exception as exc:  # surface the real error to the UI
            state.status = "error"
            state.error = str(exc)
            try:
                self._flush_records(state, records_flushed)
                self._flush_events(state, force=True)
            except Exception:
                pass
        finally:
            state.finished_at = _now()
            if self._run_repo is not None:
                try:
                    self._run_repo.set_finished(
                        state.run_id, state.status, state.finished_at, state.error)
                except Exception:
                    pass

    def _on_event(self, state: RunState, event: TraceEvent) -> None:
        with self._lock:
            state.events.append(event)
            pending = len(state.events)
        if pending % EVENT_FLUSH_EVERY == 0:
            self._flush_events(state)

    def _on_record(self, state: RunState, record: RunRecord) -> None:
        with self._lock:
            state.records.append(record)

    def _flush_records(self, state: RunState, already_flushed: int) -> None:
        if self._record_repo is None:
            return
        with self._lock:
            pending = state.records[already_flushed:]
        if not pending:
            return
        try:
            self._record_repo.add_batch([_record_row(r) for r in pending])
        except Exception:
            pass

    def _flush_events(self, state: RunState, force: bool = False) -> None:
        if self._event_repo is None:
            return
        with self._lock:
            flushed = getattr(state, "_events_flushed", 0)
            pending = state.events[flushed:]
            if not force and len(pending) < EVENT_FLUSH_EVERY:
                return
            state._events_flushed = len(state.events)
        if not pending:
            return
        try:
            self._event_repo.append_batch([_event_row(e, i) for i, e in enumerate(pending, start=flushed)])
        except Exception:
            with self._lock:
                state._events_flushed = flushed

    def get(self, run_id: str) -> RunState | None:
        with self._lock:
            state = self._runs.get(run_id)
            if state is not None:
                return state
        if self._run_repo is None:
            return None
        try:
            row = self._run_repo.get(run_id)
        except Exception:
            return None
        if row is None:
            return None
        state = RunState(
            run_id=row["run_id"], case_ids=row["case_ids"], repeats=row["repeats"],
            status=row["status"], started_at=row["started_at"],
            finished_at=row["finished_at"], error=row["error"],
        )
        try:
            if self._record_repo is not None:
                state.records = [RunRecord.from_dict(d)
                                 for d in self._record_repo.list_for_run(run_id)]
            if self._event_repo is not None:
                state.events = [_event_from_dict(d)
                                for d in self._event_repo.list_for_run(run_id)]
        except Exception:
            pass
        with self._lock:
            self._runs[run_id] = state
        return state

    def list(self) -> list[dict[str, Any]]:
        if self._run_repo is not None:
            try:
                db_runs = {r["run_id"]: r for r in self._run_repo.list_all()}
            except Exception:
                db_runs = {}
            with self._lock:
                merged: dict[str, dict[str, Any]] = {}
                for run_id, row in db_runs.items():
                    live = self._runs.get(run_id)
                    merged[run_id] = live.summary() if live else _db_summary(row)
                for run_id, state in self._runs.items():
                    if run_id not in merged:
                        merged[run_id] = state.summary()
                return sorted(merged.values(), key=lambda s: s["started_at"], reverse=True)
        with self._lock:
            return [r.summary() for r in sorted(self._runs.values(), key=lambda s: s.started_at, reverse=True)]

    def latest(self) -> RunState | None:
        with self._lock:
            if not self._runs:
                pass
            else:
                return max(self._runs.values(), key=lambda s: s.started_at)
        if self._run_repo is not None:
            try:
                rows = self._run_repo.list_all()
            except Exception:
                return None
            if not rows:
                return None
            return self.get(rows[0]["run_id"])
        return None


def _record_row(record: RunRecord) -> dict[str, Any]:
    mttr = record.mttr
    return {
        "run_id": record.run_id,
        "case_id": record.case_id,
        "agent": record.agent,
        "outcome": record.outcome,
        "mttr": float(mttr) if mttr is not None else None,
        "tokens": int(record.tokens_total or 0),
        "attempts": int(record.attempts or 0),
        "healing_path": record.healing_path or "",
        "record_json": json.dumps(record.to_dict(), ensure_ascii=False),
    }


def _event_row(event: TraceEvent, idx: int) -> dict[str, Any]:
    return {
        "run_id": event.run_id,
        "idx": int(idx),
        "agent": event.agent,
        "seq": int(event.seq),
        "type": event.type,
        "payload_json": json.dumps({"data": event.data}, ensure_ascii=False),
        "ts": event.ts,
        "ts_ms": int(time.time() * 1000),
    }


def _event_from_dict(data: dict[str, Any]) -> TraceEvent:
    payload = data.get("data", {})
    if isinstance(payload, dict) and set(payload.keys()) == {"data"}:
        payload = payload["data"]
    return TraceEvent(
        run_id=data.get("run_id", ""),
        seq=int(data.get("seq", 0)),
        ts=data.get("ts", _now()),
        agent=data.get("agent", ""),
        type=data.get("type", ""),
        data=payload if isinstance(payload, dict) else {},
    )


def _db_summary(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "run_id": row["run_id"],
        "status": row["status"],
        "case_ids": row["case_ids"],
        "repeats": row["repeats"],
        "started_at": row["started_at"],
        "finished_at": row["finished_at"],
        "error": row["error"],
        "records": [],
        "event_count": 0,
    }
