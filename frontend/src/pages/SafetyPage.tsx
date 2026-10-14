import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Card } from '../components/StatCard'
import { StatusBadge, outcomeTone } from '../components/StatusBadge'
import { RefusalPanel } from '../components/RefusalPanel'
import { TraceViewer } from '../components/TraceViewer'
import { ErrorState, LoadingState } from '../components/StateViews'
import type { ScenarioResult } from '../types'

export function SafetyPage() {
  const scenarios = useApi(() => api.scenarios(), [])
  const [results, setResults] = useState<Record<string, ScenarioResult | 'running'>>({})
  const [error, setError] = useState<string | null>(null)

  async function run(id: string) {
    setError(null)
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

  return (
    <div className="page">
      <h1>Safety Demonstration</h1>
      {error && <div className="notice notice-error">{error}</div>}
      <div className="grid grid-2">
        {scenarios.data?.scenarios.map((scenario) => {
          const value = results[scenario.id]
          const running = value === 'running'
          const result = value && value !== 'running' ? value : null
          const refused = result?.outcome === 'refused'
          return (
            <Card
              key={scenario.id}
              title={scenario.label}
              actions={
                <button className="btn btn-primary" onClick={() => run(scenario.id)} disabled={running}>
                  {running ? 'Running…' : 'Run'}
                </button>
              }
            >
              <p className="muted">{scenario.description}</p>
              {result && (
                <div className="scenario-result">
                  <div className="scenario-outcome">
                    <StatusBadge label={result.outcome} tone={outcomeTone(result.outcome)} />
                    {result.reason_code && <code className="muted"> {result.reason_code}</code>}
                    {result.mttr !== null && <span className="muted"> · {result.mttr.toFixed(3)}s</span>}
                  </div>
                  {refused || result.outcome === 'not_drift_reported' ? (
                    <RefusalPanel reasonCode={result.reason_code} explanation={result.explanation} />
                  ) : (
                    <p>{result.explanation}</p>
                  )}
                  <details>
                    <summary>Trace ({result.events.length} events)</summary>
                    <TraceViewer events={result.events} status="finished" />
                  </details>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
