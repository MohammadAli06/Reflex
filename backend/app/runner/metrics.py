"""Fixed metric formulas (PRD §9). Empty data -> ``available: false``.

ZTAR (Zero-Touch Adaptation Rate) denominator rule
---------------------------------------------------
Only records that represent a *breaking schema mutation* count toward ZTAR.
A record is eligible when **both** hold:
  1. ``expected_outcome == "recovered"``  (the case was meant to be recoverable)
  2. A breaking schema change was applied: ``mutation_ids`` is non-empty,
     or ``source == "real"`` (reviewed OpenAPI schema drift)

Ordinary baseline health-checks (e.g. ``normal_fetch`` with no mutation) pass
the first condition but not the second. Counting them would inflate ZTAR
because an already-working call requires no adaptation at all.

Proportions (ZTAR, correct-refusal rate) carry a Wilson 95% score interval so a
small sample is never read as a precise rate.
"""
from __future__ import annotations

import math
from typing import Any, Iterable

from .records import RunRecord

Z_95 = 1.959963984540054


def _wilson_interval(successes: int, total: int, z: float = Z_95) -> dict[str, float] | None:
    """Wilson score interval for a binomial proportion. ``None`` when undefined."""
    if total <= 0:
        return None
    phat = successes / total
    denominator = 1 + z * z / total
    centre = (phat + z * z / (2 * total)) / denominator
    margin = (z * math.sqrt(phat * (1 - phat) / total + z * z / (4 * total * total))
              / denominator)
    return {"low": max(0.0, centre - margin), "high": min(1.0, centre + margin)}


def _median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2


def _percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = max(0, min(len(ordered) - 1, round((pct / 100) * (len(ordered) - 1))))
    return ordered[rank]


def _is_correct_refusal(record: RunRecord) -> bool:
    if record.expected_outcome != "refused":
        return False
    if record.outcome != "refused":
        return False
    if record.expected_reason and record.reason_code != record.expected_reason:
        return False
    return True


def _is_wrong_patch(record: RunRecord) -> bool:
    if record.expected_outcome == "refused" and record.outcome == "recovered":
        return True
    if record.outcome == "recovered" and record.correct is False:
        return True
    return False


def summarize(records: list[RunRecord]) -> dict[str, Any]:
    if not records:
        return {"available": False}

    # ZTAR denominator: only genuine breaking-schema mutations count.
    # A record with no mutation_ids is a no-break health-check (unless source="real");
    # admitting normal_fetch would inflate ZTAR by crediting a trivially
    # successful call as an adaptation.
    recoverable = [
        r for r in records
        if r.expected_outcome == "recovered" and (bool(r.mutation_ids) or r.source == "real")
    ]
    recovered = [r for r in recoverable if r.outcome == "recovered" and r.correct is not False]
    ztar = (len(recovered) / len(recoverable)) if recoverable else None

    refusal_expected = [r for r in records if r.expected_outcome == "refused"]
    correct_refusals = sum(1 for r in records if _is_correct_refusal(r))
    refusal_rate = (correct_refusals / len(refusal_expected)) if refusal_expected else None

    mttrs = [r.t_recovery - r.t_break for r in recovered
             if r.t_break is not None and r.t_recovery is not None]
    t_heal = sum(r.tokens_heal for r in records if r.agent == "healing")
    t_base = sum(r.tokens_total for r in records if r.agent == "baseline")
    total_tokens = sum(r.tokens_total for r in records)

    return {
        "available": True,
        "n": len(records),
        "ztar": ztar,
        "ztar_ci": _wilson_interval(len(recovered), len(recoverable)),
        "recovered": len(recovered),
        "recoverable": len(recoverable),
        "correct_refusals": correct_refusals,
        "correct_refusal_rate": refusal_rate,
        "correct_refusal_ci": _wilson_interval(correct_refusals, len(refusal_expected)),
        "wrong_patches": sum(1 for r in records if _is_wrong_patch(r)),
        "failures": sum(1 for r in records if r.outcome == "failed"),
        "not_drift_reported": sum(1 for r in records if r.outcome == "not_drift_reported"),
        "mttr_median": _median(mttrs),
        "mttr_p95": _percentile(mttrs, 95),
        "t_heal": t_heal,
        "t_base": t_base,
        "t_ratio": (t_heal / t_base) if t_base else None,
        "tokens_total": total_tokens,
        "schema_attempts": sum(r.schema_attempts for r in records),
        "infra_retries": sum(r.infra_retries for r in records),
        # True only when EVERY record carries confirmed provider usage metadata.
        # Conservative fallback: missing field → False (unverified), not True.
        "tokens_reported": all(getattr(r, "tokens_reported", False) for r in records),
    }


def _group(records: Iterable[RunRecord], key) -> dict[str, list[RunRecord]]:
    out: dict[str, list[RunRecord]] = {}
    for record in records:
        out.setdefault(str(key(record)), []).append(record)
    return out


def compute_metrics(records: list[RunRecord]) -> dict[str, Any]:
    if not records:
        return {"available": False}
    result: dict[str, Any] = {"available": True, "n_records": len(records), "agents": {}}
    for agent, agent_records in _group(records, lambda r: r.agent).items():
        result["agents"][agent] = {
            "overall": summarize(agent_records),
            "by_error_style": {
                style: summarize(group)
                for style, group in _group(agent_records, lambda r: r.error_style).items()
            },
            "by_healing_path": {
                path: summarize(group)
                for path, group in _group(agent_records, lambda r: r.healing_path).items()
            },
            "by_split": {
                split: summarize(group)
                for split, group in _group(agent_records, lambda r: r.split).items()
            },
            "by_source": {
                source: summarize(group)
                for source, group in _group(agent_records, lambda r: r.source).items()
            },
        }
    return result
