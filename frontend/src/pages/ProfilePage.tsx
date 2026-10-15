import { useNavigate } from 'react-router-dom'
import { currentUser, signOut } from '../auth'
import { Chip, PageHead, Panel, SeamStrip } from '../components/console'

export function ProfilePage() {
  const navigate = useNavigate()
  const username = currentUser() ?? 'operator'
  function handleSignOut() { signOut(); navigate('/login', { replace: true }) }
  return <div className="con-page">
    <PageHead eyebrow={<>// OPERATOR IDENTITY</>} title="Profile" subtitle="Authenticated local demo session" />
    <div className="con-grid-2 profile-grid">
      <Panel title="Operator details" footer={<><span>SESSION: ACTIVE</span><span className="panel-foot-ok">IDENTITY VERIFIED</span></>}>
        <div className="profile-identity"><span className="profile-avatar">{username.slice(0, 1).toUpperCase()}</span><div><strong>{username}</strong><span>Reflex operator</span></div></div>
        <dl className="con-kv profile-kv"><div><dt>Access level</dt><dd><Chip tone="ok">Operator</Chip></dd></div><div><dt>Authentication</dt><dd className="con-accent">Demo local session</dd></div><div><dt>Audit attribution</dt><dd>{username}</dd></div><div><dt>Session state</dt><dd className="con-accent">Active</dd></div></dl>
      </Panel>
      <Panel title="Session controls"><p className="profile-copy">Signing out ends this local demo session and returns you to the operator sign-in page.</p><SeamStrip /><button className="profile-signout" type="button" onClick={handleSignOut}>Sign out <span aria-hidden="true">→</span></button></Panel>
    </div>
  </div>
}
