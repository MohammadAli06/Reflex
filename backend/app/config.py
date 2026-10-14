"""Typed application configuration.

All secrets and settings come from the environment (``.env`` at the repo root).
Nothing here is ever returned to the browser: the control API exposes only
booleans such as ``llm_configured``.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

try:  # optional at import time so tests never need python-dotenv installed twice
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None

# repo root = backend/app/config.py -> app, backend, repo
BASE_DIR = Path(__file__).resolve().parents[2]

VALID_THINKING_LEVELS = {"low", "medium", "high"}

_HEADER_ENV_RE = re.compile(r"^HEADER_(?P<name>[A-Z0-9_]+)$")


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


def _load_env() -> None:
    if load_dotenv is None:
        return
    env_path = BASE_DIR / ".env"
    if env_path.exists():
        load_dotenv(env_path, override=False)


def _as_bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _as_int(value: str | None, default: int) -> int:
    if value is None or value.strip() == "":
        return default
    try:
        return int(value)
    except ValueError as exc:
        raise ConfigError(f"expected an integer, got {value!r}") from exc


@dataclass(frozen=True)
class HeaderSecret:
    """A header credential resolved from the environment."""

    header_name: str
    env_var: str
    value: str

    def redacted(self) -> dict[str, str]:
        return {"header_name": self.header_name, "env_var": self.env_var}


@dataclass(frozen=True)
class Settings:
    google_api_key: str
    llm_model: str
    llm_thinking_level: str
    admin_key: str
    mock_api_url: str
    control_api_url: str
    max_schema_attempts: int
    max_infra_retries: int
    llm_fallback_enabled: bool
    audit_log_path: Path
    results_dir: Path
    frontend_origin: str
    header_secrets: dict[str, HeaderSecret] = field(default_factory=dict)

    # ---- safety helpers -------------------------------------------------
    @property
    def llm_configured(self) -> bool:
        return bool(self.google_api_key)

    def get_header_secret(self, header_name: str) -> HeaderSecret | None:
        """Return the credential for a header name, or ``None`` if absent."""
        return self.header_secrets.get(header_name.lower())

    def require_admin_key(self) -> str:
        if not self.admin_key:
            raise ConfigError("ADMIN_KEY is not configured")
        return self.admin_key

    def require_llm_key(self) -> str:
        if not self.google_api_key:
            raise ConfigError("GOOGLE_API_KEY is not configured")
        return self.google_api_key

    def public_summary(self) -> dict[str, object]:
        """Safe-to-serve summary. Never contains secret values."""
        return {
            "llm_model": self.llm_model,
            "llm_thinking_level": self.llm_thinking_level,
            "llm_configured": self.llm_configured,
            "llm_fallback_enabled": self.llm_fallback_enabled,
            "max_schema_attempts": self.max_schema_attempts,
            "max_infra_retries": self.max_infra_retries,
            "configured_header_secrets": sorted(self.header_secrets.keys()),
        }


def _collect_header_secrets(env: dict[str, str]) -> dict[str, HeaderSecret]:
    secrets: dict[str, HeaderSecret] = {}
    for key, value in env.items():
        match = _HEADER_ENV_RE.match(key)
        if not match or not value:
            continue
        # HEADER_X_TENANT_TOKEN -> X-Tenant-Token
        header_name = "-".join(part.capitalize() for part in match.group("name").split("_"))
        secrets[header_name.lower()] = HeaderSecret(
            header_name=header_name, env_var=key, value=value
        )
    return secrets


def load_settings(env: dict[str, str] | None = None) -> Settings:
    """Build :class:`Settings` from the environment.

    Raises :class:`ConfigError` for invalid values (e.g. a bad thinking level).
    Missing optional values keep safe defaults so the core (rule-based) system
    runs with no API keys at all.
    """
    if env is None:
        _load_env()
        env = dict(os.environ)

    thinking = (env.get("LLM_THINKING_LEVEL") or "low").strip().lower()
    if thinking not in VALID_THINKING_LEVELS:
        raise ConfigError(
            f"LLM_THINKING_LEVEL must be one of {sorted(VALID_THINKING_LEVELS)}, got {thinking!r}"
        )

    def _path(key: str, default: str) -> Path:
        raw = (env.get(key) or default).strip()
        p = Path(raw)
        return p if p.is_absolute() else BASE_DIR / p

    return Settings(
        google_api_key=(env.get("GOOGLE_API_KEY") or "").strip(),
        llm_model=(env.get("LLM_MODEL") or "gemini-3.8-flash").strip(),
        llm_thinking_level=thinking,
        admin_key=(env.get("ADMIN_KEY") or "").strip(),
        mock_api_url=(env.get("MOCK_API_URL") or "http://localhost:8000").rstrip("/"),
        control_api_url=(env.get("CONTROL_API_URL") or "http://localhost:8001").rstrip("/"),
        max_schema_attempts=_as_int(env.get("MAX_SCHEMA_ATTEMPTS"), 3),
        max_infra_retries=_as_int(env.get("MAX_INFRA_RETRIES"), 2),
        llm_fallback_enabled=_as_bool(env.get("LLM_FALLBACK_ENABLED"), False),
        audit_log_path=_path("AUDIT_LOG_PATH", "audit/audit.jsonl"),
        results_dir=_path("RESULTS_DIR", "results"),
        frontend_origin=(env.get("FRONTEND_ORIGIN") or "http://localhost:5173").rstrip("/"),
        header_secrets=_collect_header_secrets(env),
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings for application use."""
    return load_settings()
