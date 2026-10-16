import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { PageHead, Panel } from '../components/console'
import { EventTimeline } from '../components/EventTimeline'
import { ErrorState, LoadingState } from '../components/StateViews'
import {
  IconAlertTriangle,
  IconCheck,
  IconPlay,
  IconRefresh,
  IconX,
} from '../components/ui/Icons'
import { DASH, secs } from '../utils/format'
import type { ScenarioResult } from '../types'

const EXPLANATIONS: Record<string, string> = {
  ambiguous_mapping: 'Two or more candidates were equally plausible, so Reflex refused rather than guess.',
  missing_credential: 'Required header X-Tenant-Token has no configured secret, so Reflex refused instead of guessing.',
  missing_required_value: 'A newly required field had no approved value source, so Reflex refused rather than invent a default.',
  lossy_conversion: "The requested type conversion would have changed the value's meaning, so Reflex safely refused.",
  validation_failed: 'The candidate patch failed schema validation, so it was rejected.',
  no_evidence: 'No relevant schema change explained the error, so Reflex refused.',
  retry_cap_reached: 'The retry cap was reached without discovering a verified safe fix.',
  not_drift: 'Classified as an external server fault, not API schema drift. Registry remains unmodified.',
}

function outcomeTone(outcome: string): 'ok' | 'warn' | 'bad' | 'mute' {
  if (outcome === 'recovered') return 'ok'
  if (outcome === 'refused') return 'warn'
  if (outcome === 'not_drift_reported') return 'mute'
  return 'bad'
}

