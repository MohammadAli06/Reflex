import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { PageHead, Panel, Metric } from '../components/console'
import { DataTable, type Column } from '../components/DataTable'
import { ErrorState, LoadingState } from '../components/StateViews'
import { StatCard } from '../components/StatCard'
import { StatusBadge } from '../components/StatusBadge'
import { useApi } from '../hooks/useApi'
import type { MetricSummary, RunRecord } from '../types'
import { DASH, num, pct } from '../utils/format'

type Split = 'tuning' | 'held_out' | 'fuzz'

interface FailureRow {
  case_id: string
  split: string
  source: string
  expected: string
  actual: string
  reason: string | null
  seed: number | null
  verdict: string
}

function ciText(ci: { low: number; high: number } | null | undefined): string {
  if (!ci) return ''
  return `95% CI ${pct(ci.low)}–${pct(ci.high)}`
}

function verdictOf(caseInfo: { expected_outcome: string; expected_reason: string | null }, healing?: RunRecord): string {
  if (!healing) return 'not_run'
  if (healing.outcome === 'recovered' && healing.correct === false) return 'wrong_patch'
  if (caseInfo.expected_outcome === 'recovered') {
    return healing.outcome === 'recovered' && healing.correct !== false ? 'recovered' : 'failed'
  }
  if (caseInfo.expected_outcome === 'refused') {
    if (healing.outcome !== 'refused') return 'failed'
    if (caseInfo.expected_reason && healing.reason_code !== caseInfo.expected_reason) return 'failed'
    return 'correct_refusal'
  }
  return healing.outcome === caseInfo.expected_outcome ? 'not_drift' : 'failed'
}

