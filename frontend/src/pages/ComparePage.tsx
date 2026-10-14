import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useRunEvents } from '../hooks/useRunEvents'
import { Chip, PageHead, Panel } from '../components/console'
import { EventTimeline } from '../components/EventTimeline'
import { ErrorState, LoadingState } from '../components/StateViews'
import { DASH, num, secs } from '../utils/format'
import type { RunRecord, RunSummary } from '../types'

const STATIONS = ['01. Call', '02. 422 error', '03. Diagnose', '04. Schema', '05. Diff', '06. Validate', '07. Patch', '08. Retry', '09. Verified']

function LaneBaseline() {
  return (
    <svg viewBox="0 0 900 80" preserveAspectRatio="none" style={{ width: '100%', height: 96 }} fill="none">
      <line x1={20} x2={150} y1={40} y2={40} stroke="#87948c" strokeWidth={1.5} />
      <circle cx={50} cy={40} r={3} fill="#e2e2e5" />
      <circle cx={150} cy={40} r={4} fill="#ffb4a6" />
      <path d="M150 40 L158 32 L165 48 L172 35 L180 40" stroke="#ffb4a6" strokeWidth={1.5} />
      <line x1={180} x2={600} y1={40} y2={40} stroke="#333537" strokeDasharray="4 4" />
      <path d="M280 40 C280 15 330 15 330 40" stroke="#ffb4a6" strokeDasharray="2 2" />
      <circle cx={330} cy={40} r={2.5} fill="#ffb4a6" />
      <path d="M460 40 C460 10 520 10 520 40" stroke="#ffb4a6" strokeDasharray="2 2" />
      <circle cx={520} cy={40} r={2.5} fill="#ffb4a6" />
      <line x1={680} x2={680} y1={20} y2={60} stroke="#ffb4a6" strokeWidth={3} />
    </svg>
  )
}

function LaneHealing() {
  const stitches = [170, 176, 182, 188, 194, 200, 270, 278, 286, 370, 378, 386, 470, 478, 486, 570, 578, 586]
  return (
    <svg viewBox="0 0 900 80" preserveAspectRatio="none" style={{ width: '100%', height: 96 }} fill="none">
      <line x1={20} x2={150} y1={40} y2={40} stroke="#87948c" strokeWidth={1.5} />
      <circle cx={50} cy={40} r={3} fill="#e2e2e5" />
      <circle cx={150} cy={40} r={4} fill="#ffb4a6" />
      <line x1={150} x2={650} y1={40} y2={40} stroke="#7df0c0" strokeOpacity={0.3} strokeDasharray="6 2" strokeWidth={1.5} />
      {stitches.map((x) => (
        <line key={x} x1={x} x2={x} y1={33} y2={47} stroke="#5fd3a5" strokeWidth={1.5} />
      ))}
      {[250, 350, 450, 550, 650].map((x) => (
        <circle key={x} cx={x} cy={40} r={3.5} fill="#5fd3a5" />
      ))}
      <line x1={650} x2={850} y1={40} y2={40} stroke="#5fd3a5" strokeWidth={2} />
      <circle cx={750} cy={40} r={4} fill="#5fd3a5" />
      <circle cx={850} cy={40} r={7} stroke="#7df0c0" strokeWidth={2} />
      <circle cx={850} cy={40} r={3} fill="#7df0c0" />
    </svg>
  )
}

