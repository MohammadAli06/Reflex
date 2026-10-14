import { useEffect, useRef, useState } from 'react'
import type { TraceEvent } from '../types'

export type StreamStatus = 'idle' | 'connecting' | 'streaming' | 'finished' | 'disconnected'

/** Subscribe to a run's SSE trace. Events come only from the backend. */
export function useRunEvents(runId: string | undefined) {
  const [events, setEvents] = useState<TraceEvent[]>([])
  const [status, setStatus] = useState<StreamStatus>('idle')
  const seen = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!runId) {
      setStatus('idle')
      return
    }
    seen.current = new Set()
    setEvents([])
    setStatus('connecting')
    const source = new EventSource(`/api/runs/${runId}/events`)

    source.onopen = () => setStatus('streaming')
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as TraceEvent
        if (seen.current.has(event.seq)) return
        seen.current.add(event.seq)
        setEvents((prev) => [...prev, event])
      } catch {
        /* ignore malformed frame */
      }
    }
    source.addEventListener('end', () => {
      setStatus('finished')
      source.close()
    })
    source.onerror = () => {
      setStatus('disconnected')
      source.close()
    }
    return () => source.close()
  }, [runId])

  return { events, status }
}
