import { useState, Fragment } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { PageHead, Panel } from '../components/console'
import { JsonViewer } from '../components/JsonViewer'
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews'
import { CopyButton } from '../components/ui/CopyButton'
import {
  IconChevronDown,
  IconChevronRight,
  IconSearch,
  IconX,
} from '../components/ui/Icons'
import { DASH } from '../utils/format'
import type { AuditEntry } from '../types'

const FILTERS = ['all', 'applied', 'refused', 'rolled_back', 'needs_human_review', 'not_drift']

function getStatusBadge(outcome: string) {
  if (outcome === 'applied') {
    return (
      <span className="badge badge-success">
        Patched
      </span>
    )
  }
  if (outcome === 'refused') {
    return (
      <span className="badge badge-warning">
        Refused
      </span>
    )
  }
  return (
    <span className="badge badge-neutral">
      No action
    </span>
  )
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className="con-row" style={{ gap: 8, minWidth: 90 }}>
      <span className="font-mono text-muted" style={{ fontSize: 11, width: 28 }}>
        {value.toFixed(2)}
      </span>
      <div
        style={{
          flex: 1,
          height: 6,
          background: 'var(--border-color)',
          borderRadius: 3,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: value >= 0.8 ? 'var(--success-green)' : value >= 0.5 ? 'var(--reflex-cyan)' : 'var(--accent-orange)',
            borderRadius: 3,
          }}
        />
      </div>
    </div>
  )
}

