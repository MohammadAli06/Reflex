const SENSITIVE = ['key', 'token', 'secret', 'authorization', 'password', 'credential']
const REDACTED = '***redacted***'

function redact(value: unknown, keyName?: string): unknown {
  if (keyName && SENSITIVE.some((part) => keyName.toLowerCase().includes(part))) {
    return REDACTED
  }
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, redact(val, key)]),
    )
  }
  return value
}

export function JsonViewer({ value, label }: { value: unknown; label?: string }) {
  const safe = redact(value)
  return (
    <div className="json-viewer">
      {label && <div className="json-label muted">{label}</div>}
      <pre>{JSON.stringify(safe, null, 2)}</pre>
    </div>
  )
}
