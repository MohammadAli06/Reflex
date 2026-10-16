export type Theme = 'light' | 'dark'

export function getInitialTheme(): Theme {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return 'light'
  const saved = localStorage.getItem('reflex-theme') as Theme | null
  if (saved === 'dark' || saved === 'light') return saved
  return 'light' // default is light theme
}

export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('reflex-theme', theme)
  }
}
