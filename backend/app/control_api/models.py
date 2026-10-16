"""Request models for the control API."""
from __future__ import annotations

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
