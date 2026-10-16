import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { EmptyState, LoadingState, ErrorState } from './StateViews'
import { JsonViewer } from './JsonViewer'
import { StatusBadge } from './StatusBadge'
import { DASH } from '../utils/format'

/**
 * Pinned audit decision for one run. Renders only data returned by the
 * backend audit lookup — anything absent shows DASH.
 */
export function DecisionCard({ runId }: { runId: string }) {
  const audit = useApi(() => api.audit({ runId, limit: 1 }), [runId])

  if (audit.loading) return <LoadingState label="Loading decision…" />
  if (audit.error) return <ErrorState message={audit.error} onRetry={audit.reload} />

  const entry = audit.data?.entries[0]

  if (!entry) {
    return (
      <EmptyState
        message="No decision recorded for this run."
        hint="This run produced no audit entry. Safe refusals, patches, and non-drift classifications all appear here."
      />
    )
  }

  const shortHash = (entry.schema_sha256 ?? '').slice(0, 8)

  return (
    <div
      className="card"
      data-testid="decision-card"
      style={{ padding: 20, borderLeft: '3px solid var(--reflex-cyan)' }}
    >
      <div className="con-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
        <div>
          <div className="text-label" style={{ marginBottom: 4 }}>Decision</div>
          <div className="con-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <StatusBadge label={entry.outcome} />
            {entry.reason_code ? (
              <span className="font-mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {entry.reason_code}
              </span>
            ) : (
              <span className="text-muted font-mono" style={{ fontSize: 12 }}>{DASH}</span>
            )}
          </div>
        </div>
        <div className="con-row" style={{ gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
          <span className="text-muted">
            Confidence <b className="font-mono" style={{ color: 'var(--ink)' }}>{entry.confidence?.toFixed(2) ?? DASH}</b>
          </span>
          <span className="text-muted">
            Schema <b className="font-mono" style={{ color: 'var(--ink)' }}>{shortHash || DASH}</b>
          </span>
          <span className="text-muted">
            Version <b className="font-mono" style={{ color: 'var(--ink)' }}>v{entry.schema_version_before ?? '?'} → v{entry.schema_version_after ?? '?'}</b>
          </span>
        </div>
      </div>

      <div className="con-grid-2">
        <div>
          <div className="text-label" style={{ marginBottom: 6 }}>Schema before</div>
          {entry.old_definition ? (
            <JsonViewer value={entry.old_definition} />
          ) : (
            <div className="state state-empty" style={{ padding: 16 }}>No original definition recorded.</div>
          )}
        </div>
        <div>
          <div className="text-label" style={{ marginBottom: 6 }}>Schema after</div>
          {entry.new_definition ? (
            <JsonViewer value={entry.new_definition} />
          ) : (
            <div className="state state-empty" style={{ padding: 16 }}>No patch applied (safe refusal or non-drift).</div>
          )}
        </div>
      </div>
    </div>
  )
}
