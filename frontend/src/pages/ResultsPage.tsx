import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { PageHead, Panel } from '../components/console'
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews'
import { StatCard } from '../components/StatCard'
import {
  IconActivity,
  IconBarChart,
  IconCheck,
  IconInfo,
  IconRefresh,
  IconShieldCheck,
} from '../components/ui/Icons'
import { deltaPct, num, pct, secs } from '../utils/format'
import type { MetricSummary } from '../types'

function MttrDistributionPlot({
  median,
  p95,
}: {
  median: number | null
  p95: number | null
}) {
  const MAX_SEC = 5.0
  const LEFT_PAD = 60
  const RIGHT_PAD = 940
  const WIDTH = RIGHT_PAD - LEFT_PAD

  const scaleX = (v: number) => {
    const clamped = Math.min(MAX_SEC, Math.max(0, v))
    return LEFT_PAD + (clamped / MAX_SEC) * WIDTH
  }

  const psTargetX = scaleX(4.0)
  const medianX = median !== null ? scaleX(median) : null
  const p95X = p95 !== null ? scaleX(p95) : null

  // Prevent text overlap if median and p95 are very close
  const isClose = medianX !== null && p95X !== null && Math.abs(medianX - p95X) < 90

  return (
    <div style={{ width: '100%' }}>
      <svg
        viewBox="0 0 1000 170"
        style={{ width: '100%', height: 'auto', display: 'block' }}
        fill="none"
        role="img"
        aria-label={`Recovery time distribution. Median ${median !== null ? `${median.toFixed(3)} seconds` : 'unknown'}, p95 ${p95 !== null ? `${p95.toFixed(3)} seconds` : 'unknown'}, target 4 seconds.`}
      >
        <line x1={LEFT_PAD} x2={RIGHT_PAD} y1={115} y2={115} stroke="var(--hairline-2)" strokeWidth={2} />

        <line
          x1={psTargetX}
          x2={psTargetX}
          y1={28}
          y2={125}
          stroke="var(--warning-strong)"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
        <text
          x={psTargetX}
          y={20}
          fill="var(--warning-strong)"
          fontFamily="var(--font-sans)"
          fontSize={12}
          fontWeight={600}
          textAnchor="middle"
        >
          Target 4s
        </text>

        {[0, 1, 2, 3, 4, 5].map((t) => {
          const x = scaleX(t)
          return (
            <g key={t}>
              <line x1={x} x2={x} y1={115} y2={122} stroke="var(--faint)" strokeWidth={1.5} />
              <text
                x={x}
                y={140}
                fill="var(--muted)"
                fontFamily="var(--font-mono)"
                fontSize={12}
                textAnchor="middle"
              >
                {t.toFixed(0)}s
              </text>
            </g>
          )
        })}

        {median !== null && medianX !== null && (
          <g>
            <line x1={medianX} x2={medianX} y1={88} y2={108} stroke="var(--navy)" strokeWidth={1.5} />
            <circle cx={medianX} cy={115} r={7} fill="var(--navy)" stroke="var(--surface)" strokeWidth={2} />
            <text
              x={medianX}
              y={isClose ? 62 : 76}
              fill="var(--navy)"
              fontFamily="var(--font-mono)"
              fontSize={12}
              fontWeight={700}
              textAnchor="middle"
            >
              Median {median.toFixed(3)}s
            </text>
          </g>
        )}

        {p95 !== null && p95X !== null && (
          <g>
            <line x1={p95X} x2={p95X} y1={88} y2={108} stroke="var(--success-strong)" strokeWidth={1.5} />
            <circle cx={p95X} cy={115} r={6} fill="var(--success)" stroke="var(--surface)" strokeWidth={2} />
            <text
              x={p95X}
              y={isClose ? 40 : 76}
              fill="var(--success-strong)"
              fontFamily="var(--font-mono)"
              fontSize={12}
              fontWeight={700}
              textAnchor="middle"
            >
              p95 {p95.toFixed(3)}s
            </text>
          </g>
        )}
      </svg>

      <div
        className="con-row"
        style={{
          justifyContent: 'center',
          gap: 24,
          paddingTop: 8,
          borderTop: '1px solid var(--hairline)',
          fontSize: 12,
          flexWrap: 'wrap',
        }}
      >
        <span className="con-row" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--navy)' }} />
          <span><b>Reflex</b> median: {secs(median)}</span>
        </span>
        <span className="con-row" style={{ gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--success)' }} />
          <span><b>Reflex</b> p95: {secs(p95)}</span>
        </span>
        <span className="con-row" style={{ gap: 6 }}>
          <span style={{ width: 14, height: 0, borderTop: '2px dashed var(--warning-strong)' }} />
          <span className="text-muted">Target 4.0s</span>
        </span>
        <span className="text-muted" style={{ fontSize: 12 }}>
          Per-record medians come from the <b>Reflex</b> agent only
        </span>
      </div>
    </div>
  )
}

