"""Central security policy: one module holding every limit, toggle and the
route role classification table.

Loaded from environment with demo-generous defaults. This is the single
source of truth consumed by the auth dependency, the throttle, the breaker,
the SSRF guard, the status endpoint and the tests.

The route classification is deliberately explicit (no per-route decorators):
a middleware consults :func:`classify_route` and refuses anything the table
does not know - deny by default.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import urlsplit

from ..config import Settings

_RATE_WINDOW_S = 60


def _as_int(value: str | None, default: int) -> int:
    try:
        parsed = int((value or "").strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


@dataclass(frozen=True)
class SecurityPolicy:
    """All enforced security knobs and thresholds."""

    max_request_bytes: int
    max_response_bytes: int
    max_json_depth: int
    max_header_count: int
    max_header_bytes: int

    rate_window_s: int
    login_limit: int
    operator_limit: int
    sdk_call_limit: int
    dryrun_limit: int

    breaker_threshold: int
    breaker_window_s: int
    breaker_cooldown_s: int

    max_patch_attempts: int
    max_total_retries: int
    max_run_seconds: int

    allowed_hosts: tuple[str, ...]

    def allows_host(self, host: str) -> bool:
        host = (host or "").strip().lower().rstrip(".")
        return host in self.allowed_hosts

    def rate_limit(self, bucket: str) -> int:
        return {
            "login": self.login_limit,
            "operator": self.operator_limit,
            "sdk_call": self.sdk_call_limit,
            "dryrun": self.dryrun_limit,
        }.get(bucket, 0)

    def summary(self) -> dict[str, object]:
        return {
            "max_request_bytes": self.max_request_bytes,
            "max_response_bytes": self.max_response_bytes,
            "max_header_count": self.max_header_count,
            "rate_limits": {
                "login_per_minute": self.login_limit,
                "operator_per_minute": self.operator_limit,
                "sdk_call_per_minute": self.sdk_call_limit,
                "dryrun_per_minute": self.dryrun_limit,
            },
            "breaker": {
                "threshold": self.breaker_threshold,
                "window_s": self.breaker_window_s,
                "cooldown_s": self.breaker_cooldown_s,
            },
            "retry_budget": {
                "max_patch_attempts": self.max_patch_attempts,
                "max_total_retries": self.max_total_retries,
                "max_run_seconds": self.max_run_seconds,
            },
        }


ROLES = {"public", "operator", "sdk"}

#: (method, path-template) -> role. Templates use FastAPI path syntax exactly
#: as the route registry reports them; one entry per registered route.
ROUTE_ROLES: dict[tuple[str, str], str] = {}


def _operator(method: str, template: str) -> None:
    ROUTE_ROLES[(method, template)] = "operator"


def _public(method: str, template: str) -> None:
    ROUTE_ROLES[(method, template)] = "public"


def _sdk(method: str, template: str) -> None:
    ROUTE_ROLES[(method, template)] = "sdk"


def build_route_roles() -> dict[tuple[str, str], str]:
    """The complete classification table (idempotent)."""
    ROUTE_ROLES.clear()
    for template in (
        "/api/health", "/api/status", "/api/schema", "/api/mutations",
        "/api/cases", "/api/consistency", "/api/evaluation/config",
        "/api/registry", "/api/metrics", "/api/realworld/cases",
        "/api/sdk/tools",
    ):
        _public("GET", template)
    _public("GET", "/api/runs")
    _public("GET", "/api/runs/{run_id}")
    _public("GET", "/api/runs/{run_id}/exchanges")
    _public("GET", "/api/runs/{run_id}/events")
    _public("GET", "/api/scenarios")
    _public("POST", "/api/login")
    _public("POST", "/api/logout")
    _public("GET", "/api/me")

    for template in ("/api/mutate", "/api/reset"):
        _operator("POST", template)
    _operator("POST", "/api/runs")
    _operator("GET", "/api/audit")
    _operator("GET", "/api/audit/verify")
    _operator("GET", "/api/security/status")
    _operator("POST", "/api/security/tamper")
    _operator("GET", "/api/security/sessions")
    _operator("POST", "/api/security/sessions/{session_id}/revoke")
    _operator("POST", "/api/security/keys")
    _operator("GET", "/api/security/keys")
    _operator("POST", "/api/security/keys/{key_id}/revoke")
    _operator("POST", "/api/realworld/build")
    _operator("POST", "/api/scenarios/{scenario_id}/run")
    _operator("POST", "/api/dryrun/parse")
    _operator("POST", "/api/dryrun/analyze")
    _operator("POST", "/api/registry/rollback")
    _operator("POST", "/api/settings/repair-fallback")

    _sdk("POST", "/api/sdk/call")
    return dict(ROUTE_ROLES)


def classify_route(method: str, path_template: str) -> str:
    """Single authority for which role may touch a route. Deny by default."""
    return ROUTE_ROLES.get(
        (method.upper(), path_template),
        ROUTE_ROLES.get(("*", path_template), ""),
    )


def default_allowed_hosts(settings: Settings, env: dict[str, str]) -> tuple[str, ...]:
    """Host names Reflex may talk to outbound: the mock API plus extras."""
    hosts = {urlsplit(settings.mock_api_url).hostname or ""}
    for name in (env.get("REFLEX_ALLOWED_OUTBOUND_HOSTS") or "").replace(";", ",").split(","):
        name = name.strip().lower()
        if name:
            hosts.add(name)
    return tuple(sorted({h for h in hosts if h}))


def load_security_policy(settings: Settings, env: dict[str, str] | None = None) -> SecurityPolicy:
    """Build the policy from env with demo-generous defaults."""
    env = dict(os.environ) if env is None else dict(env)
    build_route_roles()
    return SecurityPolicy(
        max_request_bytes=_as_int(env.get("REFLEX_MAX_REQUEST_BYTES"), 1_048_576),
        max_response_bytes=_as_int(env.get("REFLEX_MAX_RESPONSE_BYTES"), 1_048_576),
        max_json_depth=_as_int(env.get("REFLEX_MAX_JSON_DEPTH"), 64),
        max_header_count=_as_int(env.get("REFLEX_MAX_HEADER_COUNT"), 32),
        max_header_bytes=_as_int(env.get("REFLEX_MAX_HEADER_BYTES"), 8192),
        rate_window_s=_as_int(env.get("REFLEX_RATE_WINDOW_S"), _RATE_WINDOW_S),
        login_limit=_as_int(env.get("REFLEX_LOGIN_LIMIT"), 10),
        operator_limit=_as_int(env.get("REFLEX_OPERATOR_LIMIT"), 120),
        sdk_call_limit=_as_int(env.get("REFLEX_SDK_CALL_LIMIT"), 60),
        dryrun_limit=_as_int(env.get("REFLEX_DRYRUN_LIMIT"), 20),
        breaker_threshold=_as_int(env.get("REFLEX_BREAKER_THRESHOLD"), 5),
        breaker_window_s=_as_int(env.get("REFLEX_BREAKER_WINDOW_S"), 60),
        breaker_cooldown_s=_as_int(env.get("REFLEX_BREAKER_COOLDOWN_S"), 30),
        max_patch_attempts=_as_int(env.get("REFLEX_MAX_PATCH_ATTEMPTS"), 1),
        max_total_retries=_as_int(env.get("REFLEX_MAX_TOTAL_RETRIES"), 6),
        max_run_seconds=_as_int(env.get("REFLEX_MAX_RUN_SECONDS"), 10),
        allowed_hosts=default_allowed_hosts(settings, env),
    )
