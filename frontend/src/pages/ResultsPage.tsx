import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Chip, PageHead, Panel } from '../components/console'
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews'
import { DASH, deltaPct, num, pct, secs } from '../utils/format'
import type { MetricSummary } from '../types'

function StripPlot({ median, p95 }: { median: number | null; p95: number | null }) {
  const MAX = 5
  const x = (v: number) => Math.min(1000, Math.max(0, (v / MAX) * 1000))
  return (
    <svg viewBox="0 0 1000 120" preserveAspectRatio="none" style={{ width: '100%', height: 140 }} fill="none">
      <line x1={0} x2={1000} y1={80} y2={80} stroke="#3d4a43" />
      <line x1={x(4)} x2={x(4)} y1={20} y2={90} stroke="#f3be58" strokeDasharray="3 3" />
      <text x={x(4) - 6} y={15} fill="#f3be58" fontFamily="JetBrains Mono" fontSize={10} textAnchor="end">
        PS TARGET: 4.0s
      </text>
      {[0, 1, 2, 3, 4, 5].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={80} y2={86} stroke="#87948c" />
          <text x={x(t)} y={102} fill="#87948c" fontFamily="JetBrains Mono" fontSize={10} textAnchor="middle">
            {t.toFixed(1)}s
          </text>
        </g>
      ))}
      {median !== null && (
        <g>
          <circle cx={x(median)} cy={80} r={5} fill="#7df0c0" />
          <text x={x(median)} y={66} fill="#7df0c0" fontFamily="JetBrains Mono" fontSize={10} textAnchor="middle">
            median {median.toFixed(3)}s
          </text>
        </g>
      )}
      {p95 !== null && (
        <g>
          <circle cx={x(p95)} cy={80} r={4} fill="#5fd3a5" />
          <text x={x(p95)} y={52} fill="#5fd3a5" fontFamily="JetBrains Mono" fontSize={10} textAnchor="middle">
            p95 {p95.toFixed(3)}s
          </text>
        </g>
      )}
    </svg>
  )
}

function Row({ metric, base, heal, delta }: { metric: string; base: string; heal: string; delta: string }) {
  return (
    <tr>
      <td className="con-muted">{metric}</td>
      <td className="con-muted">{base}</td>
      <td className="con-accent">{heal}</td>
      <td style={{ textAlign: 'right' }} className="con-accent">{delta}</td>
    </tr>
  )
}

