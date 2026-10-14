import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Chip, PageHead, Panel, SeamStrip } from '../components/console'
import { ErrorState, LoadingState } from '../components/StateViews'
import { DASH, clockTime, num, pct, secs, shortHash } from '../utils/format'
import type { RunRecord } from '../types'

function AgentColumn({ record, kind }: { record: RunRecord | null; kind: 'baseline' | 'healing' }) {
  const healing = kind === 'healing'
  const tone = healing ? 'ok' : 'bad'
  const mttr = record && record.t_break !== null && record.t_recovery !== null
    ? record.t_recovery - record.t_break
    : null
  return (
    <div className="panel" style={{ background: 'var(--c-container)' }}>
      <div className="panel-head">
        <span className="con-row" style={{ gap: '0.5rem' }}>
          <span className={`con-dot ${healing ? 'con-dot-ok' : 'con-dot-down'}`} style={{ borderRadius: 0 }} />
          <span style={{ fontSize: 14 }}>{healing ? 'Self-healing Agent (Reflex)' : 'Baseline Agent'}</span>
        </span>
        <Chip tone={tone}>{(record?.outcome ?? 'no data').toString()}</Chip>
      </div>
      <div className="panel-body" style={{ padding: '0.75rem' }}>
        <div className="con-kv">
          <div>
            <dt>Attempts</dt>
            <dd>{record ? num(record.attempts) : DASH}</dd>
          </div>
          <div>
            <dt>{healing ? 'MTTR (recovery)' : 'Recovery'}</dt>
            <dd className={healing ? 'con-accent' : 'con-bad'}>
              {healing ? secs(mttr) : record?.outcome === 'recovered' ? secs(mttr) : 'n/a (unhandled)'}
            </dd>
          </div>
          <div>
            <dt>Schema attempts</dt>
            <dd>{record ? num(record.schema_attempts) : DASH}</dd>
          </div>
          <div>
            <dt>Tokens consumed</dt>
            <dd>{record ? num(record.tokens_total) : DASH}</dd>
          </div>
          <div>
            <dt>Healing path</dt>
            <dd>{record?.healing_path ?? DASH}</dd>
          </div>
          <div>
            <dt>Payload reached server</dt>
            <dd className={record?.server_payload_ok ? 'con-accent' : 'con-bad'}>
              {record ? (record.server_payload_ok ? 'YES' : 'NO') : DASH}
            </dd>
          </div>
        </div>

        <div className="con-log" style={{ marginTop: '0.75rem' }}>
          <div style={{ color: 'var(--c-on-variant)', marginBottom: 4 }}>
            &gt; {healing ? 'REFLEX SUTURE INTERCEPT [DAEMON]' : 'TRACEBACK DUMP [AGENT]'}:
          </div>
          {record ? (
            <>
              <div>outcome: {record.outcome}</div>
              <div className={healing ? 'con-accent' : 'con-bad'}>
                reason: {record.reason_code ?? 'none'}
              </div>
              <div>
                case: {record.case_id} · repeat #{record.repeat} · split {record.split}
              </div>
            </>
          ) : (
            <div className="con-muted">no run recorded</div>
          )}
        </div>

        <div style={{ marginTop: '0.75rem' }}>
          <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <span className="con-label">Execution continuum</span>
            <span className={`con-mono ${healing && record?.outcome === 'recovered' ? 'con-accent' : 'con-bad'}`} style={{ fontSize: 10 }}>
              {record?.outcome === 'recovered' ? `SUTURED` : 'TERMINATED'}
            </span>
          </div>
          <SeamStrip variant={healing && record?.outcome === 'recovered' ? 'healed' : 'fault'} />
        </div>
      </div>
    </div>
  )
}

