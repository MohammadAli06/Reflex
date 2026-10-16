import { useState } from 'react'
import type { TraceEvent } from '../types'
import { SchemaDiffView, type SchemaDiffData } from './SchemaDiffView'
import { CopyButton } from './ui/CopyButton'
import {
  IconActivity,
  IconAlertCircle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconFileText,
  IconGitBranch,
  IconRefresh,
  IconShield,
} from './ui/Icons'

const LABELS: Record<string, string> = {
  run_started: 'Run started',
  task_started: 'Task started',
  call_attempt: 'Request sent',
  error_detected: 'Request failed (422)',
  error_classified: 'Failure diagnosed',
  schema_fetched: 'Schema fetched',
  schema_diff: 'Schema changes found',
  candidate_patch: 'Patch drafted',
  validation_result: 'Patch checked',
  patch_applied: 'Patch applied',
  retry: 'Request retried',
  verified: 'Retry verified',
  rollback: 'Patch rolled back',
  refused: 'Stopped safely',
  needs_human_review: 'Needs human review',
  response_check: 'Response checked',
  not_drift: 'Not schema drift',
  run_finished: 'Run finished',
}

function getEventIcon(type: string) {
  switch (type) {
    case 'verified':
    case 'patch_applied':
    case 'run_finished':
      return <IconCheck size={14} strokeWidth={2.5} />
    case 'error_detected':
    case 'not_drift':
      return <IconAlertCircle size={14} />
    case 'refused':
    case 'needs_human_review':
    case 'rollback':
      return <IconShield size={14} />
    case 'schema_diff':
    case 'schema_fetched':
      return <IconGitBranch size={14} />
    case 'candidate_patch':
    case 'error_classified':
      return <IconActivity size={14} />
    case 'retry':
    case 'call_attempt':
      return <IconRefresh size={14} />
    default:
      return <IconFileText size={14} />
  }
}

function toneFor(ev: TraceEvent): string {
  switch (ev.type) {
    case 'refused':
    case 'needs_human_review':
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

/** Format any value without producing [object Object] */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return 'none'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]'
    return v
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>
          if (obj.name) return String(obj.name)
          if (obj.path) return String(obj.path)
          return JSON.stringify(obj)
        }
        return String(item)
      })
      .join(', ')
  }
  if (typeof v === 'object') {
    return JSON.stringify(v)
  }
  return String(v)
}

