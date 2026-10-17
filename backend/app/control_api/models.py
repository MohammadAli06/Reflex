"""Request models for the control API. Strict types everywhere: no extra
fields, bounded strings. Unknown input is rejected, never ignored."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MutateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mutation_id: str = Field(min_length=1, max_length=128)
    error_style: str | None = Field(default=None, max_length=32)


class RunRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    case_ids: list[str] = Field(default_factory=list, max_length=200)
    repeats: int = Field(default=1, ge=1, le=50)


class StyleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    error_style: str = Field(min_length=1, max_length=32)


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class SDKCallRequest(BaseModel):
    """Public, deliberately small adapter request for the Python SDK."""

    model_config = ConfigDict(extra="forbid")
    tool: str = Field(min_length=1, max_length=128)
    args: dict[str, Any] = Field(default_factory=dict)


class DryRunParseRequest(BaseModel):
    """Two pasted OpenAPI documents; the parse endpoint only lists operations."""

    model_config = ConfigDict(extra="forbid")
    old_spec: str = Field(min_length=1, max_length=600000)
    new_spec: str = Field(min_length=1, max_length=600000)


class DryRunAnalyzeRequest(BaseModel):
    """Offline dry-run input: everything is pasted text; nothing is fetched."""

    model_config = ConfigDict(extra="forbid")
    old_spec: str = Field(min_length=1, max_length=600000)
    new_spec: str = Field(min_length=1, max_length=600000)
    operation: str = Field(min_length=3, max_length=512)
    original_request: dict[str, Any] = Field(default_factory=dict)
    error: dict[str, Any] = Field(default_factory=dict)


class SdkKeyCreateRequest(BaseModel):
    """Create a hashed SDK key; the plaintext is returned exactly once."""

    model_config = ConfigDict(extra="forbid")
    label: str = Field(default="", max_length=128)


class RollbackRequest(BaseModel):
    """Operator-only registry rollback: CAS on the seen revision, restore a
    specific target revision's definition."""

    model_config = ConfigDict(extra="forbid")
    tool: str = Field(min_length=1, max_length=128)
    current_revision: int = Field(ge=1)
    target_revision: int = Field(ge=1)
