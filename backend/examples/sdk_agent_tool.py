"""A provider-neutral function that an agent framework can expose as a tool.

Start the Mock API and Control API first; see the repository README.
Run from ``backend`` with: ``python examples/sdk_agent_tool.py``.
"""
from reflex_sdk import ReflexClient


client = ReflexClient("http://localhost:8001")


def get_user(user_id: str) -> dict:
    """Normal Python function suitable for an agent framework tool wrapper."""
    result = client.call("fetch_user", user_id=user_id)
    if result.refused:
        return {"ok": False, "reason_code": result.reason_code, "run_id": result.run_id}
    if not result.ok:
        return {"ok": False, "error": result.error, "run_id": result.run_id}
    return {"ok": True, "user": result.data, "healed": result.healed, "run_id": result.run_id}


if __name__ == "__main__":
    try:
        print(get_user("123"))
    finally:
        client.close()
