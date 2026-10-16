import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App'
import { AppShell } from '../components/AppShell'
import { RunsPage } from '../pages/RunsPage'
import { BenchmarksPage } from '../pages/BenchmarksPage'

const STATUS = {
  mock_api_reachable: true,
  control_api: 'ok',
  schema_version: 3,
  schema_hash: 'abc123def456',
  llm_configured: false,
  busy: false,
  last_run: null,
  llm_model: 'gemini-test',
  llm_thinking_level: 'low',
  llm_repair_enabled: false,
  max_schema_attempts: 3,
  max_infra_retries: 2,
  schema_signing_enabled: true,
  schema_key_pinned: true,
  spec_watch_interval_s: 5,
}

const RUNS = {
  runs: [
    {
      run_id: 'run-run-1',
      status: 'finished',
      case_ids: ['test_case'],
      repeats: 1,
      started_at: '2026-01-01T00:00:00Z',
      finished_at: '2026-01-01T00:00:05Z',
      error: null,
      records: [{ case_id: 'test_case', agent: 'healing', outcome: 'applied' }],
      event_count: 4,
    },
  ],
}

const AUDIT = {
  entries: [
    {
      ts: '2026-01-01T00:00:00Z',
      run_id: 'run-run-1',
      tool: 'tool_x',
      error: {},
      classification: 'applied',
      schema_version_before: 2,
      schema_version_after: 3,
      schema_sha256: 'a'.repeat(64),
      old_definition: null,
      new_definition: null,
      evidence: [],
      confidence: 0.9,
      outcome: 'applied',
      reason_code: 'field_renamed',
      healing_path: 'rule',
    },
  ],
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
    statusText: 'OK',
  } as Response)
}

function stubFetch(routes: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    '/api/me': { username: 'op' },
    '/api/status': STATUS,
    '/api/runs': RUNS,
    '/api/audit': AUDIT,
    '/api/metrics': { available: false },
    '/api/security/status': {
      chain: { ok: true, checked: 1, first_broken_id: null },
      provenance: { ok: true, signature_verified: true },
      signing_enabled: true,
    },
    '/api/security/sessions': { sessions: [] },
    '/api/cases': { cases: [] },
    '/api/scenarios': { scenarios: [] },
    '/api/realworld/cases': { cases: [], summary: { registered: 0, reviewed: 0, evaluated: 0, recovered: 0, correct_refusals: 0, wrong_patches: 0, failed: 0 } },
    '/api/evaluation/config': { splits: [], error_styles: [], fuzzable_mutations: [], refuse_type_mutations: [] },
  }
  const merged = { ...defaults, ...routes }
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input)
    for (const [path, body] of Object.entries(merged)) {
      if (url.includes(path)) return jsonResponse(body)
    }
    return jsonResponse({ detail: 'not found' }, 404)
  }))
}

