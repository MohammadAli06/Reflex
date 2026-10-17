import { JsonViewer } from './JsonViewer'
import { StatusBadge } from './StatusBadge'
import { DASH } from '../utils/format'

/**
 * Renders a single HTTP exchange from a stored backend record. Every field
 * shown must exist in the record - anything missing renders DASH, never a
 * blank or an invented placeholder.
 */
export interface ExchangeRecord {
  step?: string
  method?: string
  url?: string | null
  attempt?: number | null
  request_headers?: Record<string, string> | null
  request_body?: Record<string, unknown> | string | null
  response_status?: number | null
  response_headers?: Record<string, string> | null
  response_body?: Record<string, unknown> | string | null
  started_at?: string | null
  duration_ms?: number | null
  error?: string | null
  truncated?: boolean
}

function statusTone(status: number | null | undefined): string | undefined {
  if (status == null) return undefined
  if (status >= 200 && status < 300) return 'success'
  if (status >= 300 && status < 500) return 'refusal'
  return 'failure'
}

const STEP_LABELS: Record<string, string> = {
  baseline_call: 'Baseline call',
  healing_call: 'Reflex call',
  retry_call: 'Verified retry',
  infra_retry: 'Infra retry',
  spec_fetch: 'Spec fetch',
  schema_probe: 'Schema probe',
}

function method_status(status: number | null | undefined): string {
  return status == null ? DASH : String(status)
}

export function ExchangeCard({
  exchange,
  title,
  children,
}: {
  exchange: ExchangeRecord
  title?: string
  children?: React.ReactNode
}) {
  const stepLabel = (exchange.step && STEP_LABELS[exchange.step]) || exchange.step
  const method = exchange.method ?? DASH
  const endpoint = exchange.url ?? DASH
  const duration =
    exchange.duration_ms == null
      ? DASH
      : `${exchange.duration_ms}ms`

  return (
    <div className="card exchange-card" data-testid={`exchange-${exchange.step ?? 'unknown'}`}>
      <div className="con-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <div className="con-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="text-label">{title ?? stepLabel ?? 'HTTP exchange'}</span>
          {exchange.step && <span className="font-mono text-muted" style={{ fontSize: 11 }}>{exchange.step}</span>}
          {exchange.attempt != null && (
            <span className="text-muted" style={{ fontSize: 11 }}>attempt {exchange.attempt}</span>
          )}
        </div>
        <div className="con-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {exchange.response_status == null && exchange.error ? (
            <span className="badge badge-failure">{exchange.error}</span>
          ) : (
            <StatusBadge
              label={method_status(exchange.response_status)}
              tone={statusTone(exchange.response_status)}
            />
          )}
          <span className="font-mono text-muted" style={{ fontSize: 12 }}>{duration}</span>
          {exchange.truncated && <span className="badge badge-neutral">Truncated</span>}
        </div>
      </div>

      <div className="exchange-line font-mono" style={{ fontSize: 12, marginBottom: 12 }}>
        <b>{method}</b> <span className="text-muted">{endpoint}</span>
      </div>

      {exchange.request_headers == null ? (
        <p className="con-sub" style={{ margin: '0 0 8px', fontSize: 12 }}>
          Request headers: no detail recorded ({DASH})
        </p>
      ) : (
        <JsonViewer value={exchange.request_headers} label="Request headers (redacted)" />
      )}

      {exchange.request_body == null ? (
        <p className="con-sub" style={{ margin: '0 0 8px', fontSize: 12 }}>
          Request body: no detail recorded ({DASH})
        </p>
      ) : (
        <JsonViewer value={exchange.request_body} label="Request body" />
      )}

      {exchange.response_body == null ? (
        <p className="con-sub" style={{ margin: '0 0 8px', fontSize: 12 }}>
          Response body: no detail recorded ({DASH})
        </p>
      ) : (
        <JsonViewer value={exchange.response_body} label="Response body" />
      )}

      {children}
    </div>
  )
}

/** Before/after definitions on one shared splitter. */
export function DefinitionSplit({
  labelBefore,
  labelAfter,
  before,
  after,
  beforeMeta,
  afterMeta,
}: {
  labelBefore: string
  labelAfter: string
  before: unknown
  after: unknown
  beforeMeta?: string
  afterMeta?: string
}) {
  return (
    <div className="con-grid-2">
      <div>
        <div className="text-label" style={{ marginBottom: 6 }}>
          {labelBefore} {beforeMeta ? <span className="text-muted font-mono" style={{ fontSize: 11 }}>{beforeMeta}</span> : null}
        </div>
        {before == null ? (
          <div className="state state-empty" style={{ padding: 16 }}>No definition recorded ({DASH}).</div>
        ) : (
          <JsonViewer value={before} />
        )}
      </div>
      <div>
        <div className="text-label" style={{ marginBottom: 6 }}>
          {labelAfter} {afterMeta ? <span className="text-muted font-mono" style={{ fontSize: 11 }}>{afterMeta}</span> : null}
        </div>
        {after == null ? (
          <div className="state state-empty" style={{ padding: 16 }}>No definition recorded ({DASH}).</div>
        ) : (
          <JsonViewer value={after} />
        )}
      </div>
    </div>
  )
}

/** Each validator check (or error) with its pass/fail verdict from the record. */
export function ValidatorChecks({
  ok,
  errors,
  reasonCode,
}: {
  ok: boolean | null
  errors?: unknown[] | null
  reasonCode?: string | null
}) {
  const list = Array.isArray(errors) ? errors : []
  return (
    <div className="validator-checks" data-testid="validator-checks">
      <div className="con-row" style={{ gap: 8, marginBottom: 6 }}>
        <span className="text-label">Validator checks</span>
        {ok == null || reasonCode == null ? null : (
          <StatusBadge label={ok ? 'passed' : 'failed'} tone={ok ? 'success' : 'failure'} />
        )}
      </div>
      {list.length === 0 ? (
        ok ? (
          <p className="con-sub" style={{ margin: 0, fontSize: 12 }}>
            All recorded validator checks passed.
          </p>
        ) : (
          <p className="con-sub" style={{ margin: 0, fontSize: 12 }}>
            No check list recorded ({DASH}){reasonCode ? ` — ${reasonCode}` : ''}
          </p>
        )
      ) : (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)' }}>
          {list.map((item, idx) => (
            <li key={idx} className="con-row" style={{ gap: 6, marginTop: 2 }}>
              <span className="badge badge-failure" style={{ fontSize: 10 }}>fail</span>
              <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
