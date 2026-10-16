import { useState } from 'react'
import { IconCheck, IconCopy } from './Icons'

export function CopyButton({
  text,
  truncateLength = 8,
  showFullOnHover = true,
  hideText = false,
  className = '',
}: {
  text: string | null | undefined
  truncateLength?: number
  showFullOnHover?: boolean
  hideText?: boolean
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  if (!text) return <span className="text-muted">—</span>

  const display = truncateLength > 0 && text.length > truncateLength ? `${text.slice(0, truncateLength)}…` : text

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <span
      className={`copy-pill ${className}`}
      title={showFullOnHover ? text : undefined}
    >
      {!hideText && <code className="copy-text">{display}</code>}
      <button
        type="button"
        className="copy-btn"
        onClick={handleCopy}
        aria-label="Copy to clipboard"
        title={copied ? 'Copied!' : 'Copy to clipboard'}
      >
        {copied ? (
          <span className="copy-success"><IconCheck size={12} strokeWidth={2.5} /></span>
        ) : (
          <IconCopy size={12} />
        )}
      </button>
    </span>
  )
}

