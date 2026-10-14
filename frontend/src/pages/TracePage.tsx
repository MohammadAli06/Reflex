import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useRunEvents } from '../hooks/useRunEvents'
import { Card } from '../components/StatCard'
import { TraceViewer } from '../components/TraceViewer'
import { EmptyState } from '../components/StateViews'

export function TracePage() {
  const { runId } = useParams<{ runId: string }>()
  const runs = useApi(() => api.listRuns(), [])
  const [selected, setSelected] = useState<string | undefined>(runId)
  const active = runId ?? selected
  const { events, status } = useRunEvents(active)

  return (
    <div className="page">
      <h1>Live Healing Trace</h1>
      <Card
        title="Run"
        actions={
          <select value={active ?? ''} onChange={(e) => setSelected(e.target.value)}>
            <option value="">Select a run…</option>
            {runs.data?.runs.map((run) => (
              <option key={run.run_id} value={run.run_id}>
                {run.run_id} · {run.status} · {run.case_ids.join(', ')}
              </option>
            ))}
          </select>
        }
      >
        {active ? (
          <TraceViewer events={events} status={status} />
        ) : (
          <EmptyState message="No run selected." hint="Start a comparison or pick a recent run." />
        )}
      </Card>
      <p className="muted">
        <Link to="/compare">Go to Agent Comparison →</Link>
      </p>
    </div>
  )
}
