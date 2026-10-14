export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="state state-loading">{label}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="state state-empty">
      <strong>{message}</strong>
      {hint && <span className="muted">{hint}</span>}
    </div>
  )
}