export function SafetyPage() {
  const scenarios = useApi(() => api.scenarios(), [])
  const status = useApi(() => api.status(), [])
  const [results, setResults] = useState<Record<string, ScenarioResult | 'running'>>({})
  const [active, setActive] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(id: string) {
    setError(null)
    setActive(id)
    setResults((prev) => ({ ...prev, [id]: 'running' }))
    try {
      const result = await api.runScenario(id)
      setResults((prev) => ({ ...prev, [id]: result }))
    } catch (err) {
      setResults((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      setError(err instanceof ApiError ? err.message : String(err))
    }
  }

  if (scenarios.loading) return <LoadingState label="Loading safety scenarios…" />
  if (scenarios.error) return <ErrorState message={scenarios.error} onRetry={scenarios.reload} />

  const list = scenarios.data?.scenarios ?? []
  const activeResult = active && results[active] && results[active] !== 'running' ? (results[active] as ScenarioResult) : null
  const isRunning = active && results[active] === 'running'
  const refused = activeResult?.outcome === 'refused'

  const plainReason = activeResult
    ? (activeResult.reason_code && EXPLANATIONS[activeResult.reason_code]) ||
      activeResult.explanation ||
      (refused
        ? 'Reflex safely halted execution because the change could not be proven correct from verified evidence.'
        : activeResult.outcome === 'recovered'
        ? 'The schema mutation was validated and an in-memory adapter was verified upstream.'
        : 'Classified as not schema drift. No patch applied.')
    : ''

  const evidenceEvents = activeResult?.events.filter((e) =>
    ['schema_fetched', 'schema_diff', 'candidate_patch', 'validation_result', 'refused', 'not_drift'].includes(e.type),
  ) ?? []

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Refusal behavior, verified scenario by scenario</span>}
        title="Safety"
        subtitle="When a change can't be proven correct from the evidence at hand, Reflex stops instead of guessing. Run a scenario to see the decision."
        right={
          <div className="con-row" style={{ gap: 8 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {list.length} scenarios
            </span>
          </div>
        }
      />

      {error && <div className="notice notice-error">{error}</div>}

      <div className="card" style={{ padding: 24 }}>
        {activeResult ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="con-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div className="text-label" style={{ marginBottom: 6 }}>Decision</div>
                <div className="con-row" style={{ gap: 10, alignItems: 'baseline' }}>
                  <strong className="serif" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.01em' }}>
                    {refused
                      ? 'Refused'
                      : activeResult.outcome === 'recovered'
                        ? 'Patched'
                        : 'Not drift'}
                  </strong>
                  <span
                    className={`badge badge-${
                      refused ? 'warning' : activeResult.outcome === 'recovered' ? 'success' : 'neutral'
                    }`}
                  >
                    {refused
                      ? 'Stopped safely'
                      : activeResult.outcome === 'recovered'
                        ? 'Verified'
                        : 'No change made'}
                  </span>
                </div>
                <div className="font-mono text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Scenario: <b>{activeResult.label}</b>
                  {' '}· Reason: <code style={{ fontWeight: 600 }}>{activeResult.reason_code ?? 'none'}</code>
                  {' '}· Decided in <b>{secs(activeResult.mttr)}</b>
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--surface-2)', padding: '16px 20px', borderRadius: 'var(--radius)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>
                {refused
                  ? 'Stopped. No safe mapping existed.'
                  : activeResult.outcome === 'recovered'
                  ? 'Fixed and verified against the live response.'
                  : 'Left untouched — this was not schema drift.'}
              </h3>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
                {plainReason}
              </p>
            </div>

            <div>
              <div className="text-label" style={{ marginBottom: 8 }}>What Reflex checked</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {evidenceEvents.map((e) => {
                  const isHalt = ['refused', 'not_drift'].includes(e.type)
                  const isFail = e.type === 'validation_result' && String((e.data as Record<string, unknown>)?.ok ?? 'true') === 'false'
                  return (
                    <li key={e.seq} className="con-row" style={{ gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
                      <span style={{ color: isHalt ? 'var(--warning-strong)' : isFail ? 'var(--brand-text)' : 'var(--success-strong)', flex: 'none', marginTop: 1 }}>
                        {isHalt ? <IconAlertTriangle size={15} /> : isFail ? <IconX size={15} strokeWidth={2.5} /> : <IconCheck size={15} strokeWidth={2.5} />}
                      </span>
                      <span>
                        <span className="font-mono" style={{ fontWeight: 600, fontSize: 12 }}>{e.type}</span>
                        <span className="text-muted" style={{ fontSize: 12 }}> — seq {e.seq}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        ) : isRunning ? (
          <div className="state state-loading" style={{ padding: '24px' }}>
            <span>Running the scenario…</span>
          </div>
        ) : (
          <div className="con-row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>
                No scenario run yet.
              </h3>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>
                Run any scenario below to see how Reflex decides.
              </p>
            </div>
            <button
              type="button"
              className="cbtn cbtn-primary"
              onClick={() => list[0] && run(list[0].id)}
            >
              <IconPlay size={14} />
              Run first scenario
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <span className="text-label">Scenarios ({list.length})</span>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Run one to see the decision it produces
          </span>
        </div>

        <div className="con-grid-5">
          {list.map((s) => {
            const value = results[s.id]
            const running = value === 'running'
            const result = value && value !== 'running' ? (value as ScenarioResult) : null
            const on = active === s.id
            return (
              <div key={s.id} className={`sc-tile ${on ? 'on' : ''}`}>
                <div>
                  <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
                    <span className="font-mono text-muted" style={{ fontSize: 11 }}>{s.id}</span>
                    {result && (
                      <span className={`chip chip-${outcomeTone(result.outcome)}`} style={{ fontSize: 10, padding: '2px 6px' }}>
                        {result.outcome}
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {s.label}
                  </div>
                  <p className="text-muted" style={{ fontSize: 12, lineHeight: 1.4, margin: '4px 0 0' }}>
                    {s.description}
                  </p>
                </div>

                <button
                  type="button"
                  className={`cbtn cbtn-sm ${on ? 'cbtn-primary' : 'cbtn-ghost'}`}
                  style={{ width: '100%', marginTop: 8 }}
                  disabled={running}
                  onClick={() => run(s.id)}
                >
                  {running ? (
                    'Running…'
                  ) : on && result ? (
                    <>
                      <IconRefresh size={12} />
                      Run again
                    </>
                  ) : (
                    <>
                      <IconPlay size={12} />
                      Run scenario
                    </>
                  )}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {activeResult && (
        <div className="con-grid-2">
          <Panel
            title="Evidence"
            actions={
              <span className="text-muted" style={{ fontSize: 12 }}>
                {evidenceEvents.length} checks
              </span>
            }
          >
            <dl style={{ margin: 0, display: 'flex', flexDirection: 'column' }}>
              {evidenceEvents.map((e) => (
                <div
                  key={e.seq}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '180px 1fr',
                    gap: 12,
                    padding: '10px 0',
                    borderBottom: '1px solid var(--hairline)',
                    fontSize: 13,
                  }}
                >
                  <dt className="font-mono" style={{ fontWeight: 600, fontSize: 12 }}>{e.type}</dt>
                  <dd className="text-muted font-mono" style={{ margin: 0, fontSize: 12, overflowWrap: 'anywhere' }}>
                    {Object.entries(e.data)
                      .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.map((item) => (typeof item === 'object' && item !== null ? (item as Record<string, unknown>).name ?? JSON.stringify(item) : String(item))).join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                      .join('  ·  ')}
                  </dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel
            title="Decision trace"
            actions={
              <span className="text-muted" style={{ fontSize: 12 }}>
                {activeResult.events.length} steps
              </span>
            }
          >
            <EventTimeline events={activeResult.events} />
          </Panel>
        </div>
      )}

      <div
        className="con-row text-muted"
        style={{
          borderTop: '1px solid var(--hairline)',
          paddingTop: 16,
          fontSize: 13,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <span className="con-row" style={{ gap: 6 }}>
          <IconCheck size={13} strokeWidth={2.5} style={{ color: 'var(--success-strong)' }} />
          <span>Nothing was invented</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>Registry unchanged (v{status.data?.schema_version ?? DASH})</span>
        <span aria-hidden="true">·</span>
        <span>Audit entry written</span>
      </div>
    </div>
  )
}
