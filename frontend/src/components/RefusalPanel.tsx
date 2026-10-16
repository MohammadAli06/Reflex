import { IconAlertTriangle, IconCheck } from './ui/Icons'

const EXPLANATIONS: Record<string, string> = {
  ambiguous_mapping: 'Two or more candidates were equally plausible, so it refused rather than guess.',
  missing_credential: 'A required credential header had no value in the secrets store, so it refused rather than invent one.',
  missing_required_value: 'A newly required field had no approved value source, so it refused rather than invent a default.',
  lossy_conversion: "The type conversion would have changed the value's meaning, so it refused.",
  validation_failed: 'The candidate patch failed validation, so it was not applied.',
  no_evidence: 'No relevant schema change explained the error, so it refused.',
  retry_cap_reached: 'The retry cap was reached without a safe fix.',
  needs_human_review: 'The change could not be applied safely; a human must review it.',
  auth_rejected: 'Authentication was rejected. The system does not bypass authentication.',
  not_drift: 'Classified as not schema drift. No patch was applied.',
  ambiguous_response_mapping: 'The response shape changed ambiguously, so no data was returned.',
}

export function RefusalPanel({
  reasonCode,
  explanation,
  evidence,
}: {
  reasonCode: string | null
  explanation?: string
  evidence?: string[]
}) {
  return (
    <div className="card" style={{ borderLeft: '4px solid var(--accent-orange)' }}>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="con-row" style={{ justifyContent: 'space-between' }}>
          <div className="con-row" style={{ gap: 8 }}>
            <span style={{ color: 'var(--accent-orange)' }}><IconAlertTriangle size={18} /></span>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Safe refusal</h3>
          </div>
          <span className="badge badge-warning">Refused</span>
        </div>

        {reasonCode && (
          <div className="con-row" style={{ gap: 8, fontSize: 13 }}>
            <span className="text-label" style={{ fontSize: 11 }}>Reason:</span>
            <code style={{ fontSize: 12, fontWeight: 600 }}>{reasonCode}</code>
          </div>
        )}

        <p style={{ margin: 0, fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {explanation ?? EXPLANATIONS[reasonCode ?? ''] ?? 'Stopped safely and logged the decision.'}
        </p>

        {evidence && evidence.length > 0 && (
          <div style={{ marginTop: 4, background: 'var(--bg-subtle)', padding: '12px 16px', borderRadius: 'var(--radius-md)' }}>
            <div className="text-label" style={{ marginBottom: 6 }}>Evidence considered:</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {evidence.map((item, index) => (
                <li key={index}>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="con-row" style={{ gap: 6, fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
          <IconCheck size={14} style={{ color: 'var(--success-green)' }} />
          <span>A human must supply the missing evidence (a value source or credential) before this can proceed.</span>
        </div>
      </div>
    </div>
  )
}
