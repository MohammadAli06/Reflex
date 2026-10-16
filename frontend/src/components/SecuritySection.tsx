import { useState } from 'react'
import { api } from '../api/client'
import { Chip, Metric, Panel } from './console'
import { CopyButton } from './ui/CopyButton'
import { DataTable, type Column } from './DataTable'
import { ErrorState, LoadingState } from './StateViews'
import { useApi } from '../hooks/useApi'
import { IconShieldCheck } from './ui/Icons'
import type { SessionInfo } from '../types'
import { DASH, clockTime } from '../utils/format'

/**
 * Security surfaces the backend actually enforces or exposes today: the audit
 * hash chain, schema signature provenance, the tamper demonstration and
 * session management. Rendered inline by the Settings page (and formerly by
 * the standalone Security page).
 */
export function SecuritySection() {
  const status = useApi(() => api.securityStatus(), [])
  const sessions = useApi(() => api.sessions(), [])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [tamperResult, setTamperResult] = useState<string | null>(null)

  async function verify() {
    setBusy(true)
    setFailure(null)
    try {
      await status.reload()
      setNotice('Chain verification re-run against the stored audit rows.')
    } finally {
      setBusy(false)
    }
  }

  async function tamper() {
    setBusy(true)
    setFailure(null)
    setTamperResult(null)
    try {
      const result = await api.tamperSchema()
      setTamperResult(
        `Refused with reason "${result.heal_attempt.reason_code}" (outcome: ${result.heal_attempt.outcome}). ` +
        'No registry revision changed.',
      )
      await status.reload()
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: number) {
    setBusy(true)
    try {
      await api.revokeSession(id)
      await sessions.reload()
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (status.loading || sessions.loading) {
    return <LoadingState label="Loading security state…" />
  }
  if (status.error) {
    return <ErrorState message={status.error} onRetry={status.reload} />
  }

  const chain = status.data?.chain
  const provenance = status.data?.provenance

  const sessionColumns: Column<SessionInfo>[] = [
    { key: 'username', header: 'User', render: (row) => row.username },
    { key: 'created', header: 'Created', render: (row) => clockTime(row.created_at) },
    { key: 'expires', header: 'Expires', render: (row) => clockTime(row.expires_at) },
    {
      key: 'action',
      header: 'Action',
      render: (row) => (
        <button className="cbtn cbtn-sm cbtn-ghost" disabled={busy} onClick={() => revoke(row.id)}>
          Revoke
        </button>
      ),
    },
  ]

  return (
    <>
      {notice && <div className="notice">{notice}</div>}
      {failure && <div className="notice notice-error">{failure}</div>}
      {tamperResult && <div className="notice notice-warning">{tamperResult}</div>}
      {status.data?.persistence_error && (
        <div className="notice notice-error">
          Persistence unavailable: {status.data.persistence_error}. Runs, audit rows and sessions
          are not being stored.
        </div>
      )}

      <div className="con-grid-2">
        <Panel
          title="Audit chain"
          actions={
            <>
              <button type="button" className="cbtn cbtn-sm" disabled={busy} onClick={() => void verify()}>
                {busy ? 'Working…' : 'Verify chain'}
              </button>
              {chain?.ok === null || chain?.ok === undefined ? (
                <Chip tone="mute">Unknown</Chip>
              ) : chain.ok ? (
                <Chip tone="ok"><IconShieldCheck size={12} /> Intact</Chip>
              ) : (
                <Chip tone="bad">Broken</Chip>
              )}
            </>
          }
        >
          <div className="con-grid-3">
            <Metric label="Entries checked" value={chain ? String(chain.checked) : DASH} />
            <Metric
              label="First broken entry"
              value={chain?.first_broken_id === null || chain?.first_broken_id === undefined
                ? DASH
                : String(chain.first_broken_id)}
            />
            <Metric label="Chain" value={chain?.ok === null || chain?.ok === undefined ? DASH : chain.ok ? 'Verified' : 'Failed'} />
          </div>
          <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
            Each entry's hash is <code>sha256(prev_hash + canonical_json(entry))</code>. Verification
            detects a modified row; it is integrity, not proof of authorship.
          </p>
        </Panel>

        <Panel
          title="Schema provenance"
          actions={
            status.data?.signing_enabled ? (
              <Chip tone="ok">Signing on</Chip>
            ) : (
              <Chip tone="warn">Signing off</Chip>
            )
          }
        >
          <div className="con-grid-2">
            <Metric
              label="Last verified"
              value={provenance?.verified_at ? clockTime(provenance.verified_at) : DASH}
            />
            <Metric
              label="Signature"
              value={provenance?.signature_verified ? 'Verified' : DASH}
            />
            <Metric
              label="Key fingerprint"
              value={
                provenance?.fingerprint ? (
                  <span className="con-mono">{provenance.fingerprint}</span>
                ) : DASH
              }
            />
            <Metric
              label="Key source"
              value={
                !provenance?.key_configured
                  ? DASH
                  : provenance.key_pinned_in_settings
                  ? 'Pinned in settings'
                  : 'Discovered from mock (dev)'
              }
            />
          </div>
          {provenance?.sha256 && (
            <div style={{ marginTop: 'var(--s3)' }}>
              <CopyButton text={provenance.sha256} truncateLength={12} />
            </div>
          )}
          {provenance?.ok === false && (
            <div className="notice notice-error" style={{ marginTop: 'var(--s3)' }}>
              Last provenance check failed: {provenance.error ?? 'unknown reason'}. The schema was
              refused and nothing was patched.
            </div>
          )}
          <p className="con-sub" style={{ marginTop: 'var(--s3)' }}>
            The mock signs the canonical JSON of <code>/openapi.json</code>; the healer pins the
            public key and verifies before diffing. Pinning one key is a prototype trust model.
          </p>
        </Panel>
      </div>

      <Panel
        title="Tamper demonstration"
        actions={
          <button className="cbtn cbtn-sm" disabled={busy || !status.data?.signing_enabled} onClick={tamper}>
            Tamper schema
          </button>
        }
      >
        <p className="con-sub">
          Controlled test on the local mock only. It serves a document that does not match its
          signature, then asks the healer to repair a drifted schema. The expected result is a
          refusal with <code>untrusted_schema</code> and no registry change.
        </p>
        {!status.data?.signing_enabled && (
          <p className="con-sub">
            Schema signing is disabled, so the demo cannot show a refusal. Enable
            {' '}<code>SCHEMA_SIGNING_ENABLED=true</code> to run it.
          </p>
        )}
      </Panel>

      <Panel title={`Active sessions (${sessions.data?.sessions.length ?? 0})`}>
        {sessions.error ? (
          <p className="con-sub">{sessions.error}</p>
        ) : (
          <DataTable
            columns={sessionColumns}
            rows={sessions.data?.sessions ?? []}
            emptyMessage="No active sessions."
          />
        )}
      </Panel>
    </>
  )
}