export function AuditPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const audit = useApi(() => api.audit({ limit: 200 }), [])

  if (audit.loading) return <LoadingState label="Loading audit log…" />
  if (audit.error) return <ErrorState message={audit.error} onRetry={audit.reload} />

  const entries: AuditEntry[] = audit.data?.entries ?? []

  // Count by outcome
  const counts = FILTERS.reduce<Record<string, number>>((acc, f) => {
    acc[f] = f === 'all' ? entries.length : entries.filter((e) => e.outcome === f).length
    return acc
  }, {})

  // Filter and search
  const filtered = entries.filter((e) => {
    if (filter !== 'all' && e.outcome !== filter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const matchTool = e.tool.toLowerCase().includes(q)
      const matchRun = e.run_id.toLowerCase().includes(q)
      const matchHash = (e.schema_sha256 || '').toLowerCase().includes(q)
      const matchOutcome = e.outcome.toLowerCase().includes(q)
      const matchReason = (e.reason_code || '').toLowerCase().includes(q)
      if (!matchTool && !matchRun && !matchHash && !matchOutcome && !matchReason) return false
    }
    return true
  })

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Append-only record of every decision</span>}
        title="Audit log"
        subtitle="Every patch, refusal, and classification, with the evidence behind it."
        right={
          <span className="text-muted" style={{ fontSize: 12 }}>
            {entries.length} entries
          </span>
        }
      />

      <Panel
        title="Entries"
        actions={
          <span className="text-muted" style={{ fontSize: 12 }}>
            Showing {filtered.length} of {entries.length}
          </span>
        }
      >
        {/* Controls: Search box and filter buttons */}
        <div
          className="con-row"
          style={{
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {/* Search Box */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 12px',
              minWidth: 260,
            }}
          >
            <IconSearch size={15} style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              placeholder="Search by tool, run ID, hash, or reason…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                outline: 'none',
                width: '100%',
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                title="Clear search"
              >
                <IconX size={14} />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="con-row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={`cbtn cbtn-sm ${filter === f ? 'cbtn-primary' : 'cbtn-ghost'}`}
                style={{ textTransform: 'capitalize' }}
                onClick={() => {
                  setFilter(f)
                  setOpen(null)
                }}
              >
                {f === 'applied' ? 'Patched' : f === 'not_drift' ? 'No Action' : f}{' '}
                <span className="font-mono text-muted" style={{ marginLeft: 4 }}>
                  ({counts[f] ?? 0})
                </span>
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            message={search ? 'No matching entries.' : 'No audit entries yet.'}
            hint={search ? 'Try a different search term.' : 'Run a comparison or a safety scenario to create entries.'}
          />
        ) : (
          <div className="table-wrap">
            <table className="ctable">
              <thead>
                <tr>
                  <th style={{ width: 32 }} />
                  <th>Timestamp</th>
                  <th>Tool</th>
                  <th>Status</th>
                  <th>Version Change</th>
                  <th>Schema Hash</th>
                  <th>Confidence</th>
                  <th>Repair Path</th>
                  <th>Reason Code</th>
                  <th style={{ textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const isOpen = open === e.ts
                  return (
                    <Fragment key={e.ts}>
                      <tr
                        key={e.ts}
                        onClick={() => navigate(`/console/runs/${e.run_id}`)}
                        data-testid={`audit-row-${e.run_id}`}
                        style={{
                          cursor: 'pointer',
                          background: isOpen ? 'var(--surface-tint)' : undefined,
                        }}
                      >
                        <td style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
                          {isOpen ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                        </td>
                        <td className="text-muted font-mono" style={{ fontSize: 12 }}>
                          {new Date(e.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                          {new Date(e.ts).toLocaleTimeString(undefined, { hour12: false })}
                        </td>
                        <td>
                          <b>{e.tool || DASH}</b>
                        </td>
                        <td>{getStatusBadge(e.outcome)}</td>
                        <td className="font-mono" style={{ fontSize: 12 }}>
                          v{e.schema_version_before ?? '?'} → <span className="con-accent font-mono" style={{ fontWeight: 600 }}>v{e.schema_version_after ?? '?'}</span>
                        </td>
                        <td>
                          <CopyButton text={e.schema_sha256} truncateLength={8} />
                        </td>
                        <td>
                          <ConfidenceBar value={e.confidence} />
                        </td>
                        <td>
                          {e.healing_path ? (
                            <span className="font-mono" style={{ fontSize: 12 }}>
                              {e.healing_path === 'llm' ? 'LLM' : 'Rule'}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {e.reason_code ? (
                            <span className="font-mono con-warn" style={{ fontSize: 12 }}>
                              {e.reason_code}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          <button
                            type="button"
                            className="cbtn cbtn-sm"
                            onClick={(evt) => {
                              evt.stopPropagation()
                              setOpen(isOpen ? null : e.ts)
                            }}
                          >
                            {isOpen ? 'Close' : 'Details'}
                          </button>
                        </td>
                      </tr>

                      {/* Expandable row for details */}
                      {isOpen && (
                        <tr key={`${e.ts}-details`}>
                          <td colSpan={10} style={{ padding: '16px 20px', background: 'var(--bg-subtle)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                              <div className="con-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                                <div className="con-row" style={{ gap: 8 }}>
                                  <span className="text-label">Inspection:</span>
                                  <span style={{ fontWeight: 600 }}>{e.tool}</span>
                                  <span className="text-muted font-mono" style={{ fontSize: 12 }}>
                                    (Run:{' '}
                                    <Link to={`/console/runs/${e.run_id}`} className="font-mono">
                                      {e.run_id}
                                    </Link>
                                    )
                                  </span>
                                </div>
                                <div className="con-row" style={{ gap: 8 }}>
                                  <span className="text-muted">Full sha-256:</span>
                                  <CopyButton text={e.schema_sha256} truncateLength={16} />
                                </div>
                              </div>

                              {/* Before and After JSON */}
                              <div className="con-grid-2">
                                <div>
                                  <div className="text-label" style={{ marginBottom: 6 }}>
                                    Schema before
                                  </div>
                                  {e.old_definition ? (
                                    <JsonViewer value={e.old_definition} />
                                  ) : (
                                    <div className="state state-empty" style={{ padding: 16 }}>
                                      No original definition recorded.
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <div className="text-label" style={{ marginBottom: 6 }}>
                                    Schema after
                                  </div>
                                  {e.new_definition ? (
                                    <JsonViewer value={e.new_definition} />
                                  ) : (
                                    <div className="state state-empty" style={{ padding: 16 }}>
                                      No patch applied (Safe refusal or non-drift).
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Evidence Items */}
                              {(e.evidence?.length ?? 0) > 0 && (
                                <div
                                  style={{
                                    background: 'var(--bg-card)',
                                    padding: '12px 16px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--border-color)',
                                  }}
                                >
                                  <div className="text-label" style={{ marginBottom: 6 }}>
                                    Evidence ({e.evidence.length} items)
                                  </div>
                                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)' }}>
                                    {e.evidence.map((item, idx) => (
                                      <li key={idx} style={{ marginTop: 2 }}>{item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}
