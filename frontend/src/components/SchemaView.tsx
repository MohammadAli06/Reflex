import type { SchemaResponse } from '../types'
import { JsonViewer } from './JsonViewer'

export function SchemaView({ schema }: { schema: SchemaResponse }) {
  return (
    <div className="schema-view">
      <div className="schema-meta">
        <span className="pill">version {schema.version}</span>
        <span className="pill" title={schema.sha256}>
          sha256 {schema.short_hash}
        </span>
        <span className="pill">errors: {schema.error_style}</span>
      </div>
      {schema.required_headers.length > 0 && (
        <div className="schema-headers">
          <strong>Required headers:</strong>{' '}
          {schema.required_headers.map((h) => (
            <span className="pill" key={h.name}>
              {h.name}
            </span>
          ))}
        </div>
      )}
      {Object.entries(schema.request_schemas).map(([endpoint, body]) => (
        <div className="schema-endpoint" key={endpoint}>
          <code className="endpoint">{endpoint}</code>
          <JsonViewer value={body} />
        </div>
      ))}
    </div>
  )
}
