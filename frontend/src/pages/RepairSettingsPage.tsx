import { useState } from 'react'
import { Chip, Metric, PageHead, Panel } from '../components/console'
import { CopyButton } from '../components/ui/CopyButton'
import { LoadingState, ErrorState } from '../components/StateViews'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import { SecuritySection } from '../components/SecuritySection'
import { DASH, secs } from '../utils/format'
import type { SdkCallResult } from '../types'

/**
 * Settings shows only what the backend enforces or exposes today. Values are
 * read-only: there is no endpoint that changes configuration. Controls that
 * have no working backend (rate limits, circuit breakers) are deliberately
 * absent rather than shown as fake switches.
 */
type SnippetTab = 'python' | 'powershell' | 'curl'

const SAMPLE_BODY = JSON.stringify({ tool: 'fetch_user', args: { user_id: '123' } })

function buildSnippets(controlUrl: string): Record<SnippetTab, string> {
  const callUrl = `${controlUrl}/sdk/call`
  return {
    python: [
      `# SDK source: backend/reflex_sdk inside this repository`,
      `from reflex_sdk import ReflexClient`,
      ``,
      `with ReflexClient(base_url="${controlUrl}") as client:`,
      `    result = client.call("fetch_user", user_id="123")`,
      `    print(result.outcome, result.healed, result.reason_code)`,
    ].join('\n'),
    powershell:
      `Invoke-RestMethod -Method Post -Uri "${callUrl}" ` +
      `-ContentType 'application/json' -Body '${SAMPLE_BODY}'`,
    curl: `curl -sS -X POST "${callUrl}" -H 'Content-Type: application/json' -d '${SAMPLE_BODY}'`,
  }
}

const SNIPPET_TABS: { key: SnippetTab; label: string }[] = [
  { key: 'python', label: 'Python SDK' },
  { key: 'powershell', label: 'PowerShell' },
  { key: 'curl', label: 'curl' },
]

type RunSampleState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'done'; httpStatus: number; result: SdkCallResult; recordedMttr: number | null }

export function RepairSettingsPage() {
  const status = useApi(() => api.status(), [])

  if (status.loading) return <LoadingState label="Loading settings…" />
  if (status.error) return <ErrorState message={status.error} onRetry={status.reload} />

  const summary = status.data
  const llmKeyConfigured = Boolean(summary?.llm_configured)
  const controlUrl = `${window.location.origin}/api`

  return (
    <div className="con-page">
      <PageHead
        eyebrow={<span>Live configuration</span>}
        title="Settings"
        subtitle="What the backend enforces today, read-only, with integration details."
        right={<Chip tone="mute">Read-only</Chip>}
      />

      <div className="notice">
        These values come from the backend environment and cannot be changed from the UI — no
        endpoint accepts a settings change. Controls without a working backend are not shown here.
      </div>

      <div className="con-grid-2">
        <Panel title="Guardrails">
          <div className="con-grid-2">
            <Metric
              label="Schema attempts cap"
              value={String(summary?.max_schema_attempts ?? DASH)}
            />
            <Metric label="Infra retries cap" value={String(summary?.max_infra_retries ?? DASH)} />
            <Metric
              label="Schema signing"
              value={summary?.schema_signing_enabled ? 'On' : 'Off'}
              tone={summary?.schema_signing_enabled ? 'ok' : 'warn'}
            />
            <Metric
              label="Pinned key"
              value={summary?.schema_key_pinned ? 'Yes' : 'No'}
            />
          </div>
          <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
            The healer verifies the schema signature before diffing and stops after the caps above.
            Spec-watch polling (<code>{summary?.spec_watch_interval_s ?? DASH}s interval</code>) is
            reported but not yet wired to an automation loop.
          </p>
        </Panel>

        <Panel title="LLM credentials">
          <div className="con-grid-2">
            <Metric label="Model" value={summary?.llm_model ?? DASH} />
            <Metric label="Thinking level" value={summary?.llm_thinking_level ?? DASH} />
            <Metric
              label="API key"
              value={llmKeyConfigured ? 'Configured' : 'Not configured'}
              tone={llmKeyConfigured ? 'ok' : undefined}
            />
            <Metric
              label="Repair fallback"
              value={
                summary?.llm_repair_enabled == null ? DASH : summary.llm_repair_enabled ? 'Enabled' : 'Disabled'
              }
              tone={summary?.llm_repair_enabled ? 'ok' : undefined}
            />
          </div>
          <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
            The key value is never sent to the browser — only whether one is present. The fallback is a real
            rules-first gate: the LLM proposes a mapping at most once per failure event, and only after the
            rules engine reports no confident candidate. Safety refusals bypass it entirely.
          </p>
        </Panel>
      </div>

      <SecuritySection />

      <IntegrationPanel controlUrl={controlUrl} />
    </div>
  )
}

