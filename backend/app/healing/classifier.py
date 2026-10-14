"""Error classification (rules.md §B).

Only 400/422 are *possible* drift. Everything else is handled without patching.
Infrastructure retries are separate from schema attempts.
"""
from __future__ import annotations

from enum import Enum


class Category(str, Enum):
    OK = "ok"
    POSSIBLE_DRIFT = "possible_drift"
    AUTH = "auth"
    RATE_LIMIT = "rate_limit"
    INFRA = "infra"
    OTHER = "other"


_POSSIBLE_DRIFT_STATUS = {400, 422}
_AUTH_STATUS = {401, 403}


def classify(status: int | None, error_type: str | None = None) -> Category:
    if error_type in {"timeout", "connection"}:
        return Category.INFRA
    if status is None:
        return Category.INFRA
    if 200 <= status < 300:
        return Category.OK
    if status in _POSSIBLE_DRIFT_STATUS:
        return Category.POSSIBLE_DRIFT
    if status in _AUTH_STATUS:
        return Category.AUTH
    if status == 429:
        return Category.RATE_LIMIT
    if 500 <= status < 600:
        return Category.INFRA
    return Category.OTHER


def is_drift_trigger(category: Category) -> bool:
    """True only for the category that warrants a schema fetch and diff."""
    return category is Category.POSSIBLE_DRIFT


def describe(category: Category) -> str:
    return {
        Category.OK: "success",
        Category.POSSIBLE_DRIFT: "possible schema drift (4xx validation error)",
        Category.AUTH: "authentication/permission error - not drift by default",
        Category.RATE_LIMIT: "rate limited - not drift",
        Category.INFRA: "infrastructure failure - not drift",
        Category.OTHER: "unrelated client error - not drift",
    }[category]
