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
UNTRUSTED_SCHEMA = "untrusted_schema"
# LLM fallback refusals. The rules engine runs first and stays mandatory:
# these codes describe why the fallback path itself gave up.
LLM_UNCERTAIN = "llm_uncertain"
LLM_INVALID_OUTPUT = "llm_invalid_output"
LLM_VALIDATION_FAILED = "llm_validation_failed"
LLM_UNAVAILABLE = "llm_unavailable"

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
    UNTRUSTED_SCHEMA,
    LLM_UNCERTAIN,
    LLM_INVALID_OUTPUT,
    LLM_VALIDATION_FAILED,
    LLM_UNAVAILABLE,
}

#: Refusals the LLM fallback may never try to override. Rules run first; when
#: a rule engine code in this set appears the LLM is not consulted at all.
FINAL_REFUSAL_CODES = {
    LOSSY_CONVERSION,
    MISSING_CREDENTIAL,
    MISSING_REQUIRED_VALUE,
    VALIDATION_FAILED,
    NEEDS_HUMAN_REVIEW,
    AMBIGUOUS_RESPONSE_MAPPING,
    NOT_DRIFT,
    AUTH_REJECTED,
    UNTRUSTED_SCHEMA,
    RETRY_CAP_REACHED,
}

#: Rule refusal codes where the drift is unrecognized or ambiguous rather than
#: proven unsafe - the only cases the LLM fallback may attempt.
LLM_ELIGIBLE_CODES = {NO_EVIDENCE, AMBIGUOUS_MAPPING}