function IntegrationPanel({ controlUrl }: { controlUrl: string }) {
  const [snippetTab, setSnippetTab] = useState<SnippetTab>('python')
  const [runSample, setRunSample] = useState<RunSampleState>({ phase: 'idle' })
  const security = useApi(() => api.securityStatus(), [])
  const snippets = buildSnippets(controlUrl)
  const sdkAuth = security.data?.auth
  const sdkCopy = !sdkAuth
    ? 'The adapter endpoint is unauthenticated today — no SDK key is configured, so there is no key placeholder shown.'
    : sdkAuth.active_sdk_keys === 0
      ? 'No SDK key exists yet: /api/sdk/call is open for the demo. Creating the first key (Security › Access) makes the adapter key-gated.'
      : `${sdkAuth.active_sdk_keys} active SDK key(s) — agents must send a valid X-Api-Key header on /api/sdk/call.`

  async function runThis() {
    setRunSample({ phase: 'loading' })
    try {
      const result = await api.sdkCall('fetch_user', { user_id: '123' })
      let recordedMttr: number | null = null
      try {
        const run = await api.getRun(result.run_id)
        const healing = run.records?.find((record) => record.agent === 'healing')
        // Recovery time comes from the recorded run, never a stopwatch.
        recordedMttr = healing && healing.t_break != null && healing.t_recovery != null
          ? healing.t_recovery - healing.t_break
          : null
      } catch {
        recordedMttr = null // the run row stays on the server; show a dash
      }
      setRunSample({ phase: 'done', httpStatus: 200, result, recordedMttr })
    } catch (exc) {
      setRunSample({
        phase: 'error',
        message: exc instanceof Error ? exc.message : String(exc),
      })
    }
  }

  const sample = runSample.phase === 'done' ? runSample : null

  return (
    <Panel title="Integration">
      <div className="con-grid-2">
        <div>
          <div className="text-label" style={{ marginBottom: 6 }}>Control API</div>
          <code className="font-mono" style={{ fontSize: 12 }}>{controlUrl}</code>
          <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
            The console talks to this base URL (<code>/api/runs</code>, <code>/api/audit</code>,
            {' '}<code>/api/sdk/call</code>). {sdkCopy}
          </p>
        </div>
        <div>
          <div className="con-row" style={{ gap: 6, marginBottom: 6, flexWrap: 'wrap' }} role="tablist">
            {SNIPPET_TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={snippetTab === item.key}
                className={snippetTab === item.key ? 'badge badge-neutral' : 'badge badge-mute'}
                style={{ cursor: 'pointer' }}
                onClick={() => setSnippetTab(item.key)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <pre
            className="font-mono"
            data-testid="integration-snippet"
            style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: 0, minHeight: 96 }}
          >
            {snippets[snippetTab]}
          </pre>
          <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
            The adapters above call the real <code>/api/sdk/call</code>. Copy {' '}
            <CopyButton text={snippets[snippetTab]} truncateLength={0} hideText className="snippet-copy" />
          </p>
        </div>
      </div>

      <div style={{ marginTop: 'var(--s3)' }}>
        <div className="con-row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="badge badge-neutral"
            style={{ cursor: runSample.phase === 'loading' ? 'wait' : 'pointer' }}
            disabled={runSample.phase === 'loading'}
            onClick={runThis}
          >
            {runSample.phase === 'loading' ? 'Calling…' : 'Run this against the live engine'}
          </button>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Sends <code>{`POST /api/sdk/call ${SAMPLE_BODY}`}</code> — a real request, real response.
          </span>
        </div>

        {runSample.phase === 'error' && (
          <div className="notice" style={{ marginTop: 12 }} data-testid="sdk-call-error-notice">
            SDK call failed: {runSample.message} (no invented fallback is shown).
          </div>
        )}

        {sample && (
          <div className="card" data-testid="sdk-call-result" style={{ padding: 14, marginTop: 12 }}>
            <div className="con-row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <span className="text-muted">HTTP <b className="font-mono">{sample.httpStatus}</b></span>
              <span className="text-muted">outcome <b className="font-mono">{sample.result.outcome}</b></span>
              <span className="text-muted">
                reason <b className="font-mono">{sample.result.reason_code ?? DASH}</b>
              </span>
              <span className="text-muted">
                repaired by <b className="font-mono">{sample.result.healing_path ?? DASH}</b>
              </span>
              <span className="text-muted">
                attempts <b className="font-mono">{sample.result.attempts}</b>
              </span>
              <span className="text-muted">
                recorded recovery <b className="font-mono">{secs(sample.recordedMttr)}</b>
              </span>
            </div>
            {sample.result.data == null ? (
              <p className="con-sub" style={{ marginTop: 'var(--s2)' }}>No response data recorded.</p>
            ) : (
              <details style={{ marginTop: 'var(--s2)' }}>
                <summary className="con-sub">Response body (redacted server-side)</summary>
                <pre className="font-mono" style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(sample.result.data, null, 2)}
                </pre>
              </details>
            )}
            {sample.result.error && (
              <div className="notice" style={{ marginTop: 10 }}>Error: {sample.result.error}</div>
            )}
            <p className="con-sub" style={{ marginTop: 'var(--s2)' }}>
              Run <code>{sample.result.run_id}</code> appears in the{' '}
              <a href="/console/runs">Runs</a> ledger. Apply a drift on the{' '}
              <a href="/console/schema">Schema</a> page first to watch this call heal live.
            </p>
          </div>
        )}
      </div>
    </Panel>
  )
}
