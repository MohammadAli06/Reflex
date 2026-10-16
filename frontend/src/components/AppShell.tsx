import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { currentUser } from '../auth'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { CopyButton } from './ui/CopyButton'
import {
  IconActivity,
  IconBarChart,
  IconDatabase,
  IconFileText,
  IconGitBranch,
  IconLayoutDashboard,
  IconMoon,
  IconShieldCheck,
  IconSun,
} from './ui/Icons'
import { applyTheme, getInitialTheme, type Theme } from '../utils/theme'

const NAV = [
  { to: '/console', label: 'Dashboard', icon: IconLayoutDashboard, end: true },
  { to: '/console/schema', label: 'Schema', icon: IconGitBranch },
  { to: '/console/compare', label: 'Compare', icon: IconActivity },
  { to: '/console/trace', label: 'Trace', icon: IconFileText },
  { to: '/console/audit', label: 'Audit log', icon: IconDatabase },
  { to: '/console/results', label: 'Results', icon: IconBarChart },
  { to: '/console/safety', label: 'Safety', icon: IconShieldCheck },
]

export function AppShell({ children }: { children?: ReactNode }) {
  const { data } = useApi(() => api.status(), [])
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const userInitial = (currentUser()?.[0] ?? 'O').toUpperCase()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    applyTheme(next)
  }

  const mockOk = data?.mock_api_reachable === true
  const controlOk = data?.control_api === 'ok'
  const tip = [
    `Mock API: ${mockOk ? 'reachable' : 'unreachable'}`,
    `Control API: ${controlOk ? 'ok' : 'down'}`,
    `LLM: ${data?.llm_configured ? 'connected' : 'rule-based engine'}`,
  ].join(' · ')

  return (
    <div className="console">
      <header className="con-header">
        <div className="con-brand">
          <Link to="/console" className="con-wordmark-wrap">
            <span className="con-brand-logo">R</span>
            <span className="con-brand-name">Reflex Registry</span>
          </Link>
        </div>

        <div className="con-status">
          <span
            className="sys-status"
            data-tip={tip}
            title={tip}
            role="status"
            aria-label={`System status. ${tip}`}
          >
            <span>System status</span>
            <span className={`con-dot ${mockOk ? 'con-dot-ok' : 'con-dot-down'}`} title="Mock API" />
            <span className={`con-dot ${controlOk ? 'con-dot-ok' : 'con-dot-down'}`} title="Control API" />
            <span className={`con-dot ${data?.llm_configured ? 'con-dot-ok' : 'con-dot-neutral'}`} title={data?.llm_configured ? 'LLM connected' : 'Rule-based engine'} />
            {!data?.llm_configured && <span style={{ fontWeight: 500 }}>Rule-based engine</span>}
          </span>

          <span className="con-idle">
            {data?.busy ? 'Running' : 'Ready'}
          </span>

          <button
            type="button"
            className="con-theme-toggle"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? <IconMoon size={15} /> : <IconSun size={15} />}
          </button>

          <Link className="con-avatar" to="/console/profile" aria-label="Open profile" title="User Profile">
            {userInitial}
          </Link>
        </div>
      </header>

      <aside className="con-aside">
        <nav className="con-nav" aria-label="Console sections">
          {NAV.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                <span className="con-nav-icon">
                  <Icon size={16} />
                </span>
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>

        <div className="con-nav-foot">
          <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
            <span>Schema</span>
            <b>v{data?.schema_version ?? '—'}</b>
          </div>
          <div className="con-row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
            <span>Hash</span>
            <CopyButton text={data?.schema_hash ?? null} truncateLength={8} />
          </div>
        </div>
      </aside>

      <div className="con-body">
        <main className="con-main">{children ?? <Outlet />}</main>
      </div>
    </div>
  )
}
