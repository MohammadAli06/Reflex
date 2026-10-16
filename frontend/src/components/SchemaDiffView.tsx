import { IconAlertTriangle, IconCheck, IconX } from './ui/Icons'

export interface SchemaDiffData {
  endpoint?: string
  removed?: string[]
  added?: string[]
  type_changed?: { path: string; from: string | null; to: string | null }[]
  added_headers?: Array<{ name: string; format?: string | null } | string | Record<string, unknown>>
  removed_headers?: Array<{ name: string } | string | Record<string, unknown>>
}

function parseHeader(item: unknown): { name: string; format?: string | null } {
  if (typeof item === 'string') return { name: item }
  if (item && typeof item === 'object') {
    const obj = item as Record<string, unknown>
    return {
      name: String(obj.name ?? obj.header ?? JSON.stringify(obj)),
      format: obj.format ? String(obj.format) : null,
    }
  }
  return { name: String(item) }
}

export function SchemaDiffView({ diff }: { diff: SchemaDiffData }) {
  const removed = diff.removed ?? []
  const added = diff.added ?? []
  const typeChanged = diff.type_changed ?? []
  const addedHeaders = (diff.added_headers ?? []).map(parseHeader)

  const hasContent =
    removed.length + added.length + typeChanged.length + addedHeaders.length > 0

  return (
    <div className="schema-diff" style={{ padding: '8px 0', gap: 6 }}>
      {diff.endpoint && (
        <div className="con-row" style={{ gap: 6, marginBottom: 4 }}>
          <span className="text-label" style={{ fontSize: 10 }}>Target endpoint:</span>
          <code style={{ fontSize: 11, fontWeight: 600 }}>{diff.endpoint}</code>
        </div>
      )}

      {!hasContent && (
        <div className="text-muted" style={{ fontSize: 12, fontStyle: 'italic' }}>
          No relevant schema change detected.
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {removed.map((path) => (
          <span key={`rm-${path}`} className="diff-line diff-removed" title={`Removed field: ${path}`}>
            <IconX size={11} strokeWidth={3} />
            <span>removed <b>{path}</b></span>
          </span>
        ))}

        {added.map((path) => (
          <span key={`ad-${path}`} className="diff-line diff-added" title={`Added field: ${path}`}>
            <IconCheck size={11} strokeWidth={3} />
            <span>added <b>{path}</b></span>
          </span>
        ))}

        {typeChanged.map((change) => (
          <span
            key={`tc-${change.path}`}
            className="diff-line diff-changed"
            title={`Type changed for ${change.path}`}
          >
            <IconAlertTriangle size={11} />
            <span>
              <b>{change.path}</b>: {String(change.from ?? 'unknown')} → {String(change.to ?? 'unknown')}
            </span>
          </span>
        ))}

        {addedHeaders.map((header) => (
          <span
            key={`hd-${header.name}`}
            className="diff-line diff-added"
            title={`Added header: ${header.name}${header.format ? ` (${header.format})` : ''}`}
          >
            <IconCheck size={11} strokeWidth={3} />
            <span>
              + header <b>{header.name}</b>
              {header.format && (
                <span className="text-muted" style={{ marginLeft: 4 }}>
                  ({header.format})
                </span>
              )}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}