/** Stub EventSource: jsdom has none, and the timeline should not need SSE to render. */
beforeEach(() => {
  stubFetch()
  vi.stubGlobal('EventSource', class {
    onopen: (() => void) | null = null
    onmessage: (() => void) | null = null
    onerror: (() => void) | null = null
    constructor(_url: string) {}
    addEventListener() {}
    close() {}
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function PathProbe() {
  const location = useLocation()
  return <div data-testid="path">{location.pathname + location.search}</div>
}

function renderAppAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Routes>
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('console navigation', () => {
  it('renders exactly 7 nav items in the required order', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/console']}>
        <Routes>
          <Route path="/console/*" element={<AppShell user={{ username: 'op' }} />} />
        </Routes>
      </MemoryRouter>,
    )
    const nav = container.querySelector('nav.con-nav') as HTMLElement
    const links = within(nav).getAllByRole('link')
    const labels = links.map((link) => link.textContent?.trim())
    expect(labels).toEqual([
      'Overview',
      'Schema',
      'Comparison',
      'Runs',
      'Benchmarks',
      'Safety',
      'Settings',
    ])
  })
})

describe('old routes redirect', () => {
  const cases: [string, string][] = [
    ['/console/trace', '/console/runs'],
    ['/console/trace/run-run-1', '/console/runs/run-run-1'],
    ['/console/audit', '/console/runs?tab=ledger'],
    ['/console/results', '/console/benchmarks'],
    ['/console/real-world', '/console/benchmarks?tab=real-world'],
    ['/console/evaluation', '/console/benchmarks?tab=reliability'],
    ['/console/security', '/console/settings'],
    ['/console/profile', '/console'],
  ]

  for (const [entry, destination] of cases) {
    it(`${entry} → ${destination}`, async () => {
      renderAppAt(entry)
      await waitFor(() =>
        expect(screen.getByTestId('path')).toHaveTextContent(destination),
      )
    })
  }

  it('hides planned pages with the flag off', async () => {
    vi.stubEnv('VITE_SHOW_PLANNED', '')
    renderAppAt('/console/spec-watch')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/console'))
  })

  it('hides the payments sandbox with the flag off', async () => {
    vi.stubEnv('VITE_SHOW_PLANNED', '')
    renderAppAt('/console/payments-sandbox')
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/console'))
  })

  it('makes planned pages reachable with the flag on', async () => {
    vi.stubEnv('VITE_SHOW_PLANNED', 'true')
    renderAppAt('/console/spec-watch')
    await waitFor(() =>
      expect(screen.getByTestId('path')).toHaveTextContent('/console/spec-watch'),
    )
    expect(await screen.findByRole('heading', { name: 'Spec Watch' })).toBeInTheDocument()
  })
})

describe('Runs page', () => {
  it('shows a timeline with the audit decision pinned below', async () => {
    render(
      <MemoryRouter initialEntries={['/console/runs/run-run-1']}>
        <Routes>
          <Route path="/console/runs/:runId" element={<RunsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    const card = await screen.findByTestId('decision-card')
    expect(within(card).getByText('applied')).toBeInTheDocument()
    expect(within(card).getByText('field_renamed')).toBeInTheDocument()
    expect(within(card).getByText('0.90')).toBeInTheDocument()
    // Short schema hash sliced from the recorded sha256, not invented.
    expect(within(card).getByText('aaaaaaaa')).toBeInTheDocument()
    expect(within(card).getByText('No original definition recorded.')).toBeInTheDocument()
  })

  it('states explicitly when a run has no recorded decision', async () => {
    stubFetch({ '/api/audit': { entries: [] } })
    render(
      <MemoryRouter initialEntries={['/console/runs/run-run-1']}>
        <Routes>
          <Route path="/console/runs/:runId" element={<RunsPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByText('No decision recorded for this run.')).toBeInTheDocument()
  })

  it('the decision ledger filters by outcome and a row click opens the run', async () => {
    render(
      <MemoryRouter initialEntries={['/console/runs?tab=ledger']}>
        <RunsPage />
        <Routes>
          <Route path="*" element={<PathProbe />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Audit log' })).toBeInTheDocument()
    expect(screen.getByTestId('audit-row-run-run-1')).toBeInTheDocument()

    // Outcome filter chips work.
    fireEvent.click(screen.getByRole('button', { name: /^refused/i }))
    await waitFor(() => expect(screen.getByText('No audit entries yet.')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /patched/i }))

    // A row click opens that run in the timeline tab.
    fireEvent.click(await screen.findByTestId('audit-row-run-run-1'))
    await waitFor(() =>
      expect(screen.getByTestId('path')).toHaveTextContent('/console/runs/run-run-1'),
    )
    expect(await screen.findByTestId('decision-card')).toBeInTheDocument()
  })
})

describe('Benchmarks page', () => {
  it('renders the real-world tab at its redirect URL', async () => {
    render(
      <MemoryRouter initialEntries={['/console/benchmarks?tab=real-world']}>
        <Routes>
          <Route path="/console/benchmarks" element={<BenchmarksPage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByRole('heading', { name: 'Real-World Benchmark' })).toBeInTheDocument()
  })

  it('switches tabs to the scorecard and reliability panes', async () => {
    render(
      <MemoryRouter initialEntries={['/console/benchmarks?tab=real-world']}>
        <Routes>
          <Route path="/console/benchmarks" element={<BenchmarksPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Real-World Benchmark' })

    fireEvent.click(screen.getByRole('button', { name: 'Scorecard' }))
    expect(await screen.findByRole('heading', { name: 'Results & Metrics' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reliability' }))
    expect(await screen.findByRole('heading', { name: 'Reliability' })).toBeInTheDocument()
  })
})
