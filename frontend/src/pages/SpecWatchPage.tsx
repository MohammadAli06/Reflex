import { Chip, Metric, PageHead, Panel } from '../components/console'
import { LoadingState, ErrorState } from '../components/StateViews'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import { DASH } from '../utils/format'

/**
 * Spec-watch is not implemented on the backend yet. This page states that
 * plainly instead of showing a fake "watching" status, and lists exactly what
 * has to exist before the controls can do anything.
 */
export function SpecWatchPage() {
  const status = useApi(() => api.status(), [])

  if (status.loading) return <LoadingState label="Checking spec-watch availability…" />
  if (status.error) return <ErrorState message={status.error} onRetry={status.reload} />

  const summary = status.data

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Pre-emptive drift detection</span>}
        title="Spec Watch"
        subtitle="Poll the contract and repair before any agent call fails."
        right={<Chip tone="warn">Not available</Chip>}
      />

      <Panel title="Watcher state">
        <div className="con-grid-3">
          <Metric label="Watcher" value="Not implemented" tone="warn" />
          <Metric label="Last poll" value={DASH} />
          <Metric
            label="Current schema hash"
            value={summary?.schema_hash ?? DASH}
          />
        </div>
        <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
          No background task polls <code>/openapi.json</code> today, so there is no poll time, no
          change timeline and no "failed calls avoided" figure. Nothing on this page is simulated —
          it will populate once the watcher exists.
        </p>
      </Panel>

      <Panel title="Backend dependencies">
        <ul className="con-sub" style={{ paddingLeft: 'var(--s5)', margin: 0 }}>
          <li>
            A control-API background task that GETs <code>/openapi.json</code> through
            {' '}<code>schema_fetch</code> on an interval derived from
            {' '}<code>SPEC_WATCH_INTERVAL_S</code> (currently read but unused: 5s default, 0 = off).
          </li>
          <li>
            A hash comparison against the last verified schema, with
            {' '}<code>diff → hypothesize → validate → CAS patch</code> running before any agent call.
          </li>
          <li>
            Trace events and an audit entry with <code>trigger="spec_watch"</code> so the timeline and
            the patched / refused / needs-review action can be shown from real data.
          </li>
          <li>
            Metrics <code>failed_calls_before_heal</code> (0 for a pre-emptive heal) and
            {' '}<code>silent_wrong_success</code>, which is what makes "failed calls avoided" measurable
            rather than asserted.
          </li>
        </ul>
      </Panel>

      <Panel title="What already works today">
        <p className="con-sub" style={{ margin: 0 }}>
          Reactive healing is fully wired: a failed call triggers classification, a verified-schema
          fetch, a diff, a validated patch and a retry. The <code>schema_snapshots</code> table already
          records every verified schema with its version, hash and error style, so the history the
          watcher will need is being collected now.
        </p>
      </Panel>
    </div>
  )
}
