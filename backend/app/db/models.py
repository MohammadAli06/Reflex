"""SQLAlchemy 2.0 models for the Control API. Switch to Postgres later by
changing the connection string only."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class SchemaSnapshot(Base):
    __tablename__ = "schema_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    version: Mapped[int] = mapped_column(index=True)
    sha256: Mapped[str] = mapped_column(String(64))
    openapi_json: Mapped[str] = mapped_column(Text)
    error_style: Mapped[str] = mapped_column(String(16), default="clear")
    captured_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class ToolRevision(Base):
    __tablename__ = "tool_revisions"
    __table_args__ = (UniqueConstraint("tool_name", "revision"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    tool_name: Mapped[str] = mapped_column(String(128), index=True)
    revision: Mapped[int] = mapped_column()
    definition_json: Mapped[str] = mapped_column(Text)
    created_by_run: Mapped[str | None] = mapped_column(String(32), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="running")
    case_ids_json: Mapped[str] = mapped_column(Text, default="[]")
    repeats: Mapped[int] = mapped_column(default=1)
    started_at: Mapped[str] = mapped_column(String(40), default=_utcnow)
    finished_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)


class RunRecordRow(Base):
    __tablename__ = "run_records"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(32), index=True)
    case_id: Mapped[str] = mapped_column(String(128))
    agent: Mapped[str] = mapped_column(String(32))
    outcome: Mapped[str] = mapped_column(String(32))
    mttr: Mapped[float | None] = mapped_column(nullable=True)
    tokens: Mapped[int] = mapped_column(default=0)
    attempts: Mapped[int] = mapped_column(default=0)
    healing_path: Mapped[str] = mapped_column(String(32), default="")
    record_json: Mapped[str] = mapped_column(Text)


class TraceEventRow(Base):
    __tablename__ = "trace_events"
    __table_args__ = (
        UniqueConstraint("run_id", "agent", "seq"),
        Index("ix_trace_events_run_idx", "run_id", "idx"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(32), index=True)
    idx: Mapped[int] = mapped_column(default=0)
    agent: Mapped[str] = mapped_column(String(32))
    seq: Mapped[int] = mapped_column()
    type: Mapped[str] = mapped_column(String(64))
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    ts: Mapped[str] = mapped_column(String(40), default=_utcnow)
    ts_ms: Mapped[int] = mapped_column(default=0)


class AuditEntryRow(Base):
    __tablename__ = "audit_entries"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(32), index=True)
    entry_json: Mapped[str] = mapped_column(Text)
    prev_hash: Mapped[str] = mapped_column(String(64))
    entry_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(256))
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow)


class SessionRow(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[str] = mapped_column(String(40), default=_utcnow)
