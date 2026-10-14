import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useRunEvents } from '../hooks/useRunEvents'
import { AgentCard } from '../components/AgentCard'
import { Card } from '../components/StatCard'
import { TraceViewer } from '../components/TraceViewer'
import { ErrorState, LoadingState } from '../components/StateViews'
import type { RunSummary } from '../types'

export function ComparePage() {
  const cases = useApi(() => api.cases(), [])
  const [caseId, setCaseId] = useState('ps_demo')
  const [runId, setRunId] = useState<string | undefined>(undefined)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | null>(null)
  const { events, status } = useRunEvents(runId)

  useEffect(() => {
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [])

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
      if (err instanceof ApiError && err.status === 409) setMessage('A run is already in progress.')
      else setMessage(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const baseline = summary?.records.find((r) => r.agent === 'baseline') ?? null
  const healing = summary?.records.find((r) => r.agent === 'healing') ?? null
  const running = summary?.status === 'running' || (runId !== undefined && summary === null)

  if (cases.loading) return <LoadingState label="Loading cases…" />
  if (cases.error) return <ErrorState message={cases.error} onRetry={cases.reload} />

  return (
    <div className="page">
      <h1>Agent Comparison</h1>

      <Card title="Run a case">
        <div className="button-row">
          <label className="field inline">
            <span>Case</span>
            <select value={caseId} onChange={(e) => setCaseId(e.target.value)}>
              {cases.data?.cases
                .filter((c) => c.split === 'tuning')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id} (expects {c.expected_outcome})
                  </option>
                ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={start} disabled={busy || running}>
            {running ? 'Running…' : 'Run comparison'}
          </button>
        </div>
        {message && <div className="notice">{message}</div>}
      </Card>

      <div className="grid grid-2">
        <AgentCard agent="baseline" record={baseline} running={Boolean(running)} />
        <AgentCard agent="healing" record={healing} running={Boolean(running)} />
      </div>

      <Card title="Live healing trace">
        <TraceViewer events={events} status={status} />
      </Card>
    </div>
  )
}
