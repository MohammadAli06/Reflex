import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { CopyButton } from './ui/CopyButton'
import {
  IconActivity,
  IconBarChart,
  IconDatabase,
  IconGitBranch,
  IconInfo,
  IconShieldCheck,
  IconLayoutDashboard,
  IconMoon,
  IconSun,
} from './ui/Icons'
import { applyTheme, getInitialTheme, type Theme } from '../utils/theme'
import { ErrorBoundary } from './ErrorBoundary'

const NAV = [
  { to: '/console', label: 'Overview', icon: IconLayoutDashboard, end: true, section: 'Monitor' },
  { to: '/console/schema', label: 'Schema', icon: IconGitBranch, section: 'Monitor' },
  { to: '/console/compare', label: 'Comparison', icon: IconActivity, section: 'Benchmark' },
  { to: '/console/runs', label: 'Runs', icon: IconDatabase, section: 'Benchmark' },
  { to: '/console/benchmarks', label: 'Benchmarks', icon: IconBarChart, section: 'Benchmark' },
  { to: '/console/safety', label: 'Safety', icon: IconShieldCheck, section: 'Control' },
  { to: '/console/settings', label: 'Settings', icon: IconInfo, section: 'Control' },
]

export function AppShell({ children, user }: { children?: ReactNode; user?: { username: string } }) {
  const { data } = useApi(() => api.status(), [])
  const [theme, setTheme] = useState<Theme>(getInitialTheme)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()
  const userInitial = (user?.username[0] ?? 'O').toUpperCase()

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    applyTheme(next)
  }

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  async function signOut() {
    try {
      await api.logout()
    } finally {
      navigate('/login')
    }
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
          <NavLink to="/console" className="con-wordmark-wrap">
            <span className="con-brand-logo">R</span>
            <span className="con-brand-name">Reflex Registry</span>
          </NavLink>
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

          <div className="con-user" ref={menuRef} style={{ position: 'relative' }}>
            <button
              type="button"
              className="con-avatar"
              aria-label="Open user menu"
              aria-expanded={menuOpen}
              title={user?.username ?? 'Operator'}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {userInitial}
            </button>
            {menuOpen && (
              <div
                role="menu"
                aria-label="User menu"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  zIndex: 60,
                  minWidth: 190,
                  padding: 10,
                  border: '1px solid var(--border, #2a2a35)',
                  borderRadius: 10,
                  background: 'var(--panel, #14141d)',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
                }}
              >
                <div className="con-row" style={{ fontSize: 12, marginBottom: 8 }}>
                  <span style={{ opacity: 0.7 }}>Operator</span>
                  <b>{user?.username ?? '—'}</b>
                </div>
                <button
                  type="button"
                  className="cbtn cbtn-sm cbtn-ghost"
                  role="menuitem"
                  onClick={() => void signOut()}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <aside className="con-aside">
        <nav className="con-nav" aria-label="Console sections">
          {NAV.map((item, index) => {
            const Icon = item.icon
            const showSection = index === 0 || NAV[index - 1].section !== item.section
            return (
              <Fragment key={item.to}>
                {showSection && (
                  <div className="con-nav-section" role="presentation">
                    {item.section}
                  </div>
                )}
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  <span className="con-nav-icon">
                    <Icon size={16} />
                  </span>
                  <span>{item.label}</span>
                </NavLink>
              </Fragment>
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
        <main className="con-main">
          <ErrorBoundary>{children ?? <Outlet />}</ErrorBoundary>
        </main>
      </div>
    </div>
  )
}
