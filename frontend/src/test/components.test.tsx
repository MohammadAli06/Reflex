import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge, outcomeTone } from '../components/StatusBadge'
import { RefusalPanel } from '../components/RefusalPanel'
import { EmptyState } from '../components/StateViews'
import { DataTable } from '../components/DataTable'
import { JsonViewer } from '../components/JsonViewer'

describe('StatusBadge', () => {
  it('maps outcomes to tones', () => {
    expect(outcomeTone('recovered')).toBe('success')
    expect(outcomeTone('refused')).toBe('refusal')
    expect(outcomeTone('failed')).toBe('failure')
  })

  it('renders the label text', () => {
    render(<StatusBadge label="recovered" />)
    expect(screen.getByText('recovered')).toBeInTheDocument()
  })
})

describe('RefusalPanel', () => {
  it('shows the reason and an explanation', () => {
    render(<RefusalPanel reasonCode="missing_credential" />)
    expect(screen.getByText('missing_credential')).toBeInTheDocument()
    expect(screen.getByText(/no value in the secrets store/i)).toBeInTheDocument()
  })
})

describe('DataTable', () => {
  it('renders rows and an empty state', () => {
    const { rerender } = render(
      <DataTable columns={[{ key: 'a', header: 'A' }]} rows={[{ a: 1 }, { a: 2 }]} />,
    )
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()

    rerender(<DataTable columns={[{ key: 'a', header: 'A' }]} rows={[]} emptyMessage="nothing" />)
    expect(screen.getByText('nothing')).toBeInTheDocument()
  })
})

describe('JsonViewer', () => {
  it('redacts secret-like keys', () => {
    render(<JsonViewer value={{ api_key: 'super-secret', name: 'safe' }} />)
    expect(screen.queryByText(/super-secret/)).not.toBeInTheDocument()
    expect(screen.getByText(/\*\*\*redacted\*\*\*/)).toBeInTheDocument()
    expect(screen.getByText(/safe/)).toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('renders message and hint', () => {
    render(<EmptyState message="No data" hint="Do something" />)
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByText('Do something')).toBeInTheDocument()
  })
})
