import type { ReactNode } from 'react'

export function PageHead({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow: ReactNode
  title: string
  subtitle?: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="con-head">
      <div>
        <div className="con-eyebrow">{eyebrow}</div>
        <h1 className="con-h1">{title}</h1>
        {subtitle && <p className="con-sub">{subtitle}</p>}
      </div>
      {right && <div className="con-row">{right}</div>}
    </div>
  )
}

export function Panel({
  title,
  actions,
  children,
  footer,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <section className="panel">
      {(title || actions) && (
        <header className="panel-head">
          {title && <span className="con-h2">{title}</span>}
          {actions && <div className="con-row">{actions}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
      {footer && <div className="panel-foot">{footer}</div>}
    </section>
  )
}

export function Chip({ tone = 'mute', children }: { tone?: 'ok' | 'warn' | 'bad' | 'mute'; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

/** Miniature "continuum" seam: healthy line -> suture -> healthy line. */
export function SeamStrip({ variant = 'healed' }: { variant?: 'healed' | 'fault' }) {
  if (variant === 'fault') {
    return (
      <div className="seam-strip">
        <span className="seam-line" style={{ maxWidth: '38%' }} />
        <span className="seam-fault">
          <span className="seam-cap" />
          <span className="seam-gap" />
          <span className="seam-cap" />
        </span>
        <span className="seam-line" style={{ flex: 1, background: 'transparent', borderTop: '1px dotted var(--c-outline-variant)' }} />
      </div>
    )
  }
  return (
    <div className="seam-strip">
      <span className="seam-line" style={{ maxWidth: '26%' }} />
      <span className="seam-stitches">
        <span className="seam-stitch" />
        <span className="seam-stitch" />
        <span className="seam-stitch" />
      </span>
      <span className="seam-line seam-line-ok" style={{ flex: 1 }} />
    </div>
  )
}

export function Metric({ label, value, tone }: { label: string; value: ReactNode; tone?: 'ok' | 'bad' | 'warn' }) {
  return (
    <div>
      <div className="con-label">{label}</div>
      <div className={`con-mono ${tone === 'ok' ? 'con-accent' : tone === 'bad' ? 'con-bad' : tone === 'warn' ? 'con-warn' : ''}`}>
        {value}
      </div>
    </div>
  )
}
