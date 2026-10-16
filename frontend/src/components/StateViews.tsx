import { IconAlertCircle, IconInfo, IconRefresh } from './ui/Icons'

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state state-loading" style={{ gap: 12, padding: '48px 24px' }}>
      <span className="con-accent" style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}>
        <IconRefresh size={20} />
      </span>
      <span>{label}</span>
      <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state-error" role="alert" style={{ gap: 12 }}>
      <div className="con-row" style={{ gap: 8 }}>
        <IconAlertCircle size={18} />
        <span style={{ fontWeight: 500 }}>{message}</span>
      </div>
      {onRetry && (
        <button type="button" className="cbtn cbtn-sm" onClick={onRetry} style={{ marginTop: 4 }}>
          <IconRefresh size={13} />
          Retry
        </button>
      )}
    </div>
  )
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="state state-empty" style={{ gap: 8, padding: '40px 24px' }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>
        <IconInfo size={24} />
      </div>
      <strong>{message}</strong>
      {hint && <span className="text-muted" style={{ fontSize: 13, maxWidth: 440 }}>{hint}</span>}
    </div>
  )
}
