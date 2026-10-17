import { useState } from 'react'
import { api, ApiError } from '../api/client'
import { Panel } from './console'
import { SchemaDiffView } from './SchemaDiffView'
import { DefinitionSplit, ValidatorChecks } from './ExchangeCard'
import { StatusBadge } from './StatusBadge'
import { DASH } from '../utils/format'
import type { DryRunParseResponse, DryRunResult } from '../types'

/**
 * Offline dry-run analysis for pasted specs. Nothing here sends a request:
 * the panel talks only to /api/dryrun/*, which parses and analyzes in-process.
 * Every value shown comes from the backend response — absences render DASH.
 */

const EXAMPLE_OLD = `openapi: 3.1.0
info:
  title: Demo payment API
  version: "1.0"
paths:
  /user/fetch:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/FetchUser'
components:
  schemas:
    FetchUser:
      type: object
      properties:
        user_id:
          type: string
      required: [user_id]
`

const EXAMPLE_NEW = `openapi: 3.1.0
info:
  title: Demo payment API
  version: "2.0"
paths:
  /user/fetch:
    post:
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/FetchUser'
components:
  schemas:
    FetchUser:
      type: object
      properties:
        account:
          type: object
          properties:
            id:
              type: string
          required: [id]
      required: [account]
`

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { __invalid_json__: true, raw: text }
  }
}

