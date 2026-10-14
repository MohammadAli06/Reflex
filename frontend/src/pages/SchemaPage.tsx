import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Chip, PageHead, Panel } from '../components/console'
import { ErrorState, LoadingState } from '../components/StateViews'
import { shortHash } from '../utils/format'
import type { ConsistencyResult, ErrorStyle, JSONSchema } from '../types'

const ERROR_STYLES: ErrorStyle[] = ['clear', 'vague', 'none']
const HELPERS: Record<ErrorStyle, string> = {
  clear: 'Detailed 4xx with field-level JSON schema validation hints.',
  vague: 'Generic rejection with an opaque message and no field paths.',
  none: 'Silent rejection with an empty error body.',
}
const REFUSAL_MUTATIONS = new Set(['M_AMBIGUOUS', 'M_REQUIRED_BODY'])

function Field({ name, schema, required, depth }: { name: string; schema: JSONSchema; required: boolean; depth: number }) {
  const isObject = schema.type === 'object' && Boolean(schema.properties)
  const props = (schema.properties ?? {}) as Record<string, JSONSchema>
  const requiredList = (schema.required ?? []) as string[]
  return (
    <>
      <div
        className="con-row"
        style={{
          justifyContent: 'space-between',
          background: 'var(--c-bg)',
          border: '1px solid var(--c-outline-variant)',
          padding: '0.3125rem 0.75rem',
          marginLeft: depth * 12,
          marginTop: 6,
        }}
      >
        <span className="con-row" style={{ gap: '0.5rem' }}>
          <span className={`con-dot ${required ? 'con-dot-down' : 'con-dot-ok'}`} style={{ borderRadius: 0, opacity: required ? 1 : 0.4 }} />
          <span className="con-mono" style={{ fontSize: 11, color: required ? 'var(--c-on)' : 'var(--c-on-variant)' }}>{name}</span>
          <span className="con-muted">:</span>
          <span className="con-mono con-muted" style={{ fontSize: 11 }}>{String(schema.type ?? 'any')}</span>
        </span>
        <span className={`con-mono ${required ? 'con-bad' : 'con-muted'}`} style={{ fontSize: 10, textTransform: 'uppercase' }}>
          {required ? 'required' : 'optional'}
        </span>
      </div>
      {isObject &&
        Object.entries(props).map(([child, childSchema]) => (
          <Field
            key={child}
            name={child}
            schema={childSchema}
            required={requiredList.includes(child)}
            depth={depth + 1}
          />
        ))}
    </>
  )
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
      const result = await api.mutate(selected, errorStyle)
      setConsistency(result.consistency)
      setMessage(`Applied ${selected} · schema now v${result.version}`)
      schema.reload()
    } catch (err) {
      setMessage(`Failed: ${err instanceof ApiError ? err.message : String(err)}`)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  if (schema.loading) return <LoadingState label="Loading schema…" />
  if (schema.error) return <ErrorState message={schema.error} onRetry={schema.reload} />

  const data = schema.data!

  return (
    <div className="con-page">
      <PageHead
        eyebrow={
          <>
            Registry state <span className="con-muted">/</span> <span className="con-accent">Injector &amp; mutation matrix</span>
          </>
        }
        title="Schema mutation"
        right={
          <>
            <span className="con-row" style={{ gap: '0.5rem', border: '1px solid var(--c-outline-variant)', padding: '0.25rem 0.5rem' }}>
              <span className="con-dot con-dot-ok" style={{ borderRadius: 0 }} />
              <span className="con-label">target:</span>
              <span className="con-mono" style={{ fontSize: 11 }}>LOCAL MOCK REGISTRY</span>
            </span>
            <button className="cbtn" onClick={() => schema.reload()}>
              <span className="msym msym-13">download</span> Reload schema
            </button>
          </>
        }
      />

      <div className="con-grid-2-73">
        <Panel
          title={
            <span className="con-row" style={{ gap: '0.75rem' }}>
              <span className="con-mono" style={{ border: '1px solid var(--c-outline-variant)', padding: '1px 6px' }}>v{data.version}</span>
              <span className="con-row" style={{ gap: '0.25rem' }}>
                <span className="msym msym-13 con-accent">lock</span>
                <span style={{ letterSpacing: '0.08em' }}>{shortHash(data.sha256, 12)}</span>
              </span>
              <span className="con-muted">|</span>
              <span className="con-label">
                Required headers: {data.required_headers.length ? data.required_headers.map((h) => h.name).join(', ') : 'none'}
              </span>
            </span>
          }
          actions={<span className="con-label">strict_mode: true</span>}
          footer={
            <>
              <span>Schema parser status // recursive descent deterministic</span>
              <Chip tone="ok">validation tree ok</Chip>
            </>
          }
        >
          {Object.entries(data.request_schemas).map(([endpoint, body]) => (
            <div key={endpoint} style={{ marginBottom: '1.25rem' }}>
              <div className="con-row" style={{ justifyContent: 'space-between', background: 'var(--c-container)', border: '1px solid var(--c-outline-variant)', padding: '0.375rem 0.75rem' }}>
                <span className="con-row" style={{ gap: '0.5rem' }}>
                  <span className="con-mono" style={{ background: 'var(--c-primary)', color: 'var(--c-on-primary)', fontSize: 9, fontWeight: 700, padding: '1px 4px', letterSpacing: '0.1em' }}>POST</span>
                  <span className="con-mono" style={{ fontSize: 12 }}>{endpoint}</span>
                </span>
                <span className="con-label">endpoint</span>
              </div>
              {Object.entries((body.properties ?? {}) as Record<string, JSONSchema>).map(([name, field]) => (
                <Field
                  key={name}
                  name={name}
                  schema={field}
                  required={((body.required ?? []) as string[]).includes(name)}
                  depth={0}
                />
              ))}
            </div>
          ))}
        </Panel>

        <Panel
          title="Inject drift // schema mutation generator"
          actions={<Chip tone="mute">{mutations.data?.mutations.length ?? 0} vectors</Chip>}
        >
          <p className="con-label" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 0 }}>
            Select a synthetic mutation vector to evaluate agent self-healing resilience.
          </p>
          {mutations.loading && (
            <div className="notice" style={{ marginTop: '0.75rem' }}>Loading mutation vectors…</div>
          )}
          {mutations.error && (
            <div className="notice notice-error" style={{ marginTop: '0.75rem' }}>
              Could not load mutation vectors: {mutations.error}
              <button className="cbtn cbtn-sm" style={{ marginLeft: '0.5rem' }} onClick={mutations.reload}>Retry</button>
            </div>
          )}

          <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column' }}>
            {mutations.data?.mutations.map((m) => {
              const on = selected === m.id
              const refusal = REFUSAL_MUTATIONS.has(m.id)
              return (
                <label
                  key={m.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: '0.625rem 0.75rem',
                    cursor: 'pointer',
                    borderLeft: `2px solid ${on ? 'var(--c-primary)' : 'transparent'}`,
                    borderBottom: '1px solid var(--c-outline-variant)',
                    background: on ? 'var(--c-container)' : 'transparent',
                  }}
                >
                  <span className="con-row" style={{ justifyContent: 'space-between' }}>
                    <span className="con-row" style={{ gap: '0.5rem' }}>
                      <input type="radio" name="mutation_vector" checked={on} onChange={() => setSelected(m.id)} />
                      <span className={`con-mono ${on ? 'con-accent' : ''}`} style={{ fontSize: 11, fontWeight: 500 }}>{m.id}</span>
                    </span>
                    <Chip tone={refusal ? 'warn' : 'ok'}>
                      expected: {refusal ? 'refusal' : 'recoverable'}
                    </Chip>
                  </span>
                  <span className="con-muted" style={{ fontSize: 12, paddingLeft: 20, textTransform: 'none', letterSpacing: 0 }}>
                    {m.label} — {m.description}
                  </span>
                </label>
              )
            })}
          </div>

          <div style={{ marginTop: '1rem', borderTop: '1px solid var(--c-outline-variant)', paddingTop: '0.75rem' }}>
            <div className="con-row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span className="con-label">Error response profile</span>
              <span className="con-label">HTTP 4xx / 5xx</span>
            </div>
            <div className="csegment">
              {ERROR_STYLES.map((style) => (
                <button key={style} className={style === errorStyle ? 'on' : ''} onClick={() => setErrorStyle(style)}>
                  {style}
                </button>
              ))}
            </div>
            <div className="con-muted" style={{ fontSize: 12, marginTop: 6, textTransform: 'none', letterSpacing: 0 }}>
              {HELPERS[errorStyle]}
            </div>
          </div>

          <div className="con-row" style={{ marginTop: '1rem', borderTop: '1px solid var(--c-outline-variant)', paddingTop: '0.75rem', justifyContent: 'space-between' }}>
            <span className="con-row">
              <button className="cbtn cbtn-primary" disabled={busy || !mutations.data} onClick={apply}>
                {busy ? 'Working…' : 'Apply mutation'}
              </button>
              <button
                className="cbtn"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm('Reset the mock schema to the initial version? This bumps the version.')) return
                  run(() => api.reset().then((r) => r.consistency), 'Schema reset')
                }}
              >
                Reset schema
              </button>
            </span>
            <button className="cbtn cbtn-ghost" disabled={busy} onClick={() => run(() => api.consistency(), 'Consistency suite executed')}>
              <span className="msym msym-13">sync</span> Check consistency
            </button>
          </div>

          {message && <div className={`notice ${failed ? 'notice-error' : ''}`} style={{ marginTop: '0.75rem' }}>{message}</div>}
        </Panel>
      </div>

      <Panel
        title={
          <span className="con-row" style={{ gap: '0.75rem' }}>
            <span className="msym msym-18 con-accent">verified</span>
            Consistency check // validation suite
          </span>
        }
        actions={
          <>
            <span className="con-label">{consistency ? `${consistency.checks.filter((c) => c.ok).length}/${consistency.checks.length} assertions confirmed` : 'not run yet'}</span>
            <Chip tone={consistency?.pass ? 'ok' : consistency ? 'bad' : 'mute'}>
              {consistency ? (consistency.pass ? 'pass' : 'fail') : 'idle'}
            </Chip>
          </>
        }
        footer={
          <span className="con-row" style={{ gap: '0.5rem' }}>
            <span className="con-dot con-dot-ok" style={{ borderRadius: 0 }} />
            <span>Registry seam conformance // deterministic execution sandbox</span>
          </span>
        }
      >
        {consistency ? (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {consistency.checks.map((check) => (
              <div key={check.name} className="con-row" style={{ justifyContent: 'space-between', padding: '0.625rem 0', borderBottom: '1px solid var(--c-outline-variant)' }}>
                <span className="con-row" style={{ gap: '0.75rem', minWidth: 0 }}>
                  <span className={`msym msym-18 ${check.ok ? 'con-accent' : 'con-bad'}`}>{check.ok ? 'check_circle' : 'cancel'}</span>
                  <span className="con-mono" style={{ fontSize: 11, fontWeight: 600 }}>{check.name}</span>
                  <span className="con-muted" style={{ fontSize: 12, textTransform: 'none', letterSpacing: 0 }}>{check.detail}</span>
                </span>
                <Chip tone={check.ok ? 'ok' : 'bad'}>{check.ok ? 'ok' : 'fail'}</Chip>
              </div>
            ))}
          </div>
        ) : (
          <div className="state state-empty">
            <strong>Consistency suite not run.</strong>
            <span>Apply a mutation or press “Check consistency”.</span>
          </div>
        )}
      </Panel>
    </div>
  )
}
