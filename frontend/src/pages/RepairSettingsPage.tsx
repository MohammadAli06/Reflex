import { Chip, Metric, PageHead, Panel } from '../components/console'
import { LoadingState, ErrorState } from '../components/StateViews'
import { useApi } from '../hooks/useApi'
import { api } from '../api/client'
import { SecuritySection } from '../components/SecuritySection'
import { DASH } from '../utils/format'

/**
 * Settings shows only what the backend enforces or exposes today. Values are
 * read-only: there is no endpoint that changes configuration. Controls that
 * have no working backend (rate limits, circuit breakers, LLM repair toggle)
 * are deliberately absent rather than shown as fake switches.
 */
export function RepairSettingsPage() {
  const status = useApi(() => api.status(), [])

  if (status.loading) return <LoadingState label="Loading settings…" />
  if (status.error) return <ErrorState message={status.error} onRetry={status.reload} />

  const summary = status.data
  const llmKeyConfigured = Boolean(summary?.llm_configured)
  const controlUrl = `${window.location.origin}/api`

  const integrationSnippet = [
    'import reflex_sdk',
    'tools = await client.list_tools(base_url="/", control_api="' + controlUrl + '")',
    'result = await client.call_tool("list_pet", args={"status": "sold"})',
    'result.run_id  # open this run in the Runs page',
  ].join('\n')

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
          </div>
          <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
            The key value is never sent to the browser — only whether one is present. Model-assisted
            repair is not wired into the healing pipeline, so no repair-path control exists here.
          </p>
        </Panel>
      </div>

      <SecuritySection />

      <Panel title="Integration">
        <div className="con-grid-2">
          <div>
            <div className="text-label" style={{ marginBottom: 6 }}>Control API</div>
            <code className="font-mono" style={{ fontSize: 12 }}>{controlUrl}</code>
            <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
              The console talks to this base URL (<code>/api/runs</code>, <code>/api/audit</code>,
              {' '}<code>/api/sdk/call</code>) with session-cookie auth.
            </p>
          </div>
          <div>
            <div className="text-label" style={{ marginBottom: 6 }}>SDK usage</div>
            <pre className="font-mono" style={{ fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>
              {integrationSnippet}
            </pre>
            <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
              <code>result.run_id</code> opens the same run in{' '}
              <a href="/console/runs">Runs</a>; every decision appears in the decision ledger.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  )
}
