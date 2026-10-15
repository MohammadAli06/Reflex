import type { ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { currentUser } from '../auth'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { shortHash } from '../utils/format'
import '../console.css'

const NAV = [
  { to: '/console', label: 'Dashboard', end: true },
  { to: '/console/schema', label: 'Schema Mutation' },
  { to: '/console/compare', label: 'Agent Comparison' },
  { to: '/console/trace', label: 'Trace' },
  { to: '/console/audit', label: 'Audit Log' },
  { to: '/console/results', label: 'Results & Metrics' },
  { to: '/console/safety', label: 'Safety' },
]

function StatusItem({ ok, label, state }: { ok: boolean; label: string; state: string }) {
  return (
    <div className="con-status-item">
      <span className={`con-dot ${ok ? 'con-dot-ok' : 'con-dot-down'}`} />
      <b>{label}</b>
      <span>{state}</span>
    </div>
  )
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { data } = useApi(() => api.status(), [])
  const userInitial = (currentUser()?.[0] ?? 'O').toUpperCase()

  return (
    <div className="console">
      <header className="con-header">
        <div className="con-brand">
          <span className="con-wordmark">
            reflex<span className="con-wordmark-dot" />
          </span>
          <span className="con-brand-name">Reflex Registry</span>
        </div>
        <div className="con-status">
          <StatusItem ok={Boolean(data?.mock_api_reachable)} label="Mock API" state={data?.mock_api_reachable ? 'operational' : 'down'} />
          <span className="con-sep" />
          <StatusItem ok={data?.control_api === 'ok'} label="Control API" state={data?.control_api === 'ok' ? 'operational' : 'down'} />
          <span className="con-sep" />
          <StatusItem ok={Boolean(data?.llm_configured)} label="LLM" state={data?.llm_configured ? 'configured' : 'unconfigured'} />
          <span className="con-idle">{data?.busy ? 'RUNNING · BUSY' : 'IDLE · READY'}</span>
          <Link className="con-avatar" to="/console/profile" aria-label="Open profile">
            {userInitial}
          </Link>
        </div>
      </header>

      <aside className="con-aside">
        <nav className="con-nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="con-nav-foot">
          schema v{data?.schema_version ?? '—'} · {shortHash(data?.schema_hash ?? undefined, 12)}
        </div>
      </aside>

      <div className="con-body">
        <main className="con-main">{children ?? <Outlet />}</main>
      </div>
    </div>
  )
}
