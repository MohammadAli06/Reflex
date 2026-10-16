"""OpenAPI extraction used by the offline real-world evaluation harness."""
from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).parent / "specs"


def load_spec(api: str, revision: str) -> dict[str, Any]:
    path = ROOT / api / f"{revision}.json"
    if not path.is_file():
        raise FileNotFoundError(path)
    return json.loads(path.read_text(encoding="utf-8"))


def _resolve(spec: dict[str, Any], schema: dict[str, Any]) -> dict[str, Any]:
    if "$ref" not in schema:
        return copy.deepcopy(schema)
    ref = schema["$ref"]
    if not ref.startswith("#/components/schemas/"):
        raise ValueError("only local component references are supported")
    return copy.deepcopy(spec["components"]["schemas"][ref.rsplit("/", 1)[-1]])


def extract_operation(spec: dict[str, Any], operation: str) -> dict[str, Any]:
    method, path = operation.split(" ", 1)
    item = spec["paths"][path][method.lower()]
    content = item.get("requestBody", {}).get("content", {})
    if "application/json" not in content:
        raise ValueError(f"{operation} does not use an application/json request body")
    headers = [{"name": param["name"], "required": True, "schema": copy.deepcopy(param.get("schema", {}))}
               for param in item.get("parameters", []) if param.get("in") == "header" and param.get("required")]
    return {"operation": operation, "request_schema": _resolve(spec, content["application/json"].get("schema", {})),
            "required_headers": headers}
