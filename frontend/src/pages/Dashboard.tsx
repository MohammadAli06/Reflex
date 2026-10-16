import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { PageHead, Panel } from '../components/console'
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews'
import { StatCard } from '../components/StatCard'
import { CopyButton } from '../components/ui/CopyButton'
import {
  IconActivity,
  IconArrowRight,
  IconBarChart,
  IconCheck,
  IconDatabase,
  IconPlay,
  IconRefresh,
  IconShieldCheck,
} from '../components/ui/Icons'
import { DASH, clockTime, num, pct, secs } from '../utils/format'
import type { RunRecord } from '../types'

function AgentSummaryCard({
  record,
  kind,
}: {
  record: RunRecord | null
  kind: 'baseline' | 'healing'
}) {
  const healing = kind === 'healing'
  const isRecovered = record?.outcome === 'recovered'
  const isRefused = record?.outcome === 'refused'

  const mttr = record && record.t_break !== null && record.t_recovery !== null
    ? record.t_recovery - record.t_break
    : null

  return (
    <div className="card" style={{ padding: 20, background: 'var(--surface)' }}>
      <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>
          {healing ? 'Reflex' : 'Baseline'}
        </h3>

        {record ? (
          <span
            className={`badge badge-${
              isRecovered ? 'success' : isRefused ? 'warning' : 'failure'
            }`}
          >
            {record.outcome}
          </span>
        ) : (
          <span className="badge badge-neutral">No run yet</span>
        )}
      </div>

      <div className="con-kv" style={{ fontSize: 13 }}>
        <div>
          <dt>Attempts</dt>
          <dd>{record ? num(record.attempts) : DASH}</dd>
        </div>
        <div>
          <dt>{healing ? 'Recovery time' : 'Result'}</dt>
          <dd className={healing && isRecovered ? 'con-accent' : 'con-bad'}>
            {healing ? secs(mttr) : record?.outcome === 'recovered' ? secs(mttr) : 'Unrecovered'}
          </dd>
        </div>
        <div>
          <dt>Schema checks</dt>
          <dd>{record ? num(record.schema_attempts) : DASH}</dd>
        </div>
        <div>
          <dt>Tokens used</dt>
          <dd>{record ? num(record.tokens_total) : DASH}</dd>
        </div>
        <div>
          <dt>Repair method</dt>
          <dd>{record?.healing_path ?? DASH}</dd>
        </div>
        <div>
          <dt>Upstream check</dt>
          <dd className={record?.server_payload_ok ? 'con-accent' : 'con-bad'}>
            {record ? (record.server_payload_ok ? 'Passed' : 'Failed') : DASH}
          </dd>
        </div>
      </div>

      {record && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 10,
            borderTop: '1px solid var(--hairline)',
            fontSize: 12,
            color: 'var(--muted)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>Case: <b>{record.case_id}</b></span>
          <span className="font-mono">
            {record.reason_code ? `Reason: ${record.reason_code}` : 'No errors'}
          </span>
        </div>
      )}
    </div>
  )
}

