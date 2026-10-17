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

  it('never mentions the LLM fallback unless the backend reports it enabled', async () => {
    function stub(jsonBody: unknown) {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true, status: 200, json: () => Promise.resolve(jsonBody), text: () => '',
      } as unknown as Response)))
    }
    // Flag off (the real default): no fallback claim at all.
    stub({ overall: {}, available: false, status: { mock_api_reachable: true, llm_repair_enabled: false } })
    renderLanding()
    await screen.findByText('HEALED')
    expect(screen.queryByText(/LLM fallback/)).not.toBeInTheDocument()
  })
})
