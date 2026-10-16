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
      {right && <div className="con-row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>{right}</div>}
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

export function Chip({
  tone = 'mute',
  children,
}: {
  tone?: 'ok' | 'warn' | 'bad' | 'mute' | 'reflex'
  children: ReactNode
}) {
  return <span className={`chip chip-${tone}`}>{children}</span>
}

/** Miniature status line. */
export function SeamStrip({ variant = 'healed' }: { variant?: 'healed' | 'fault' }) {
  if (variant === 'fault') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0' }}>
        <span style={{ height: 2, flex: '0 0 40%', background: 'var(--brand-red)', borderRadius: 2 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--brand-red)', fontFamily: 'var(--font-mono)' }}>BROKEN</span>
        <span style={{ height: 2, flex: 1, borderTop: '2px dashed var(--neutral-grey-border)' }} />
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '8px 0' }}>
      <span style={{ height: 2, flex: '0 0 30%', background: 'var(--neutral-grey)', borderRadius: 2 }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--reflex-cyan)', fontFamily: 'var(--font-mono)' }}>HEALED</span>
      <span style={{ height: 2, flex: 1, background: 'var(--reflex-cyan)', borderRadius: 2 }} />
    </div>
  )
}

export function Metric({
  label,
  value,
  tone,
}: {
  label: string
  value: ReactNode
  tone?: 'ok' | 'bad' | 'warn' | 'reflex'
}) {
  return (
    <div>
      <div className="con-label">{label}</div>
      <div
        className={`con-mono ${
          tone === 'ok'
            ? 'con-accent'
            : tone === 'bad'
            ? 'con-bad'
            : tone === 'warn'
            ? 'con-warn'
            : ''
        }`}
        style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}
      >
        {value}
      </div>
    </div>
  )
}
