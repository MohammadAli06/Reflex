import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../hooks/useApi'
import { Chip, PageHead, Panel } from '../components/console'

export function ProfilePage() {
  const navigate = useNavigate()
  const session = useApi(() => api.me(), [])
  const username = session.data?.username ?? '—'
  async function handleSignOut() { await api.logout(); navigate('/login', { replace: true }) }
  return <div className="con-page">
    <PageHead eyebrow={<span>Signed-in account</span>} title="Profile" subtitle="HttpOnly session managed by the control API." />
    <div className="con-grid-2 profile-grid">
      <Panel title="Account" footer={<><span>Session active</span><span className="panel-foot-ok">Signed in</span></>}>
        <div className="profile-identity"><span className="profile-avatar">{username.slice(0, 1).toUpperCase()}</span><div><strong>{username}</strong><span>Operator</span></div></div>
        <dl className="con-kv profile-kv"><div><dt>Access level</dt><dd><Chip tone="ok">Operator</Chip></dd></div><div><dt>Authentication</dt><dd className="con-accent">Secure cookie session</dd></div><div><dt>Audit attribution</dt><dd>{username}</dd></div><div><dt>Session state</dt><dd className="con-accent">Active</dd></div></dl>
      </Panel>
      <Panel title="Sign out"><p className="profile-copy">Signing out ends this browser session and returns you to the sign-in page.</p><button className="profile-signout" type="button" onClick={handleSignOut}>Sign out <span aria-hidden="true">→</span></button></Panel>
    </div>
  </div>
}