export function Dashboard() {
  const status = useApi(() => api.status(), [])
  const metrics = useApi(() => api.metrics(), [])

  if (status.loading) return <LoadingState label="Loading registry dashboard…" />
  if (status.error) return <ErrorState message={status.error} onRetry={status.reload} />

  const data = status.data!
  const records = data.last_run?.records ?? []
  const baseline = records.find((r) => r.agent === 'baseline') ?? null
  const healing = records.find((r) => r.agent === 'healing') ?? null
  const summary = metrics.data?.agents?.healing?.overall
  const version = data.schema_version
  const sampleN = summary?.available ? summary.n : null

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Registry health at a glance</span>}
        title="Dashboard"
        subtitle="Recovery performance, current schema, and the most recent run."
        right={
          <div className="con-row" style={{ gap: 12 }}>
            <button
              type="button"
              className="cbtn cbtn-ghost"
              onClick={() => {
                status.reload()
                metrics.reload()
              }}
              title="Refresh telemetry"
            >
              <IconRefresh size={14} />
              <span>Refresh</span>
            </button>

            <Link
              to="/console/compare"
              className="cbtn cbtn-primary"
              style={{ padding: '8px 18px' }}
            >
              <IconPlay size={14} />
              <span>Run demo</span>
            </Link>
          </div>
        }
      />

      <div className="stat-row">
        <StatCard
          label="Adaptation rate"
          value={summary?.available ? pct(summary.ztar, 0) : '—'}
          hint={
            <span>
              Share of breaking changes repaired automatically{sampleN !== null ? ` · n = ${num(sampleN)}` : ''}
            </span>
          }
          icon={<IconCheck size={18} />}
        />

        <StatCard
          label="Median recovery time"
          value={summary?.available ? secs(summary.mttr_median) : '—'}
          hint={
            <span>
              Break to verified fix{sampleN !== null ? ` · n = ${num(sampleN)}` : ''}
            </span>
          }
          icon={<IconActivity size={18} />}
        />

        <StatCard
          label="Token overhead"
          value={summary?.available ? num(summary.tokens_total) : '0'}
          hint={
            <span>
              Model calls used during repair{sampleN !== null ? ` · n = ${num(sampleN)}` : ''}
            </span>
          }
          icon={<IconBarChart size={18} />}
        />

        <StatCard
          label="Safe refusals"
          value={summary?.available ? num(summary.correct_refusals) : '—'}
          hint={
            <span>
              Stopped rather than guessed{sampleN !== null ? ` · n = ${num(sampleN)}` : ''}
            </span>
          }
          icon={<IconShieldCheck size={18} />}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 className="text-h2" style={{ fontSize: 15 }}>
                System status
              </h2>
              <span className="text-muted" style={{ fontSize: 12 }}>
                {data.mock_api_reachable && data.control_api === 'ok' ? 'All systems running' : 'Check services'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div
                className="con-row"
                style={{
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--hairline)',
                }}
              >
                <span style={{ fontWeight: 500 }}>Mock API</span>
                <span className="con-row" style={{ gap: 8 }}>
                  <span className={`con-dot ${data.mock_api_reachable ? 'con-dot-ok' : 'con-dot-down'}`} />
                  <span className="font-mono" style={{ fontSize: 12 }}>
                    {data.mock_api_reachable ? 'Reachable' : 'Unreachable'}
                  </span>
                </span>
              </div>

              <div
                className="con-row"
                style={{
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--hairline)',
                }}
              >
                <span style={{ fontWeight: 500 }}>Control API</span>
                <span className="con-row" style={{ gap: 8 }}>
                  <span className={`con-dot ${data.control_api === 'ok' ? 'con-dot-ok' : 'con-dot-down'}`} />
                  <span className="font-mono" style={{ fontSize: 12 }}>
                    {data.control_api === 'ok' ? 'OK' : 'Down'}
                  </span>
                </span>
              </div>

              <div
                className="con-row"
                style={{ justifyContent: 'space-between', padding: '8px 0' }}
              >
                <span style={{ fontWeight: 500 }}>Repair engine</span>
                <span className="con-row" style={{ gap: 8 }}>
                  <span className="con-dot con-dot-neutral" />
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {data.llm_configured ? 'Model-assisted' : 'Rule-based'}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div
            style={{
              marginTop: 18,
              paddingTop: 12,
              borderTop: '1px solid var(--hairline)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
            }}
          >
            <span className="con-row" style={{ gap: 6 }}>
              <IconDatabase size={14} style={{ color: 'var(--muted)' }} />
              <span>Schema <b>v{version ?? '—'}</b></span>
            </span>
            <CopyButton text={data.schema_hash ?? null} truncateLength={10} />
          </div>
        </div>

        <div className="card" style={{ padding: 24, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <h2 className="serif" style={{ fontSize: 24, fontWeight: 500, margin: '0 0 8px', letterSpacing: '-0.01em' }}>
              See a repair happen
            </h2>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
              Replay a breaking schema change against both agents and watch Reflex diagnose, patch, and verify — or stop safely when it can&apos;t.
            </p>
          </div>

          <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link
              to="/console/compare"
              className="cbtn cbtn-primary"
              style={{ padding: '10px 22px', fontSize: 14 }}
            >
              <span>Run the demo</span>
              <IconArrowRight size={16} />
            </Link>
            <Link
              to="/console/safety"
              className="cbtn cbtn-ghost"
              style={{ fontSize: 13 }}
            >
              <span>How safety works</span>
            </Link>
          </div>
        </div>
      </div>

      <Panel
        title={
          <div className="con-row" style={{ gap: 8 }}>
            <span>Last run</span>
            {data.last_run && (
              <span className="font-mono text-muted" style={{ fontSize: 13 }}>
                {String(data.last_run.run_id).slice(0, 12)}…
              </span>
            )}
          </div>
        }
        actions={
          data.last_run ? (
            <div className="con-row" style={{ gap: 8, fontSize: 12, color: 'var(--muted)' }}>
              <span>Case: <b>{data.last_run.case_ids.join(', ')}</b></span>
              {data.last_run.finished_at && (
                <span>· Finished {clockTime(data.last_run.finished_at)}</span>
              )}
            </div>
          ) : null
        }
      >
        {data.last_run ? (
          <div className="con-grid-2">
            <AgentSummaryCard record={baseline} kind="baseline" />
            <AgentSummaryCard record={healing} kind="healing" />
          </div>
        ) : (
          <EmptyState
            message="No run yet"
            hint="Run the demo from the comparison page to see live results here."
          />
        )}
      </Panel>
    </div>
  )
}
