import { IconCheck, IconX } from './Icons'

export interface StepInfo {
  label: string
  sublabel?: string
  status: 'pending' | 'current' | 'completed' | 'failed' | 'skipped'
  tooltip?: string
}

export function HorizontalStepper({
  steps,
  theme = 'reflex',
  className = '',
}: {
  steps: StepInfo[]
  theme?: 'baseline' | 'reflex'
  className?: string
}) {
  return (
    <div className={`stepper-track stepper-${theme} ${className}`}>
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1
        return (
          <div
            key={idx}
            className={`stepper-step stepper-step-${step.status}`}
            title={step.tooltip || `${step.label}: ${step.status}`}
          >
            <div className="stepper-node-wrap">
              <div className="stepper-node">
                {step.status === 'completed' && <IconCheck size={11} strokeWidth={3} />}
                {step.status === 'failed' && <IconX size={11} strokeWidth={3} />}
                {step.status === 'current' && <span className="stepper-pulse" />}
                {step.status === 'skipped' && <span className="stepper-dash" />}
                {step.status === 'pending' && <span className="stepper-dot" />}
              </div>
              {!isLast && <div className={`stepper-connector ${step.status === 'completed' ? 'connected' : ''}`} />}
            </div>
            <div className="stepper-content">
              <span className="stepper-num">0{idx + 1}</span>
              <span className="stepper-label">{step.label}</span>
              {step.sublabel && <span className="stepper-sublabel">{step.sublabel}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
