"""Server-sent-events helpers for streaming real trace events."""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

from ..healing.events import TraceEvent


def format_event(event: TraceEvent) -> str:
    payload = json.dumps(event.to_dict(), ensure_ascii=False)
    return f"id: {event.seq}\ndata: {payload}\n\n"


async def stream_events(state, start_index: int = 0, poll_s: float = 0.15) -> AsyncIterator[str]:
    """Replay events from ``start_index`` then stream live until the run ends."""
    index = max(0, start_index)
    ticks = 0
    while True:
        while index < len(state.events):
            yield format_event(state.events[index])
            index += 1
        if state.status != "running":
            yield f"event: end\ndata: {json.dumps(state.summary(), ensure_ascii=False)}\n\n"
            return
        ticks += 1
        if ticks % 20 == 0:
            yield ": keep-alive\n\n"
        await asyncio.sleep(poll_s)