function EventRow({ ev, t0 }: { ev: TraceEvent; t0: number }) {
  const [showDetails, setShowDetails] = useState(false)
  const offset = Math.max(0, new Date(ev.ts).getTime() - t0)
  const isDiff = ev.type === 'schema_diff'
  const isRefusal = ev.type === 'refused'
  const isVerified = ev.type === 'verified'
  const isError = ev.type === 'error_detected'

  // Extract key facts
  const data = ev.data ?? {}
  const facts: Array<{ label: string; value: React.ReactNode }> = []

  if (data.status) facts.push({ label: 'HTTP status', value: String(data.status) })
  if (data.endpoint) facts.push({ label: 'Endpoint', value: <code>{String(data.endpoint)}</code> })
  if (data.version !== undefined) facts.push({ label: 'Schema version', value: `v${data.version}` })
  if (data.sha256) {
    facts.push({
      label: 'Hash',
      value: <CopyButton text={String(data.sha256)} truncateLength={8} />,
    })
  }
  if (data.reason || data.reason_code) {
    facts.push({
      label: 'Reason',
      value: <span className="con-warn font-mono">{String(data.reason ?? data.reason_code)}</span>,
    })
  }
  if (data.attempt) facts.push({ label: 'Attempt', value: `#${data.attempt}` })
  if (data.healing_path) facts.push({ label: 'Method', value: String(data.healing_path) })
  if (data.explanation) facts.push({ label: 'Note', value: String(data.explanation) })

  // If no predefined facts were extracted, extract up to 2 generic keys
  if (facts.length === 0 && !isDiff) {
    const entries = Object.entries(data).slice(0, 2)
    for (const [k, v] of entries) {
      if (v === null || v === undefined) continue
      facts.push({ label: k, value: formatValue(v) })
    }
  }

  return (
    <div className={`tl-item ${toneFor(ev)}`}>
      <div className="tl-head">
        <span className="tl-time">+{offset}ms</span>
        <span className={`tl-tag tl-tag-${ev.agent}`}>
          {ev.agent === 'healing' ? 'Reflex' : ev.agent}
        </span>
        <span className="con-row" style={{ gap: 6 }}>
          <span style={{ color: 'var(--text-muted)' }}>{getEventIcon(ev.type)}</span>
          <span className="tl-title">{LABELS[ev.type] ?? ev.type}</span>
        </span>
        {isRefusal && <span className="badge badge-warning">Refused</span>}
        {isVerified && <span className="badge badge-success">Verified</span>}
        {isError && <span className="badge badge-failure">Error</span>}
      </div>

      {isDiff ? (
        <div style={{ marginTop: 8 }}>
          <SchemaDiffView diff={ev.data as SchemaDiffData} />
        </div>
      ) : facts.length > 0 ? (
        <div className="tl-facts">
          {facts.map((fact, idx) => (
            <span key={idx} className="tl-fact-chip">
              <span className="text-muted">{fact.label}:</span>
              <b>{fact.value}</b>
            </span>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: 6 }}>
        <button
          type="button"
          className="tl-details-toggle"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          <span>{showDetails ? 'Hide raw event details' : 'Show details'}</span>
        </button>

        {showDetails && (
          <div style={{ marginTop: 8 }}>
            <pre
              style={{
                margin: 0,
                padding: '8px 12px',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                overflowX: 'auto',
                color: 'var(--text-secondary)',
              }}
            >
              {JSON.stringify(ev.data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

export type TimelineFilter = 'all' | 'error' | 'diagnosis' | 'patch' | 'refusal' | 'baseline' | 'healing'

export function EventTimeline({
  events,
  filter = 'all',
}: {
  events: TraceEvent[]
  filter?: TimelineFilter
}) {
  const [activeFilter, setActiveFilter] = useState<TimelineFilter>(filter)
  const t0 = events.length ? new Date(events[0].ts).getTime() : 0

  const filtered = events.filter((e) => {
    if (activeFilter === 'all') return true
    if (activeFilter === 'baseline') return e.agent === 'baseline'
    if (activeFilter === 'healing') return e.agent === 'healing'
    if (activeFilter === 'error') return ['error_detected', 'not_drift'].includes(e.type)
    if (activeFilter === 'diagnosis') return ['error_classified', 'schema_fetched', 'schema_diff'].includes(e.type)
    if (activeFilter === 'patch') return ['candidate_patch', 'validation_result', 'patch_applied', 'retry', 'verified'].includes(e.type)
    if (activeFilter === 'refusal') return ['refused', 'needs_human_review'].includes(e.type)
    return true
  })

  if (events.length === 0) {
    return (
      <div className="state state-empty">
        <strong>No events yet</strong>
        <span className="text-muted">Events appear here as the run progresses.</span>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="con-row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="text-label" style={{ marginRight: 4 }}>Show</span>
        {(['all', 'error', 'diagnosis', 'patch', 'refusal'] as TimelineFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            className={`cbtn cbtn-sm ${activeFilter === f ? 'cbtn-primary' : 'cbtn-ghost'}`}
            style={{ textTransform: 'capitalize' }}
            onClick={() => setActiveFilter(f)}
          >
            {f === 'error' ? 'Errors' : f === 'diagnosis' ? 'Diagnosis' : f === 'patch' ? 'Patch' : f === 'refusal' ? 'Refusals' : 'All'}
          </button>
        ))}
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
          Showing {filtered.length} of {events.length} events
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="state state-empty" style={{ padding: '24px' }}>
          <strong>No events match filter &ldquo;{activeFilter}&rdquo;.</strong>
          <span className="text-muted">Select &ldquo;all&rdquo; to view the entire timeline.</span>
        </div>
      ) : (
        <div className="tl">
          {filtered.map((ev) => (
            <EventRow key={`${ev.run_id}-${ev.seq}`} ev={ev} t0={t0} />
          ))}
        </div>
      )}
    </div>
  )
}
