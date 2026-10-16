"""Fuzz runner: determinism, the composition oracle, and seed replay."""
from __future__ import annotations

import pytest

from app.runner.fuzz import (
    FUZZABLE,
    PROFILES,
    composition_applies,
    derive_seed,
    fuzz_cases,
    mutation_catalog,
    predict,
    replay_case,
)


def test_generation_is_deterministic_for_a_seed():
    first = fuzz_cases(20, seed=11)
    second = fuzz_cases(20, seed=11)
    assert [c.id for c in first] == [c.id for c in second]
    assert [c.composed_mutations for c in first] == [c.composed_mutations for c in second]
    assert [c.error_style for c in first] == [c.error_style for c in second]


def test_different_seeds_produce_different_cases():
    assert [c.composed_mutations for c in fuzz_cases(25, seed=1)] != \
           [c.composed_mutations for c in fuzz_cases(25, seed=2)]


def test_every_generated_case_records_its_seed_and_source():
    for case in fuzz_cases(30, seed=5):
        assert case.seed is not None
        assert case.source == "fuzz"
        assert case.split == "fuzz"
        assert case.composed_mutations


def test_seeds_are_unique_so_any_case_can_be_replayed():
    cases = fuzz_cases(40, seed=3)
    assert len({case.seed for case in cases}) == len(cases)


def test_replay_rebuilds_the_exact_case():
    for case in fuzz_cases(5, seed=7):
        replayed = replay_case(case.seed)
        assert replayed is not None
        assert replayed.composed_mutations == case.composed_mutations
        assert replayed.error_style == case.error_style
        assert replayed.expected_outcome == case.expected_outcome


def test_derive_seed_is_injective_over_an_index_range():
    seeds = {derive_seed(9, index) for index in range(500)}
    assert len(seeds) == 500


def test_single_refuse_mutation_predicts_the_exact_reason():
    assert predict(["M_REQUIRED_BODY"]) == ("refused", "missing_required_value")
    assert predict(["M_AMBIGUOUS"]) == ("refused", "ambiguous_mapping")


def test_composition_stays_within_recoverable_mutations():
    """A refuse-type component can be masked by another change, so the oracle
    would be asserting something the engine does not guarantee."""
    for case in fuzz_cases(60, seed=13):
        if len(case.composed_mutations) > 1:
            assert all(PROFILES[m].recoverable for m in case.composed_mutations)
        else:
            assert case.expected_outcome in {"recovered", "refused"}


def test_single_mutation_cases_cover_the_mutation_catalogue():
    seen = {m for case in fuzz_cases(120, seed=21) for m in case.composed_mutations}
    assert seen.issubset(set(FUZZABLE))
    assert len(seen) > 1


def test_preflight_guard_rejects_degenerate_input():
    """The guard is a pre-flight check, not a filter.

    Measured: every pair and triple in the current catalogue applies cleanly, so
    it never rejects a real composition today. It exists so an unapplicable
    composition is skipped instead of killing a whole run, and it must still
    reject the obviously invalid.
    """
    assert composition_applies([]) is False
    assert composition_applies(["M_NOT_A_MUTATION"]) is False


def test_every_catalog_composition_applies_today():
    from itertools import combinations

    for size in (2, 3):
        for combo in combinations(FUZZABLE, size):
            assert composition_applies(list(combo)), combo


def test_generated_compositions_use_distinct_mutations():
    for case in fuzz_cases(60, seed=17):
        assert len(set(case.composed_mutations)) == len(case.composed_mutations)


def test_task_dependent_mutation_is_excluded_from_fuzzing():
    # M_LOSSY_TYPE only refuses for particular argument values, so a predicted
    # label would be meaningless without pinning the task.
    assert PROFILES["M_LOSSY_TYPE"].task_dependent is True
    assert "M_LOSSY_TYPE" not in FUZZABLE
    assert mutation_catalog()
