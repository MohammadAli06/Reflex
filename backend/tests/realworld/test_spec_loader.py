from app.mock_api.active_schema import ActiveSchema
from app.realworld.spec_loader import extract_operation, load_spec


OPERATION = "POST /repos/{owner}/{repo}/issues"


def test_vendored_openapi_operation_extracts_without_network():
    old = load_spec("github", "old")
    extracted = extract_operation(old, OPERATION)
    assert extracted["request_schema"]["required"] == ["title"]
    assert extracted["required_headers"] == []


def test_active_schema_from_openapi_uses_new_contract_headers():
    new = load_spec("github", "new")
    active = ActiveSchema.from_openapi(new, OPERATION).snapshot()
    assert active.version == 2
    assert active.request_schemas["/repos/{owner}/{repo}/issues"]["required"] == ["summary"]
    assert active.required_headers[0].name == "X-Tenant-Token"


def test_non_json_operation_is_refused():
    spec = {"paths": {"/upload": {"post": {"requestBody": {"content": {"multipart/form-data": {}}}}}}}
    try:
        extract_operation(spec, "POST /upload")
    except ValueError as exc:
        assert "application/json" in str(exc)
    else:
        raise AssertionError("multipart operation must be rejected")
