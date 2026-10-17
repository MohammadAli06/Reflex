import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useRunEvents } from '../hooks/useRunEvents'
import { PageHead, Panel } from '../components/console'
import { EventTimeline } from '../components/EventTimeline'
import { ErrorState, LoadingState } from '../components/StateViews'
import { HorizontalStepper, type StepInfo } from '../components/ui/Stepper'
import { ExchangeCard, ExchangeRecord, ValidatorChecks } from '../components/ExchangeCard'
import { JsonViewer } from '../components/JsonViewer'
import { SchemaDiffView, type SchemaDiffData } from '../components/SchemaDiffView'
import { CopyButton } from '../components/ui/CopyButton'
import { IconPlay, IconRefresh } from '../components/ui/Icons'
import { DASH, num, secs } from '../utils/format'
import type { CaseInfo, RunRecord, RunSummary, TraceEvent } from '../types'

/** The five demo steps; every status is derived from stored records/events. */
const DEMO_STEPS = ['Break the API', 'Baseline', 'Reflex', 'Validate / Patch', 'Retry / Verify']

type TraceList = TraceEvent[]

function eventsOf(events: TraceList, type: string, agent?: string): TraceEvent[] {
  return events.filter((e) => e.type === type && (agent ? e.agent === agent : true))
}

function latestOf(events: TraceList, type: string, agent?: string): TraceEvent | undefined {
  const list = eventsOf(events, type, agent)
  return list[list.length - 1]
}

function latestExchange(events: TraceList, step: string, agent?: string): ExchangeRecord | undefined {
  const list = events
    .filter((e) => e.type === 'http_exchange' && (agent ? e.agent === agent : true))
    .filter((e) => (e.data.step as string) === step)
  const ev = list[list.length - 1]
  return ev ? (ev.data as unknown as ExchangeRecord) : undefined
}

/**
 * Step statuses come strictly from stored data: a step with no record stays
 * "pending" even when later steps exist. There is no timer.
 */
function deriveSteps(
  baseline: RunRecord | null,
  healing: RunRecord | null,
  running: boolean,
  events: TraceList,
): StepInfo[] {
  const has = (type: string, agent?: string) => eventsOf(events, type, agent).length > 0
  const broken = has('error_detected')
  const baselineDone = baseline !== null
  const healingDone = healing !== null
  const patched = has('patch_applied')
  const refused = healingDone && healing.outcome === 'refused'
  const verified = has('verified', 'healing')

  const step = (
    done: boolean,
    started: boolean,
    failed = false,
  ): StepInfo['status'] => (done ? 'completed' : failed ? 'failed' : started ? 'current' : 'pending')

  const refusalReason = refused ? (healing.reason_code ?? DASH) : undefined

  return [
    {
      label: DEMO_STEPS[0],
      status: step(broken, broken || running),
      tooltip: broken ? 'A real 4xx response was recorded from the mock API.' : undefined,
    },
    {
      label: DEMO_STEPS[1],
      status: step(baselineDone, broken || running),
      tooltip: baselineDone ? `Baseline finished: ${baseline.outcome}` : undefined,
    },
    {
      label: DEMO_STEPS[2],
      status: step(healingDone, baselineDone || (broken && running), refused),
      tooltip: refusalReason ? `Reflex stopped: ${refusalReason}` : undefined,
    },
    {
      label: DEMO_STEPS[3],
      status: semanticsPatchStep(patched, refused, healingDone, broken, running),
      tooltip: refusalReason ? `Refused: ${refusalReason}` : undefined,
    },
    {
      label: DEMO_STEPS[4],
      status: verified
        ? 'completed'
        : refused
        ? 'failed'
        : healingDone && healing.outcome !== 'recovered'
        ? 'failed'
        : patched && running ? 'current' : 'pending',
      tooltip: verified ? 'Retry verified against the server.' : undefined,
    },
  ]
}

