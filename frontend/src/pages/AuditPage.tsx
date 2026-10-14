import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Chip, PageHead, Panel } from '../components/console'
import { JsonViewer } from '../components/JsonViewer'
import { ErrorState, LoadingState } from '../components/StateViews'
import { DASH, num } from '../utils/format'
import type { AuditEntry } from '../types'

const FILTERS = ['all', 'applied', 'refused', 'rolled_back', 'needs_human_review', 'not_drift']

function outcomeTone(outcome: string): 'ok' | 'bad' | 'warn' | 'mute' {
  if (outcome === 'applied') return 'ok'
  if (outcome === 'rolled_back' || outcome === 'needs_human_review') return 'warn'
  if (outcome === 'refused') return 'warn'
  return 'mute'
}

function Confidence({ value }: { value: number }) {
  const width = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <span className="con-row" style={{ gap: '0.5rem' }}>
      <span className="con-mono" style={{ width: 32 }}>{value.toFixed(2)}</span>
      <span className={`con-bar ${value < 0.5 ? 'con-bar-warn' : ''}`}>
        <span style={{ width: `${width}%` }} />
      </span>
    </span>
  )
}

export function AuditPage() {
  const [filter, setFilter] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const audit = useApi(() => api.audit({ limit: 200 }), [])

  if (audit.loading) return <LoadingState label="Loading audit ledger…" />
  if (audit.error) return <ErrorState message={audit.error} onRetry={audit.reload} />

  const entries: AuditEntry[] = audit.data?.entries ?? []
  const counts = FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f] = f === 'all' ? entries.length : entries.filter((e) => e.outcome === f).length
    return acc
  }, {})
  const shown = filter === 'all' ? entries : entries.filter((e) => e.outcome === filter)
  const selected = shown.find((e) => e.ts === open) ?? null

  return (
    <div className="con-page">
      <PageHead
        eyebrow={
          <>
            <span className="con-dot con-dot-ok" style={{ borderRadius: 0 }} />
            Telemetry ledger // registry core
          </>
        }
        title="Audit log"
        subtitle="Append-only record of every patch and refusal. Entries are hash-linked."
        right={
          <span className="con-row" style={{ gap: '0.5rem', border: '1px solid var(--c-outline-variant)', padding: '0.375rem 0.625rem' }}>
            <span className="msym msym-13 con-accent">lock</span>
            <span className="con-mono" style={{ fontSize: 11 }}>Chain status:</span>
            <span className="con-mono con-accent" style={{ fontSize: 11 }}>{entries.length} entries</span>
          </span>
        }
      />

      <Panel
        title="Ledger stream // immutable journal"
        actions={<span className="con-label">sync_state: verified</span>}
        footer={<><span>Showing {shown.length} of {entries.length} entries</span><span className="con-label">Append-only · secrets redacted</span></>}
      >
        <div className="con-row" style={{ gap: 2, marginBottom: '1rem' }}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className="cbtn cbtn-sm"
              style={{
                borderLeft: `2px solid ${filter === f ? 'var(--c-primary)' : 'transparent'}`,
                borderColor: filter === f ? 'var(--c-outline)' : 'var(--c-outline-variant)',
                background: filter === f ? 'var(--c-container)' : 'transparent',
                color: filter === f ? 'var(--c-on)' : 'var(--c-on-variant)',
              }}
              onClick={() => { setFilter(f); setOpen(null) }}
            >
              {f} <span className="con-muted">{counts[f] ?? 0}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <div className="state state-empty">
            <strong>No audit entries{filter !== 'all' ? ` for “${filter}”` : ''}.</strong>
            <span>Run a comparison or a safety scenario to populate the ledger.</span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ctable">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Tool</th>
                  <th>Outcome</th>
                  <th>Version</th>
                  <th>Hash</th>
                  <th>Confidence</th>
                  <th>Reason code</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.ts}>
                    <td className="con-muted">{new Date(e.ts).toLocaleString()}</td>
                    <td>{e.tool || DASH}</td>
                    <td><Chip tone={outcomeTone(e.outcome)}>{e.outcome}</Chip></td>
                    <td>
                      v{e.schema_version_before ?? '?'} <span className="con-muted">→</span>{' '}
                      <span className="con-accent">v{e.schema_version_after ?? '?'}</span>
                    </td>
                    <td className="con-accent">{(e.schema_sha256 || '').slice(0, 10) || DASH}</td>
                    <td><Confidence value={e.confidence} /></td>
                    <td>{e.reason_code ? <Chip tone="mute">{e.reason_code}</Chip> : DASH}</td>
                    <td>
                      <button className="cbtn cbtn-sm" onClick={() => setOpen(open === e.ts ? null : e.ts)}>
                        {open === e.ts ? 'hide' : 'inspect'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected && (
        <Panel
          title={`Inspector · ${selected.tool || 'entry'} · ${selected.outcome}`}
          actions={<Chip tone={outcomeTone(selected.outcome)}>{selected.outcome}</Chip>}
          footer={
            <>
              <span className="con-row" style={{ gap: '0.5rem' }}>
                <span className="msym msym-13 con-accent">lock</span>
                <span>schema sha-256:</span>
                <span className="con-mono">{(selected.schema_sha256 || DASH).slice(0, 32)}</span>
              </span>
              <span className="con-label">path: {selected.healing_path}</span>
            </>
          }
        >
          <div className="con-grid-2">
            <div>
              <div className="con-label" style={{ marginBottom: 6 }}>Original definition</div>
              {selected.old_definition ? <JsonViewer value={selected.old_definition} /> : <div className="state state-empty"><strong>No old definition recorded.</strong></div>}
            </div>
            <div>
              <div className="con-label" style={{ marginBottom: 6 }}>Patched definition</div>
              {selected.new_definition ? <JsonViewer value={selected.new_definition} /> : <div className="state state-empty"><strong>No new definition recorded (refusal / not drift).</strong></div>}
            </div>
          </div>
          {(selected.evidence?.length ?? 0) > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <div className="con-label" style={{ marginBottom: 6 }}>Evidence · {selected.evidence.length} checks</div>
              <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: 12 }} className="con-muted">
                {selected.evidence.map((item, i) => <li key={i}>{item}</li>)}
              </ul>
            </div>
          )}
          <div className="con-label" style={{ marginTop: '1rem' }}>
            confidence {selected.confidence.toFixed(2)} · {num(selected.evidence?.length ?? 0)} evidence items
          </div>
        </Panel>
      )}
    </div>
  )
}
