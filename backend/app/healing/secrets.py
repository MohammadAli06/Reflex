"""Credential providers.

Credential values come only from here - never from error bodies, schemas or
the LLM. The ``EmptySecretsProvider`` backs the missing-credential scenario.
"""
from __future__ import annotations

from typing import Protocol

from ..config import Settings


class SecretsProvider(Protocol):
    def get(self, header_name: str) -> str | None:
        ...  # pragma: no cover

    def names(self) -> list[str]:
        ...  # pragma: no cover


class EnvSecretsProvider:
    """Resolves header credentials from configured ``HEADER_*`` values."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def get(self, header_name: str) -> str | None:
        secret = self._settings.get_header_secret(header_name)
        return secret.value if secret else None

    def names(self) -> list[str]:
        return sorted(self._settings.header_secrets.keys())


class EmptySecretsProvider:
    """No credentials at all (used to demonstrate a safe refusal)."""

    def get(self, header_name: str) -> str | None:
        return None

    def names(self) -> list[str]:
        return []


class StaticSecretsProvider:
    """Fixed credentials (tests and demos)."""

    def __init__(self, values: dict[str, str]) -> None:
        self._values = {k.lower(): v for k, v in values.items()}

    def get(self, header_name: str) -> str | None:
        return self._values.get(header_name.lower())

    def names(self) -> list[str]:
        return sorted(self._values)
