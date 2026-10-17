import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { PageHead, Panel } from '../components/console'
import { DataTable, type Column } from '../components/DataTable'
import { DryRunPanel } from '../components/DryRunPanel'
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews'
import { StatCard } from '../components/StatCard'
import { StatusBadge } from '../components/StatusBadge'
import { useApi } from '../hooks/useApi'
import type { RealWorldCase } from '../types'
import { DASH, num } from '../utils/format'

type LabelFilter = 'all' | 'recoverable' | 'refuse_expected'
type SectionView = 'reviewed' | 'dryrun'

const POLL_MS = 500
/** One baseline and one healing record per case. */
const RECORDS_PER_CASE = 2

interface ActiveRun {
  /** Empty until the start request returns. */
  runId: string
  caseIds: string[]
  total: number
  done: number
}

function progressLabel(active: ActiveRun | null): string {
  if (!active) return ''
  return `${active.done} of ${active.total} records`
}

export function RealWorldPage() {
  const cases = useApi(() => api.realWorldCases(), [])
  const { reload } = cases
  const [label, setLabel] = useState<LabelFilter>('all')
  const [view, setView] = useState<SectionView>('reviewed')
  const [active, setActive] = useState<ActiveRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  const timer = useRef<number | null>(null)
  const alive = useRef(true)

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      stopPolling()
    }
  }, [stopPolling])

  const all = cases.data?.cases ?? []
  const rows = useMemo(
    () => (label === 'all' ? all : all.filter((item) => item.label === label)),
    [all, label],
  )
  const summary = cases.data?.summary
  const unreviewed = all.filter((item) => !item.reviewed)

  /**
   * Follow the run until it stops.
   *
   * A single refresh immediately after starting reads pre-run state: the run
   * executes on a background thread and persists records as it goes, so the
   * first read returns no outcomes and no run id at all.
   */
  const poll = useCallback(
    async (runId: string, caseIds: string[], total: number) => {
      let run
      try {
        run = await api.getRun(runId)
      } catch (err) {
        if (!alive.current) return
        stopPolling()
        setActive(null)
        setError(
          `Lost contact with run ${runId} while it was running: ${
            err instanceof Error ? err.message : String(err)
          }`,
        )
        return
      }
      if (!alive.current) return

      setActive({ runId, caseIds, total, done: run.records.length })

      if (run.status === 'running') {
        timer.current = window.setTimeout(() => {
          void poll(runId, caseIds, total)
        }, POLL_MS)
        return
      }

      stopPolling()
      if (run.status === 'error') {
        setError(`Run ${runId} finished with an error: ${run.error ?? 'no detail reported'}`)
      }
      try {
        await reload()
      } finally {
        if (alive.current) setActive(null)
      }
    },
    [reload, stopPolling],
  )

  async function runBenchmark() {
    const caseIds = all.filter((item) => item.reviewed).map((item) => item.id)
    if (!caseIds.length) {
      setError('No reviewed cases are registered, so there is nothing to run.')
      return
    }
    const total = caseIds.length * RECORDS_PER_CASE
    stopPolling()
    setError(null)
    setActive({ runId: '', caseIds, total, done: 0 })
    try {
      const started = await api.startRun(caseIds)
      if (!alive.current) return
      setActive({ runId: started.run_id, caseIds, total, done: started.records.length })
      await poll(started.run_id, caseIds, total)
    } catch (err) {
      if (!alive.current) return
      stopPolling()
      setActive(null)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (cases.loading) {
    return (
      <div className="con-page">
        <PageHead
          eyebrow={<span>Versioned OpenAPI contracts</span>}
          title="Real-World Benchmark"
          subtitle="Evaluate schema-drift recovery against versioned public API contracts."
        />
        <LoadingState label="Loading benchmark cases…" />
      </div>
    )
  }

  if (cases.error) {
    return (
      <div className="con-page">
        <PageHead
          eyebrow={<span>Versioned OpenAPI contracts</span>}
          title="Real-World Benchmark"
          subtitle="Evaluate schema-drift recovery against versioned public API contracts."
        />
        <ErrorState message={cases.error} onRetry={reload} />
      </div>
    )
  }

  const running = active !== null

  const columns: Column<RealWorldCase>[] = [
    { key: 'id', header: 'Case ID', render: (item) => <span className="font-mono">{item.id}</span> },
    { key: 'api', header: 'API / source', render: (item) => item.api ?? DASH },
    { key: 'operation', header: 'Operation', render: (item) => item.operation ?? DASH },
    { key: 'change_kind', header: 'Change', render: (item) => item.change_kind ?? DASH },
    { key: 'label', header: 'Expected', render: (item) => <StatusBadge label={item.label} /> },
    {
      key: 'baseline',
      header: 'Baseline',
      render: (item) => (item.baseline_outcome ? <StatusBadge label={item.baseline_outcome} /> : DASH),
    },
    {
      key: 'reflex',
      header: 'Reflex',
      render: (item) => (item.reflex_outcome ? <StatusBadge label={item.reflex_outcome} /> : DASH),
    },
    {
      key: 'server_payload_ok',
      header: 'Result check',
      render: (item) =>
        item.server_payload_ok === true ? (
          <StatusBadge label="Verified" tone="success" />
        ) : item.server_payload_ok === false ? (
          <StatusBadge label="Failed check" tone="failure" />
        ) : (
          DASH
        ),
    },
    {
      key: 'reviewed',
      header: 'Label',
      render: (item) => (item.reviewed ? 'Reviewed' : 'Draft'),
    },
    {
      key: 'trace',
      header: 'Trace',
      render: (item) => {
        // The persisted run id only exists once records are written, so an
        // in-flight benchmark run is used until then.
        const runId = item.run_id ?? (active?.caseIds.includes(item.id) ? active.runId : null)
        return runId ? (
          <Link className="cbtn cbtn-sm cbtn-ghost" to={`/console/runs/${runId}`}>
            Open trace
          </Link>
        ) : (
          DASH
        )
      },
    },
  ]

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Versioned OpenAPI contracts</span>}
        title="Real-World Benchmark"
        subtitle="Evaluate schema-drift recovery against versioned public API contracts."
        right={
          <button
            className="cbtn cbtn-primary"
            disabled={running || !summary?.reviewed}
            onClick={runBenchmark}
            title={
              summary?.reviewed
                ? undefined
                : 'No reviewed cases are registered yet; drafts are not ground truth.'
            }
          >
            {running
              ? `Running… ${progressLabel(active)}`
              : `Run Benchmark${summary?.reviewed ? ` (${summary.reviewed})` : ''}`}
          </button>
        }
      />

      {error && <div className="notice notice-error">{error}</div>}

      {active && (
        <div className="notice" role="status" aria-live="polite">
          Benchmark {active.runId ? `run ${active.runId} ` : ''}in progress —{' '}
          {progressLabel(active)}. Results fill in as each case completes.
        </div>
      )}

      <div className="stat-row">
        <StatCard
          label="Correct recoveries"
          value={summary ? num(summary.recovered) : DASH}
          hint="Server payloads verified"
        />
        <StatCard
          label="Correct refusals"
          value={summary ? num(summary.correct_refusals) : DASH}
          hint="Expected safe stops"
        />
        <StatCard
          label="Wrong patches"
          value={summary ? num(summary.wrong_patches) : DASH}
          hint="Claimed recovery, failed verification"
        />
        <StatCard
          label="Failed"
          value={summary ? num(summary.failed) : DASH}
          hint="Cases that did not recover or refuse"
        />
      </div>

      <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 13, marginBottom: 10 }}>
        <span className="text-muted">
          {summary
            ? `${summary.reviewed} reviewed cases · target 10+`
            : 'Reviewed case count unavailable.'}
        </span>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {summary ? `${summary.registered} registered` : DASH}
        </span>
      </div>

      <div className="csegment" aria-label="Real-world section" data-testid="realworld-section-toggle">
        {(['reviewed', 'dryrun'] as SectionView[]).map((value) => (
          <button key={value} className={view === value ? 'on' : ''} onClick={() => setView(value)}>
            {value === 'reviewed' ? 'Reviewed cases' : 'Try your own API'}
          </button>
        ))}
      </div>

      {view === 'dryrun' ? (
        <DryRunPanel />
      ) : (
      <Panel
        title="Benchmark cases"
        actions={
          <div className="csegment" aria-label="Expected-label filter">
            {(['all', 'recoverable', 'refuse_expected'] as LabelFilter[]).map((value) => (
              <button key={value} className={label === value ? 'on' : ''} onClick={() => setLabel(value)}>
                {value === 'all' ? 'All' : value === 'recoverable' ? 'Recoverable' : 'Should refuse'}
              </button>
            ))}
          </div>
        }
      >
        {!all.length ? (
          <EmptyState
            message="No real-world cases are registered yet."
            hint="Vendored, hand-reviewed OpenAPI cases appear here once cases.yaml is populated."
          />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            emptyMessage="No cases match this filter."
            rowClassName={(item) => (item.reviewed ? '' : 'row-draft')}
          />
        )}
      </Panel>
      )}

      {view === 'reviewed' && unreviewed.length > 0 && (
        <div className="notice notice-warning">
          {unreviewed.length} case(s) are unreviewed and are not presented as benchmark ground truth.
          Only reviewed cases run when you press Run Benchmark.
        </div>
      )}
    </div>
  )
}