function TelemetryMatrix({ record, kind }: { record: RunRecord | null; kind: 'baseline' | 'healing' }) {
  const healing = kind === 'healing'
  const mttr = record && record.t_break !== null && record.t_recovery !== null ? record.t_recovery - record.t_break : null
  const rows: [string, string, boolean][] = [
    ['Total attempts', record ? `${num(record.attempts)}` : DASH, false],
    ['Schema attempts', record ? `${num(record.schema_attempts)}${healing ? ' adapted' : ' failed'}` : DASH, healing],
    ['Recovery time', healing ? secs(mttr) : record?.outcome === 'recovered' ? secs(mttr) : 'n/a (unhandled)', healing],
    ['Tokens consumed', record ? `${num(record.tokens_total)}` : DASH, false],
    ['Healing path', record?.healing_path ?? DASH, healing],
    ['Payload reached server', record ? (record.server_payload_ok ? 'YES' : 'NO') : DASH, Boolean(record?.server_payload_ok)],
  ]
  return (
    <div className="panel">
      <div className="panel-head">
        <span className="con-row" style={{ gap: '0.5rem' }}>
          <span className={`con-label ${healing ? 'con-accent' : 'con-bad'}`}>Telemetry matrix</span>
          <span className="con-label">/ {healing ? 'reflex suture engine' : 'baseline runtime'}</span>
        </span>
        <Chip tone={healing ? 'ok' : 'bad'}>status: {record?.outcome ?? 'no run'}</Chip>
      </div>
      <div className="panel-body" style={{ padding: '0.75rem' }}>
        <div className="con-grid-2" style={{ gap: '0.5rem 1rem' }}>
          {rows.map(([label, value, good]) => (
            <div key={label}>
              <div className="con-label">{label}</div>
              <div className={`con-mono ${good ? 'con-accent' : ''}`} style={{ fontSize: 12 }}>{value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ComparePage() {
  const cases = useApi(() => api.cases(), [])
  const [caseId, setCaseId] = useState('ps_demo')
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

  if (cases.loading) return <LoadingState label="Loading cases…" />
  if (cases.error) return <ErrorState message={cases.error} onRetry={cases.reload} />

  const baseline = summary?.records.find((r) => r.agent === 'baseline') ?? null
  const healing = summary?.records.find((r) => r.agent === 'healing') ?? null
  const running = summary?.status === 'running' || (runId !== undefined && summary === null)
  const tuning = cases.data?.cases.filter((c) => c.split === 'tuning') ?? []

  return (
    <div className="con-page">
      <PageHead
        eyebrow={
          <>
            <span className="con-accent">System telemetry // replay lab</span>
            <span className="con-muted">·</span>
            <span>run_id: {runId ?? DASH}</span>
          </>
        }
        title="Comparison"
        subtitle="Dual seam execution benchmark // deterministic replay"
        right={
          <>
            <Chip tone={running ? 'warn' : 'ok'}>replay buffer: {running ? 'streaming' : 'idle'}</Chip>
            <span className="con-label">sse: {status}</span>
          </>
        }
      />

      <div className="panel">
        <div className="panel-body" style={{ padding: '0.75rem 1rem', display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center', justifyContent: 'space-between' }}>
          <div className="con-row" style={{ gap: 4 }}>
            <span className="con-label" style={{ marginRight: 4 }}>Case:</span>
            {tuning.map((c) => (
              <button
                key={c.id}
                className="cbtn cbtn-sm"
                style={{
                  borderColor: c.id === caseId ? 'var(--c-primary)' : 'var(--c-outline-variant)',
                  color: c.id === caseId ? 'var(--c-primary)' : 'var(--c-on-variant)',
                  background: c.id === caseId ? 'var(--c-container)' : 'transparent',
                }}
                onClick={() => setCaseId(c.id)}
              >
                {c.id}
              </button>
            ))}
          </div>
          <div className="con-row">
            <span className="con-row" style={{ gap: '0.375rem' }}>
              <span className={`con-dot ${status === 'streaming' || status === 'finished' ? 'con-dot-ok' : 'con-dot-warn'}`} />
              <span className="con-label">sse {status}</span>
            </span>
            <button className="cbtn cbtn-primary" onClick={start} disabled={busy || running}>
              <span className="msym msym-13">play_arrow</span>
              {running ? 'Running…' : 'Run comparison'}
            </button>
          </div>
        </div>
        {message && <div className="notice" style={{ margin: '0 1rem 0.75rem' }}>{message}</div>}
      </div>

      <Panel
        title="Seam trace execution // dual continuum comparison"
        actions={<Chip tone={healing?.outcome === 'recovered' ? 'ok' : 'mute'}>registry healing</Chip>}
      >
        <div className="con-grid-3" style={{ gap: 2, marginBottom: '0.75rem' }}>
          {STATIONS.map((s) => (
            <span key={s} className={`con-label ${s.includes('422') ? 'con-bad' : s.includes('Verified') ? 'con-accent' : ''}`} style={{ textAlign: 'center' }}>
              {s}
            </span>
          ))}
        </div>

        <div style={{ background: 'var(--c-bg)', padding: '0.75rem', marginBottom: '0.75rem' }}>
          <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span className="con-row" style={{ gap: '0.5rem' }}>
              <Chip tone="bad">lane a</Chip>
              <span className="con-label">Baseline agent (fixed schema)</span>
            </span>
            <span className="con-label con-bad">{baseline ? `outcome: ${baseline.outcome}` : 'no run'}</span>
          </div>
          <LaneBaseline />
          <div className="con-row" style={{ justifyContent: 'space-between' }}>
            <span className="con-label">rupture · 422 unprocessable · retries exhausted</span>
            <span className="con-label con-bad">
              {baseline ? `reason: ${baseline.reason_code ?? 'none'}` : 'recovery: n/a'}
            </span>
          </div>
        </div>

        <div style={{ background: 'var(--c-bg)', padding: '0.75rem' }}>
          <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span className="con-row" style={{ gap: '0.5rem' }}>
              <Chip tone="ok">lane b</Chip>
              <span className="con-label">Self-healing agent (Reflex suture engine)</span>
            </span>
            <span className="con-label con-accent">
              {healing ? `${healing.outcome} · ${num(healing.tokens_total)} llm tokens` : 'no run'}
            </span>
          </div>
          <LaneHealing />
          <div className="con-row" style={{ justifyContent: 'space-between' }}>
            <span className="con-label con-accent">suture bridge · in-memory patch · verified upstream</span>
            <span className="con-label con-accent">
              {healing ? `recovered in ${secs(healing.t_break !== null && healing.t_recovery !== null ? healing.t_recovery - healing.t_break : null)}` : 'awaiting run'}
            </span>
          </div>
        </div>
      </Panel>

      <div className="con-grid-2">
        <TelemetryMatrix record={baseline} kind="baseline" />
        <TelemetryMatrix record={healing} kind="healing" />
      </div>

      <Panel
        title="Live stream buffer // recorded run trace"
        actions={<span className="con-label">{events.length} events · stream_sync: deterministic</span>}
      >
        <EventTimeline events={events} />
      </Panel>
    </div>
  )
}
