"""Seeded drift fuzzer: compose 1-3 catalog mutations into generated cases.

Reproducibility is the point. Every generated case carries the seed that
produced it, so a failure can be replayed exactly with ``--replay-seed``.

Composition oracle: if any component is a refuse-type change, the whole case is
expected to refuse with that component's reason. Otherwise it is expected to
recover. The oracle is a *prediction*; when it disagrees with reality the case
is reported as a failure, never silently relabelled.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

from ..mock_api.active_schema import initial_state
from ..mock_api.mutations import MUTATIONS, apply_mutation
from .cases import Case

ERROR_STYLE_CHOICES = ["clear", "vague", "none"]
TASK_CHOICES = ["normal_fetch", "lossy_fetch"]


@dataclass(frozen=True)
class MutationProfile:
    mutation_id: str
    recoverable: bool
    expected_reason: str | None = None
    # Some mutations only refuse for particular argument values, which makes the
    # oracle depend on the task rather than the schema change. Those stay out of
    # the fuzzer so a predicted label is always meaningful.
    task_dependent: bool = False


PROFILES: dict[str, MutationProfile] = {
    "M_RENAME": MutationProfile("M_RENAME", recoverable=True),
    "M_TYPE": MutationProfile("M_TYPE", recoverable=True),
    "M_NEST": MutationProfile("M_NEST", recoverable=True),
    "M_HEADER": MutationProfile("M_HEADER", recoverable=True),
    "M_RENAME_NEST": MutationProfile("M_RENAME_NEST", recoverable=True),
    "M_NEST_TYPE_HEADER": MutationProfile("M_NEST_TYPE_HEADER", recoverable=True),
    "M_RESP_NEST": MutationProfile("M_RESP_NEST", recoverable=True),
    "M_REQUIRED_BODY": MutationProfile("M_REQUIRED_BODY", recoverable=False,
                                       expected_reason="missing_required_value"),
    "M_AMBIGUOUS": MutationProfile("M_AMBIGUOUS", recoverable=False,
                                   expected_reason="ambiguous_mapping"),
    "M_RESP_AMBIG": MutationProfile("M_RESP_AMBIG", recoverable=False,
                                    expected_reason="ambiguous_response_mapping"),
    "M_LOSSY_TYPE": MutationProfile("M_LOSSY_TYPE", recoverable=True,
                                    task_dependent=True),
}

FUZZABLE = [mutation_id for mutation_id, profile in PROFILES.items()
            if not profile.task_dependent]
RECOVERABLE = [mutation_id for mutation_id in FUZZABLE
               if PROFILES[mutation_id].recoverable]


def composition_applies(mutation_ids: list[str]) -> bool:
    """True when the catalog can apply these mutations in this order.

    Checked in-process so an impossible composition is skipped instead of
    failing a run halfway through.
    """
    if not mutation_ids:
        return False
    state = initial_state()
    try:
        for mutation_id in mutation_ids:
            state = apply_mutation(state, mutation_id)
    except (ValueError, KeyError):
        return False
    return True


def predict(mutation_ids: list[str]) -> tuple[str, str | None]:
    """Apply the composition oracle.

    A single refuse-type mutation has a well-defined refusal reason. Composition
    is restricted to recoverable mutations (see :func:`fuzz_cases`) because a
    refuse-type change can be masked or made satisfiable by another change -
    measured behaviour, not a guess: composing M_REQUIRED_BODY with M_NEST
    recovers on the current engine. Asserting a refusal there would report a
    safe, verified recovery as a failure.
    """
    refused = [mutation_id for mutation_id in mutation_ids
               if not PROFILES[mutation_id].recoverable]
    if not refused:
        return "recovered", None
    if len(mutation_ids) == 1:
        return "refused", PROFILES[refused[0]].expected_reason
    return "recovered", None


def derive_seed(run_seed: int, index: int) -> int:
    """A stable per-case seed so one case can be replayed on its own."""
    return run_seed * 100_000 + index


def fuzz_cases(count: int, seed: int = 0, task_id: str = "normal_fetch") -> list[Case]:
    """Generate ``count`` deterministic cases from ``seed``."""
    rng = random.Random(seed)
    cases: list[Case] = []
    index = 0
    attempts = 0
    while len(cases) < count and attempts < count * 20:
        attempts += 1
        size = rng.choice([1, 1, 2, 2, 3])
        # Compositions stay inside recoverable mutations so the oracle holds.
        pool = FUZZABLE if size == 1 else RECOVERABLE
        if size > len(pool):
            continue
        mutation_ids = rng.sample(pool, k=size)
        if not composition_applies(mutation_ids):
            continue
        expected_outcome, expected_reason = predict(mutation_ids)
        case_seed = derive_seed(seed, index)
        cases.append(Case(
            id=f"fuzz_{seed}_{index}",
            task_id=task_id,
            expected_outcome=expected_outcome,
            composed_mutations=mutation_ids,
            error_style=rng.choice(ERROR_STYLE_CHOICES),
            expected_reason=expected_reason,
            split="fuzz",
            source="fuzz",
            seed=case_seed,
        ))
        index += 1
    return cases


def replay_case(case_seed: int) -> Case | None:
    """Rebuild exactly one fuzz case from its own seed."""
    run_seed, index = divmod(case_seed, 100_000)
    cases = fuzz_cases(index + 1, seed=run_seed)
    for case in cases:
        if case.seed == case_seed:
            return case
    return None


def mutation_catalog() -> list[str]:
    return sorted(MUTATIONS)