export function Dashboard() {
  const status = useApi(() => api.status(), [])
  const metrics = useApi(() => api.metrics(), [])

  if (status.loading) return <LoadingState label="Loading overview…" />
  if (status.error) return <ErrorState message={status.error} onRetry={status.reload} />

  const data = status.data!
  const records = data.last_run?.records ?? []
  const baseline = records.find((r) => r.agent === 'baseline') ?? null
  const healing = records.find((r) => r.agent === 'healing') ?? null
  const summary = metrics.data?.agents?.healing?.overall
  const version = data.schema_version
  const previous = version !== null && version !== undefined ? Math.max(1, version - 1) : null

  return (
    <div className="con-page">
      <PageHead
        eyebrow={
          <>
            <span className="con-dot con-dot-ok" style={{ borderRadius: 0 }} />
            Registry status // live observation
          </>
        }
        title="Overview"
        right={
          <>
            <span className="con-label">Poll interval: 500ms</span>
            <button className="cbtn" onClick={() => { status.reload(); metrics.reload() }}>
              <span className="msym msym-13">sync</span> Refresh
            </button>
          </>
        }
      />

      <Panel
        title={
          <span className="con-row" style={{ gap: '0.5rem' }}>
            <span className="msym msym-13 con-accent">grain</span>
            Schema continuum // seam trace engine
          </span>
        }
        actions={<span className="con-label">pipeline: deterministic · current cycle</span>}
      >
        <div style={{ overflowX: 'auto' }}>
          <div className="seam" style={{ minWidth: 620, padding: '0.5rem 0' }}>
            <div className="seam-col">
              <span className="seam-node" />
              <span className="con-mono" style={{ fontSize: 11 }}>
                v{previous ?? DASH} · baseline
              </span>
            </div>
            <span className="seam-line" />
            <div className="seam-col">
              <Chip tone="ok">patched in {secs(summary?.mttr_median ?? null)}</Chip>
              <span className="seam">
                <span className="seam-fault">
                  <span className="seam-cap" />
                  <span className="seam-gap" />
                </span>
                <span className="seam-stitches">
                  <span className="seam-stitch" />
                  <span className="seam-stitch" />
                  <span className="seam-stitch" />
                  <span className="seam-stitch" />
                </span>
              </span>
              <span className="con-mono con-accent" style={{ fontSize: 10 }}>
                SUTURE ADAPTATION
              </span>
            </div>
            <span className="seam-line seam-line-ok" />
            <div className="seam-col">
              <span className="seam-node seam-node-ok" />
              <span className="con-mono con-accent" style={{ fontSize: 11 }}>
                v{version ?? DASH} · current active
              </span>
            </div>
            <span className="seam-line" style={{ background: 'transparent', borderTop: '1px dashed var(--c-outline-variant)' }} />
            <div className="seam-col">
              <span className="seam-node seam-node-pending" />
              <span className="con-mono con-muted" style={{ fontSize: 11 }}>
                staged target
              </span>
            </div>
          </div>
        </div>
        <div className="con-row" style={{ justifyContent: 'space-between', marginTop: '1rem', borderTop: '1px solid var(--c-outline-variant)', paddingTop: '0.5rem' }}>
          <span className="con-label">Continuous (healthy) · suture bridge (healed) · fracture / revision fault</span>
          <span className="con-label">
            stability: {summary?.available ? `${num(summary.wrong_patches)} wrong patches` : 'no runs yet'}
          </span>
        </div>
      </Panel>

      <div className="stat-row">
        <div className="stat-block">
          <div>
            <div className="con-label">Schema version</div>
            <div className="stat-big">v{version ?? DASH}</div>
          </div>
          <div className="stat-foot">
            <span>active registry snapshot</span>
            <span className="con-dot con-dot-ok" style={{ borderRadius: 0 }} />
          </div>
        </div>
        <div className="stat-block">
          <div>
            <div className="con-label">Schema hash</div>
            <div className="con-mono" style={{ fontSize: 13, letterSpacing: '0.1em', marginTop: 8 }}>
              {shortHash(data.schema_hash ?? undefined, 12)}
            </div>
          </div>
          <div className="stat-foot">
            <span>sha256 · canonical json</span>
            <span className="msym msym-13">lock</span>
          </div>
        </div>
        <div className="stat-block">
          <div>
            <div className="con-label">System architecture</div>
            <div className="con-mono con-accent" style={{ fontSize: 18, marginTop: 4 }}>
              mock {data.mock_api_reachable ? 'up' : 'down'} · control {data.control_api === 'ok' ? 'up' : 'down'}
            </div>
          </div>
          <div className="stat-foot">
            <span>LLM configured: {data.llm_configured ? 'yes' : 'no'}</span>
            <Chip tone={data.llm_configured ? 'ok' : 'warn'}>{data.llm_configured ? 'LIVE' : 'STANDBY'}</Chip>
          </div>
        </div>
        <div className="stat-block">
          <div>
            <div className="con-label">Zero-touch adaptation</div>
            <div className="stat-big">{summary?.available ? pct(summary.ztar, 0) : DASH}</div>
          </div>
          <div className="stat-foot">
            <span className="con-accent">
              {summary?.available
                ? `${num(summary.correct_refusals)} correct refusals · ${num(summary.wrong_patches)} wrong patches`
                : 'no runs yet'}
            </span>
            <span className="msym msym-13 con-accent">verified</span>
          </div>
        </div>
      </div>

      <Panel
        title={
          <span className="con-row" style={{ gap: '0.5rem' }}>
            <span className="con-dot con-dot-ok" style={{ borderRadius: 0 }} />
            Latest comparison run {data.last_run ? `#${data.last_run.run_id}` : '— none yet'}
          </span>
        }
        actions={
          <span className="con-label">
            case: {data.last_run ? data.last_run.case_ids.join(', ') : DASH}
            {data.last_run?.finished_at ? ` · ${clockTime(data.last_run.finished_at)}` : ''}
          </span>
        }
      >
        {data.last_run ? (
          <div className="con-grid-2">
            <AgentColumn record={baseline} kind="baseline" />
            <AgentColumn record={healing} kind="healing" />
          </div>
        ) : (
          <div className="state state-empty">
            <strong>No runs yet.</strong>
            <span>Go to Agent Comparison to start one.</span>
          </div>
        )}
      </Panel>

      <div className="panel-foot" style={{ border: '1px solid var(--c-outline-variant)', background: 'var(--c-low)', padding: '0.75rem 1rem' }}>
        <span className="con-row" style={{ gap: '0.5rem' }}>
          <span className="msym msym-13">tune</span>
          <span style={{ textTransform: 'none', letterSpacing: 0 }}>Figures come only from runs recorded by the control API.</span>
        </span>
        <span className="con-row" style={{ gap: '0.5rem' }}>
          <span className="con-label">Need a fresh benchmark?</span>
          <Link className="con-accent con-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }} to="/console/compare">
            Open Agent Comparison →
          </Link>
        </span>
      </div>
    </div>
  )
}
