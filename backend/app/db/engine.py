"""SQLite engine with WAL mode. One cached engine per database URL."""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .models import Base

_engines: dict[str, Engine] = {}
_factories: dict[str, sessionmaker] = {}


def _is_sqlite(database_url: str) -> bool:
    return database_url.startswith("sqlite")


def get_engine(database_url: str) -> Engine:
    if database_url not in _engines:
        kwargs: dict = {}
        if _is_sqlite(database_url):
            kwargs["connect_args"] = {"check_same_thread": False, "timeout": 5.0}
        engine = create_engine(database_url, **kwargs)
        if _is_sqlite(database_url):

            @event.listens_for(engine, "connect")
            def _pragmas(dbapi_conn, _record) -> None:
                cursor = dbapi_conn.cursor()
                cursor.execute("PRAGMA journal_mode=WAL")
                cursor.execute("PRAGMA busy_timeout=5000")
                cursor.close()

        _engines[database_url] = engine
    return _engines[database_url]


def session_factory(database_url: str) -> sessionmaker:
    if database_url not in _factories:
        _factories[database_url] = sessionmaker(
            bind=get_engine(database_url), expire_on_commit=False
        )
    return _factories[database_url]


@contextmanager
def session_scope(database_url: str) -> Iterator[Session]:
    session = session_factory(database_url)()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db(database_url: str) -> None:
    Base.metadata.create_all(get_engine(database_url))
