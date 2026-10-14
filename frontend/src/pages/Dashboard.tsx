import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { AgentCard } from '../components/AgentCard'
import { Card, StatCard } from '../components/StatCard'
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews'

export function Dashboard() {
  const status = useApi(() => api.status(), [])
  const metrics = useApi(() => api.metrics(), [])

  if (status.loading) return <LoadingState label="Loading dashboard…" />
  if (status.error) return <ErrorState message={status.error} onRetry={status.reload} />
  const data = status.data!

  const latestRecords = data.last_run?.records ?? []
  const baseline = latestRecords.find((r) => r.agent === 'baseline') ?? null
  const healing = latestRecords.find((r) => r.agent === 'healing') ?? null
  const healingSummary = metrics.data?.agents?.healing?.overall

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
        <button className="btn" onClick={() => { status.reload(); metrics.reload() }}>
          Refresh
        </button>
      </div>

      <div className="grid grid-4">
        <StatCard label="Schema version" value={data.schema_version ?? 'n/a'} />
        <StatCard
          label="Schema hash"
          value={<code>{data.schema_hash ?? 'n/a'}</code>}
          hint="SHA-256 of canonical JSON (change tracking)"
        />
        <StatCard
          label="System status"
          value={
            <>
              <span className={`badge badge-${data.mock_api_reachable ? 'success' : 'failure'}`}>
                mock {data.mock_api_reachable ? 'up' : 'down'}
              </span>{' '}
              <span className="badge badge-success">control up</span>
            </>
          }
          hint={`LLM configured: ${data.llm_configured ? 'yes' : 'no'}`}
        />
        <StatCard
          label="Recovery / refusals"
          value={
            healingSummary?.available
              ? `${fmtPct(healingSummary.ztar)} ZTAR`
              : 'n/a'
          }
          hint={
            healingSummary?.available
              ? `${healingSummary.correct_refusals} correct refusals · ${healingSummary.wrong_patches} wrong patches`
              : 'No runs yet'
          }
        />
      </div>

      <Card title="Latest comparison run">
        {data.last_run ? (
          <div className="grid grid-2">
            <AgentCard agent="baseline" record={baseline} running={false} />
            <AgentCard agent="healing" record={healing} running={false} />
          </div>
        ) : (
          <EmptyState message="No runs yet." hint="Go to Agent Comparison to start one." />
        )}
      </Card>
    </div>
  )
}

function fmtPct(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'n/a'
  return `${(value * 100).toFixed(0)}%`
}