export function ResultsPage() {
  const metrics = useApi(() => api.metrics(), [])

  if (metrics.loading) return <LoadingState label="Loading metrics…" />
  if (metrics.error) return <ErrorState message={metrics.error} onRetry={metrics.reload} />

  const data = metrics.data!
  if (!data.available || !data.agents) {
    return (
      <div className="con-page">
        <PageHead eyebrow="Empirical benchmark // synthetic & replay evaluation" title="Results" />
        <EmptyState message="No results yet." hint="Run the suite from Agent Comparison to populate metrics from real runs." />
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
        eyebrow={
          <>
            <span className="con-dot con-dot-ok" style={{ borderRadius: 0 }} />
            Empirical benchmark // synthetic &amp; replay evaluation
          </>
        }
        title="Results"
        right={
          <span className="con-row" style={{ gap: '0.5rem', border: '1px solid var(--c-outline-variant)', padding: '0.375rem 0.625rem' }}>
            <span className="con-dot con-dot-ok" style={{ borderRadius: 0 }} />
            <span className="con-mono" style={{ fontSize: 11 }}>N = {num(data.n_records)} records</span>
            <span className="con-muted">·</span>
            <span className="con-mono con-accent" style={{ fontSize: 11 }}>tamper-evident</span>
          </span>
        }
      />

      <div>
        <h2 style={{ fontFamily: 'var(--c-serif)', fontSize: 24, fontWeight: 400, margin: 0 }}>
          Across {num(data.n_records)} records, Reflex recovered {pct(heal.ztar)} of recoverable drift with {num(heal.wrong_patches)} wrong patches.
        </h2>
        <div className="con-label" style={{ marginTop: 8 }}>
          Sample size and held-out status shown per table · deterministic AST mode
        </div>
      </div>

      <Panel title="01 // Baseline vs Reflex scorecard" actions={<Chip tone="mute">N = {num(heal.n)} healing rows</Chip>}>
        <div style={{ overflowX: 'auto' }}>
          <table className="ctable">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Baseline</th>
                <th>Reflex</th>
                <th style={{ textAlign: 'right' }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              <Row metric="ZTAR (zero-touch adaptation rate)" base={pct(base.ztar)} heal={pct(heal.ztar)} delta={deltaPct(base.ztar, heal.ztar)} />
              <Row metric="Correct refusals" base={num(base.correct_refusals)} heal={num(heal.correct_refusals)} delta={DASH} />
              <Row metric="Wrong patches" base={num(base.wrong_patches)} heal={num(heal.wrong_patches)} delta={DASH} />
              <Row metric="MTTR median / p95" base={`${secs(base.mttr_median)} / ${secs(base.mttr_p95)}`} heal={`${secs(heal.mttr_median)} / ${secs(heal.mttr_p95)}`} delta={DASH} />
              <Row metric="T_heal / T_base" base={num(base.t_base)} heal={num(heal.t_heal)} delta={DASH} />
              <Row metric="Token ratio" base={DASH} heal={heal.t_ratio !== null && heal.t_ratio !== undefined ? heal.t_ratio.toFixed(3) : DASH} delta={DASH} />
              <Row metric="Total task tokens" base={num(base.tokens_total)} heal={num(heal.tokens_total)} delta={DASH} />
              <Row metric="Schema attempts before stop" base={num(base.schema_attempts)} heal={num(heal.schema_attempts)} delta={DASH} />
              <Row metric="Failures" base={num(base.failures)} heal={num(heal.failures)} delta={DASH} />
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="02 // Adaptation by error style">
        <div className="con-grid-3">
          {styles.map((style) => {
            const b = baseStyles[style]
            const h = healStyles[style]
            return (
              <div key={style} className="panel" style={{ background: 'var(--c-container)' }}>
                <div className="panel-body" style={{ padding: '0.75rem' }}>
                  <div className="con-row" style={{ justifyContent: 'space-between' }}>
                    <span className="con-mono" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase' }}>{style}</span>
                    <span className="con-label">{h?.n ?? 0} runs</span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div className="con-row" style={{ justifyContent: 'space-between' }}>
                      <span className="con-label">Baseline ({pct(b?.ztar)})</span>
                      <span className="con-mono con-bad" style={{ fontSize: 11 }}>{secs(b?.mttr_median)}</span>
                    </div>
                    <span className="con-bar con-bar-warn" style={{ width: '100%' }}>
                      <span style={{ width: `${(b?.ztar ?? 0) * 100}%` }} />
                    </span>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div className="con-row" style={{ justifyContent: 'space-between' }}>
                      <span className="con-label">Reflex ({pct(h?.ztar)})</span>
                      <span className="con-mono con-accent" style={{ fontSize: 11 }}>{secs(h?.mttr_median)}</span>
                    </div>
                    <span className="con-bar" style={{ width: '100%' }}>
                      <span style={{ width: `${(h?.ztar ?? 0) * 100}%` }} />
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </Panel>

      <Panel title="03 // Synthesis path performance">
        {paths.length === 0 ? (
          <EmptyState message="No healing-path data yet." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="ctable">
              <thead>
                <tr>
                  <th>Healing path</th>
                  <th>Runs</th>
                  <th>ZTAR</th>
                  <th>Avg MTTR</th>
                  <th style={{ textAlign: 'right' }}>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {paths.map(([path, summary]) => (
                  <tr key={path}>
                    <td>{path}</td>
                    <td className="con-muted">{num(summary.n)}</td>
                    <td className="con-accent">{pct(summary.ztar)}</td>
                    <td>{secs(summary.mttr_median)}</td>
                    <td style={{ textAlign: 'right' }} className="con-muted">{num(summary.tokens_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="04 // MTTR latency distribution"
        actions={<span className="con-label">median and p95 from recorded recoveries</span>}
        footer={<><span className="con-label">axis clamp: 5000ms</span><span className="con-label">refusals excluded</span></>}
      >
        <StripPlot median={heal.mttr_median ?? null} p95={heal.mttr_p95 ?? null} />
      </Panel>
    </div>
  )
}
