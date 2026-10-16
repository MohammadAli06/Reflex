import { Chip, Metric, PageHead, Panel } from '../components/console'
import { DataTable, type Column } from '../components/DataTable'
import { LoadingState, ErrorState } from '../components/StateViews'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import { DASH } from '../utils/format'

interface LedgerRow {
  id: string
  amount: string
  currency: string
  key: string
  created: string
  run: string
  verification: string
}

/**
 * The mock has no payments endpoint, ledger or idempotency handling yet, so
 * there is no ledger to display. This page shows an empty, clearly-labelled
 * state plus the exact contract the backend must expose.
 */
export function PaymentsSandboxPage() {
  const scenarios = useApi(() => api.scenarios(), [])

  if (scenarios.loading) return <LoadingState label="Checking payments support…" />
  if (scenarios.error) return <ErrorState message={scenarios.error} onRetry={scenarios.reload} />

  const columns: Column<LedgerRow>[] = [
    { key: 'id', header: 'Record ID', render: (row) => row.id },
    { key: 'amount', header: 'Amount', render: (row) => row.amount },
    { key: 'currency', header: 'Currency', render: (row) => row.currency },
    { key: 'key', header: 'Idempotency key', render: (row) => row.key },
    { key: 'created', header: 'Created', render: (row) => row.created },
    { key: 'run', header: 'Run', render: (row) => row.run },
    { key: 'verification', header: 'Verification', render: (row) => row.verification },
  ]

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Safe writes under retry</span>}
        title="Payments Sandbox"
        subtitle="Demonstrate idempotent writes, postcondition verification and rollback."
        right={<Chip tone="warn">Not available</Chip>}
      />

      <div className="notice notice-warning">
        No payments ledger exists in the mock API, so this sandbox has nothing to show. It will
        never display synthetic amounts or a "prevented duplicate" claim that the ledger cannot
        verify.
      </div>

      <div className="con-grid-3">
        <Metric label="Ledger rows" value={DASH} />
        <Metric label="Duplicate writes" value={DASH} />
        <Metric label="Read-back checks" value={DASH} />
      </div>

      <Panel title="Ledger">
        <DataTable columns={columns} rows={[]} emptyMessage="No ledger endpoint is implemented." />
      </Panel>

      <Panel title="Scenarios to expose">
        <ul className="con-sub" style={{ paddingLeft: 'var(--s5)', margin: 0 }}>
          <li><strong>Timeout after commit</strong> — the row is committed, then the response times out.</li>
          <li><strong>Lossy amount</strong> — a float-to-int conversion must refuse before anything is sent.</li>
          <li><strong>Idempotency unsupported</strong> — no key support means no live retry and a needs-review end state.</li>
        </ul>
      </Panel>

      <Panel title="Backend dependencies">
        <ul className="con-sub" style={{ paddingLeft: 'var(--s5)', margin: 0 }}>
          <li>
            Mock <code>POST /api/v1/payments/create</code> (amount, currency, customer ref) over an
            in-memory ledger, honouring <code>Idempotency-Key</code>: the same key returns the stored
            response and writes <strong>no</strong> second row.
          </li>
          <li>
            Mock <code>GET /api/v1/payments/&#123;id&#125;</code> for read-back, plus the header declared in the
            generated OpenAPI so the executor can discover it.
          </li>
          <li>
            A <code>timeout_after_commit</code> fault mode.
          </li>
          <li>
            <code>ToolDefinition</code> fields <code>idempotency</code> and <code>readback</code>, discovered
            from the verified schema and never assumed.
          </li>
          <li>
            A <code>duplicate_writes</code> metric counted from the ledger, so the comparison below is
            measured rather than asserted.
          </li>
        </ul>
      </Panel>

      <Panel title="Baseline vs Reflex">
        <p className="con-sub" style={{ margin: 0 }}>
          The comparison appears once the ledger exists. Today's synthetic safety scenarios
          ({scenarios.data?.scenarios.length ?? 0} registered) already demonstrate the refusal gates
          this sandbox will exercise, on the <a href="/console/safety">Safety</a> page.
        </p>
      </Panel>
    </div>
  )
}
