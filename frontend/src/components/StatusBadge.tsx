import { IconAlertTriangle, IconCheck, IconX } from './ui/Icons'

const OUTCOME_TONES: Record<string, string> = {
  recovered: 'success',
  verified: 'success',
  applied: 'success',
  refused: 'refusal',
  rolled_back: 'warning',
  needs_human_review: 'warning',
  not_drift_reported: 'neutral',
  failed: 'failure',
  wrong_patch: 'failure',
}

export function outcomeTone(outcome: string | undefined | null): string {
  if (!outcome) return 'neutral'
  return OUTCOME_TONES[outcome] ?? 'neutral'
}

export function StatusBadge({ label, tone }: { label: string; tone?: string }) {
  const actualTone = tone ?? outcomeTone(label)
  return (
    <span className={`badge badge-${actualTone}`}>
      {actualTone === 'success' && <IconCheck size={12} strokeWidth={3} />}
      {actualTone === 'failure' && <IconX size={12} strokeWidth={3} />}
      {(actualTone === 'warning' || actualTone === 'refusal') && <IconAlertTriangle size={12} />}
      {label}
    </span>
  )
}
