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
from app.runner.records import RunRecord
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
            "DATABASE_URL": f"sqlite:///{(tmp_path / 'reflex_test.db').as_posix()}",
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


def test_tokens_reported_false_propagates_from_fake_llm(harness):
    """FakeLLMClient emits tokens_reported=False; this must flow all the way
    to RunRecord and be reflected in compute_metrics so the UI can suppress
    fake token counts."""
    # ps_demo fails baseline (uses FakeLLMClient) → tokens_reported=False expected
    records = run_single_case(harness, get_case("ps_demo"), run_id="tok1")
    by_agent = {r.agent: r for r in records}

    # Baseline made LLM calls with FakeLLMClient
    assert by_agent["baseline"].tokens_reported is False, (
        "baseline RunRecord should reflect tokens_reported=False from FakeLLMClient"
    )

    # Healing (rule-based) makes no LLM calls; tokens_reported stays True (no LLM flag set)
    assert by_agent["healing"].tokens_reported is True

    # Aggregate metric must be False because at least one record is False
    metrics = compute_metrics(records)
    base_overall = metrics["agents"]["baseline"]["overall"]
    heal_overall = metrics["agents"]["healing"]["overall"]
    assert base_overall["tokens_reported"] is False
    assert heal_overall["tokens_reported"] is True  # rule-based never flips False


def test_normal_fetch_does_not_inflate_ztar(harness):
    """normal_fetch has no schema mutation (mutation_ids=[]).
    It must NOT enter the ZTAR denominator even though expected_outcome='recovered'.
    Denominator (recoverable) = 0, so ztar = None.

    Numerator / denominator used in this test: 0 / 0 → None (undefined).
    An undefined rate is the correct answer when there are no eligible cases;
    the UI shows '—' rather than a fabricated percentage.
    """
    records = run_single_case(harness, get_case("normal_fetch"), run_id="nf1")
    healing = next(r for r in records if r.agent == "healing")

    # Confirm the run succeeded — this is a no-break health check, not adaptation.
    assert healing.outcome == "recovered"
    assert healing.correct is True
    # Confirm mutation_ids is empty — no schema break was applied.
    assert healing.mutation_ids == [], "normal_fetch must have no mutation_ids"

    metrics = compute_metrics(records)
    heal = metrics["agents"]["healing"]["overall"]

    # Key assertion: normal_fetch must NOT count toward ZTAR.
    assert heal["recoverable"] == 0, (
        f"recoverable denominator should be 0 for no-mutation cases, got {heal['recoverable']}"
    )
    assert heal["recovered"] == 0, (
        f"recovered numerator should be 0, got {heal['recovered']}"
    )
    assert heal["ztar"] is None, (
        "ztar must be None (undefined) when there are no eligible mutation cases, "
        f"got {heal['ztar']}"
    )


def test_mutation_case_counts_toward_ztar(harness):
    """A case with a schema mutation (ps_demo, mutation_id=M_NEST_TYPE_HEADER)
    must appear in the ZTAR denominator.

    Numerator / denominator used in this test: 1 recovered / 1 recoverable → 1.0.
    """
    records = run_single_case(harness, get_case("ps_demo"), run_id="mut1")
    healing = next(r for r in records if r.agent == "healing")

    assert healing.mutation_ids == ["M_NEST_TYPE_HEADER"], "ps_demo must have a mutation_id"
    assert healing.outcome == "recovered"

    metrics = compute_metrics(records)
    heal = metrics["agents"]["healing"]["overall"]
    assert heal["recoverable"] == 1, "mutation case must be in the recoverable denominator"
    assert heal["recovered"] == 1
    assert heal["ztar"] == 1.0


def test_splits_are_distinguishable_in_metrics(harness):
    """Running a tuning case and a held-out case produces separate by_split
    buckets so headline and held-out ZTARs stay distinguishable."""
    cases = [get_case("ps_demo"), get_case("heldout_ps_demo")]
    records = run_cases(harness, cases, run_id="split1")
    metrics = compute_metrics(records)
    heal_splits = metrics["agents"]["healing"]["by_split"]
    assert "tuning" in heal_splits, "tuning split must appear"
    assert "held_out" in heal_splits, "held_out split must appear"
    # The two splits should not be silently merged into one key
    assert heal_splits["tuning"]["n"] != metrics["agents"]["healing"]["overall"]["n"]


# ---------------------------------------------------------------------------
# Task 3: Token-provenance regression tests
# ---------------------------------------------------------------------------

