import type { TraceEvent } from '../types'
import { SchemaDiffView, type SchemaDiffData } from './SchemaDiffView'
import { Chip } from './console'

const LABELS: Record<string, string> = {
  run_started: 'Run started',
  task_started: 'Task started',
  call_attempt: 'Tool invocation dispatched',
  error_detected: 'Error detected',
  error_classified: 'Failure classified',
  schema_fetched: 'Active schema fetched',
  schema_diff: 'Schema diff computed',
  candidate_patch: 'Candidate patch synthesized',
  validation_result: 'Validation evaluated',
  patch_applied: 'Patch applied in-memory',
  retry: 'Retry dispatched',
  verified: 'Verified success',
  rollback: 'Rollback executed',
  refused: 'Safe refusal committed',
  needs_human_review: 'Human review required',
  response_check: 'Response contract checked',
  not_drift: 'Classified as not drift',
  run_finished: 'Run finished',
}

function toneFor(ev: TraceEvent): string {
  switch (ev.type) {
    case 'refused':
    case 'needs_human_review':
      return 'tl-item-warn'
    case 'rollback':
      return 'tl-item-warn'
    case 'verified':
    case 'patch_applied':
    case 'run_finished':
      return 'tl-item-ok'
    case 'error_detected':
    case 'not_drift':
      return 'tl-item-bad'
    default:
      return ''
  }
}

function describe(ev: TraceEvent): string {
  const d = ev.data
  const parts: string[] = []
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue
    const rendered = Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)
    parts.push(`${k}: ${rendered}`)
  }
  return parts.join('  ·  ')
}

function EventRow({ ev, t0 }: { ev: TraceEvent; t0: number }) {
  const offset = Math.max(0, new Date(ev.ts).getTime() - t0)
  const isDiff = ev.type === 'schema_diff'
  return (
    <div className={`tl-item ${toneFor(ev)}`}>
      <div className="tl-head">
        <span className="tl-time">+{offset}ms</span>
        <span className={`tl-tag tl-tag-${ev.agent}`}>{ev.agent}</span>
        <span className="tl-title">{LABELS[ev.type] ?? ev.type}</span>
        {ev.type === 'refused' && <Chip tone="warn">refusal</Chip>}
        {ev.type === 'verified' && <Chip tone="ok">ok</Chip>}
      </div>
      {isDiff ? (
        <div style={{ marginTop: 6 }}>
          <SchemaDiffView diff={ev.data as SchemaDiffData} />
        </div>
      ) : (
        <div className="con-mono con-muted" style={{ fontSize: 11, marginTop: 2 }}>{describe(ev)}</div>
      )}
    </div>
  )
}

export function EventTimeline({
  events,
  filter = 'all',
}: {
  events: TraceEvent[]
  filter?: 'all' | 'baseline' | 'healing'
}) {
  const t0 = events.length ? new Date(events[0].ts).getTime() : 0
  const shown = events.filter((e) => filter === 'all' || e.agent === filter)
  if (shown.length === 0) {
    return (
      <div className="state state-empty">
        <strong>Waiting for events…</strong>
        <span>Trace events stream from the backend over SSE.</span>
      </div>
    )
  }
  return (
    <div className="tl">
      {shown.map((ev) => (
        <EventRow key={`${ev.run_id}-${ev.seq}`} ev={ev} t0={t0} />
      ))}
    </div>
  )
}
