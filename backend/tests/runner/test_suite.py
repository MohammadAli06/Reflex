"""Runner and metrics tests using an in-process mock app."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.llm.fake import FakeLLMClient
from app.mock_api.main import create_app
from app.runner.cases import get_case
from app.runner.harness import Harness
from app.runner.metrics import compute_metrics
from app.runner.run_suite import run_cases, run_single_case, save_results

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "tenant-secret-value"


@pytest.fixture
def harness(tmp_path):
    settings = load_settings(
        env={
            "ADMIN_KEY": ADMIN_KEY,
            "MOCK_TENANT_TOKEN": TENANT_TOKEN,
            "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
            "AUDIT_LOG_PATH": str(tmp_path / "audit.jsonl"),
            "RESULTS_DIR": str(tmp_path / "results"),
        }
    )
    app = create_app(settings)
    client = TestClient(app)
    client.__enter__()
    try:
        yield Harness(settings, client=client, llm=FakeLLMClient())
    finally:
        client.__exit__(None, None, None)


def test_ps_demo_case_recovers_for_healing_only(harness):
    records = run_single_case(harness, get_case("ps_demo"), run_id="r1")
    by_agent = {r.agent: r for r in records}
    assert by_agent["baseline"].outcome == "failed"
    assert by_agent["healing"].outcome == "recovered"
    assert by_agent["healing"].correct is True
    assert by_agent["healing"].mttr is None or by_agent["healing"].t_recovery is not None


def test_wrong_patch_count_is_zero_on_tuning_cases(harness):
    records = run_cases(
        harness,
        [get_case(c) for c in ("ps_demo", "ambiguous_mapping", "lossy_conversion", "not_drift_5xx")],
        run_id="r2",
    )
    metrics = compute_metrics(records)
    assert metrics["available"]
    healing = metrics["agents"]["healing"]["overall"]
    assert healing["wrong_patches"] == 0
    assert healing["correct_refusals"] >= 1
    assert healing["ztar"] is not None


def test_results_persist_and_reload(harness, tmp_path):
    records = run_cases(harness, [get_case("normal_fetch")], run_id="r3")
    path = save_results(records, harness.settings.results_dir, "r3")
    assert path.exists()
    assert len(records) == 2  # baseline + healing


def test_empty_metrics_unavailable():
    assert compute_metrics([]) == {"available": False}