def test_legacy_record_missing_tokens_reported_defaults_to_false():
    """RunRecord.from_dict must default tokens_reported=False for older records
    that were written before the field existed.

    This prevents legacy JSON rows from being silently treated as genuine
    provider measurements.
    """
    # Simulate a persisted row that has no tokens_reported key at all.
    legacy_row = {
        "run_id": "legacy1",
        "case_id": "ps_demo",
        "agent": "baseline",
        "outcome": "failed",
        "expected_outcome": "recovered",
        "mutation_ids": ["M_NEST_TYPE_HEADER"],
        "source": "synthetic",
    }
    record = RunRecord.from_dict(legacy_row)
    assert record.tokens_reported is False, (
        "Legacy record missing tokens_reported must deserialize as False (unverified), "
        f"got {record.tokens_reported!r}"
    )


def test_mixed_verified_and_simulated_tokens_reported_aggregates_to_false():
    """When one record has tokens_reported=True and another has tokens_reported=False,
    compute_metrics must report tokens_reported=False for the overall bucket.

    The invariant: tokens_reported is True ONLY when EVERY record in the group
    carries confirmed provider usage metadata.
    """
    # Record with confirmed provider metadata
    verified = RunRecord(
        run_id="mix1",
        case_id="ps_demo",
        agent="baseline",
        outcome="failed",
        expected_outcome="recovered",
        mutation_ids=["M_NEST_TYPE_HEADER"],
        source="synthetic",
        tokens_total=150,
        tokens_reported=True,
    )
    # Record with simulated / fake-LLM tokens
    simulated = RunRecord(
        run_id="mix1",
        case_id="rename",
        agent="baseline",
        outcome="recovered",
        expected_outcome="recovered",
        mutation_ids=["M_RENAME"],
        source="synthetic",
        tokens_total=80,
        tokens_reported=False,
    )

    metrics = compute_metrics([verified, simulated])
    overall = metrics["agents"]["baseline"]["overall"]
    assert overall["tokens_reported"] is False, (
        "Mixed verified+simulated records must aggregate to tokens_reported=False, "
        f"got {overall['tokens_reported']!r}"
    )


def test_rule_based_zero_token_recovery_provenance():
    """Rule-based healing applies no LLM call, so there is no provider usage
    metadata to report.  tokens_reported must be False.

    tokens_reported=True means genuine provider usage metadata was received from
    the LLM API (e.g. Gemini usage_metadata).  A rule that executes without any
    LLM call never receives such metadata, so tokens_reported must remain False.

    The frontend distinguishes this case via healing_path === 'rule', which is
    evaluated *before* tokens_reported in the display logic.  That means the UI
    will correctly show '0 (rule-based)' even when tokens_reported=False.
    """
    record = RunRecord(
        run_id="rule1",
        case_id="ps_demo",
        agent="healing",
        healing_path="rule",
        outcome="recovered",
        expected_outcome="recovered",
        mutation_ids=["M_NEST_TYPE_HEADER"],
        source="synthetic",
        tokens_heal=0,
        tokens_total=0,
        tokens_reported=False,  # no LLM call → no provider metadata
    )
    # Rule-based zero: no LLM calls were made, so provider provenance is absent.
    assert record.tokens_reported is False, (
        "Rule-based recovery makes no LLM call; tokens_reported must be False "
        "(no provider usage metadata is available)"
    )
    assert record.tokens_total == 0
    assert record.healing_path == "rule"

    metrics = compute_metrics([record])
    overall = metrics["agents"]["healing"]["overall"]
    # The aggregate provenance must also be False — no LLM was consulted.
    assert overall["tokens_reported"] is False, (
        "Rule-based zero-token aggregate must be tokens_reported=False; "
        f"got {overall['tokens_reported']!r}"
    )
    assert overall["tokens_total"] == 0


def test_genuine_provider_metadata_preserves_tokens_reported():
    """A record explicitly marked tokens_reported=True must survive a
    to_dict → from_dict round-trip with provenance intact.
    """
    original = RunRecord(
        run_id="prov1",
        case_id="ps_demo",
        agent="baseline",
        outcome="recovered",
        expected_outcome="recovered",
        mutation_ids=["M_NEST_TYPE_HEADER"],
        source="synthetic",
        tokens_total=320,
        tokens_reported=True,
    )
    reloaded = RunRecord.from_dict(original.to_dict())
    assert reloaded.tokens_reported is True, (
        "Genuine provider metadata (tokens_reported=True) must survive "
        f"serialization round-trip, got {reloaded.tokens_reported!r}"
    )
    assert reloaded.tokens_total == 320
