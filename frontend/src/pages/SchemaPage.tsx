import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { PageHead, Panel } from '../components/console'
import { EmptyState, ErrorState, LoadingState } from '../components/StateViews'
import { CopyButton } from '../components/ui/CopyButton'
import {
  IconAlertCircle,
  IconCheck,
  IconPlay,
  IconRefresh,
} from '../components/ui/Icons'
import type { ConsistencyResult, ErrorStyle, JSONSchema, SchemaResponse } from '../types'

const ERROR_STYLES: ErrorStyle[] = ['clear', 'vague', 'none']
const HELPERS: Record<ErrorStyle, string> = {
  clear: 'Detailed 4xx with field-level JSON schema validation hints.',
  vague: 'Generic rejection with an opaque message and no field paths.',
  none: 'Silent rejection with an empty error body.',
}

const COMMON_MUTATIONS = [
  { id: 'M_RENAME', label: 'Rename field', desc: 'Rename request field user_id to uid' },
  { id: 'M_TYPE', label: 'Change type', desc: 'Change user_id type from string to integer' },
  { id: 'M_NEST', label: 'Nest field', desc: 'Move user_id into nested target.id object' },
  { id: 'M_HEADER', label: 'Add header', desc: 'Require credential header X-Tenant-Token' },
  { id: 'M_NEST_TYPE_HEADER', label: 'Combined PS demo', desc: 'Nesting + type change + new header together' },
]

// Baseline canonical schema (v1)
const INITIAL_BASELINE_SCHEMA: Record<string, unknown> = {
  request_schemas: {
    '/user/fetch': {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Identifier of the user to fetch' },
      },
      required: ['user_id'],
      additionalProperties: false,
    },
    '/user/update': {
      type: 'object',
      properties: {
        user_id: { type: 'string', description: 'Identifier of the user to update' },
        display_name: { type: 'string', description: 'New display name' },
      },
      required: ['display_name', 'user_id'],
      additionalProperties: false,
    },
  },
  required_headers: [],
}

/** Compute simple line diff for side-by-side JSON panels */
function computeLineDiff(beforeLines: string[], afterLines: string[]) {
  const beforeSet = new Set(beforeLines)
  const afterSet = new Set(afterLines)

  const diffBefore = beforeLines.map((line) => ({
    text: line,
    changed: !afterSet.has(line) && line.trim() !== '{' && line.trim() !== '}' && line.trim() !== '],',
  }))

  const diffAfter = afterLines.map((line) => ({
    text: line,
    changed: !beforeSet.has(line) && line.trim() !== '{' && line.trim() !== '}' && line.trim() !== '],',
  }))

  return { diffBefore, diffAfter }
}

