import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api/client'
import { IconEye, IconEyeOff } from '../components/ui/Icons'

export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password) { setError('Enter your username and password to continue.'); return }
    try {
      await api.login(username.trim(), password)
      navigate('/console', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Those credentials were not recognized.' : 'Unable to sign in. Try again.')
    }
  }
  return <main className="login-split">
    <section className="login-form-col" aria-labelledby="login-title">
      <div className="login-form-inner">
        <Link className="login-wordmark" to="/" aria-label="Return to Reflex home">
          <span className="login-wordmark-mark">R</span>
          <span>Reflex Registry</span>
        </Link>
        <h1 id="login-title" className="login-title">Sign in to Reflex</h1>
        <p className="login-sub">Monitor API drift and review every automated repair.</p>
        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: 16 }}>
            <label className="login-label" htmlFor="username">Username</label>
            <input className="login-input" id="username" name="username" autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); setError('') }} placeholder="operator" />
          </div>
          <div>
            <label className="login-label" htmlFor="password">Password</label>
            <span className="login-password-wrap">
              <input className="login-input" id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setError('') }} placeholder="Enter your password" />
              <button className="login-visibility" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'} title={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <IconEyeOff size={17} /> : <IconEye size={17} />}
              </button>
            </span>
          </div>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="login-submit" type="submit">Sign in</button>
        </form>
      </div>
    </section>
    <aside className="login-brand-col" aria-hidden="true">
      <div className="login-brand-inner">
        <h2 className="login-brand-head">APIs change. Your agent shouldn&apos;t break.</h2>
        <p className="login-brand-sub">Reflex watches your API contracts, adapts to breaking changes in memory, and stops safely when a change can&apos;t be proven correct.</p>
        <div className="login-diff">
          <div className="login-diff-bar"><i /><i /><i /></div>
          <div className="login-diff-body">
            <div className="login-diff-old">{'{"user_id": "123"}'}</div>
            <div className="login-diff-new">{'{"target": {"id": 123}}'}</div>
            <div className="login-diff-header">+ header X-Tenant-Token</div>
            <div className="login-diff-status"><span className="con-dot" />Patched in memory, no restart</div>
          </div>
        </div>
        <ul className="login-proofs">
          <li>
            <span className="login-proof-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
            </span>
            <span><strong>Detects drift</strong><span>Notices when a working request starts failing.</span></span>
          </li>
          <li>
            <span className="login-proof-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </span>
            <span><strong>Validates before patching</strong><span>Checks the fix against the live schema first.</span></span>
          </li>
          <li>
            <span className="login-proof-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            </span>
            <span><strong>Refuses when unsafe</strong><span>Stops and logs the decision instead of guessing.</span></span>
          </li>
        </ul>
      </div>
    </aside>
  </main>
}
