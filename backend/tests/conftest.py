import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.mock_api.main import create_app

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "test-tenant-token"


@pytest.fixture
def settings(tmp_path):
    return load_settings(
        env={
            "ADMIN_KEY": ADMIN_KEY,
            "MOCK_TENANT_TOKEN": TENANT_TOKEN,
            "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
            "MAX_SCHEMA_ATTEMPTS": "3",
            "MAX_INFRA_RETRIES": "2",
            "DATABASE_URL": f"sqlite:///{(tmp_path / 'reflex_test.db').as_posix()}",
        }
    )


@pytest.fixture
def admin_headers():
    return {"X-Admin-Key": ADMIN_KEY}


@pytest.fixture
def tenant_headers():
    return {"X-Tenant-Token": TENANT_TOKEN}


@pytest.fixture
def client(settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c