export function DryRunPanel() {
  const [oldSpec, setOldSpec] = useState('')
  const [newSpec, setNewSpec] = useState('')
  const [operation, setOperation] = useState('')
  const [reqMethod, setReqMethod] = useState('POST')
  const [reqPath, setReqPath] = useState('')
  const [reqHeaders, setReqHeaders] = useState('{}')
  const [reqBody, setReqBody] = useState('{\n  "user_id": "123"\n}')
  const [errStatus, setErrStatus] = useState('422')
  const [errBody, setErrBody] = useState('{}')
  const [parsing, setParsing] = useState(false)
  const [operations, setOperations] = useState<DryRunParseResponse | null>(null)
  const [analyzeState, setAnalyzeState] = useState<
    { phase: 'loading' } | { phase: 'error'; message: string; code: string | null } |
    { phase: 'done'; result: DryRunResult } | { phase: 'idle' }
  >({ phase: 'idle' })

  async function loadOperations() {
    setParsing(true)
    try {
      const parsed = await api.dryRunParse(oldSpec, newSpec)
      setOperations(parsed)
      const shared = parsed.shared_operations[0] ?? parsed.old_operations[0]
      if (shared && !operation) {
        setOperation(`${shared.method} ${shared.path}`)
        setReqPath(shared.path)
      }
    } catch (exc) {
      setOperations(null)
      setAnalyzeState({
        phase: 'error',
        message: exc instanceof ApiError || exc instanceof Error ? exc.message : String(exc),
        code: exc instanceof ApiError ? String(exc.status) : null,
      })
    } finally {
      setParsing(false)
    }
  }

  async function analyze() {
    setAnalyzeState({ phase: 'loading' })
    try {
      const result = await api.dryRunAnalyze({
        oldSpec,
        newSpec,
        operation: operation || `${reqMethod} ${reqPath}`.trim(),
        originalRequest: {
          method: reqMethod,
          path: reqPath,
          headers: parseJson(reqHeaders),
          body: parseJson(reqBody),
        },
        error: { status: Number(errStatus) || null, body: parseJson(errBody) },
      })
      setAnalyzeState({ phase: 'done', result })
    } catch (exc) {
      setAnalyzeState({
        phase: 'error',
        message: exc instanceof Error ? exc.message : String(exc),
        code: exc instanceof ApiError ? String(exc.status) : null,
      })
    }
  }

  function readInto(setter: (value: string) => void) {
    return (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => setter(String(reader.result ?? ''))
      reader.readAsText(file)
    }
  }

  const result = analyzeState.phase === 'done' ? analyzeState.result : null
  const repairedBy = result
    ? result.source === 'llm' ? 'LLM fallback' : result.source === 'rule' ? 'Rules' : DASH
    : null

  return (
    <>
      <div className="notice" data-testid="dryrun-banner" role="status">
        Dry-run: no request was sent. Specs are parsed in-process; values are only ever derived
        from what you paste below.
      </div>

      <Panel title="Paste your contracts">
        <div className="con-grid-2">
          <div>
            <div className="text-label" style={{ marginBottom: 6 }}>Old spec (before the change)</div>
            <textarea
              data-testid="dryrun-old-spec"
              rows={14}
              spellCheck={false}
              value={oldSpec}
              onChange={(e) => setOldSpec(e.target.value)}
              placeholder='openapi: "3.1.0" ... (JSON or YAML)'
            />
            <input
              type="file"
              accept=".yaml,.yml,.json,.txt"
              style={{ marginTop: 8 }}
              onChange={(e) => readInto(setOldSpec)(e.target.files)}
            />
          </div>
          <div>
            <div className="text-label" style={{ marginBottom: 6 }}>New spec (what the API serves now)</div>
            <textarea
              data-testid="dryrun-new-spec"
              rows={14}
              spellCheck={false}
              value={newSpec}
              onChange={(e) => setNewSpec(e.target.value)}
              placeholder='openapi: "3.1.0" ... (JSON or YAML)'
            />
            <input
              type="file"
              accept=".yaml,.yml,.json,.txt"
              style={{ marginTop: 8 }}
              onChange={(e) => readInto(setNewSpec)(e.target.files)}
            />
          </div>
        </div>
        <div className="con-row" style={{ gap: 8, marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="cbtn cbtn-ghost"
            data-testid="dryrun-load-example"
            onClick={() => {
              setOldSpec(EXAMPLE_OLD)
              setNewSpec(EXAMPLE_NEW)
              setOperation('POST /user/fetch')
              setReqPath('/user/fetch')
              setReqBody('{\n  "user_id": "123"\n}')
              setErrStatus('422')
              setErrBody('{\n  "error": "validation_failed"\n}')
            }}
          >
            Load example
          </button>
          <button
            type="button"
            className="cbtn cbtn-ghost"
            disabled={parsing || !oldSpec || !newSpec}
            onClick={loadOperations}
          >
            {parsing ? 'Parsing…' : 'List operations from the specs'}
          </button>
          {operations && (
            <span className="text-muted" style={{ fontSize: 12 }}>
              {operations.shared_operations.length
                ? `${operations.shared_operations.length} shared operation(s)`
                : 'no shared operations'}
            </span>
          )}
        </div>
      </Panel>

      <Panel title="The failing request">
        <div className="con-grid-2">
          <div>
            <div className="text-label" style={{ marginBottom: 6 }}>Operation (METHOD /path)</div>
            <input
              data-testid="dryrun-operation"
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              placeholder="POST /user/fetch"
            />
            {operations && operations.shared_operations.length > 0 && (
              <select
                style={{ marginTop: 8 }}
                value={operation}
                onChange={(e) => {
                  setOperation(e.target.value)
                  const [, p] = e.target.value.split(' ', 2)
                  setReqPath(p)
                }}
              >
                {operations.shared_operations.map((op) => (
                  <option key={`${op.method} ${op.path}`} value={`${op.method} ${op.path}`}>
                    {`${op.method} ${op.path}`}
                  </option>
                ))}
              </select>
            )}
            <div className="text-label" style={{ margin: '10px 0 6px' }}>Original request</div>
            <div className="con-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                data-testid="dryrun-req-method"
                style={{ width: 90 }}
                value={reqMethod}
                onChange={(e) => setReqMethod(e.target.value)}
              />
              <input
                data-testid="dryrun-req-path"
                style={{ flex: 1 }}
                value={reqPath}
                onChange={(e) => setReqPath(e.target.value)}
                placeholder="/user/fetch"
              />
            </div>
            <div className="text-label" style={{ margin: '10px 0 6px' }}>Headers (JSON; values stay local)</div>
            <textarea rows={3} spellCheck={false} value={reqHeaders} onChange={(e) => setReqHeaders(e.target.value)} />
            <div className="text-label" style={{ margin: '10px 0 6px' }}>JSON body</div>
            <textarea rows={6} spellCheck={false} value={reqBody} onChange={(e) => setReqBody(e.target.value)} />
          </div>
          <div>
            <div className="text-label" style={{ marginBottom: 6 }}>Error the API returned</div>
            <div className="con-row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                data-testid="dryrun-err-status"
                style={{ width: 110 }}
                value={errStatus}
                onChange={(e) => setErrStatus(e.target.value)}
                placeholder="422"
              />
            </div>
            <div className="text-label" style={{ margin: '10px 0 6px' }}>Error body (JSON)</div>
            <textarea rows={10} spellCheck={false} value={errBody} onChange={(e) => setErrBody(e.target.value)} />
            <div className="con-row" style={{ gap: 8, marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="cbtn cbtn-primary"
                data-testid="dryrun-analyze"
                disabled={analyzeState.phase === 'loading' || !oldSpec || !newSpec || (!operation && !reqPath)}
                onClick={analyze}
              >
                {analyzeState.phase === 'loading' ? 'Analyzing…' : 'Analyze'}
              </button>
            </div>
          </div>
        </div>
      </Panel>

      {analyzeState.phase === 'error' && (
        <Panel title="Analysis error">
          <div className="notice notice-warning" data-testid="dryrun-error">
            <b>{analyzeState.code ? `HTTP ${analyzeState.code}` : 'Request failed'}</b> — {analyzeState.message}
          </div>
        </Panel>
      )}

      {result && (
        <div data-testid="dryrun-result">
          <Panel title="What Reflex would do">
            <div className="con-row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <StatusBadge label={result.outcome} />
              <span className="text-muted" style={{ fontSize: 12 }}>
                Repaired by <b style={{ color: 'var(--ink)' }}>{repairedBy}</b>
              </span>
              <span className="text-muted" style={{ fontSize: 12 }}>
                drift <b className="font-mono" style={{ color: 'var(--ink)' }}>{result.drift_classification}</b>
              </span>
              {result.reason_code && (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  reason <b className="font-mono" style={{ color: 'var(--ink)' }}>{result.reason_code}</b>
                </span>
              )}
              {result.validation && (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  confidence <b className="font-mono" style={{ color: 'var(--ink)' }}>
                    {result.candidate?.confidence?.toFixed(2) ?? DASH}
                  </b>
                </span>
              )}
            </div>

            {result.outcome === 'refused' && (
              <div className="notice notice-warning" style={{ marginTop: 12 }} data-testid="dryrun-refusal">
                <b>Refused</b> — no patch applied, nothing changes.
                {result.reason_code ? <> Reason code <code>{result.reason_code}</code>.</> : null}
                {result.missing_values.length > 0 && (
                  <> Missing original value(s): <code>{result.missing_values.join(', ')}</code>.</>
                )}
              </div>
            )}
            {result.outcome === 'no_drift' && (
              <div className="notice" style={{ marginTop: 12 }}>
                No drift detected between the two contracts for this operation; the original request
                stands as-is.
              </div>
            )}

            {result.diff && (
              <div style={{ marginTop: 12 }}>
                <SchemaDiffView diff={result.diff} />
              </div>
            )}

            {result.candidate && (
              <div style={{ marginTop: 12 }}>
                <div className="text-label" style={{ marginBottom: 4 }}>Candidate patch</div>
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {result.candidate.evidence.map((line, index) => (
                    <li key={index} className="font-mono" style={{ fontSize: 12 }}>{line}</li>
                  ))}
                </ul>
                {Object.keys(result.candidate.conversions).length > 0 && (
                  <p className="con-sub" style={{ marginTop: 'var(--s2)' }}>
                    Conversions: <code>{Object.entries(result.candidate.conversions).map(([k, v]) => `${k}: ${v}`).join(', ')}</code>
                  </p>
                )}
              </div>
            )}

            {result.validation && result.validation.ok && result.corrected_request && (
              <div style={{ marginTop: 12 }}>
                <div className="text-label" style={{ marginBottom: 4 }}>
                  Corrected request (would be sent — headers show names/provenance only)
                </div>
                <div className="con-row" style={{ gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                  <span className="font-mono">{result.corrected_request.method} {result.corrected_request.path}</span>
                  <span className="font-mono">{JSON.stringify(result.corrected_request.headers)}</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <DefinitionSplit
                    labelBefore="Original body"
                    labelAfter="Corrected body"
                    before={parseJson(reqBody)}
                    after={result.corrected_request.body}
                  />
                </div>
              </div>
            )}

            {result.validation && !result.validation.ok && (
              <div style={{ marginTop: 12 }}>
                <div className="text-label" style={{ marginBottom: 4 }}>Validation checks</div>
                <ValidatorChecks
                  ok={result.validation.ok}
                  errors={result.validation.errors}
                  reasonCode={result.validation.reason_code}
                />
              </div>
            )}

            {result.llm_meta && (
              <p className="con-sub" style={{ marginTop: 'var(--s2)' }}>
                LLM proposal: <code>{String(result.llm_meta.model ?? DASH)}</code>, prompt hash{' '}
                <code>{String(result.llm_meta.prompt_sha256 ?? DASH).slice(0, 12)}</code>. The prompt
                body is never retained.
              </p>
            )}
          </Panel>
        </div>
      )}
    </>
  )
}
