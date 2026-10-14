import { NavLink } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/schema', label: 'Schema Mutation' },
  { to: '/compare', label: 'Agent Comparison' },
  { to: '/audit', label: 'Audit Log' },
  { to: '/results', label: 'Results & Metrics' },
  { to: '/safety', label: 'Safety Demo' },
]

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="status-dot-wrap" title={`${label}: ${ok ? 'ok' : 'down'}`}>
      <span className={`status-dot ${ok ? 'dot-ok' : 'dot-down'}`} />
      {label}
    </span>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data } = useApi(() => api.status(), [])

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          Reflex <span className="muted">· Self-Healing Tool Registry</span>
        </div>
        <div className="topbar-status">
          <Dot ok={Boolean(data?.mock_api_reachable)} label="Mock API" />
          <Dot ok={data?.control_api === 'ok'} label="Control API" />
          <Dot ok={Boolean(data?.llm_configured)} label="LLM" />
          {data?.busy && <span className="badge badge-warning">busy</span>}
        </div>
      </header>
      <div className="layout">
        <nav className="sidebar">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  )
}
