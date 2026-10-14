import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Card } from '../components/StatCard'
import { DataTable, type Column } from '../components/DataTable'
import { MetricsChart, type ChartDatum } from '../components/MetricsChart'
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews'
import type { AgentMetrics, MetricSummary } from '../types'

interface Row {
  metric: string
  baseline: string
  healing: string
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${(value * 100).toFixed(0)}%`
}
function num(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : String(value)
}
function secs(value: number | null | undefined): string {
  return value === null || value === undefined ? 'n/a' : `${value.toFixed(3)}s`
}

function buildRows(base: MetricSummary, heal: MetricSummary): Row[] {
  return [
    { metric: 'ZTAR', baseline: pct(base.ztar), healing: pct(heal.ztar) },
    { metric: 'Correct refusals', baseline: num(base.correct_refusals), healing: num(heal.correct_refusals) },
    { metric: 'Wrong patches', baseline: num(base.wrong_patches), healing: num(heal.wrong_patches) },
    { metric: 'MTTR median / p95 (s)', baseline: `${secs(base.mttr_median)} / ${secs(base.mttr_p95)}`, healing: `${secs(heal.mttr_median)} / ${secs(heal.mttr_p95)}` },
    { metric: 'T_heal / T_base', baseline: num(base.t_base), healing: num(heal.t_heal) },
    { metric: 'Token ratio', baseline: '—', healing: heal.t_ratio ? heal.t_ratio.toFixed(3) : 'n/a' },
    { metric: 'Total task tokens', baseline: num(base.tokens_total), healing: num(heal.tokens_total) },
    { metric: 'Schema attempts before stop', baseline: num(base.schema_attempts), healing: num(heal.schema_attempts) },
    { metric: 'Failures', baseline: num(base.failures), healing: num(heal.failures) },
  ]
}

const ROW_COLUMNS: Column<Row>[] = [
  { key: 'metric', header: 'Metric' },
  { key: 'baseline', header: 'Baseline' },
  { key: 'healing', header: 'Self-Healing' },
]

export function ResultsPage() {
  const metrics = useApi(() => api.metrics(), [])

  if (metrics.loading) return <LoadingState label="Loading metrics…" />
  if (metrics.error) return <ErrorState message={metrics.error} onRetry={metrics.reload} />

  const data = metrics.data!
  if (!data.available || !data.agents) {
    return (
      <div className="page">
        <h1>Results &amp; Metrics</h1>
        <EmptyState message="No results yet." hint="Run the suite (Agent Comparison) to populate metrics from real runs." />
      </div>
    )
  }

  const baseline: AgentMetrics | undefined = data.agents.baseline
  const healing: AgentMetrics | undefined = data.agents.healing
  const baseOverall = baseline?.overall ?? { available: false }
  const healOverall = healing?.overall ?? { available: false }

  const styles = Array.from(
    new Set([...Object.keys(baseline?.by_error_style ?? {}), ...Object.keys(healing?.by_error_style ?? {})]),
  )
  const chartData: ChartDatum[] = styles.map((style) => ({
    name: style,
    baseline: baseline?.by_error_style?.[style]?.recovered ?? 0,
    healing: healing?.by_error_style?.[style]?.recovered ?? 0,
  }))

  const styleRows = styles.map((style) => ({
    style,
    base: baseline?.by_error_style?.[style],
    heal: healing?.by_error_style?.[style],
  }))

  const healingPaths = Object.keys(healing?.by_healing_path ?? {})

  return (
    <div className="page">
      <h1>Results &amp; Metrics</h1>

      <Card title="Baseline vs Self-Healing">
        <DataTable columns={ROW_COLUMNS} rows={buildRows(baseOverall, healOverall)} />
      </Card>

      <Card title="By error style">
        <DataTable
          columns={[
            { key: 'style', header: 'Error style' },
            { key: 'base_ztar', header: 'Baseline ZTAR', render: (r) => pct(r.base?.ztar) },
            { key: 'heal_ztar', header: 'Healing ZTAR', render: (r) => pct(r.heal?.ztar) },
            { key: 'base_mttr', header: 'Baseline MTTR (med)', render: (r) => secs(r.base?.mttr_median) },
            { key: 'heal_mttr', header: 'Healing MTTR (med)', render: (r) => secs(r.heal?.mttr_median) },
          ]}
          rows={styleRows}
        />
      </Card>

      <Card title="Success by error style">
        <MetricsChart data={chartData} />
      </Card>

      <Card title="Healing paths">
        <DataTable
          columns={[
            { key: 'path', header: 'Path' },
            { key: 'n', header: 'Runs', render: (r) => num(healing?.by_healing_path?.[r.path]?.n) },
            { key: 'mttr', header: 'MTTR median', render: (r) => secs(healing?.by_healing_path?.[r.path]?.mttr_median) },
          ]}
          rows={healingPaths.map((path) => ({ path }))}
        />
      </Card>

      <footer className="results-footer muted">
        Records: {num(data.n_records)} · Held-out cases are reported separately under{' '}
        <code>by_split</code>. No number here is estimated; all come from real run records.
      </footer>
    </div>
  )
}
