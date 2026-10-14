import type { TraceEvent } from '../types'
import { SchemaDiffView, type SchemaDiffData } from './SchemaDiffView'

const LABELS: Record<string, string> = {
  run_started: 'Run started',
  task_started: 'Task started',
  call_attempt: 'Call attempt',
  error_detected: 'Error detected',
  error_classified: 'Classified',
  schema_fetched: 'Schema fetched',
  schema_diff: 'Schema diff',
  candidate_patch: 'Candidate patch',
  validation_result: 'Validation',
  patch_applied: 'Patch applied',
  retry: 'Retry',
  verified: 'Verified',
  rollback: 'Rollback',
  refused: 'Refused',
  needs_human_review: 'Needs human review',
  response_check: 'Response check',
  not_drift: 'Not drift',
  run_finished: 'Run finished',
}

function compact(data: Record<string, unknown>): string {
  const skip = new Set(['endpoint', 'response', 'errors'])
  const parts: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (skip.has(key) || value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    const rendered = Array.isArray(value) ? value.join(', ') : String(value)
    parts.push(`${key}=${rendered}`)
  }
  return parts.join('  ')
}

function TraceRow({ event }: { event: TraceEvent }) {
  const isDiff = event.type === 'schema_diff'
  const isRefusal = event.type === 'refused' || event.type === 'needs_human_review'
  return (
    <li className={`trace-event trace-${event.agent} trace-type-${event.type}`}>
      <div className="trace-head">
        <span className={`agent-tag agent-${event.agent}`}>{event.agent}</span>
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
