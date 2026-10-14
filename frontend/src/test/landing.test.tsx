import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LandingPage } from '../pages/LandingPage'

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  )
}

describe('LandingPage', () => {
  beforeEach(() => {
    // No backend in the test environment: metrics must degrade to an em dash.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  })

  it('renders the hero and the console call to action', () => {
    renderLanding()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/APIs change/i)
    // Two console CTAs by design: hero and closing section.
    expect(screen.getAllByRole('link', { name: /open console/i }).length).toBeGreaterThanOrEqual(1)
  })

  it('renders the three terminal outcomes', () => {
    renderLanding()
    expect(screen.getByText('HEALED')).toBeInTheDocument()
    expect(screen.getByText('REFUSED')).toBeInTheDocument()
    expect(screen.getByText('NOT DRIFT')).toBeInTheDocument()
  })

  it('shows an em dash instead of a fabricated metric when no run data exists', () => {
    renderLanding()
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })
})
