import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Chip, PageHead, Panel } from '../components/console'
import { EventTimeline } from '../components/EventTimeline'
import { ErrorState, LoadingState } from '../components/StateViews'
import { DASH, num, secs } from '../utils/format'
import type { ScenarioResult } from '../types'

function ForkVisual() {
  return (
    <svg viewBox="0 0 400 120" preserveAspectRatio="none" style={{ width: '100%', height: 130 }} fill="none">
      <line x1={0} x2={160} y1={60} y2={60} stroke="#5fd3a5" strokeDasharray="3 3" strokeWidth={1.5} />
      <circle cx={2} cy={60} r={3} fill="#5fd3a5" />
      <path d="M160 60 C190 60, 210 24, 250 24" stroke="#87948c" strokeDasharray="2 2" />
      <path d="M160 60 C190 60, 210 96, 250 96" stroke="#87948c" strokeDasharray="2 2" />
      <line x1={250} x2={250} y1={12} y2={36} stroke="#e3b04b" strokeWidth={4} />
      <line x1={250} x2={250} y1={84} y2={108} stroke="#e3b04b" strokeWidth={4} />
      <rect x={156} y={52} width={6} height={16} fill="#e3b04b" />
    </svg>
  )
}

function toneFor(outcome: string): 'ok' | 'warn' | 'bad' | 'mute' {
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

  if (scenarios.loading) return <LoadingState label="Loading scenarios…" />
  if (scenarios.error) return <ErrorState message={scenarios.error} onRetry={scenarios.reload} />

  const list = scenarios.data?.scenarios ?? []
  const activeResult = active && results[active] && results[active] !== 'running' ? (results[active] as ScenarioResult) : null
  const refused = activeResult?.outcome === 'refused'

  return (
    <div className="con-page">
      <PageHead
        eyebrow={
          <>
            <span className="con-dot" style={{ borderRadius: 0, background: 'var(--c-tertiary)' }} />
            <span className="con-warn">Safety &amp; deterministic constraints // zero-hallucination enforcement</span>
          </>
        }
        title="Safety"
        right={
          <span className="con-row" style={{ gap: '0.5rem', border: '1px solid var(--c-outline-variant)', padding: '0.5rem 0.75rem' }}>
            <span className="con-dot" style={{ borderRadius: 0, background: 'var(--c-tertiary)' }} />
            <span className="con-mono con-warn" style={{ fontSize: 11 }}>POLICY: STRICT DETERMINISTIC HOLD</span>
            <span className="msym msym-18 con-muted">verified_user</span>
          </span>
        }
      />

      <p className="con-mono" style={{ margin: 0, color: 'var(--c-on-variant)', fontSize: 16, letterSpacing: 0 }}>
        Reflex stops when it can&rsquo;t justify a change. Refusal is a result, not a failure.
      </p>

      {error && <div className="notice notice-error">{error}</div>}

      <section>
        <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span className="con-label">Deterministic invariant scenarios ({list.length})</span>
          <span className="con-label con-warn">{activeResult ? '1 active execution state' : 'idle'}</span>
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
                  <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                    <span className="seam-fault">
                      <span className="seam-cap" style={{ background: 'var(--c-tertiary)' }} />
                      <span className="seam-gap" style={{ background: 'var(--c-tertiary)' }} />
                    </span>
                    <span className="con-label">{result ? result.outcome : 'id 0x' + s.id.slice(0, 2)}</span>
                  </div>
                  <div className="con-mono" style={{ fontSize: 12, fontWeight: 600 }}>{s.label}</div>
                  <p className="con-muted" style={{ fontSize: 12, marginTop: 4, lineHeight: 1.4 }}>{s.description}</p>
                </div>
                <button
                  className="cbtn cbtn-sm"
                  style={{ width: '100%', borderColor: on ? 'var(--c-tertiary)' : undefined, color: on ? 'var(--c-tertiary)' : undefined }}
                  disabled={running}
                  onClick={() => run(s.id)}
                >
                  <span className="msym msym-13">{on && result ? 'refresh' : 'play_arrow'}</span>
                  {running ? 'running…' : on && result ? 're-evaluate' : 'run'}
                </button>
              </div>
            )
          })}
        </div>
      </section>

      <Panel
        title="Refusal showcase // decision receipt"
        actions={<span className="con-label">verdict: {activeResult ? `${activeResult.outcome} · ${activeResult.reason_code ?? 'none'}` : 'no execution'}</span>}
      >
        {activeResult ? (
          <>
            <div className="con-row" style={{ justifyContent: 'space-between', borderBottom: '1px solid var(--c-outline-variant)', paddingBottom: '1rem' }}>
              <div className="con-row">
                <Chip tone={toneFor(activeResult.outcome)}>[ | ] {activeResult.outcome}</Chip>
                <span className="con-mono con-muted" style={{ fontSize: 11 }}>reason_code: <span className="con-warn">{activeResult.reason_code ?? DASH}</span></span>
                <span className="con-mono con-muted" style={{ fontSize: 11 }}>
                  halt: {secs(activeResult.mttr)} · schema_attempts: {num(activeResult.schema_attempts)}
                </span>
              </div>
              <span className="con-label">{activeResult.label}</span>
            </div>

            <h3 style={{ fontFamily: 'var(--c-serif)', fontSize: 24, fontWeight: 400, margin: '1rem 0 0.75rem' }}>
              {refused ? 'Halted. The mapping could not be justified.' : activeResult.outcome === 'recovered' ? 'Recovered. The patch was validated.' : 'Classified. No patch applied.'}
            </h3>
            <p className="con-muted" style={{ fontSize: 14, margin: 0 }}>{activeResult.explanation}</p>

            <div style={{ marginTop: '1.25rem', background: 'var(--c-bg)', border: '1px solid var(--c-outline-variant)', padding: '1rem' }}>
              <div className="con-label" style={{ marginBottom: 6 }}>Arbitration topology dispatch</div>
              <ForkVisual />
              <div className="con-row" style={{ justifyContent: 'center', marginTop: 6 }}>
                <span className="con-mono con-warn" style={{ fontSize: 10, letterSpacing: '0.08em' }}>
                  MUTATION {refused ? 'HALTED: NO SAFE MAPPING FOUND' : 'RESOLVED BY EVIDENCE'}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="state state-empty">
            <strong>No scenario executed yet.</strong>
            <span>Press “run” on a scenario tile to produce a decision receipt.</span>
          </div>
        )}
      </Panel>

      {activeResult && (
        <div className="con-grid-2">
          <Panel title="Forensic decision trace" actions={<span className="con-label">{activeResult.events.length} ops</span>}>
            <EventTimeline events={activeResult.events} />
          </Panel>

          <Panel title="Evidence evaluated" actions={<span className="con-label">from the recorded run</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeResult.events
                .filter((e) => ['schema_fetched', 'schema_diff', 'candidate_patch', 'validation_result', 'refused', 'not_drift'].includes(e.type))
                .map((e) => {
                  const good = ['schema_fetched', 'schema_diff'].includes(e.type)
                  const bad = ['refused', 'not_drift'].includes(e.type)
                  return (
                    <div key={e.seq} style={{ background: 'var(--c-bg)', border: `1px solid ${bad ? 'rgba(255,212,134,0.4)' : 'var(--c-outline-variant)'}`, padding: '0.625rem' }}>
                      <div className="con-row" style={{ gap: '0.5rem' }}>
                        <span className={`msym msym-18 ${good ? 'con-accent' : bad ? 'con-warn' : 'con-muted'}`}>
                          {good ? 'check_circle' : bad ? 'cancel' : 'info'}
                        </span>
                        <span className="con-mono" style={{ fontSize: 11, fontWeight: 600 }}>{e.type}</span>
                      </div>
                      <div className="con-mono con-muted" style={{ fontSize: 10, marginTop: 4 }}>
                        {Object.entries(e.data).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join('  ·  ')}
                      </div>
                    </div>
                  )
                })}
            </div>
          </Panel>
        </div>
      )}

      <div className="con-row" style={{ borderTop: '1px solid var(--c-outline-variant)', paddingTop: '1rem', justifyContent: 'space-between' }}>
        <div className="con-row">
          <Chip tone="ok">✓ Nothing was invented</Chip>
          <Chip tone="mute">Registry unchanged (v{status.data?.schema_version ?? DASH})</Chip>
          <Chip tone="warn">
            <span className="msym msym-13">receipt_long</span> Audit entry written
          </Chip>
        </div>
        <span className="con-label">Reflex deterministic engine · safety gateway active</span>
      </div>
    </div>
  )
}
