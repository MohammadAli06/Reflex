import { FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import '../login.css'

export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim() || !password) { setError('USERNAME_AND_PASSWORD_REQUIRED'); return }
    navigate('/console')
  }
  return <main className="login-page">
    <div className="login-telemetry login-telemetry-left">NODE: AUTH_GATEWAY_01 // TLS: VERIFIED</div>
    <div className="login-telemetry login-telemetry-right">REGISTRY_STATE: STABLE_MUTABLE</div>
    <section className="login-panel" aria-labelledby="login-title">
      <Link className="login-brand" to="/" aria-label="Return to Reflex home">reflex<span className="login-brand-dot" /></Link>
      <div className="login-heading"><span className="login-kicker"><span className="login-kicker-dot" /> SECURE OPERATOR ACCESS</span><h1 id="login-title">Resume the repair loop.</h1><p>Sign in to inspect drift events, approve safety boundaries, and review the audit trail.</p></div>
      <form className="login-form" onSubmit={handleSubmit} noValidate>
        <label className="login-field" htmlFor="username"><span>USERNAME / OPERATOR ID</span><input id="username" name="username" autoComplete="username" value={username} onChange={(event) => { setUsername(event.target.value); setError('') }} placeholder="operator@reflex.dev" /></label>
        <label className="login-field" htmlFor="password"><span>PASSWORD</span><span className="login-password-wrap"><input id="password" name="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => { setPassword(event.target.value); setError('') }} placeholder="Enter your password" /><button className="login-visibility" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? 'HIDE' : 'SHOW'}</button></span></label>
        {error && <p className="login-error" role="alert">// {error}</p>}
        <button className="login-submit" type="submit">Authenticate <span aria-hidden="true">→</span></button>
      </form>
      <div className="login-foot"><span>ACCESS_LEVEL: OPERATOR</span><span>SESSION: ENCRYPTED</span></div>
    </section>
    <aside className="login-art" aria-hidden="true"><div className="login-art-copy"><span>// IDENTITY VERIFICATION</span><strong>Authentication is<br />a safety boundary.</strong><p>Every action in the repair loop is attributable, reviewable, and retained in the audit log.</p></div><div className="login-seam"><span className="login-line" /><span className="login-break">×</span><span className="login-stitches"><i /><i /><i /><i /><i /></span><span className="login-line login-line-healed" /></div><div className="login-art-meta"><span>UNVERIFIED</span><span>IDENTITY_ASSERTED</span></div></aside>
  </main>
}
