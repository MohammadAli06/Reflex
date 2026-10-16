"""One repository per table. Callers never touch SQL or sessions.

Every method opens a short-lived session via :func:`session_scope`, so repos
are safe to call from the ``RunManager`` background thread.
"""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from .engine import session_scope
from .models import (
    AuditEntryRow,
    Run,
    RunRecordRow,
    SchemaSnapshot,
    SessionRow,
    ToolRevision,
    TraceEventRow,
    User,
)

GENESIS_HASH = "0" * 64
SESSION_TTL_HOURS = 24


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


def _canonical(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


class SchemaSnapshotRepo:
    def __init__(self, database_url: str) -> None:
        self._db = database_url

    def insert_if_new(self, version: int, sha256: str, openapi_json: str, error_style: str) -> bool:
        with session_scope(self._db) as session:
            existing = session.execute(
                select(SchemaSnapshot.id).where(
                    SchemaSnapshot.version == version, SchemaSnapshot.sha256 == sha256
                )
            ).first()
            if existing:
                return False
            session.add(SchemaSnapshot(
                version=version, sha256=sha256,
                openapi_json=openapi_json, error_style=error_style,
            ))
            return True

    def latest(self) -> dict[str, Any] | None:
        with session_scope(self._db) as session:
            row = session.execute(
                select(SchemaSnapshot).order_by(SchemaSnapshot.id.desc()).limit(1)
            ).scalar_one_or_none()
            if row is None:
                return None
            return {"version": row.version, "sha256": row.sha256,
                    "openapi_json": row.openapi_json, "error_style": row.error_style}


class ToolRevisionRepo:
    def __init__(self, database_url: str) -> None:
        self._db = database_url

    def max_revision(self, tool_name: str) -> int:
        with session_scope(self._db) as session:
            value = session.execute(
                select(func.max(ToolRevision.revision)).where(
                    ToolRevision.tool_name == tool_name)
            ).scalar()
            return int(value or 0)

    def insert(self, tool_name: str, revision: int, definition: dict[str, Any],
               created_by_run: str | None = None, reason: str | None = None) -> None:
        with session_scope(self._db) as session:
            session.add(ToolRevision(
                tool_name=tool_name, revision=revision,
                definition_json=json.dumps(definition, ensure_ascii=False),
                created_by_run=created_by_run, reason=reason,
            ))

    def insert_next(self, tool_name: str, definition: dict[str, Any],
                    created_by_run: str | None = None, reason: str | None = None) -> int:
        """Insert at max+1. Lets concurrent writers race; the loser gets
        ``IntegrityError`` from the UNIQUE(tool_name, revision) constraint."""
        with session_scope(self._db) as session:
            value = session.execute(
                select(func.max(ToolRevision.revision)).where(
                    ToolRevision.tool_name == tool_name)
            ).scalar()
            revision = int(value or 0) + 1
            session.add(ToolRevision(
                tool_name=tool_name, revision=revision,
                definition_json=json.dumps(definition, ensure_ascii=False),
                created_by_run=created_by_run, reason=reason,
            ))
            return revision

    def seed_initial(self, definitions: dict[str, dict[str, Any]]) -> bool:
        """Insert rev-1 rows once. Returns True when seeding happened."""
        with session_scope(self._db) as session:
            count = session.execute(select(func.count(ToolRevision.id))).scalar()
            if count:
                return False
            for name, definition in definitions.items():
                session.add(ToolRevision(
                    tool_name=name, revision=int(definition.get("revision", 1)),
                    definition_json=json.dumps(definition, ensure_ascii=False),
                    reason="seed",
                ))
            return True

    def insert_cas(self, tool_name: str, expected_revision: int,
                   definition: dict[str, Any],
                   created_by_run: str | None = None,
                   reason: str | None = None) -> int:
        """Compare-and-swap insert at ``expected_revision + 1``.

        Raises ``StaleRevisionError`` when a concurrent writer already took
        the next revision (UNIQUE violation) or the counter moved on.
        """
        from ..registry.tool_registry import StaleRevisionError

        with session_scope(self._db) as session:
            value = session.execute(
                select(func.max(ToolRevision.revision)).where(
                    ToolRevision.tool_name == tool_name)
            ).scalar()
            current = int(value or 0)
            if current != expected_revision:
                raise StaleRevisionError(
                    f"{tool_name}: expected revision {expected_revision}, found {current}"
                )
            session.add(ToolRevision(
                tool_name=tool_name, revision=current + 1,
                definition_json=json.dumps(definition, ensure_ascii=False),
                created_by_run=created_by_run, reason=reason,
            ))
            try:
                session.flush()
            except IntegrityError as exc:
                raise StaleRevisionError(
                    f"{tool_name}: concurrent writer took revision {current + 1}"
                ) from exc
            return current + 1

    def latest(self, tool_name: str) -> dict[str, Any] | None:
        with session_scope(self._db) as session:
            row = session.execute(
                select(ToolRevision).where(ToolRevision.tool_name == tool_name)
                .order_by(ToolRevision.revision.desc()).limit(1)
            ).scalar_one_or_none()
            if row is None:
                return None
            return {"tool_name": row.tool_name, "revision": row.revision,
                    "definition": json.loads(row.definition_json),
                    "created_by_run": row.created_by_run, "reason": row.reason}

    def history(self, tool_name: str) -> list[dict[str, Any]]:
        with session_scope(self._db) as session:
            rows = session.execute(
                select(ToolRevision).where(ToolRevision.tool_name == tool_name)
                .order_by(ToolRevision.revision.asc())
            ).scalars().all()
            return [{"revision": r.revision, "created_by_run": r.created_by_run,
                     "reason": r.reason, "created_at": r.created_at} for r in rows]


class RunRepo:
    def __init__(self, database_url: str) -> None:
        self._db = database_url

    def create(self, run_id: str, case_ids: list[str], repeats: int) -> None:
        with session_scope(self._db) as session:
            session.add(Run(run_id=run_id, status="running",
                            case_ids_json=json.dumps(case_ids), repeats=repeats))

    def set_finished(self, run_id: str, status: str, finished_at: str,
                     error: str | None = None) -> None:
        with session_scope(self._db) as session:
            row = session.execute(
                select(Run).where(Run.run_id == run_id)).scalar_one_or_none()
            if row is not None:
                row.status = status
                row.finished_at = finished_at
                row.error = error

    def mark_crashed(self) -> int:
        """Mark runs left 'running' by a previous process as errored. Returns count."""
        with session_scope(self._db) as session:
            rows = session.execute(
                select(Run).where(Run.status == "running")).scalars().all()
            for row in rows:
                row.status = "error"
                row.finished_at = _utcnow()
                row.error = "control API restarted mid-run"
            return len(rows)

    def get(self, run_id: str) -> dict[str, Any] | None:
        with session_scope(self._db) as session:
            row = session.execute(
                select(Run).where(Run.run_id == run_id)).scalar_one_or_none()
            if row is None:
                return None
            return {"run_id": row.run_id, "status": row.status,
                    "case_ids": json.loads(row.case_ids_json), "repeats": row.repeats,
                    "started_at": row.started_at, "finished_at": row.finished_at,
                    "error": row.error}

    def list_all(self) -> list[dict[str, Any]]:
        with session_scope(self._db) as session:
            rows = session.execute(
                select(Run).order_by(Run.started_at.desc())).scalars().all()
            return [{"run_id": r.run_id, "status": r.status,
                     "case_ids": json.loads(r.case_ids_json), "repeats": r.repeats,
                     "started_at": r.started_at, "finished_at": r.finished_at,
                     "error": r.error} for r in rows]


class RunRecordRepo:
    def __init__(self, database_url: str) -> None:
        self._db = database_url

    def add_batch(self, records: list[dict[str, Any]]) -> None:
        if not records:
            return
        with session_scope(self._db) as session:
            session.add_all([RunRecordRow(**r) for r in records])

    def list_all(self) -> list[dict[str, Any]]:
        with session_scope(self._db) as session:
            rows = session.execute(
                select(RunRecordRow).order_by(RunRecordRow.id.asc())).scalars().all()
            return [json.loads(r.record_json) for r in rows]

    def list_for_run(self, run_id: str) -> list[dict[str, Any]]:
        with session_scope(self._db) as session:
            rows = session.execute(
                select(RunRecordRow).where(RunRecordRow.run_id == run_id)
                .order_by(RunRecordRow.id.asc())).scalars().all()
            return [json.loads(r.record_json) for r in rows]


class TraceEventRepo:
    def __init__(self, database_url: str) -> None:
        self._db = database_url

    def append_batch(self, rows: list[dict[str, Any]]) -> None:
        if not rows:
            return
        with session_scope(self._db) as session:
            session.add_all([TraceEventRow(**r) for r in rows])

    def list_for_run(self, run_id: str) -> list[dict[str, Any]]:
        with session_scope(self._db) as session:
            rows = session.execute(
                select(TraceEventRow).where(TraceEventRow.run_id == run_id)
                .order_by(TraceEventRow.idx.asc())).scalars().all()
            return [{"run_id": r.run_id, "idx": r.idx, "agent": r.agent, "seq": r.seq,
                     "type": r.type, "data": json.loads(r.payload_json),
                     "ts": r.ts} for r in rows]

    def list_after(self, run_id: str, last_idx: int) -> list[dict[str, Any]]:
        with session_scope(self._db) as session:
            rows = session.execute(
                select(TraceEventRow).where(
                    TraceEventRow.run_id == run_id, TraceEventRow.idx > last_idx)
                .order_by(TraceEventRow.idx.asc())).scalars().all()
            return [{"run_id": r.run_id, "idx": r.idx, "agent": r.agent, "seq": r.seq,
                     "type": r.type, "data": json.loads(r.payload_json),
                     "ts": r.ts} for r in rows]


class AuditRepo:
    def __init__(self, database_url: str) -> None:
        self._db = database_url

    def append(self, entry: dict[str, Any]) -> dict[str, str]:
        with session_scope(self._db) as session:
            last_hash = session.execute(
                select(AuditEntryRow.entry_hash)
                .order_by(AuditEntryRow.id.desc()).limit(1)).scalar()
            prev_hash = last_hash or GENESIS_HASH
            entry_hash = hashlib.sha256(
                (prev_hash + _canonical(entry)).encode("utf-8")).hexdigest()
            session.add(AuditEntryRow(
                run_id=str(entry.get("run_id") or ""),
                entry_json=json.dumps(entry, ensure_ascii=False),
                prev_hash=prev_hash, entry_hash=entry_hash,
            ))
            return {"prev_hash": prev_hash, "entry_hash": entry_hash}

    def read(self, *, outcome: str | None = None, run_id: str | None = None,
             limit: int | None = None) -> list[dict[str, Any]]:
        with session_scope(self._db) as session:
            query = select(AuditEntryRow).order_by(AuditEntryRow.id.asc())
            if run_id:
                query = query.where(AuditEntryRow.run_id == run_id)
            rows = session.execute(query).scalars().all()
            entries = [json.loads(r.entry_json) for r in rows]
            if outcome:
                entries = [e for e in entries if e.get("outcome") == outcome]
            if limit is not None:
                entries = entries[-limit:]
            return entries

    def count(self) -> int:
        with session_scope(self._db) as session:
            return int(session.execute(select(func.count(AuditEntryRow.id))).scalar() or 0)

    def verify_chain(self) -> tuple[bool, int | None]:
        """Walk the hash chain. Returns (ok, broken_row_id or None)."""
        with session_scope(self._db) as session:
            rows = session.execute(
                select(AuditEntryRow).order_by(AuditEntryRow.id.asc())).scalars().all()
            prev_hash = GENESIS_HASH
            for row in rows:
                entry = json.loads(row.entry_json)
                expected = hashlib.sha256(
                    (prev_hash + _canonical(entry)).encode("utf-8")).hexdigest()
                if row.prev_hash != prev_hash or row.entry_hash != expected:
                    return False, row.id
                prev_hash = row.entry_hash
            return True, None


class UserRepo:
    def __init__(self, database_url: str) -> None:
        self._db = database_url

    def ensure_user(self, username: str, password: str) -> tuple[dict[str, Any], bool]:
        """Create the user if missing. Never overwrites an existing password."""
        with session_scope(self._db) as session:
            row = session.execute(
                select(User).where(User.username == username)).scalar_one_or_none()
            if row is not None:
                return {"id": row.id, "username": row.username}, False
            row = User(username=username, password_hash=hash_password(password))
            session.add(row)
            session.flush()
            return {"id": row.id, "username": row.username}, True

    def get_by_username(self, username: str) -> dict[str, Any] | None:
        with session_scope(self._db) as session:
            row = session.execute(
                select(User).where(User.username == username)).scalar_one_or_none()
            if row is None:
                return None
            return {"id": row.id, "username": row.username,
                    "password_hash": row.password_hash}

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        user = self.get_by_username(username)
        if user is None or not verify_password(password, user["password_hash"]):
            return None
        return {"id": user["id"], "username": user["username"]}


class SessionRepo:
    def __init__(self, database_url: str) -> None:
        self._db = database_url

    def create(self, user_id: int) -> dict[str, str]:
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc)
                      + timedelta(hours=SESSION_TTL_HOURS)).isoformat()
        with session_scope(self._db) as session:
            session.add(SessionRow(token=token, user_id=user_id, expires_at=expires_at))
        return {"token": token, "expires_at": expires_at}

    def get_valid(self, token: str) -> dict[str, Any] | None:
        with session_scope(self._db) as session:
            row = session.execute(
                select(SessionRow).where(SessionRow.token == token)
            ).scalar_one_or_none()
            if row is None or row.expires_at <= _utcnow():
                return None
            user = session.execute(
                select(User).where(User.id == row.user_id)).scalar_one_or_none()
            if user is None:
                return None
            return {"user_id": user.id, "username": user.username,
                    "expires_at": row.expires_at}

    def delete(self, token: str) -> None:
        with session_scope(self._db) as session:
            session.execute(delete(SessionRow).where(SessionRow.token == token))

    def delete_expired(self) -> int:
        with session_scope(self._db) as session:
            result = session.execute(
                delete(SessionRow).where(SessionRow.expires_at <= _utcnow()))
            return int(result.rowcount or 0)


__all__ = [
    "GENESIS_HASH",
    "SESSION_TTL_HOURS",
    "hash_password",
    "verify_password",
    "SchemaSnapshotRepo",
    "ToolRevisionRepo",
    "RunRepo",
    "RunRecordRepo",
    "TraceEventRepo",
    "AuditRepo",
    "UserRepo",
    "SessionRepo",
]
