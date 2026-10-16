"""Persistence configuration must not depend on the process working directory."""
from __future__ import annotations

import os
from pathlib import Path

from app.config import BASE_DIR, load_settings


def test_relative_sqlite_url_is_rebased_onto_the_repo_root():
    settings = load_settings(env={"DATABASE_URL": "sqlite:///data/reflex.db"})
    assert settings.database_url == f"sqlite:///{(BASE_DIR / 'data' / 'reflex.db').as_posix()}"
    assert settings.database_url.startswith("sqlite:///")
    # The resolved path is absolute, so the CWD cannot change where data lands.
    resolved = settings.database_url[len("sqlite:///"):]
    assert Path(resolved).is_absolute()


def test_absolute_sqlite_url_is_left_alone():
    absolute = f"sqlite:///{(BASE_DIR / 'data' / 'custom.db').as_posix()}"
    settings = load_settings(env={"DATABASE_URL": absolute})
    assert settings.database_url == absolute


def test_postgres_url_is_passed_through_untouched():
    url = "postgresql+psycopg://user:pw@localhost/reflex"
    settings = load_settings(env={"DATABASE_URL": url})
    assert settings.database_url == url


def test_memory_url_is_not_rebased():
    settings = load_settings(env={"DATABASE_URL": "sqlite:///:memory:"})
    assert settings.database_url == "sqlite:///:memory:"


def test_default_url_points_inside_the_repo():
    for key in ("DATABASE_URL", "DATA_DIR"):
        os.environ.pop(key, None)
    settings = load_settings(env={})
    assert settings.database_url.startswith("sqlite:///")
    assert (BASE_DIR / "data").as_posix() in settings.database_url


def test_rebased_url_actually_opens(tmp_path, monkeypatch):
    """Regression: a relative URL used to fail with 'unable to open database file'.

    The path is deliberately unique per run so the assertion never depends on
    leftover state from a previous execution.
    """
    import uuid

    from app.db import UserRepo, init_db
    from app.db.engine import get_engine

    monkeypatch.chdir(tmp_path)  # a CWD that does not contain the data directory
    name = f"probe_{uuid.uuid4().hex[:8]}.db"
    settings = load_settings(env={"DATABASE_URL": f"sqlite:///data/{name}"})
    expected = BASE_DIR / "data" / name
    try:
        init_db(settings.database_url)
        assert expected.exists(), "the database was not created under the repo root"

        user, created = UserRepo(settings.database_url).ensure_user("someone", "pw")
        assert created is True
        assert user["username"] == "someone"
        assert UserRepo(settings.database_url).authenticate("someone", "pw") is not None
        assert UserRepo(settings.database_url).authenticate("someone", "wrong") is None
    finally:
        # Windows keeps the file locked while the pool holds a connection, and a
        # leftover file must never fail the suite: the assertions above are about
        # the URL rebasing, not about being able to delete the database.
        get_engine(settings.database_url).dispose()
        for suffix in ("", "-wal", "-shm"):
            candidate = expected.with_name(expected.name + suffix)
            try:
                if candidate.exists():
                    candidate.unlink()
            except OSError:
                pass
