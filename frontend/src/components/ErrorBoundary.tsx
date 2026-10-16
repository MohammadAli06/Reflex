import { Component, type ErrorInfo, type ReactNode } from 'react'
import { IconAlertTriangle, IconRefresh } from './ui/Icons'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Reflex ErrorBoundary caught an error:', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="con-page" style={{ padding: '32px' }}>
          <div className="state state-error" role="alert" style={{ gap: 16, padding: '24px' }}>
            <div className="con-row" style={{ gap: 12 }}>
              <IconAlertTriangle size={24} />
              <div>
                <strong style={{ fontSize: 16 }}>An error occurred while rendering this page</strong>
                <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                  {this.state.error?.message || 'Unknown render error'}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="cbtn cbtn-sm cbtn-primary"
              onClick={this.handleReset}
              style={{ marginTop: 8 }}
            >
              <IconRefresh size={14} />
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