export function SchemaPage() {
  const schema = useApi(() => api.schema(), [])
  const mutations = useApi(() => api.mutations(), [])
  const [selected, setSelected] = useState('M_NEST_TYPE_HEADER')
  const [errorStyle, setErrorStyle] = useState<ErrorStyle>('clear')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [consistency, setConsistency] = useState<ConsistencyResult | null>(null)

  // Store previous schema before mutation was applied
  const [previousSchema, setPreviousSchema] = useState<SchemaResponse | null>(null)

  useEffect(() => {
    if (schema.data && !previousSchema && schema.data.version > 1) {
      // If active schema is already mutated, use baseline as before
      setPreviousSchema({
        version: 1,
        sha256: 'initial-baseline-hash',
        short_hash: 'v1-base',
        request_schemas: INITIAL_BASELINE_SCHEMA.request_schemas as Record<string, JSONSchema>,
        required_headers: [],
        response_schemas: {},
        error_style: 'clear',
      })
    }
  }, [schema.data])

  async function run(action: () => Promise<ConsistencyResult>, note: string) {
    setBusy(true)
    setMessage(null)
    setFailed(false)
    try {
      const result = await action()
      setConsistency(result)
      setMessage(note)
      schema.reload()
    } catch (err) {
      setMessage(`Failed: ${err instanceof ApiError ? err.message : String(err)}`)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    setBusy(true)
    setMessage(null)
    setFailed(false)
    try {
      if (schema.data) {
        setPreviousSchema(schema.data)
      }
      const result = await api.mutate(selected, errorStyle)
      setConsistency(result.consistency)
      setMessage(`Successfully applied mutation: ${selected}. Schema updated to v${result.version}.`)
      schema.reload()
    } catch (err) {
      setMessage(`Failed to mutate schema: ${err instanceof ApiError ? err.message : String(err)}`)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (schema.loading) return <LoadingState label="Loading schema specifications…" />
  if (schema.error) return <ErrorState message={schema.error} onRetry={schema.reload} />

  const data = schema.data!

  // Prepare before and after line arrays
  const beforeObj = previousSchema
    ? {
        version: previousSchema.version,
        required_headers: previousSchema.required_headers,
        request_schemas: previousSchema.request_schemas,
      }
    : {
        version: 1,
        required_headers: [],
        request_schemas: INITIAL_BASELINE_SCHEMA.request_schemas,
      }

  const afterObj = {
    version: data.version,
    required_headers: data.required_headers,
    request_schemas: data.request_schemas,
  }

  const beforeLines = JSON.stringify(beforeObj, null, 2).split('\n')
  const afterLines = JSON.stringify(afterObj, null, 2).split('\n')
  const { diffBefore, diffAfter } = computeLineDiff(beforeLines, afterLines)

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Break the API on purpose, then watch recovery</span>}
        title="Schema"
        subtitle="Introduce a breaking change into the mock API, then replay it on the comparison page."
        right={
          <div className="con-row" style={{ gap: 12 }}>
            <button
              type="button"
              className="cbtn cbtn-ghost"
              onClick={() => schema.reload()}
              disabled={busy}
            >
              <IconRefresh size={14} />
              <span>Reload</span>
            </button>
          </div>
        }
      />

      {message && (
        <div className={`notice ${failed ? 'notice-error' : ''}`}>
          <div className="con-row" style={{ gap: 8 }}>
            {failed ? <IconAlertCircle size={16} /> : <IconCheck size={16} style={{ color: 'var(--success-green)' }} />}
            <span>{message}</span>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 24 }}>
        <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 16, alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h2 className="text-h2" style={{ fontSize: 15, marginBottom: 4 }}>
              Breaking change
            </h2>
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
              Pick a change, pick how much detail the error gives, then apply it.
            </p>
          </div>

          <div className="con-row" style={{ gap: 8 }}>
            <button
              type="button"
              className="cbtn cbtn-primary"
              style={{ padding: '8px 18px' }}
              disabled={busy || !mutations.data}
              onClick={apply}
            >
              <IconPlay size={14} />
              <span>Apply change</span>
            </button>

            <button
              type="button"
              className="cbtn cbtn-ghost"
              disabled={busy}
              onClick={() => {
                if (!window.confirm('Reset the mock schema to the starting version (v1)?')) return
                run(() => api.reset().then((r) => r.consistency), 'Schema reset to the starting version.')
              }}
            >
              <span>Reset schema</span>
            </button>
          </div>
        </div>

        <div className="text-label" style={{ marginBottom: 8 }}>Change to apply</div>
        <div role="radiogroup" aria-label="Schema change" style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--hairline)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 20 }}>
          {COMMON_MUTATIONS.map((m, i) => {
            const isSelected = selected === m.id
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(m.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  border: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                  background: isSelected ? 'var(--navy-soft)' : 'var(--surface)',
                  color: 'var(--ink, #ffffff)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  width: '100%',
                }}
              >
                <span
                  style={{
                    flex: 'none',
                    width: 16,
                    height: 16,
                    borderRadius: '50%',
                    border: `1.5px solid ${isSelected ? 'var(--brand)' : 'var(--hairline-2)'}`,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isSelected && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)' }} />}
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--ink, #ffffff)' }}>{m.label}</span>
                  <span className="text-muted" style={{ display: 'block', fontSize: 12, color: 'var(--muted, #a8a29a)' }}>{m.desc}</span>
                </span>
                {m.id === 'M_NEST_TYPE_HEADER' && (
                  <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--muted, #a8a29a)' }}>Recommended</span>
                )}
              </button>
            )
          })}
        </div>

        <div
          style={{
            padding: 16,
            background: 'var(--surface-2)',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--hairline)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div className="con-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span className="text-label">Error detail level</span>
            <div className="csegment" role="group" aria-label="Error detail level">
              {ERROR_STYLES.map((style) => (
                <button
                  key={style}
                  type="button"
                  className={style === errorStyle ? 'on' : ''}
                  onClick={() => setErrorStyle(style)}
                  aria-pressed={style === errorStyle}
                  style={{ textTransform: 'capitalize' }}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {HELPERS[errorStyle]}
          </div>
        </div>
      </div>

      <Panel
        title={
          <div className="con-row" style={{ gap: 10 }}>
            <span>Before and after</span>
            <span className="font-mono text-muted" style={{ fontSize: 12 }}>
              v{beforeObj.version} → v{afterObj.version}
            </span>
          </div>
        }
        actions={
          <div className="con-row" style={{ gap: 8, fontSize: 12 }}>
            <span className="text-muted">Current hash:</span>
            <CopyButton text={data.sha256} truncateLength={10} />
          </div>
        }
      >
        <div className="con-grid-2">
          <div
            className="card"
            style={{
              background: 'var(--surface-2)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '10px 16px',
                background: 'var(--surface)',
                borderBottom: '1px solid var(--hairline)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>Current schema (v{beforeObj.version})</span>
              <span className="text-muted font-mono" style={{ fontSize: 11 }}>Removed lines in red</span>
            </div>

            <div style={{ padding: 12, overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
              <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5 }}>
                {diffBefore.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: item.changed ? 'var(--brand-red-subtle)' : 'transparent',
                      color: item.changed ? 'var(--brand-red)' : 'var(--text-secondary)',
                      padding: '1px 6px',
                      borderRadius: 2,
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <span style={{ userSelect: 'none', color: item.changed ? 'var(--brand-red)' : 'var(--text-muted)', width: 14 }}>
                      {item.changed ? '−' : ' '}
                    </span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </pre>
            </div>
          </div>

          <div
            className="card"
            style={{
              background: 'var(--surface-2)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '10px 16px',
                background: 'var(--surface)',
                borderBottom: '1px solid var(--hairline)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                Changed schema (v{afterObj.version})
              </span>
              <span className="text-muted font-mono" style={{ fontSize: 11 }}>Added lines in green</span>
            </div>

            <div style={{ padding: 12, overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
              <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5 }}>
                {diffAfter.map((item, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: item.changed ? 'var(--success-green-subtle)' : 'transparent',
                      color: item.changed ? 'var(--success-green)' : 'var(--text-primary)',
                      padding: '1px 6px',
                      borderRadius: 2,
                      display: 'flex',
                      gap: 8,
                    }}
                  >
                    <span style={{ userSelect: 'none', color: item.changed ? 'var(--success-green)' : 'var(--text-muted)', width: 14 }}>
                      {item.changed ? '+' : ' '}
                    </span>
                    <span>{item.text}</span>
                  </div>
                ))}
              </pre>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Consistency checks"
        actions={
          <div className="con-row" style={{ gap: 8 }}>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {consistency
                ? `${consistency.checks.filter((c) => c.ok).length}/${consistency.checks.length} passed`
                : 'Not run yet'}
            </span>
            <button
              type="button"
              className="cbtn cbtn-sm"
              disabled={busy}
              onClick={() => run(() => api.consistency(), 'Consistency checks finished.')}
            >
              <IconRefresh size={12} />
              <span>Run checks</span>
            </button>
          </div>
        }
      >
        {consistency ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {consistency.checks.map((check) => (
              <div
                key={check.name}
                className="con-row"
                style={{
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--bg-subtle)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div className="con-row" style={{ gap: 10 }}>
                  <span
                    style={{
                      color: check.ok ? 'var(--success-strong)' : 'var(--brand-text)',
                    }}
                  >
                    {check.ok ? <IconCheck size={16} strokeWidth={2.5} /> : <IconAlertCircle size={16} />}
                  </span>
                  <span className="font-mono" style={{ fontWeight: 600, fontSize: 12 }}>
                    {check.name}
                  </span>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {check.detail}
                  </span>
                </div>
                <span className={`badge badge-${check.ok ? 'success' : 'failure'}`} style={{ fontSize: 11 }}>
                  {check.ok ? 'Passed' : 'Failed'}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            message="Checks not run yet."
            hint="Apply a change above or run the checks to verify the schema."
          />
        )}
      </Panel>
    </div>
  )
}
