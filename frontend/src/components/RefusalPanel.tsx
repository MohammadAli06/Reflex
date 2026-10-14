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
    <div className="refusal-panel">
      <h3>Safe refusal</h3>
      {reasonCode && <div className="refusal-code">
        reason: <code>{reasonCode}</code>
      </div>}
      <p>{explanation ?? EXPLANATIONS[reasonCode ?? ''] ?? 'Stopped safely and logged the decision.'}</p>
      {evidence && evidence.length > 0 && (
        <>
          <div className="muted">Evidence considered:</div>
          <ul>
            {evidence.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}
      <div className="muted">
        A human must supply the missing evidence (a value source or credential) before this can proceed.
      </div>
    </div>
  )
}
