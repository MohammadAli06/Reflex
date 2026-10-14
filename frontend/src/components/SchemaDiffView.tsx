export interface SchemaDiffData {
  endpoint?: string
  removed?: string[]
  added?: string[]
  type_changed?: { path: string; from: string | null; to: string | null }[]
  added_headers?: { name: string; format?: string | null }[]
}

export function SchemaDiffView({ diff }: { diff: SchemaDiffData }) {
  const hasContent =
    (diff.removed?.length ?? 0) +
      (diff.added?.length ?? 0) +
      (diff.type_changed?.length ?? 0) +
      (diff.added_headers?.length ?? 0) >
    0
  return (
    <div className="schema-diff">
      {diff.endpoint && <div className="muted">{diff.endpoint}</div>}
      {!hasContent && <div className="muted">no relevant change</div>}
      {diff.removed?.map((path) => (
        <div key={`rm-${path}`} className="diff-line diff-removed">
          − {path}
        </div>
      ))}
      {diff.added?.map((path) => (
        <div key={`ad-${path}`} className="diff-line diff-added">
          + {path}
        </div>
      ))}
      {diff.type_changed?.map((change) => (
        <div key={`tc-${change.path}`} className="diff-line diff-changed">
          ± {change.path}: {change.from} → {change.to}
        </div>
      ))}
      {diff.added_headers?.map((header) => (
        <div key={`hd-${header.name}`} className="diff-line diff-added">
          + header {header.name}
        </div>
      ))}
    </div>
  )
}
