import type { ReactNode } from 'react'

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="stat-block">
      <div>
        <div className="con-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="text-label">{label}</div>
          {icon && <span style={{ color: 'var(--text-muted)' }}>{icon}</span>}
        </div>
        <div className="stat-big">{value}</div>
      </div>
      {hint && <div className="stat-foot">{hint}</div>}
    </div>
  )
}

export function Card({
  title,
  children,
  actions,
}: {
  title?: string
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="text-h2">{title}</h2>}
          {actions && <div className="con-row">{actions}</div>}
        </header>
      )}
      <div className="card-body">{children}</div>
    </section>
  )
}
