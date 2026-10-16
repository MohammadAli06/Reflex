"""Request models for the control API."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class MutateRequest(BaseModel):
    mutation_id: str
    error_style: str | None = None


class RunRequest(BaseModel):
    case_ids: list[str] = Field(default_factory=list)
    repeats: int = 1


class StyleRequest(BaseModel):
    error_style: str


class LoginRequest(BaseModel):
    username: str
    password: str


class SDKCallRequest(BaseModel):
    """Public, deliberately small adapter request for the Python SDK."""

    tool: str = Field(min_length=1, max_length=128)
    args: dict[str, Any] = Field(default_factory=dict)
