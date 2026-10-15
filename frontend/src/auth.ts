export const DEMO_USERNAME = 'operator'
export const DEMO_PASSWORD = 'reflex2026'

const SESSION_KEY = 'reflex-demo-session'

export function authenticate(username: string, password: string): boolean {
  if (username.trim() !== DEMO_USERNAME || password !== DEMO_PASSWORD) return false
  window.localStorage.setItem(SESSION_KEY, username.trim())
  return true
}

export function currentUser(): string | null {
  return window.localStorage.getItem(SESSION_KEY)
}

export function signOut(): void {
  window.localStorage.removeItem(SESSION_KEY)
}
