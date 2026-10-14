"""Synthetic runtime mutations applied to the mock :class:`ActiveSchema`.

Each mutation returns a *new* state with a strictly higher version. Mutations
change both real validation and the exposed ``/openapi.json`` together, because
both are derived from the same state. Fault injection (``faults.py``) never
mutates the schema.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Callable

from .active_schema import (
    ActiveSchemaState,
    FETCH_ENDPOINT,
    UPDATE_ENDPOINT,
    HeaderRequirement,
    integer,
    obj_schema,
    string,
)

DEFAULT_TENANT_HEADER = "X-Tenant-Token"


def _bump(state: ActiveSchemaState, **changes) -> ActiveSchemaState:
    data = state.to_dict()
    data.update(copy.deepcopy(changes))
    data["version"] = state.version + 1
    return ActiveSchemaState.from_dict(data)


def _fetch_req(state: ActiveSchemaState, schema: dict) -> dict:
    reqs = copy.deepcopy(state.request_schemas)
    reqs[FETCH_ENDPOINT] = schema
    return reqs


def _with_header(state: ActiveSchemaState, header_name: str, fmt: str | None) -> list[dict]:
    headers = [h.to_dict() for h in state.required_headers]
    if not any(h["name"].lower() == header_name.lower() for h in headers):
        headers.append(HeaderRequirement(name=header_name, format=fmt).to_dict())
    return headers


# --- individual mutation transforms ---------------------------------------

def m_rename(state: ActiveSchemaState) -> ActiveSchemaState:
    schema = obj_schema({"uid": string("Identifier of the user to fetch")})
    return _bump(state, request_schemas=_fetch_req(state, schema))


def m_type(state: ActiveSchemaState) -> ActiveSchemaState:
    schema = obj_schema({"user_id": integer("Identifier of the user to fetch")})
    return _bump(state, request_schemas=_fetch_req(state, schema))


def m_nest(state: ActiveSchemaState) -> ActiveSchemaState:
    schema = obj_schema({"target": obj_schema({"id": string("Identifier of the user to fetch")})})
    return _bump(state, request_schemas=_fetch_req(state, schema))


def m_header(state: ActiveSchemaState, header_name: str = DEFAULT_TENANT_HEADER) -> ActiveSchemaState:
    return _bump(
        state,
        required_headers=_with_header(state, header_name, "opaque-token"),
    )


def m_required_body(state: ActiveSchemaState) -> ActiveSchemaState:
    schema = obj_schema(
        {
            "user_id": string("Identifier of the user to fetch"),
            "tenant_id": string("Tenant scope for the request"),
        }
    )
    return _bump(state, request_schemas=_fetch_req(state, schema))


def m_rename_nest(state: ActiveSchemaState) -> ActiveSchemaState:
    schema = obj_schema({"target": obj_schema({"uid": string("Identifier of the user to fetch")})})
    return _bump(state, request_schemas=_fetch_req(state, schema))


def m_nest_type_header(state: ActiveSchemaState, header_name: str = DEFAULT_TENANT_HEADER) -> ActiveSchemaState:
    """The PS demo mutation: nesting + type change + new required header."""
    schema = obj_schema({"target": obj_schema({"id": integer("Identifier of the user to fetch")})})
    return _bump(
        state,
        request_schemas=_fetch_req(state, schema),
        required_headers=_with_header(state, header_name, "opaque-token"),
    )


def m_ambiguous(state: ActiveSchemaState) -> ActiveSchemaState:
    """Two equally plausible nested candidates -> the healer must refuse."""
    schema = obj_schema(
        {
            "account": obj_schema({"id": string("Identifier of the user to fetch")}),
            "profile": obj_schema({"id": string("Identifier of the user to fetch")}),
        }
    )
    return _bump(state, request_schemas=_fetch_req(state, schema))


def m_lossy_type(state: ActiveSchemaState) -> ActiveSchemaState:
    """Same transform as a type change; the lossy case feeds ``"00123"``."""
    return m_type(state)


def m_resp_nest(state: ActiveSchemaState) -> ActiveSchemaState:
    """Nest a response field: ``data.name`` -> ``data.user.name``."""
    responses = copy.deepcopy(state.response_schemas)
    responses[FETCH_ENDPOINT] = obj_schema(
        {
            "data": obj_schema(
                {
                    "user": obj_schema({"name": string(), "email": string()}, required=["name", "email"])
                },
                required=["user"],
            )
        },
        required=["data"],
    )
    return _bump(state, response_schemas=responses)


def m_resp_ambig(state: ActiveSchemaState) -> ActiveSchemaState:
    """Ambiguous response nesting: two candidates for ``name``."""
    responses = copy.deepcopy(state.response_schemas)
    responses[FETCH_ENDPOINT] = obj_schema(
        {
            "data": obj_schema(
                {
                    "user": obj_schema({"name": string(), "email": string()}, required=["name"]),
                    "profile": obj_schema({"name": string()}, required=["name"]),
                }
            )
        },
        required=["data"],
    )
    return _bump(state, response_schemas=responses)


@dataclass(frozen=True)
class MutationSpec:
    id: str
    label: str
    description: str
    transform: Callable[[ActiveSchemaState], ActiveSchemaState]
    requires_header_secret: bool = False


MUTATIONS: dict[str, MutationSpec] = {
    "M_RENAME": MutationSpec("M_RENAME", "Rename field", "Rename a request field", m_rename),
    "M_TYPE": MutationSpec("M_TYPE", "Type change", "Change a request field type", m_type),
    "M_NEST": MutationSpec("M_NEST", "Nesting change", "Move a request field into a nested object", m_nest),
    "M_HEADER": MutationSpec(
        "M_HEADER", "New required header", "Add a required credential header", m_header,
        requires_header_secret=True,
    ),
    "M_REQUIRED_BODY": MutationSpec(
        "M_REQUIRED_BODY", "New required body field", "Add a required body field with no task source",
        m_required_body,
    ),
    "M_RENAME_NEST": MutationSpec(
        "M_RENAME_NEST", "Rename + nesting", "Rename a field while nesting it", m_rename_nest
    ),
    "M_NEST_TYPE_HEADER": MutationSpec(
        "M_NEST_TYPE_HEADER", "PS demo (nest + type + header)",
        "Nesting, type change and a new required header together",
        m_nest_type_header, requires_header_secret=True,
    ),
    "M_AMBIGUOUS": MutationSpec(
        "M_AMBIGUOUS", "Ambiguous mapping", "Two equally plausible candidates", m_ambiguous
    ),
    "M_LOSSY_TYPE": MutationSpec(
        "M_LOSSY_TYPE", "Lossy type change", "Type change tested with a lossy value", m_lossy_type
    ),
    "M_RESP_NEST": MutationSpec(
        "M_RESP_NEST", "Response nesting", "Nest a response field (clear 1-to-1)", m_resp_nest
    ),
    "M_RESP_AMBIG": MutationSpec(
        "M_RESP_AMBIG", "Ambiguous response", "Two candidates for a response field", m_resp_ambig
    ),
}


def list_mutations() -> list[dict[str, object]]:
    return [
        {
            "id": spec.id,
            "label": spec.label,
            "description": spec.description,
            "requires_header_secret": spec.requires_header_secret,
        }
        for spec in MUTATIONS.values()
    ]


def apply_mutation(state: ActiveSchemaState, mutation_id: str) -> ActiveSchemaState:
    spec = MUTATIONS.get(mutation_id)
    if spec is None:
        raise ValueError(f"unknown mutation {mutation_id!r}")
    return spec.transform(state)
