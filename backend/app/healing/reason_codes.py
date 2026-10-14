"""Refusal / outcome reason codes (Architecture §9)."""
from __future__ import annotations

AMBIGUOUS_MAPPING = "ambiguous_mapping"
LOSSY_CONVERSION = "lossy_conversion"
MISSING_CREDENTIAL = "missing_credential"
MISSING_REQUIRED_VALUE = "missing_required_value"
VALIDATION_FAILED = "validation_failed"
NO_EVIDENCE = "no_evidence"
RETRY_CAP_REACHED = "retry_cap_reached"
NEEDS_HUMAN_REVIEW = "needs_human_review"
AMBIGUOUS_RESPONSE_MAPPING = "ambiguous_response_mapping"
NOT_DRIFT = "not_drift"
AUTH_REJECTED = "auth_rejected"

ALL = {
    AMBIGUOUS_MAPPING,
    LOSSY_CONVERSION,
    MISSING_CREDENTIAL,
    MISSING_REQUIRED_VALUE,
    VALIDATION_FAILED,
    NO_EVIDENCE,
    RETRY_CAP_REACHED,
    NEEDS_HUMAN_REVIEW,
    AMBIGUOUS_RESPONSE_MAPPING,
    NOT_DRIFT,
    AUTH_REJECTED,
}
