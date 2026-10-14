import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Card } from '../components/StatCard'
import { DataTable, type Column } from '../components/DataTable'
import { JsonViewer } from '../components/JsonViewer'
import { StatusBadge, outcomeTone } from '../components/StatusBadge'
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews'
import type { AuditEntry } from '../types'

const OUTCOMES = ['', 'applied', 'refused', 'rolled_back', 'needs_human_review', 'not_drift']

export function AuditPage() {
  const [outcome, setOutcome] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const audit = useApi(() => api.audit({ outcome: outcome || undefined, limit: 100 }), [outcome])

  const columns: Column<AuditEntry>[] = [
    { key: 'ts', header: 'Time', render: (r) => new Date(r.ts).toLocaleString() },
    { key: 'tool', header: 'Tool' },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (r) => <StatusBadge label={r.outcome} tone={outcomeTone(r.outcome)} />,
    },
    {
      key: 'versions',
      header: 'Schema v',
      render: (r) => `${r.schema_version_before ?? '?'} → ${r.schema_version_after ?? '?'}`,
    },
    { key: 'hash', header: 'Hash', render: (r) => <code title={r.schema_sha256}>{(r.schema_sha256 || '').slice(0, 10)}</code> },
    { key: 'confidence', header: 'Conf.', render: (r) => r.confidence?.toFixed(2) ?? 'n/a' },
    { key: 'reason', header: 'Reason', render: (r) => (r.reason_code ? <code>{r.reason_code}</code> : '—') },
    {
      key: 'open',
      header: '',
      render: (r) => (
        <button className="btn btn-small" onClick={() => setExpanded(expanded === r.ts ? null : r.ts)}>
          {expanded === r.ts ? 'Hide' : 'Details'}
        </button>
      ),
    },
  ]

  const selected = audit.data?.entries.find((e) => e.ts === expanded)

  return (
    <div className="page">
      <h1>Audit Log</h1>
      <Card
        title="Entries"
        actions={
          <label className="field inline">
            <span>Outcome</span>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              {OUTCOMES.map((value) => (
                <option key={value} value={value}>
                  {value || 'all'}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {audit.loading && <LoadingState />}
        {audit.error && <ErrorState message={audit.error} onRetry={audit.reload} />}
        {audit.data && audit.data.entries.length === 0 && (
          <EmptyState message="No audit entries yet." hint="Run a comparison or a safety scenario." />
        )}
        {audit.data && audit.data.entries.length > 0 && (
          <DataTable columns={columns} rows={audit.data.entries} />
        )}
      </Card>

      {selected && (
        <div className="grid grid-2">
          <Card title="Old definition">
            {selected.old_definition ? <JsonViewer value={selected.old_definition} /> : <EmptyState message="No old definition recorded." />}
          </Card>
          <Card title="New definition">
            {selected.new_definition ? <JsonViewer value={selected.new_definition} /> : <EmptyState message="No new definition recorded." />}
          </Card>
        </div>
      )}
    </div>
  )
}
