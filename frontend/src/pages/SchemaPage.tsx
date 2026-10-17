import { useState } from 'react'
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
import type { ConsistencyResult, ErrorStyle, MutateResult, MutationInfo } from '../types'
import { DASH } from '../utils/format'

const ERROR_STYLES: ErrorStyle[] = ['clear', 'vague', 'none']
const HELPERS: Record<ErrorStyle, string> = {
  clear: 'Detailed 4xx with field-level JSON schema validation hints.',
  vague: 'Generic rejection with an opaque message and no field paths.',
  none: 'Silent rejection with an empty error body.',
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
  // Specs recorded by the last real mutation (real mock OpenAPI, not fabricated).
  const [lastApply, setLastApply] = useState<MutateResult | null>(null)

  async function run(action: () => Promise<ConsistencyResult>, note: string) {
    setBusy(true)
    setMessage(null)
    setFailed(false)
    try {
      const result = await action()
      setConsistency(result)
      setMessage(note)
      setLastApply(null)
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
      const result = await api.mutate(selected, errorStyle)
      setConsistency(result.consistency)
      setLastApply(result)
      setMessage(`Successfully applied mutation: ${selected}. Schema updated to v${result.version}.`)
      schema.reload()
    } catch (err) {
      setMessage(`Failed to mutate schema: ${err instanceof ApiError ? err.message : String(err)}`)
      setFailed(true)
      schema.reload()
    } finally {
      setBusy(false)
    }
  }

  if (schema.loading) return <LoadingState label="Loading schema specifications…" />
  if (schema.error) return <ErrorState message={schema.error} onRetry={schema.reload} />

  const data = schema.data!

  const mutationList: MutationInfo[] = mutations.data?.mutations ?? []

  const beforeObj = lastApply?.spec_before
    ? {
        version: lastApply.spec_before.version ?? DASH,
        required_headers: lastApply.spec_before.required_headers ?? [],
        request_schemas: lastApply.spec_before.request_schemas ?? {},
      }
    : null

  const afterObj = lastApply?.spec_after
    ? {
        version: lastApply.spec_after.version ?? DASH,
        required_headers: lastApply.spec_after.required_headers ?? [],
        request_schemas: lastApply.spec_after.request_schemas ?? {},
      }
    : {
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
          {mutationList.map((m, i) => {
            const MUT = m as unknown as { id: string; label?: string; description?: string }
            const isSelected = selected === MUT.id
            return (
              <button
                key={MUT.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelected(MUT.id)}
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
                  <span style={{ display: 'block', fontWeight: 600, fontSize: 13, color: 'var(--ink, #ffffff)' }}>
                    {MUT.label || MUT.id}
                  </span>
                  <span className="text-muted" style={{ display: 'block', fontSize: 12, color: 'var(--muted, #a8a29a)' }}>
                    {MUT.description || 'No description recorded for this mutation.'}
                  </span>
                </span>
                {MUT.id === 'M_NEST_TYPE_HEADER' && (
                  <span className="text-muted" style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--muted, #a8a29a)' }}>Recommended</span>
                )}
              </button>
            )
          })}
          {mutationList.length === 0 && (
            <button type="button" style={{ padding: 16, border: 'none', background: 'var(--surface)', color: 'var(--text-muted)', textAlign: 'left' }}>
              Mutations unavailable ({DASH}) — the backend list could not be loaded.
            </button>
          )}
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
          <div className="con-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <span>Before and after</span>
            {beforeObj ? (
              <span className="font-mono text-muted" style={{ fontSize: 12 }}>
                v{String(beforeObj.version)} → v{String(afterObj.version)}
                {lastApply?.mutation?.id ? ` · ${lastApply.mutation.id}` : ''}
              </span>
            ) : (
              <span className="font-mono text-muted" style={{ fontSize: 12 }}>
                current v{String(afterObj.version)}
              </span>
            )}
          </div>
        }
        actions={
          <div className="con-row" style={{ gap: 8, fontSize: 12 }}>
            <span className="text-muted">Current hash:</span>
            <CopyButton text={data.sha256} truncateLength={10} />
          </div>
        }
      >
        {!beforeObj ? (
          <EmptyState
            message="No recorded before spec for this session."
            hint="Apply a mutation here and the real mock OpenAPI contract taken before and after the change is shown. The page never invents a baseline."
          />
        ) : (
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
              <span style={{ fontWeight: 600, fontSize: 13 }}>Schema before (v{beforeObj.version})</span>
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
                Schema after (v{afterObj.version})
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
        )}
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
