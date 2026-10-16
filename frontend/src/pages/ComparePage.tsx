import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useRunEvents } from '../hooks/useRunEvents'
import { PageHead, Panel } from '../components/console'
import { EventTimeline } from '../components/EventTimeline'
import { ErrorState, LoadingState } from '../components/StateViews'
import { RaceTrack } from '../components/ui/RaceTrack'
import type { StepInfo } from '../components/ui/Stepper'
import { CopyButton } from '../components/ui/CopyButton'
import {
  IconPlay,
  IconRefresh,
} from '../components/ui/Icons'
import { DASH, num, secs } from '../utils/format'
import type { CaseInfo, RunRecord, RunSummary } from '../types'

const STEP_LABELS = [
  'Call',
  '422 error',
  'Diagnose',
  'Fetch schema',
  'Diff',
  'Validate',
  'Patch',
  'Retry',
  'Verified',
]

function computeBaselineSteps(
  record: RunRecord | null,
  running: boolean,
): StepInfo[] {
  if (!record && !running) {
    return STEP_LABELS.map((label) => ({
      label,
      status: 'pending',
    }))
  }

  if (running && !record) {
    return STEP_LABELS.map((label, idx) => ({
      label,
      status: idx === 0 ? 'completed' : idx === 1 ? 'current' : 'pending',
    }))
  }

  // Baseline finished
  return STEP_LABELS.map((label, idx) => {
    if (idx === 0) return { label, status: 'completed', tooltip: 'Initial request dispatched' }
    if (idx === 1) return { label, status: 'failed', tooltip: 'HTTP 422 Unprocessable Entity returned' }
    if (idx === 7) return { label, status: 'failed', tooltip: `Retried ${record?.attempts ?? 3} times without adaptation` }
    return { label, status: 'skipped', tooltip: 'No self-healing mechanism available in baseline' }
  })
}

