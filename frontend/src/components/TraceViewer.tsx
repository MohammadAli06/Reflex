import type { TraceEvent } from '../types'
import { SchemaDiffView, type SchemaDiffData } from './SchemaDiffView'

const LABELS: Record<string, string> = {
  run_started: 'Run started',
  task_started: 'Task started',
  call_attempt: 'Call attempt',
  error_detected: 'Validation error',
  error_classified: 'Diagnosed',
  schema_fetched: 'Schema fetched',
  schema_diff: 'Schema diff',
  candidate_patch: 'Candidate patch',
  validation_result: 'Validation evaluated',
  patch_applied: 'Patch applied',
  retry: 'Retry',
  verified: 'Verified success',
  rollback: 'Rollback',
  refused: 'Safe refusal',
  needs_human_review: 'Needs human review',
  response_check: 'Response check',
  not_drift: 'Not drift',
  run_finished: 'Run finished',
}

function formatSafe(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'object' && item !== null ? (item as Record<string, unknown>).name ?? JSON.stringify(item) : String(item)))
      .join(', ')
  }
  return JSON.stringify(value)
}

function compact(data: Record<string, unknown>): string {
  const skip = new Set(['endpoint', 'response', 'errors'])
  const parts: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (skip.has(key) || value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    parts.push(`${key}=${formatSafe(value)}`)
  }
  return parts.join('  ')
}

function TraceRow({ event }: { event: TraceEvent }) {
  const isDiff = event.type === 'schema_diff'
  const isRefusal = event.type === 'refused' || event.type === 'needs_human_review'
  return (
    <li className={`trace-event trace-${event.agent} trace-type-${event.type}`}>
      <div className="trace-head">
        <span className={`agent-tag agent-${event.agent}`}>
          {event.agent === 'healing' ? 'Reflex' : event.agent}
        </span>
        <strong>{LABELS[event.type] ?? event.type}</strong>
        <span className="muted">{new Date(event.ts).toLocaleTimeString()}</span>
      </div>
      {isDiff ? (
        <SchemaDiffView diff={event.data as SchemaDiffData} />
      ) : (
        <code className={`trace-data ${isRefusal ? 'trace-refusal' : ''}`}>{compact(event.data)}</code>
      )}
    </li>
  )
}

export function TraceViewer({
  events,
  status,
}: {
  events: TraceEvent[]
  status: string
}) {
  if (events.length === 0) {
    return <div className="state state-empty">Waiting for events… ({status})</div>
  }
  return (
    <div className="trace-viewer">
      <div className="trace-status muted">stream: {status} · {events.length} events</div>
      <ol className="trace-list">
        {events.map((event) => (
          <TraceRow key={`${event.run_id}-${event.seq}`} event={event} />
        ))}
      </ol>
    </div>
  )
}
