import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useRunEvents } from '../hooks/useRunEvents'
import { PageHead, Panel } from '../components/console'
import { EventTimeline } from '../components/EventTimeline'
import { EmptyState, LoadingState } from '../components/StateViews'
import { CopyButton } from '../components/ui/CopyButton'
import { DecisionCard } from '../components/DecisionCard'
import {
  IconPlay,
  IconSearch,
} from '../components/ui/Icons'
import { DASH, num, relTime } from '../utils/format'

function runTone(status: string): 'ok' | 'bad' | 'warn' | 'mute' {
  if (status === 'finished') return 'ok'
  if (status === 'error') return 'bad'
  if (status === 'running') return 'warn'
  return 'mute'
}

export function TracePage({ embedded = false }: { embedded?: boolean }) {
  const { runId } = useParams<{ runId: string }>()
  const runs = useApi(() => api.listRuns(), [])
  const [selected, setSelected] = useState<string | undefined>(runId)
  const [query, setQuery] = useState('')
  const active = runId ?? selected ?? runs.data?.runs[0]?.run_id
  const { events, status } = useRunEvents(active)

  if (runs.loading) return <LoadingState label="Loading recorded traces…" />

  const activeRun = runs.data?.runs.find((r) => r.run_id === active) ?? null
  const healingRecord = activeRun?.records.find((r) => r.agent === 'healing') ?? null

  const duration =
    healingRecord && healingRecord.t_break !== null && healingRecord.t_recovery !== null
      ? `${Math.round((healingRecord.t_recovery - healingRecord.t_break) * 1000)}ms`
      : DASH

  const q = query.trim().toLowerCase()
  const visibleRuns = q
    ? (runs.data?.runs.filter((run) =>
        run.run_id.toLowerCase().includes(q) ||
        run.case_ids.some((c) => c.toLowerCase().includes(q)) ||
        (run.records.find((r) => r.agent === 'healing')?.outcome ?? '').includes(q)
      ) ?? [])
    : (runs.data?.runs ?? [])

  return (
    <div className="con-page">
      {!embedded && (
        <PageHead
        eyebrow={<span>Every step of a run, in order</span>}
        title="Trace"
        subtitle="Calls, schema diffs, patches, and validation checks for the selected run."
        right={
          <div className="con-row" style={{ gap: 12 }}>
            <Link className="cbtn cbtn-primary" to="/console/compare">
              <span>Run new comparison</span>
              <IconPlay size={13} />
            </Link>
          </div>
        }
      />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, alignItems: 'start' }}>
        <Panel
          title="Runs"
          actions={
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                padding: '3px 8px',
              }}
            >
              <IconSearch size={13} style={{ color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Filter runs…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search runs"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-primary)',
                  fontSize: 12,
                  outline: 'none',
                  width: 140,
                }}
              />
            </div>
          }
        >
          {runs.data && runs.data.runs.length === 0 ? (
            <EmptyState
              message="No runs recorded."
              hint="Execute a benchmark run from Agent Comparison to populate this ledger."
            />
          ) : visibleRuns.length === 0 ? (
            <EmptyState message="No runs match this filter." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {visibleRuns.map((run) => {
                const healing = run.records.find((r) => r.agent === 'healing')
                const on = run.run_id === active
                const isRecovered = healing?.outcome === 'recovered'
                const isRefused = healing?.outcome === 'refused'

                return (
                  <button
                    key={run.run_id}
                    type="button"
                    onClick={() => setSelected(run.run_id)}
                    style={{
                      textAlign: 'left',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${on ? 'var(--reflex-cyan)' : 'var(--border-subtle)'}`,
                      background: on ? 'var(--surface-tint)' : 'var(--bg-card)',
                      color: 'inherit',
                      transition: 'all var(--transition-fast)',
                    }}
                  >
                    <div style={{ fontSize: 12 }}>
                      <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                        <span className="font-mono" style={{ fontWeight: 600 }}>
                          {run.run_id.slice(0, 10)}…
                        </span>
                        <span
                          className={`badge badge-${
                            healing
                              ? isRecovered
                                ? 'success'
                                : isRefused
                                ? 'warning'
                                : 'failure'
                              : runTone(run.status) === 'ok' ? 'success' : runTone(run.status) === 'bad' ? 'failure' : runTone(run.status) === 'warn' ? 'warning' : 'neutral'
                          }`}
                          style={{ fontSize: 11 }}
                        >
                          {healing?.outcome ?? run.status}
                        </span>
                      </div>

                    <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
                      <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>
                        {run.case_ids.join(', ')}
                      </span>
                      <span>{relTime(run.started_at)}</span>
                    </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        {/* Right: Selected Run Details & Event Timeline */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {activeRun ? (
            <>
              <div className="card" style={{ padding: 20 }}>
                <div className="con-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div className="text-label" style={{ marginBottom: 4 }}>Run</div>
                    <div className="con-row" style={{ gap: 8 }}>
                      <h2 className="text-h2 serif" style={{ fontSize: 20, fontWeight: 500 }}>
                        {activeRun.run_id.slice(0, 18)}…
                      </h2>
                      <CopyButton text={activeRun.run_id} truncateLength={0} />
                    </div>
                  </div>

                  <div className="con-row" style={{ flexWrap: 'wrap', gap: 8, fontSize: 12 }}>
                    <span className="text-muted">
                      Case <b style={{ color: 'var(--ink)' }}>{activeRun.case_ids.join(', ')}</b>
                    </span>
                    <span className="text-muted">
                      Recovery <b className="font-mono" style={{ color: 'var(--ink)' }}>{duration}</b>
                    </span>
                    <span className="text-muted">
                      Tokens <b className="font-mono" style={{ color: 'var(--ink)' }}>{num(healingRecord?.tokens_total ?? null)}</b>
                    </span>
                    <span
                      className={`badge badge-${
                        healingRecord?.outcome === 'recovered'
                          ? 'success'
                          : healingRecord?.outcome === 'refused'
                          ? 'warning'
                          : 'failure'
                      }`}
                    >
                      {healingRecord?.outcome ?? activeRun.status}
                    </span>
                  </div>
                </div>
              </div>

              <Panel
                title="Timeline"
                actions={
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    Stream: {status}
                  </span>
                }
              >
                <EventTimeline events={events} />
              </Panel>

              {activeRun.run_id && <DecisionCard runId={activeRun.run_id} />}
            </>
          ) : (
            <EmptyState
              message="No run selected."
              hint="Pick a run from the list on the left or run a benchmark comparison."
            />
          )}

          <div
            className="text-muted"
            style={{
              padding: '14px 18px',
              borderRadius: 'var(--radius)',
              background: 'var(--surface-2)',
              border: '1px solid var(--hairline)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 13,
            }}
          >
            <span>
              When a change can&apos;t be verified, Reflex stops and records the refusal here.
            </span>
            <span className="font-mono" style={{ fontSize: 11 }}>
              {status}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