function semanticsPatchStep(
  patched: boolean,
  refused: boolean,
  healingDone: boolean,
  broken: boolean,
  running: boolean,
): StepInfo['status'] {
  if (patched) return 'completed'
  if (refused) return 'failed'
  if (healingDone) return 'failed'
  if (running && broken) return 'current'
  return 'pending'
}

function badgeBaselineTone(outcome: string): string {
  return outcome === 'failed' ? 'failure' : outcome === 'refused' ? 'warning' : 'neutral'
}

export function ComparePage() {
  const cases = useApi(() => api.cases(), [])
  const [caseId, setCaseId] = useState('ps_demo')
  const [filter, setFilter] = useState('')
  const [runId, setRunId] = useState<string | undefined>(undefined)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | null>(null)
  const { events, status } = useRunEvents(runId)

  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current) }, [])

  async function start() {
    setBusy(true)
    setMessage(null)
    setSummary(null)
    setRunId(undefined)
    try {
      // The run executes BOTH agent lanes against the same drift; that is the
      // only comparison the backend records, so the button says exactly that.
      const started = await api.startRun([caseId], 1)
      setRunId(started.run_id)
      if (timer.current) window.clearInterval(timer.current)
      timer.current = window.setInterval(async () => {
        try {
          const current = await api.getRun(started.run_id)
          setSummary(current)
          if (current.status !== 'running' && timer.current) {
            window.clearInterval(timer.current)
            timer.current = null
          }
        } catch {
          if (timer.current) window.clearInterval(timer.current)
        }
      }, 400)
    } catch (err) {
      setMessage(err instanceof ApiError && err.status === 409 ? 'A run is already in progress.' : `Failed: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  if (cases.loading) return <LoadingState label="Loading benchmark cases…" />
  if (cases.error) return <ErrorState message={cases.error} onRetry={cases.reload} />

  const allCases: CaseInfo[] = cases.data?.cases ?? []
  const tuningCases = allCases.filter((c) => c.split === 'tuning')

  const recoverableCases = tuningCases.filter((c) => c.expected_outcome === 'recovered')
  const refusalCases = tuningCases.filter((c) => c.expected_outcome === 'refused')
  const notDriftCases = tuningCases.filter((c) => c.expected_outcome === 'not_drift_reported')

  const baseline = summary?.records.find((r) => r.agent === 'baseline') ?? null
  const healing = summary?.records.find((r) => r.agent === 'healing') ?? null
  const running = summary?.status === 'running' || (runId !== undefined && summary === null)

  const steps = deriveSteps(baseline, healing, running, events)

  // Per-lane stored elements — everything below comes from run events/records.
  const baselineStarted = events.find((e) => e.agent === 'baseline' && e.type === 'run_started')
  const baselineTool = (baselineStarted?.data?.tool_definition ?? null) as Record<string, unknown> | null
  const baselineExchange = latestExchange(events, 'baseline_call', 'baseline')

  const specFetch = latestExchange(events, 'spec_fetch', 'healing')
  const classified = latestOf(events, 'error_classified', 'healing')
  const diffEv = latestOf(events, 'schema_diff')
  const candidate = latestOf(events, 'candidate_patch', 'healing')
  const validation = latestOf(events, 'validation_result', 'healing')
  const applied = latestOf(events, 'patch_applied', 'healing')
  const healingRefusal = latestOf(events, 'refused', 'healing')
  const retryExchange = latestExchange(events, 'retry_call', 'healing')

  const healingMttr = healing && healing.t_break !== null && healing.t_recovery !== null
    ? healing.t_recovery - healing.t_break
    : null
  const baselineMttr = baseline && baseline.t_break !== null && baseline.t_recovery !== null
    ? baseline.t_recovery - baseline.t_break
    : null

  const selectedCase = tuningCases.find((c) => c.id === caseId)
  const q = filter.trim().toLowerCase()
  const matches = (c: CaseInfo) => !q || c.id.toLowerCase().includes(q) || (c.task_id ?? '').toLowerCase().includes(q)
  const anyVisible = tuningCases.some(matches)
  const idle = !baseline && !healing && !running

  const PRESETS = [
    { id: 'ps_demo', label: 'Combined demo' },
    { id: 'rename', label: 'Field rename' },
    { id: 'missing_credential', label: 'Missing credential' },
    { id: 'not_drift_5xx', label: 'External 500' },
  ]

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Side-by-side replay under identical drift</span>}
        title="Agent comparison"
        subtitle="The same breaking change is replayed against both agents. Baseline retries the original request; Reflex adapts from the live schema."
        right={
          <div className="con-row" style={{ gap: 12 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>
              Stream: {status}
              {runId && <span className="font-mono"> · {runId.slice(0, 12)}…</span>}
            </span>
            <button
              type="button"
              className="cbtn cbtn-primary"
              style={{ padding: '10px 24px', fontSize: 14 }}
              onClick={start}
              disabled={busy || running}
            >
              {running ? (
                <>
                  <span style={{ display: 'inline-flex', animation: 'spin 1s linear infinite' }}>
                    <IconRefresh size={16} />
                  </span>
                  <span>Running…</span>
                </>
              ) : (
                <>
                  <IconPlay size={16} />
                  <span>Run both agents</span>
                </>
              )}
            </button>
          </div>
        }
      />

      {message && <div className="notice notice-error">{message}</div>}

      <div className="card" style={{ padding: 20 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 280, flex: '1 1 320px' }}>
            <label className="text-label" htmlFor="scenario-select">Scenario</label>
            <div className="con-row" style={{ gap: 8 }}>
              <input
                type="search"
                aria-label="Filter scenarios"
                placeholder="Filter scenarios…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--hairline-2)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontSize: 13,
                  width: 150,
                }}
              />
              <select
                id="scenario-select"
                value={caseId}
                onChange={(e) => setCaseId(e.target.value)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--hairline-2)',
                  background: 'var(--surface)',
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 13,
                  cursor: 'pointer',
                  flex: 1,
                  minWidth: 0,
                }}
              >
                <optgroup label="Recoverable drift">
                  {recoverableCases.filter(matches).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id}{c.id === 'ps_demo' ? ' — recommended' : ''}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Should refuse">
                  {refusalCases.filter(matches).map((c) => (
                    <option key={c.id} value={c.id}>{c.id}</option>
                  ))}
                </optgroup>
                <optgroup label="Not drift">
                  {notDriftCases.filter(matches).map((c) => (
                    <option key={c.id} value={c.id}>{c.id}</option>
                  ))}
                </optgroup>
              </select>
              {caseId === 'ps_demo' && (
                <span className="text-muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Recommended</span>
              )}
            </div>
            {!anyVisible && (
              <span className="text-muted" style={{ fontSize: 12 }}>No scenarios match “{filter}”. Clear the filter to see all.</span>
            )}
          </div>

          <div className="csegment" role="group" aria-label="Scenario shortcuts">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={caseId === p.id ? 'on' : ''}
                onClick={() => setCaseId(p.id)}
                aria-pressed={caseId === p.id}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {selectedCase && (
          <div
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTop: '1px solid var(--hairline)',
              fontSize: 13,
              color: 'var(--muted)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <span>
              Task <code>{selectedCase.task_id}</code>
              {selectedCase.mutation_id && (
                <> · Mutation <code>{selectedCase.mutation_id}</code></>
              )}
              {' '}· Error style <code>{selectedCase.error_style}</code>
            </span>
            <span>
              Expected outcome: <b style={{ color: 'var(--ink)' }}>{selectedCase.expected_outcome}</b>
            </span>
          </div>
        )}
      </div>

      {/* Step 01..05 — stepper statuses come from records only. */}
      <HorizontalStepper steps={steps} />
      {runId && (
        <div className="con-row text-muted" style={{ padding: '12px 20px 0', fontSize: 12 }}>
          <span>Run </span>
          <CopyButton text={runId} truncateLength={12} />
        </div>
      )}

      {idle ? (
        <div className="state state-empty" style={{ padding: '48px 24px' }}>
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true" style={{ marginBottom: 8 }}>
            <circle cx="14" cy="24" r="7" stroke="var(--hairline-2)" strokeWidth="2" />
            <circle cx="34" cy="24" r="7" stroke="var(--hairline-2)" strokeWidth="2" />
            <line x1="21" y1="24" x2="27" y2="24" stroke="var(--hairline-2)" strokeWidth="2" strokeDasharray="3 3" />
            <circle cx="14" cy="24" r="2.5" fill="var(--muted)" />
          </svg>
          <strong>Press Run to start</strong>
          <span className="text-muted" style={{ fontSize: 13, maxWidth: 440 }}>
            Both agents replay the selected scenario; steps fill in only as their records are written.
          </span>
        </div>
      ) : (
        <div className="con-grid-2" style={{ alignItems: 'start' }}>
          {/* ----- Baseline lane ----- */}
          <div className="card" style={{ padding: 20 }}>
            <div className="con-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Baseline</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Plain tool-calling loop (framework: {baseline?.framework ?? 'plain-loop'}) — fixed schema, no adaptation
                </div>
              </div>
              {baseline ? (
                <span className={`badge badge-${badgeBaselineTone(baseline.outcome)}`}>
                  {baseline.outcome}
                </span>
              ) : (
                <span className="badge badge-neutral">{running ? 'Running' : 'Not started'}</span>
              )}
            </div>

            {baselineExchange ? (
              <div style={{ marginTop: 12 }}>
                <ExchangeCard exchange={baselineExchange} title="Failing call" />
              </div>
            ) : (
              <p className="con-sub" style={{ fontSize: 12, marginTop: 12 }}>
                Baseline call exchange: no detail recorded (—).
              </p>
            )}

            {baselineTool ? (
              <div style={{ marginTop: 12 }}>
                <div className="text-label" style={{ marginBottom: 6 }}>
                  Tool schema used (stale, recorded at run start) — revision{' '}
                  {baselineTool.revision != null ? String(baselineTool.revision) : DASH}
                </div>
                <JsonViewer value={baselineTool} label="Stale tool definition (recorded at run start)" />
              </div>
            ) : null}

            <div className="con-row" style={{ justifyContent: 'space-between', marginTop: 14, fontSize: 12, flexWrap: 'wrap', gap: 8 }}>
              <span className="text-muted">
                Calls: <b>{baseline ? num(baseline.attempts) : DASH}</b> · Tokens:{' '}
                <b>{baseline ? num(baseline.tokens_total) : DASH}</b>
              </span>
              <span className="text-muted">
                First failure → {baselineMttr !== null ? secs(baselineMttr) : DASH}
              </span>
            </div>
          </div>

          {/* ----- Reflex lane ----- */}
          <div className="card" style={{ padding: 20 }}>
            <div className="con-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Reflex</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {healing?.framework ?? 'rule-based-healer'} — live schema adaptation
                </div>
              </div>
              {healing ? (
                <span className={`badge badge-${healing.outcome === 'recovered' ? 'success' : healing.outcome === 'refused' ? 'warning' : 'neutral'}`}>
                  {healing.outcome}
                </span>
              ) : (
                <span className="badge badge-neutral">{running ? 'Running' : 'Not started'}</span>
              )}
            </div>

            {/* First-class refusal — reason code comes from the run record */}
            {healing?.outcome === 'refused' ? (
              <div className="notice notice-warning" style={{ marginTop: 12 }}>
                <b>Refused</b> — reason code{' '}
                <code>{healing.reason_code ?? String(healingRefusal?.data?.reason_code ?? DASH)}</code>
                {healingRefusal?.data?.detail ? (<> · <span>{String(healingRefusal.data.detail)}</span></>) : null}
                . No patch applied, no retry sent.
              </div>
            ) : null}

            {specFetch ? (
              <div style={{ marginTop: 12 }}>
                <ExchangeCard exchange={specFetch} title="Spec fetched" />
              </div>
            ) : (
              <p className="con-sub" style={{ fontSize: 12, marginTop: 12 }}>Spec fetch: no exchange recorded (—).</p>
            )}

            {classified ? (
              <div className="con-row" style={{ gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <span className="text-label">Drift classification:</span>
                <span className="badge badge-neutral font-mono">{String(classified.data?.category ?? DASH)}</span>
                <span className="text-muted" style={{ fontSize: 12 }}>{String(classified.data?.explanation ?? '')}</span>
              </div>
            ) : null}

            {diffEv ? (
              <div style={{ marginTop: 12 }}>
                <SchemaDiffView diff={diffEv.data as SchemaDiffData} />
              </div>
            ) : (
              healing && (
                <p className="con-sub" style={{ fontSize: 12, marginTop: 12 }}>Schema diff: not recorded (—).</p>
              )
            )}

            {candidate && !candidate.data?.refused ? (
              <div style={{ marginTop: 12 }}>
                <div className="text-label" style={{ marginBottom: 6 }}>
                  Candidate patch — confidence{' '}
                  {typeof candidate.data?.confidence === 'number'
                    ? (candidate.data.confidence as number).toFixed(2)
                    : DASH}
                </div>
                <ul className="con-sub" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {Array.isArray(candidate.data?.evidence)
                    ? (candidate.data.evidence as unknown[]).map((item, idx) => (
                        <li key={idx} style={{ marginTop: 2 }}>{String(item)}</li>
                      ))
                    : null}
                </ul>
              </div>
            ) : null}

            {validation ? (
              <div style={{ marginTop: 12 }}>
                <ValidatorChecks
                  ok={Boolean(validation.data?.ok)}
                  errors={Array.isArray(validation.data?.errors) ? (validation.data.errors as unknown[]) : []}
                  reasonCode={(validation.data?.reason_code as string) ?? null}
                />
              </div>
            ) : null}

            {applied ? (
              <div className="con-row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <span className="text-label">Registry</span>
                <span className="font-mono text-muted" style={{ fontSize: 12 }}>
                  revision{' '}
                  {applied.data?.revision_before != null
                    ? `${String(applied.data.revision_before)} → `
                    : DASH + ' → '}
                  <b>{String(applied.data?.revision ?? DASH)}</b>
                </span>
              </div>
            ) : (
              healing && (
                <p className="con-sub" style={{ fontSize: 12, marginTop: 12 }}>No patch applied (—).</p>
              )
            )}

            {retryExchange ? (
              <div style={{ marginTop: 12 }}>
                <ExchangeCard exchange={retryExchange} title="Verified retry" />
              </div>
            ) : healing && applied ? (
              <p className="con-sub" style={{ fontSize: 12, marginTop: 12 }}>Retry exchange: no detail recorded (—).</p>
            ) : null}

            <div className="con-row" style={{ justifyContent: 'space-between', marginTop: 14, fontSize: 12, flexWrap: 'wrap', gap: 8 }}>
              <span className="text-muted">
                Calls: <b>{healing ? num(healing.attempts) : DASH}</b> · Tokens:{' '}
                <b>{healing ? num(healing.tokens_total) : DASH}</b>
              </span>
              <span className="text-muted">
                Failing call → verified retry: <b>{healingMttr !== null ? secs(healingMttr) : DASH}</b>
              </span>
            </div>
          </div>
        </div>
      )}

      <Panel
        title="Replay event trace"
        actions={
          <span className="text-muted" style={{ fontSize: 12 }}>
            {events.length} events recorded
          </span>
        }
      >
        <EventTimeline events={events} />
      </Panel>
    </div>
  )
}
