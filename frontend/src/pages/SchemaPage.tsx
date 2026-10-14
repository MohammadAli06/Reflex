import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Card } from '../components/StatCard'
import { SchemaView } from '../components/SchemaView'
import { StatusBadge } from '../components/StatusBadge'
import { ErrorState, LoadingState } from '../components/StateViews'
import type { ConsistencyResult, ErrorStyle } from '../types'

const ERROR_STYLES: ErrorStyle[] = ['clear', 'vague', 'none']

export function SchemaPage() {
  const schema = useApi(() => api.schema(), [])
  const mutations = useApi(() => api.mutations(), [])
  const [selected, setSelected] = useState('M_NEST_TYPE_HEADER')
  const [errorStyle, setErrorStyle] = useState<ErrorStyle>('clear')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [consistency, setConsistency] = useState<ConsistencyResult | null>(null)

  async function apply() {
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.mutate(selected, errorStyle)
      setConsistency(result.consistency)
      setMessage(`Applied ${selected}. New schema version: ${result.version}.`)
      schema.reload()
    } catch (err) {
      setMessage(`Failed: ${err instanceof ApiError ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    if (!window.confirm('Reset the mock schema to the initial version? This bumps the version.')) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.reset()
      setConsistency(result.consistency)
      setMessage(`Reset complete. New schema version: ${result.version}.`)
      schema.reload()
    } catch (err) {
      setMessage(`Failed: ${err instanceof ApiError ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function checkConsistency() {
    setBusy(true)
    setMessage(null)
    try {
      setConsistency(await api.consistency())
    } catch (err) {
      setMessage(`Consistency check failed: ${err instanceof ApiError ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  if (schema.loading) return <LoadingState label="Loading schema…" />
  if (schema.error) return <ErrorState message={schema.error} onRetry={schema.reload} />

  return (
    <div className="page">
      <h1>Schema Mutation</h1>
      <div className="grid grid-2-wide">
        <Card title="Active schema">
          <SchemaView schema={schema.data!} />
        </Card>

        <Card title="Controls">
          <label className="field">
            <span>Mutation</span>
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {mutations.data?.mutations.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.id})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Error style</span>
            <select value={errorStyle} onChange={(e) => setErrorStyle(e.target.value as ErrorStyle)}>
              {ERROR_STYLES.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>

          <div className="button-row">
            <button className="btn btn-primary" onClick={apply} disabled={busy}>
              {busy ? 'Working…' : 'Apply mutation'}
            </button>
            <button className="btn" onClick={checkConsistency} disabled={busy}>
              Consistency check
            </button>
            <button className="btn btn-danger" onClick={reset} disabled={busy}>
              Reset
            </button>
          </div>

          {message && <div className="notice">{message}</div>}

          {consistency && (
            <div className="consistency">
              <div>
                <StatusBadge label={consistency.pass ? 'pass' : 'fail'} tone={consistency.pass ? 'success' : 'failure'} />{' '}
                consistency @ version {consistency.version}
              </div>
              <ul>
                {consistency.checks.map((check) => (
                  <li key={check.name}>
                    <StatusBadge label={check.ok ? 'ok' : 'fail'} tone={check.ok ? 'success' : 'failure'} />{' '}
                    <code>{check.name}</code> {check.detail}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
