import type { ReactNode } from 'react'
import { IconCheck, IconX } from './Icons'
import type { StepInfo } from './Stepper'

/** Signature "race" visual: one shared step header, two aligned tracks. */
export function RaceTrack({
  steps,
  tracks,
  header,
  outcomes,
}: {
  steps: string[]
  tracks: Array<{ key: string; name: ReactNode; sub: string; tone: 'baseline' | 'reflex'; states: StepInfo['status'][] }>
  header?: ReactNode
  outcomes?: ReactNode
}) {
  return (
    <div className="race">
      {header}
      <div className="race-head" aria-hidden="true">
        <span className="race-corner">Step</span>
        {steps.map((label, i) => (
          <span className="race-step" key={label}>
            {label}
            <span>{String(i + 1).padStart(2, '0')}</span>
          </span>
        ))}
      </div>
      {tracks.map((track) => (
        <div className={`race-track race-${track.tone}`} key={track.key}>
          <div className="race-name">
            {track.name}
            <small>{track.sub}</small>
          </div>
          <div className="race-cells" role="list" aria-label={`${track.key} progress`}>
            {track.states.map((state, i) => (
              <div
                key={i}
                role="listitem"
                aria-label={`${steps[i]}: ${state}`}
                title={`${steps[i]}: ${state}`}
                className={`race-cell ${state === 'completed' ? 'done' : ''} ${state === 'failed' ? 'failed' : ''} ${state === 'current' ? 'current' : ''} ${state === 'pending' || state === 'skipped' ? 'muted' : ''}`}
              >
                <span className="race-dot">
                  {state === 'completed' && <IconCheck size={11} strokeWidth={3} />}
                  {state === 'failed' && <IconX size={11} strokeWidth={3} />}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {outcomes}
    </div>
  )
}
