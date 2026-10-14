export const DASH = '—'

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return DASH
  return `${(value * 100).toFixed(digits)}%`
}

export function secs(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined) return DASH
  return `${value.toFixed(digits)}s`
}

export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : String(value)
}

export function shortHash(value: string | null | undefined, length = 12): string {
  if (!value) return DASH
  return value.slice(0, length)
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return DASH
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return DASH
  const delta = Math.max(0, Date.now() - then)
  const mins = Math.floor(delta / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return DASH
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return DASH
  return date.toLocaleTimeString(undefined, { hour12: false })
}

export function deltaPct(base: number | null | undefined, heal: number | null | undefined): string {
  if (base === null || base === undefined || heal === null || heal === undefined) return DASH
  const diff = (heal - base) * 100
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff.toFixed(1)}%`
}
