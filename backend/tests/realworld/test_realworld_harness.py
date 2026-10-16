"""Real-spec harness: vendored contracts, reviewed cases, and the CLI path."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import load_settings
from app.llm.fake import FakeLLMClient
from app.mock_api.main import create_app
from app.realworld.case_builder import (
    build_draft,
    classify_change,
    load_cases,
    load_rows,
    propose_label,
    reviewed_cases,
)
from app.runner.cases import all_cases, get_case, list_cases
from app.runner.harness import Harness
from app.runner.run_suite import case_verdict, run_single_case, select_cases

ADMIN_KEY = "test-admin-key"
TENANT_TOKEN = "tenant-secret-value"
OPERATION = "POST /repos/{owner}/{repo}/issues"


@pytest.fixture
def settings(tmp_path):
    return load_settings(env={
        "ADMIN_KEY": ADMIN_KEY,
        "MOCK_TENANT_TOKEN": TENANT_TOKEN,
        "HEADER_X_TENANT_TOKEN": TENANT_TOKEN,
        "AUDIT_LOG_PATH": str(tmp_path / "audit.jsonl"),
        "RESULTS_DIR": str(tmp_path / "results"),
        "DATABASE_URL": f"sqlite:///{(tmp_path / 'rw.db').as_posix()}",
    })


@pytest.fixture
def harness(settings):
    client = TestClient(create_app(settings))
    client.__enter__()
    try:
        yield Harness(settings, client=client, llm=FakeLLMClient()), client
    finally:
        client.__exit__(None, None, None)


def test_vendored_case_is_reviewed_and_runnable():
    cases = reviewed_cases()
    assert cases, "the vendored github case must be reviewed"
    case = cases[0]
    assert case.source == "real"
    assert case.old_ref == "old" and case.new_ref == "new"
    assert case.reviewed is True
    assert case.task_args["owner"] and case.task_args["repo"]


def test_real_cases_are_registered_with_the_runner():
    ids = {case["id"] for case in list_cases()}
    assert "github_issue_field_rename_and_header" in ids
    assert get_case("github_issue_field_rename_and_header").source == "real"
    assert any(case.source == "real" for case in all_cases())


def test_unreviewed_rows_never_run():
    """A draft must not be presented as ground truth."""
    drafts = [row for row in load_rows() if not row.get("reviewed")]
    assert drafts == []

    every = load_cases()
    unreviewed = [case for case in every if not case.reviewed]
    assert not unreviewed


def test_draft_builder_labels_the_github_pair_recoverable():
    draft = build_draft("github", OPERATION, "old", "new",
                        {"owner": "acme", "repo": "widgets", "title": "x"})
    assert draft["change_kind"] == "field_renamed+header_added"
    assert draft["label"] == "recoverable"
    assert draft["reviewed"] is False, "drafts must never claim review"


def test_change_classification_prefers_refusal_for_unmappable_changes():
    class FakeDiff:
        removed = []
        added = ["new_required"]
        type_changed = []
        added_headers = []
        removed_headers = []

    kind = classify_change(FakeDiff())
    assert kind == "field_added_required"
    assert propose_label(kind) == "refuse_expected"


def test_real_case_recovers_against_the_new_revision(harness):
    h, _ = harness
    case = reviewed_cases()[0]
    records = run_single_case(h, case, run_id="rw-test")
    by_agent = {record.agent: record for record in records}

    # The old contract is wrong against the new schema, so the baseline fails...
    assert by_agent["baseline"].outcome == "failed"
    # ...while the healer repairs it and the server sees the values it sent.
    assert by_agent["healing"].outcome == "recovered"
    assert by_agent["healing"].correct is True
    assert by_agent["healing"].source == "real"
    assert by_agent["healing"].mttr is not None and by_agent["healing"].mttr >= 0


def test_real_case_verdict_is_recovered(harness):
    h, _ = harness
    case = reviewed_cases()[0]
    records = run_single_case(h, case, run_id="rw-verdict")
    assert case_verdict(case, records) == "recovered"


def test_spec_operation_path_is_served_and_recorded(harness):
    """The mock must serve the vendored path and record the payload we read back."""
    h, client = harness
    case = reviewed_cases()[0]
    run_single_case(h, case, run_id="rw-payload")
    payload = client.get("/admin/last_payload/repos/acme/widgets/issues",
                         headers={"X-Admin-Key": ADMIN_KEY}).json()
    assert payload.get("ok") is True
    assert "summary" in payload["body"]


def test_select_cases_excludes_unreviewed_real_cases():
    selected = select_cases(source="real")
    assert all(case.source == "real" and case.reviewed for case in selected)
    assert len(selected) == len(reviewed_cases())


def test_select_cases_synthetic_only_returns_synthetic():
    selected = select_cases(source="synthetic")
    assert selected
    assert all(case.source == "synthetic" for case in selected)


def test_only_reviewed_real_cases_are_runnable():
    """A draft is a proposal: neither the API nor the CLI may run it.

    Checked against the registry directly so adding an unreviewed row to
    cases.yaml cannot silently re-open the gate.
    """
    for case in all_cases():
        if case.source == "real":
            assert case.reviewed, f"{case.id} is registered without review"
    assert all(case.reviewed for case in reviewed_cases())


def test_load_cases_marks_drafts_as_unreviewed(tmp_path):
    """The API-level run path is covered in tests/control_api/test_realworld_routes.py."""
    csv = tmp_path / "cases.yaml"
    csv.write_text(
        "cases:\n"
        "  - id: draft_only\n"
        "    api: github\n"
        "    operation: POST /repos/{owner}/{repo}/issues\n"
        "    old_ref: old\n"
        "    new_ref: new\n"
        "    change_kind: field_added_required\n"
        "    label: refuse_expected\n"
        "    reviewed: false\n"
        "    task_args: {owner: acme, repo: widgets}\n",
        encoding="utf-8",
    )
    assert load_cases(csv)[0].reviewed is False
    assert reviewed_cases(csv) == []
    # The builder defaults to unreviewed, so a generated draft can never claim
    # ground-truth status.
    assert build_draft("github", OPERATION, "old", "new", {})["reviewed"] is False
