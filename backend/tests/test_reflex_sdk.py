from __future__ import annotations

import httpx
import pytest

from reflex_sdk import ReflexClient, ReflexConnectionError, ReflexResult, ReflexValidationError


def test_client_loads_tools_and_returns_structured_refusal():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/sdk/tools":
            return httpx.Response(200, json={"tools": [{"name": "fetch_user", "method": "POST"}]})
        return httpx.Response(200, json={
            "run_id": "run-1", "outcome": "refused", "healed": False, "data": None,
            "reason_code": "ambiguous_mapping", "error": None, "attempts": 1,
            "schema_attempts": 1,
        })

    with ReflexClient(client=httpx.Client(base_url="http://test", transport=httpx.MockTransport(handler))) as client:
        assert client.load_tool("fetch_user").method == "POST"
        result = client.call("fetch_user", user_id="123")
    assert isinstance(result, ReflexResult)
    assert result.refused and not result.ok
    assert result.reason_code == "ambiguous_mapping"


def test_client_rejects_bad_input_and_maps_connection_errors():
    with pytest.raises(ReflexValidationError):
        ReflexClient(base_url="not-a-url")
    with ReflexClient(client=httpx.Client(base_url="http://test", transport=httpx.MockTransport(
        lambda request: (_ for _ in ()).throw(httpx.ConnectError("down", request=request))
    ))) as client:
        with pytest.raises(ReflexConnectionError):
            client.list_tools()
