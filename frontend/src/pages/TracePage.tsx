import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { useRunEvents } from '../hooks/useRunEvents'
import { Chip, PageHead, Panel } from '../components/console'
import { EventTimeline } from '../components/EventTimeline'
import { EmptyState } from '../components/StateViews'
import { DASH, num, relTime } from '../utils/format'

type Filter = 'all' | 'baseline' | 'healing'

function runTone(status: string): 'ok' | 'bad' | 'warn' | 'mute' {
  if (status === 'finished') return 'ok'
  if (status === 'error') return 'bad'
  if (status === 'running') return 'warn'
  return 'mute'
}

export function TracePage() {
  const { runId } = useParams<{ runId: string }>()
  const runs = useApi(() => api.listRuns(), [])
  const [selected, setSelected] = useState<string | undefined>(runId)
  const [filter, setFilter] = useState<Filter>('all')
  const active = runId ?? selected
  const { events, status } = useRunEvents(active)

  const activeRun = runs.data?.runs.find((r) => r.run_id === active) ?? null
  const healingRecord = activeRun?.records.find((r) => r.agent === 'healing') ?? null
  const duration = healingRecord && healingRecord.t_break !== null && healingRecord.t_recovery !== null
    ? `${Math.round((healingRecord.t_recovery - healingRecord.t_break) * 1000)}ms`
    : DASH

  return (
    <div className="con-page">
      <PageHead
        eyebrow={
          <>
            <span>System telemetry</span>
            <span className="con-muted">//</span>
            <span>forensic audit</span>
            <span className="con-muted">·</span>
            <span className="con-accent">run_id: {active ?? DASH}</span>
          </>
        }
        title="Trace"
        right={
          <>
            <div className="csegment" style={{ gridAutoFlow: 'row' }}>
              {(['all', 'baseline', 'healing'] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
            <Link className="cbtn" to="/console/compare">
              Back to comparison <span className="msym msym-13">arrow_forward</span>
            </Link>
          </>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 9fr', gap: '1.25rem', alignItems: 'start' }}>
        <Panel title="Recorded runs" actions={<Chip tone="mute">{runs.data?.runs.length ?? 0} runs</Chip>}>
          {runs.data && runs.data.runs.length === 0 ? (
            <EmptyState message="No runs recorded." hint="Start a comparison to populate the ledger." />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {runs.data?.runs.map((run) => {
                const healing = run.records.find((r) => r.agent === 'healing')
                const on = run.run_id === active
                return (
                  <button
                    key={run.run_id}
                    onClick={() => setSelected(run.run_id)}
                    style={{
                      textAlign: 'left',
                      padding: '0.75rem',
                      cursor: 'pointer',
                      borderLeft: `2px solid ${on ? 'var(--c-primary)' : 'transparent'}`,
                      borderBottom: '1px solid var(--c-outline-variant)',
                      background: on ? 'var(--c-container)' : 'transparent',
                      color: 'inherit',
                      font: 'inherit',
                    }}
                  >
                    <div className="con-row" style={{ justifyContent: 'space-between' }}>
                      <span className="con-mono" style={{ fontSize: 11, letterSpacing: '0.06em' }}>{run.run_id}</span>
                      <Chip tone={healing ? (healing.outcome === 'recovered' ? 'ok' : 'bad') : runTone(run.status)}>
                        {healing?.outcome ?? run.status}
                      </Chip>
                    </div>
                    <div className="con-row" style={{ justifyContent: 'space-between', marginTop: 4 }}>
                      <span className="con-label" style={{ textTransform: 'none', letterSpacing: 0 }}>{run.case_ids.join(', ')}</span>
                      <span className="con-label">{relTime(run.started_at)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Panel>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <Panel
            title={activeRun ? `Run ${activeRun.run_id}` : 'No run selected'}
            actions={
              activeRun ? (
                <>
                  <Chip tone="mute">case: {activeRun.case_ids.join(', ')}</Chip>
                  <Chip tone="mute">duration: {duration}</Chip>
                  <Chip tone="mute">tokens: {num(healingRecord?.tokens_total ?? null)}</Chip>
                  <Chip tone={healingRecord?.outcome === 'recovered' ? 'ok' : 'bad'}>
                    status: {healingRecord?.outcome ?? activeRun.status}
                  </Chip>
                </>
              ) : null
            }
          >
            {active ? (
              <EventTimeline events={events} filter={filter} />
            ) : (
              <EmptyState message="No run selected." hint="Pick a run from the list or start a comparison." />
            )}
          </Panel>

          <div className="panel-foot" style={{ border: '1px solid var(--c-outline-variant)', background: 'var(--c-low)', padding: '0.75rem 1rem' }}>
            <span className="con-row" style={{ gap: '0.5rem' }}>
              <span className="con-label">Refusal notation</span>
              <span style={{ textTransform: 'none', letterSpacing: 0 }}>
                When a violation cannot be resolved from available evidence, the timeline terminates with a refusal event.
              </span>
            </span>
            <span className="con-label con-warn">stream: {status}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
