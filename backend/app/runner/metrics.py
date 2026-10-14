"""Fixed metric formulas (PRD §9). Empty data -> ``available: false``."""
from __future__ import annotations

from typing import Any, Iterable

from .records import RunRecord


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

    recoverable = [r for r in records if r.expected_outcome == "recovered"]
    recovered = [r for r in recoverable if r.outcome == "recovered" and r.correct is not False]
    ztar = (len(recovered) / len(recoverable)) if recoverable else None

    mttrs = [r.t_recovery - r.t_break for r in recovered
             if r.t_break is not None and r.t_recovery is not None]
    t_heal = sum(r.tokens_heal for r in records if r.agent == "healing")
    t_base = sum(r.tokens_total for r in records if r.agent == "baseline")
    total_tokens = sum(r.tokens_total for r in records)

    return {
        "available": True,
        "n": len(records),
        "ztar": ztar,
        "recovered": len(recovered),
        "recoverable": len(recoverable),
        "correct_refusals": sum(1 for r in records if _is_correct_refusal(r)),
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
        }
    return result