function TableRow({
  metric,
  base,
  heal,
  delta,
}: {
  metric: string
  base: string | React.ReactNode
  heal: string | React.ReactNode
  delta: string | React.ReactNode
}) {
  return (
    <tr>
      <td style={{ fontWeight: 500 }}>{metric}</td>
      <td className="text-muted font-mono">{base}</td>
      <td className="con-accent font-mono" style={{ fontWeight: 600 }}>{heal}</td>
      <td style={{ textAlign: 'right' }} className="con-accent font-mono">{delta}</td>
    </tr>
  )
}

export function ResultsPage() {
  const metrics = useApi(() => api.metrics(), [])

  if (metrics.loading) return <LoadingState label="Loading performance metrics…" />
  if (metrics.error) return <ErrorState message={metrics.error} onRetry={metrics.reload} />

  const data = metrics.data!
  if (!data.available || !data.agents) {
    return (
      <div className="con-page">
        <PageHead
          eyebrow="Empirical Benchmark & Evaluation"
          title="Results & Metrics"
          subtitle="Empirical benchmark metrics comparing Baseline vs Reflex."
        />
        <EmptyState
          message="No results recorded yet."
          hint="Run the benchmark test cases in Agent Comparison to record real performance telemetry."
        />
      </div>
    )
  }

  const base: MetricSummary = data.agents.baseline?.overall ?? { available: false }
  const heal: MetricSummary = data.agents.healing?.overall ?? { available: false }
  const baseStyles = data.agents.baseline?.by_error_style ?? {}
  const healStyles = data.agents.healing?.by_error_style ?? {}
  const styles = Array.from(new Set([...Object.keys(baseStyles), ...Object.keys(healStyles)]))
  const paths = Object.entries(data.agents.healing?.by_healing_path ?? {})

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Measured from recorded runs</span>}
        title="Results"
        subtitle="How Reflex compares against the baseline across every recorded run."
        right={
          <div className="con-row" style={{ gap: 12 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>
              Sample size: n = {num(data.n_records)} runs
            </span>
            <button
              type="button"
              className="cbtn cbtn-ghost"
              onClick={() => metrics.reload()}
              title="Refresh metrics from recorded runs"
            >
              <IconRefresh size={14} />
              <span>Reload</span>
            </button>
          </div>
        }
      />

      <div className="stat-row">
        <StatCard
          label="Adaptation rate"
          value={pct(heal.ztar, 0)}
          hint={
            <span>
              Baseline: {pct(base.ztar, 0)} ({deltaPct(base.ztar, heal.ztar)})
            </span>
          }
          icon={<IconCheck size={18} />}
        />

        <StatCard
          label="Median recovery time"
          value={secs(heal.mttr_median)}
          hint={
            <span>
              Target &lt;4.0s (Baseline: {base.mttr_median !== null ? secs(base.mttr_median) : 'Failed to recover'})
            </span>
          }
          icon={<IconActivity size={18} />}
        />

        <StatCard
          label="Token overhead"
          value={num(heal.tokens_total)}
          hint={
            <span>
              Baseline: {num(base.tokens_total)} tokens
            </span>
          }
          icon={<IconBarChart size={18} />}
        />

        <StatCard
          label="Safe refusals"
          value={num(heal.correct_refusals)}
          hint={
            <span className="con-row" style={{ gap: 4 }}>
              <IconShieldCheck size={13} style={{ color: 'var(--success-strong)' }} />
              <span>{num(heal.wrong_patches)} wrong patches applied</span>
            </span>
          }
          icon={<IconShieldCheck size={18} />}
        />
      </div>

      <div
        className="con-row text-muted"
        style={{
          background: 'var(--navy-soft)',
          padding: '10px 16px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--navy-border)',
          fontSize: 13,
          gap: 8,
        }}
      >
        <IconInfo size={16} />
        <span>
          Every metric below is computed from <b>n = {num(data.n_records)} recorded runs</b>. Refusals are excluded from recovery-time averages.
        </span>
      </div>

      <Panel
        title="Baseline vs Reflex scorecard"
        actions={
          <span className="text-muted" style={{ fontSize: 12 }}>
            {num(heal.n)} Reflex runs · {num(base.n)} baseline runs
          </span>
        }
      >
        <div className="table-wrap">
          <table className="ctable">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Baseline</th>
                <th>Reflex</th>
                <th style={{ textAlign: 'right' }}>Difference</th>
              </tr>
            </thead>
            <tbody>
              <TableRow
                metric="Adaptation rate"
                base={pct(base.ztar)}
                heal={pct(heal.ztar)}
                delta={deltaPct(base.ztar, heal.ztar)}
              />
              <TableRow
                metric="Correct refusals"
                base={num(base.correct_refusals)}
                heal={num(heal.correct_refusals)}
                delta={(heal.correct_refusals ?? 0) > (base.correct_refusals ?? 0) ? `+${(heal.correct_refusals ?? 0) - (base.correct_refusals ?? 0)}` : '0'}
              />
              <TableRow
                metric="Wrong patches"
                base={num(base.wrong_patches)}
                heal={num(heal.wrong_patches)}
                delta={String(Math.max(0, (base.wrong_patches ?? 0) - (heal.wrong_patches ?? 0)))}
              />
              <TableRow
                metric="Median recovery time"
                base={base.mttr_median !== null ? secs(base.mttr_median) : <span style={{ color: 'var(--brand-text, #e08073)' }}>Failed (no recovery)</span>}
                heal={secs(heal.mttr_median)}
                delta={base.mttr_median != null ? secs((heal.mttr_median ?? 0) - base.mttr_median) : '—'}
              />
              <TableRow
                metric="p95 recovery time"
                base={base.mttr_p95 !== null ? secs(base.mttr_p95) : <span style={{ color: 'var(--brand-text, #e08073)' }}>Failed (no recovery)</span>}
                heal={secs(heal.mttr_p95)}
                delta={base.mttr_p95 != null ? secs((heal.mttr_p95 ?? 0) - base.mttr_p95) : '—'}
              />
              <TableRow
                metric="Total tokens used"
                base={num(base.tokens_total)}
                heal={num(heal.tokens_total)}
                delta={
                  base.tokens_total
                    ? String(Math.max(0, (base.tokens_total ?? 0) - (heal.tokens_total ?? 0)))
                    : '0'
                }
              />
              <TableRow
                metric="Schema attempts before stop"
                base={num(base.schema_attempts)}
                heal={num(heal.schema_attempts)}
                delta={
                  base.schema_attempts
                    ? String(Math.max(0, (base.schema_attempts ?? 0) - (heal.schema_attempts ?? 0)))
                    : '0'
                }
              />
              <TableRow
                metric="Unrecovered failures"
                base={num(base.failures)}
                heal={num(heal.failures)}
                delta={String(Math.max(0, (base.failures ?? 0) - (heal.failures ?? 0)))}
              />
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Adaptation by error style"
        actions={
          <span className="text-muted" style={{ fontSize: 12 }}>
            Clear, vague, and empty error responses
          </span>
        }
      >
        <div className="con-grid-3">
          {styles.map((style) => {
            const b = baseStyles[style]
            const h = healStyles[style]
            const basePct = Math.round((b?.ztar ?? 0) * 100)
            const healPct = Math.round((h?.ztar ?? 0) * 100)
            return (
              <div
                key={style}
                className="card"
                style={{
                  padding: 20,
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {style} errors
                  </span>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {h?.n ?? 0} runs
                  </span>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                    <span style={{ fontWeight: 600, color: 'var(--muted)' }}>
                      Baseline success {basePct}%
                    </span>
                    <span className="font-mono text-muted">{b?.mttr_median !== null && b?.mttr_median !== undefined ? secs(b.mttr_median) : 'Failed (0s)'}</span>
                  </div>
                  <div
                    style={{
                      height: 10,
                      background: 'var(--surface-3)',
                      borderRadius: 5,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${basePct}%`,
                        background: 'var(--faint)',
                        borderRadius: 5,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 4, fontSize: 12 }}>
                    <span style={{ fontWeight: 600, color: 'var(--success-strong)' }}>
                      Reflex success {healPct}%
                    </span>
                    <span className="font-mono con-accent">{secs(h?.mttr_median)}</span>
                  </div>
                  <div
                    style={{
                      height: 10,
                      background: 'var(--surface-3)',
                      borderRadius: 5,
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${healPct}%`,
                        background: 'var(--success)',
                        borderRadius: 5,
                      }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel
        title="Recovery method"
        actions={
          <span className="text-muted" style={{ fontSize: 12 }}>
            Repair path as recorded on each entry
          </span>
        }
      >
        {paths.length === 0 ? (
          <EmptyState message="No healing-method data recorded yet." />
        ) : (
          <div className="table-wrap">
            <table className="ctable">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Runs</th>
                  <th>Adaptation rate</th>
                  <th>Avg recovery</th>
                  <th style={{ textAlign: 'right' }}>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {paths.map(([path, summary]) => (
                  <tr key={path}>
                    <td>
                      <b>{path === 'rule' ? 'Rule-based repair' : path === 'llm' ? 'Model-assisted repair' : path}</b>
                    </td>
                    <td className="text-muted font-mono">{num(summary.n)}</td>
                    <td className="con-accent font-mono" style={{ fontWeight: 600 }}>{pct(summary.ztar)}</td>
                    <td className="font-mono">{secs(summary.mttr_median)}</td>
                    <td style={{ textAlign: 'right' }} className="font-mono text-muted">{num(summary.tokens_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Recovery time distribution"
        actions={
          <span className="text-muted" style={{ fontSize: 12 }}>
            Recorded recovery runs only
          </span>
        }
        footer={
          <>
            <span>Range 0.0s – 5.0s · target marked at 4.0s</span>
            <span>Refusals excluded from recovery time</span>
          </>
        }
      >
        <MttrDistributionPlot
          median={heal.mttr_median ?? null}
          p95={heal.mttr_p95 ?? null}
        />
      </Panel>
    </div>
  )
}