function computeReflexSteps(
  record: RunRecord | null,
  running: boolean,
  events: Array<{ type: string }>,
): StepInfo[] {
  if (!record && !running) {
    return STEP_LABELS.map((label) => ({
      label,
      status: 'pending',
    }))
  }

  if (running && !record) {
    const hasType = (t: string) => events.some((e) => e.type === t)
    const s1 = hasType('call_attempt')
    const s2 = hasType('error_detected')
    const s3 = hasType('error_classified')
    const s4 = hasType('schema_fetched')
    const s5 = hasType('schema_diff')
    const s6 = hasType('validation_result') || hasType('candidate_patch')
    const s7 = hasType('patch_applied')
    const s8 = hasType('retry')
    const s9 = hasType('verified')

    const statuses: Array<'pending' | 'current' | 'completed'> = [
      s1 ? 'completed' : 'current',
      s2 ? 'completed' : s1 ? 'current' : 'pending',
      s3 ? 'completed' : s2 ? 'current' : 'pending',
      s4 ? 'completed' : s3 ? 'current' : 'pending',
      s5 ? 'completed' : s4 ? 'current' : 'pending',
      s6 ? 'completed' : s5 ? 'current' : 'pending',
      s7 ? 'completed' : s6 ? 'current' : 'pending',
      s8 ? 'completed' : s7 ? 'current' : 'pending',
      s9 ? 'completed' : s8 ? 'current' : 'pending',
    ]

    return STEP_LABELS.map((label, idx) => ({
      label,
      status: statuses[idx],
    }))
  }

  // Run finished
  const outcome = record?.outcome
  if (outcome === 'recovered') {
    return STEP_LABELS.map((label) => ({
      label,
      status: 'completed',
    }))
  }

  if (outcome === 'refused') {
    return STEP_LABELS.map((label, idx) => {
      if (idx < 5) return { label, status: 'completed' }
      if (idx === 5) return { label, status: 'failed', tooltip: `Refused: ${record?.reason_code ?? 'Ambiguous mapping'}` }
      return { label, status: 'skipped', tooltip: 'Safely halted before applying unverified patch' }
    })
  }

  if (outcome === 'not_drift_reported') {
    return STEP_LABELS.map((label, idx) => {
      if (idx < 2) return { label, status: 'completed' }
      if (idx === 2) return { label, status: 'failed', tooltip: 'Identified external server fault, not schema drift' }
      return { label, status: 'skipped' }
    })
  }

  // Default fallback
  return STEP_LABELS.map((label, idx) => ({
    label,
    status: idx < 2 ? 'completed' : idx === 2 ? 'failed' : 'skipped',
  }))
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

  // Group cases into 3 categories
  const recoverableCases = tuningCases.filter((c) => c.expected_outcome === 'recovered')
  const refusalCases = tuningCases.filter((c) => c.expected_outcome === 'refused')
  const notDriftCases = tuningCases.filter((c) => c.expected_outcome === 'not_drift_reported')

  const baseline = summary?.records.find((r) => r.agent === 'baseline') ?? null
  const healing = summary?.records.find((r) => r.agent === 'healing') ?? null
  const running = summary?.status === 'running' || (runId !== undefined && summary === null)

  const baselineSteps = computeBaselineSteps(baseline, running)
  const reflexSteps = computeReflexSteps(healing, running, events)

  const mttr = healing && healing.t_break !== null && healing.t_recovery !== null
    ? healing.t_recovery - healing.t_break
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

  const baselineStatus = baseline
    ? 'Failed, retries exhausted'
    : running ? 'Running' : 'Not run yet'
  const healingStatus = healing
    ? healing.outcome === 'recovered'
      ? 'Recovered'
      : healing.outcome === 'refused'
        ? 'Refused safely'
        : healing.outcome
    : running ? 'Running' : 'Not run yet'

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
                  <span>Run comparison</span>
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

      <RaceTrack
        steps={STEP_LABELS}
        header={
          runId ? (
            <div style={{ padding: '12px 20px 0', fontSize: 12 }} className="text-muted">
              <span>Run </span>
              <CopyButton text={runId} truncateLength={12} />
            </div>
          ) : undefined
        }
        tracks={[
          {
            key: 'Baseline',
            name: 'Baseline',
            sub: 'Retries the original request; no schema update.',
            tone: 'baseline',
            states: baselineSteps.map((s) => s.status),
          },
          {
            key: 'Reflex',
            name: 'Reflex',
            sub:
              healing?.outcome === 'refused'
                ? 'Stops before applying an unverified patch.'
                : 'Adapts from the live schema, then retries.',
            tone: 'reflex',
            states: reflexSteps.map((s) => s.status),
          },
        ]}
      />

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
            Both agents will replay the selected scenario step by step on the timeline above.
          </span>
        </div>
      ) : (
        <div className="con-grid-2">
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Baseline</div>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>Fixed schema, no adaptation</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <strong className="serif" style={{ fontSize: 22, fontWeight: 500 }}>{baselineStatus}</strong>
              <span className={`badge badge-${baseline ? 'failure' : 'neutral'}`}>{baseline ? 'Failed' : running ? 'Running' : 'Idle'}</span>
            </div>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <div><dt className="text-label" style={{ fontSize: 11 }}>Time</dt><dd className="font-mono" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{DASH}</dd></div>
              <div><dt className="text-label" style={{ fontSize: 11 }}>Tokens</dt><dd className="font-mono" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{baseline ? num(baseline.tokens_total) : DASH}</dd></div>
              <div><dt className="text-label" style={{ fontSize: 11 }}>Attempts</dt><dd className="font-mono" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{baseline ? num(baseline.attempts) : DASH}</dd></div>
            </dl>
            <p className="text-muted" style={{ margin: '12px 0 0', fontSize: 12 }}>{baseline ? `Stopped: ${baseline.reason_code ?? 'retries exhausted'}.` : 'Awaiting execution.'}</p>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Reflex</div>
            <div className="text-muted" style={{ fontSize: 12, marginBottom: 10 }}>{healing ? `${healing.healing_path} path` : 'Live schema adaptation'}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 12 }}>
              <strong className="serif" style={{ fontSize: 22, fontWeight: 500 }}>{healingStatus}</strong>
              <span className={`badge badge-${healing ? (healing.outcome === 'recovered' ? 'success' : healing.outcome === 'refused' ? 'warning' : 'neutral') : 'neutral'}`}>{healing ? (healing.outcome === 'recovered' ? 'Verified' : healing.outcome === 'refused' ? 'Refused' : healing.outcome) : running ? 'Running' : 'Idle'}</span>
            </div>
            <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
              <div><dt className="text-label" style={{ fontSize: 11 }}>Time</dt><dd className="font-mono" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{healing && mttr !== null ? secs(mttr) : DASH}</dd></div>
              <div><dt className="text-label" style={{ fontSize: 11 }}>Tokens</dt><dd className="font-mono" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{healing ? num(healing.tokens_total) : DASH}</dd></div>
              <div><dt className="text-label" style={{ fontSize: 11 }}>Attempts</dt><dd className="font-mono" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{healing ? num(healing.attempts) : DASH}</dd></div>
            </dl>
            <p className="text-muted" style={{ margin: '12px 0 0', fontSize: 12 }}>
              {healing?.outcome === 'recovered'
                ? 'Detected the schema change, validated a patch, and verified the retry.'
                : healing?.outcome === 'refused'
                  ? `Stopped safely: ${healing.reason_code ?? 'could not verify a fix'}.`
                  : 'Awaiting execution.'}
            </p>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 20 }}>
        <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
          <span className="text-label">Run summary</span>
          {runId && (
            <span className="con-row" style={{ gap: 6, fontSize: 12 }}>
              <span className="text-muted">Run ID:</span>
              <CopyButton text={runId} truncateLength={12} />
            </span>
          )}
        </div>

        <div className="con-grid-4">
          <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 'var(--radius)' }}>
            <div className="text-label" style={{ fontSize: 11 }}>Final outcome</div>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span className="text-muted">Baseline:</span>
                <span className="con-bad font-mono" style={{ fontWeight: 600 }}>{baseline?.outcome ?? DASH}</span>
              </div>
              <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span className="text-muted">Reflex:</span>
                <span className="con-accent font-mono" style={{ fontWeight: 600 }}>{healing?.outcome ?? DASH}</span>
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 'var(--radius)' }}>
            <div className="text-label" style={{ fontSize: 11 }}>Recovery time</div>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span className="text-muted">Baseline:</span>
                <span className="text-muted font-mono">Unrecovered</span>
              </div>
              <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span className="text-muted">Reflex:</span>
                <span className="con-accent font-mono" style={{ fontWeight: 600 }}>
                  {healing && mttr !== null ? secs(mttr) : DASH}
                </span>
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 'var(--radius)' }}>
            <div className="text-label" style={{ fontSize: 11 }}>Tokens used</div>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span className="text-muted">Baseline:</span>
                <span className="font-mono">{baseline ? num(baseline.tokens_total) : DASH}</span>
              </div>
              <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span className="text-muted">Reflex:</span>
                <span className="font-mono con-accent">{healing ? num(healing.tokens_total) : DASH}</span>
              </div>
            </div>
          </div>

          <div style={{ background: 'var(--surface-2)', padding: 14, borderRadius: 'var(--radius)' }}>
            <div className="text-label" style={{ fontSize: 11 }}>Upstream response</div>
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span className="text-muted">Baseline:</span>
                <span className="con-bad font-mono">{baseline ? (baseline.server_payload_ok ? 'OK' : 'Failed') : DASH}</span>
              </div>
              <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 12 }}>
                <span className="text-muted">Reflex:</span>
                <span className="con-accent font-mono" style={{ fontWeight: 600 }}>
                  {healing ? (healing.server_payload_ok ? 'Verified (200)' : 'Stopped') : DASH}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

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
