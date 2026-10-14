import type { RunRecord } from '../types'
import { StatusBadge, outcomeTone } from './StatusBadge'

export function AgentCard({
  agent,
  record,
  running,
}: {
  agent: string
  record: RunRecord | null
  running: boolean
}) {
  const title = agent === 'healing' ? 'Self-Healing Agent' : 'Baseline Agent'
  if (!record) {
    return (
      <div className={`card agent-card agent-${agent}`}>
        <h3>{title}</h3>
        <div className="state state-empty">{running ? 'Running…' : 'No result yet'}</div>
      </div>
    )
  }
  const mttr = record.t_break !== null && record.t_recovery !== null
    ? `${(record.t_recovery - record.t_break).toFixed(3)}s`
    : 'n/a'
  return (
    <div className={`card agent-card agent-${agent}`}>
      <h3>
        {title} <StatusBadge label={record.outcome} tone={outcomeTone(record.outcome)} />
      </h3>
      <dl className="kv">
        <div>
          <dt>Attempts</dt>
          <dd>{record.attempts}</dd>
        </div>
        <div>
          <dt>Schema attempts</dt>
          <dd>{record.schema_attempts}</dd>
        </div>
        <div>
          <dt>Recovery time</dt>
          <dd>{mttr}</dd>
        </div>
        <div>
          <dt>Tokens (total)</dt>
          <dd>{record.tokens_total}</dd>
        </div>
        <div>
          <dt>Healing path</dt>
          <dd>{record.healing_path}</dd>
        </div>
        <div>
          <dt>Server payload OK</dt>
          <dd>{record.server_payload_ok ? 'yes' : 'no'}</dd>
        </div>
        {record.reason_code && (
          <div>
            <dt>Reason</dt>
            <dd>
              <code>{record.reason_code}</code>
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}