export function EvaluationPage() {
  const cases = useApi(() => api.cases(), [])
  const runs = useApi(() => api.listRuns(), [])
  const metrics = useApi(() => api.metrics(), [])
  const [split, setSplit] = useState<Split>('tuning')
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const selected = useMemo(
    () => (cases.data?.cases ?? []).filter((item) => item.split === split),
    [cases.data, split],
  )

  const records = useMemo(() => runs.data?.runs.flatMap((run) => run.records) ?? [], [runs.data])
  const results = useMemo(() => {
    const byCase = new Map<string, RunRecord[]>()
    for (const record of records) {
      const bucket = byCase.get(record.case_id) ?? []
      bucket.push(record)
      byCase.set(record.case_id, bucket)
    }
    return byCase
  }, [records])

  const rows: FailureRow[] = useMemo(() => {
    const out: FailureRow[] = []
    for (const item of selected) {
      const bucket = results.get(item.id) ?? []
      const healing = bucket.filter((r) => r.agent === 'healing').slice(-1)[0]
      out.push({
        case_id: item.id,
        split: item.split,
        source: item.source ?? 'synthetic',
        expected: item.expected_outcome,
        actual: healing?.outcome ?? 'not_run',
        reason: healing?.reason_code ?? null,
        seed: healing?.seed ?? null,
        verdict: verdictOf(item, healing),
      })
    }
    return out
  }, [selected, results])

  const evaluated = rows.filter((row) => row.verdict !== 'not_run')
  const recovered = evaluated.filter((row) => row.verdict === 'recovered').length
  const refusals = evaluated.filter((row) => row.verdict === 'correct_refusal').length
  const wrongPatches = evaluated.filter((row) => row.verdict === 'wrong_patch').length
  const failures = rows.filter((row) => row.verdict === 'failed')

  if (cases.loading || runs.loading || metrics.loading) {
    return <LoadingState label="Loading evaluation configuration…" />
  }
  if (cases.error || runs.error) {
    return (
      <ErrorState
        message={cases.error ?? runs.error ?? 'Evaluation unavailable'}
        onRetry={() => { cases.reload(); runs.reload(); metrics.reload() }}
      />
    )
  }

  const columns: Column<FailureRow>[] = [
    { key: 'case_id', header: 'Case', render: (row) => <span className="font-mono">{row.case_id}</span> },
    { key: 'source', header: 'Source', render: (row) => row.source },
    { key: 'expected', header: 'Expected', render: (row) => <StatusBadge label={row.expected} /> },
    { key: 'actual', header: 'Actual', render: (row) => <StatusBadge label={row.actual} /> },
    { key: 'reason', header: 'Reason', render: (row) => row.reason ?? DASH },
    { key: 'verdict', header: 'Verdict', render: (row) => <StatusBadge label={row.verdict} /> },
    {
      key: 'replay',
      header: 'Replay',
      render: (row) => row.seed === null ? (
        /^fuzz_(\d+)_(\d+)$/.test(row.case_id) ? (
          <button
            className="cbtn cbtn-sm cbtn-ghost"
            onClick={() => replay(row)}
            title="Re-run this case with its recorded seed"
          >
            Replay seed
          </button>
        ) : (
          DASH
        )
      ) : (
        <button
          className="cbtn cbtn-sm cbtn-ghost"
          onClick={() => replay(row)}
          title="Re-run this case with its recorded seed"
        >
          Replay seed {row.seed}
        </button>
      ),
    },
  ]

  function replay(row: FailureRow) {
    if (row.seed === null) {
      const match = /^fuzz_(\d+)_(\d+)$/.exec(row.case_id)
      if (!match) {
        setFailure('Replay is only available for seeded fuzz cases.')
        return
      }
      const [, runSeed, index] = match
      row = {
        ...row,
        seed: Number(runSeed) * 100000 + Number(index),
      }
    }
    setFailure(null)
    setNotice(
      `Replay from a terminal: python -m app.runner.run_suite --replay-seed ${row.seed} ` +
      `# regenerates ${row.case_id} exactly (fuzz generation needs the seed, which lives server-side in the CLI)`,
    )
  }

  const healing = metrics.data?.agents?.healing
  // Prefer the exact split; the fuzz split is reported as a source instead.
  const scoped: MetricSummary | undefined =
    split === 'fuzz' ? healing?.by_source?.fuzz : healing?.by_split?.[split]

  const [running, setRunning] = useState(false)

  async function runCurrentSplit() {
    const caseIds = selected.map((item) => item.id)
    if (!caseIds.length) {
      setFailure('No cases available in this split.')
      return
    }
    setRunning(true)
    setFailure(null)
    setNotice(null)
    try {
      await api.startRun(caseIds)
      await Promise.all([cases.reload(), runs.reload(), metrics.reload()])
      setNotice(`Successfully executed ${caseIds.length} ${split} cases.`)
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Splits, seeds and confidence</span>}
        title="Reliability"
        subtitle="Pass/fail counts and failed cases per split, with replay seeds where recorded."
        right={
          <button
            className="cbtn cbtn-primary"
            disabled={running || !selected.length}
            onClick={runCurrentSplit}
          >
            {running ? 'Running split…' : `Evaluate ${split === 'held_out' ? 'Held-out' : split[0].toUpperCase() + split.slice(1)} (${selected.length})`}
          </button>
        }
      />
      {notice && <div className="notice">{notice}</div>}
      {failure && <div className="notice notice-error">{failure}</div>}

      <div className="csegment" role="group" aria-label="Split selector">
        {(['tuning', 'held_out', 'fuzz'] as Split[]).map((value) => (
          <button key={value} className={split === value ? 'on' : ''} onClick={() => setSplit(value)}>
            {value === 'held_out' ? 'Held-out' : value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>

      <div className="stat-row">
        <StatCard label="Evaluated" value={num(evaluated.length)} hint={`of ${rows.length} in split`} />
        <StatCard label="Correct recoveries" value={num(recovered)} hint="Server payloads verified" />
        <StatCard label="Correct refusals" value={num(refusals)} hint="Safe stops, right reason" />
        <StatCard label="Wrong patches" value={num(wrongPatches)} hint="Claimed recovery, failed verification" />
      </div>

      <Panel
        title={`${split === 'held_out' ? 'Held-out' : split} cases`}
        actions={<span className="con-label">{selected.length} selected</span>}
      >
        <DataTable columns={columns} rows={rows} emptyMessage="No cases in this split." />
      </Panel>

      <Panel title="Rates with 95% confidence">
        {!scoped?.available ? (
          <p className="con-sub">
            No recorded {split === 'fuzz' ? 'fuzz' : split.replace('_', '-')} run yet — rates stay
            unknown until one exists, and are shown as {DASH} rather than assumed.
          </p>
        ) : (
          <>
            <div className="con-grid-3">
              <Metric
                label="Adaptation rate (ZTAR)"
                value={scoped.ztar === null || scoped.ztar === undefined ? DASH : pct(scoped.ztar)}
              />
              <Metric
                label="Correct-refusal rate"
                value={
                  scoped.correct_refusal_rate === null || scoped.correct_refusal_rate === undefined
                    ? DASH
                    : pct(scoped.correct_refusal_rate)
                }
              />
              <Metric label="Records" value={num(scoped.n ?? 0)} />
            </div>
            <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
              {scoped.ztar_ci
                ? `ZTAR ${ciText(scoped.ztar_ci)}. `
                : 'ZTAR interval unavailable for this sample. '}
              {scoped.correct_refusal_ci
                ? `Correct-refusal rate ${ciText(scoped.correct_refusal_ci)}.`
                : ''}
              {' '}
              <Link to="/console/benchmarks?tab=scorecard">Scorecard</Link> has the full breakdown.
            </p>
          </>
        )}
      </Panel>

      <Panel title={`Failures (${failures.length})`}>
        <DataTable columns={columns} rows={failures} emptyMessage="No failed cases in this split." />
      </Panel>
    </div>
  )
}
