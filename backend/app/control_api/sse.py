"""Server-sent-events helpers for streaming real trace events."""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from ..healing.events import TraceEvent


def format_event(event: TraceEvent) -> str:
    payload = json.dumps(event.to_dict(), ensure_ascii=False)
    return f"id: {event.seq}\ndata: {payload}\n\n"


def format_stored_event(stored: dict) -> str:
    payload = json.dumps(stored, ensure_ascii=False)
    return f"id: {stored.get('idx', 0)}\ndata: {payload}\n\n"


async def stream_events(state, start_index: int = 0, poll_s: float = 0.15,
                        event_repo=None) -> AsyncIterator[str]:
    """Replay events from ``start_index`` then stream live until the run ends."""
    index = max(0, start_index)
    if event_repo is not None:
        try:
            for stored in event_repo.list_after(state.run_id, index - 1 if index else -1):
                yield format_stored_event(stored)
                index = stored.get("idx", index) + 1
        except Exception:
            pass
    ticks = 0
    while True:
        pending = state.events
        while index < len(pending):
            yield format_event(pending[index])
            index += 1
        if state.status != "running":
            yield f"event: end\ndata: {json.dumps(state.summary(), ensure_ascii=False)}\n\n"
            return
        ticks += 1
        if ticks % 20 == 0:
            yield ": keep-alive\n\n"
        await asyncio.sleep(poll_s)
