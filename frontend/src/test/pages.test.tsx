import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuditPage } from '../pages/AuditPage'
import { EvaluationPage } from '../pages/EvaluationPage'
import { PaymentsSandboxPage } from '../pages/PaymentsSandboxPage'
import { RealWorldPage } from '../pages/RealWorldPage'
import { RepairSettingsPage } from '../pages/RepairSettingsPage'
import { SecurityPage } from '../pages/SecurityPage'
import { SpecWatchPage } from '../pages/SpecWatchPage'

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

const SECURITY = {
  chain: { ok: true, checked: 12, first_broken_id: null },
  provenance: {
    ok: true,
    verified_at: '2026-01-01T00:00:00Z',
    version: 3,
    sha256: 'f'.repeat(64),
    signature_verified: true,
    key_fingerprint: 'abcd1234efgh5678',
    fingerprint: 'abcd1234efgh5678',
    key_configured: true,
    key_pinned_in_settings: true,
    error: null,
  },
  signing_enabled: true,
}

const REALWORLD = {
  cases: [
    {
      id: 'github_issue_field_rename_and_header',
      api: 'github',
      operation: 'POST /repos/{owner}/{repo}/issues',
      old_ref: 'old',
      new_ref: 'new',
      change_kind: 'field_renamed+header_added',
      label: 'recoverable',
      expected_reason: null,
      reviewed: true,
      task_args: {},
      baseline_outcome: 'failed',
      reflex_outcome: 'recovered',
      reflex_correct: true,
      run_id: 'run-abc',
    },
    {
      id: 'draft_unreviewed',
      api: 'github',
      operation: 'POST /x',
      old_ref: 'old',
      new_ref: 'new',
      change_kind: 'field_added_required',
      label: 'refuse_expected',
      expected_reason: 'no_evidence',
      reviewed: false,
      task_args: {},
      baseline_outcome: null,
      reflex_outcome: null,
      reflex_correct: null,
      run_id: null,
    },
  ],
  summary: {
    registered: 2,
    reviewed: 1,
    evaluated: 1,
    recovered: 1,
    correct_refusals: 0,
    wrong_patches: 0,
    failed: 0,
  },
}

const AUDIT = {
  entries: [
    {
      ts: '2026-01-01T00:00:00Z',
      run_id: 'run-abc',
      tool: 'real_github_issue_field_rename_and_header',
      error: {},
      classification: 'applied',
      schema_version_before: 2,
      schema_version_after: 2,
      schema_sha256: 'a'.repeat(64),
      old_definition: null,
      new_definition: null,
      evidence: [],
      confidence: 0.9,
      outcome: 'applied',
      reason_code: null,
      healing_path: 'llm',
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

function mockApi(overrides: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    '/api/status': STATUS,
    '/api/security/status': SECURITY,
    '/api/security/sessions': { sessions: [] },
    '/api/realworld/cases': REALWORLD,
    '/api/audit': AUDIT,
    '/api/cases': { cases: [] },
    '/api/scenarios': { scenarios: [] },
    '/api/runs': { runs: [] },
    '/api/metrics': { available: false },
    '/api/evaluation/config': {
      splits: ['tuning', 'held_out', 'fuzz'],
      error_styles: ['clear', 'vague', 'none'],
      fuzzable_mutations: ['M_RENAME', 'M_NEST'],
      refuse_type_mutations: ['M_REQUIRED_BODY'],
      reviewed_real_cases: ['github_issue_field_rename_and_header'],
    },
    ...overrides,
  }
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input)
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return jsonResponse(body)
    }
    return jsonResponse({ detail: 'not found' }, 404)
  }))
}

function renderAt(path: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/console/runs/:runId" element={<div>Trace inspector</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

/** Capture calls so a test can assert what the page actually requested. */
interface CallLog {
  url: string
  method: string
  body: string | null
}

function recordingFetch(routes: Record<string, { body: unknown; status?: number }>) {
  const calls: CallLog[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input)
      calls.push({
        url,
        method: (init?.method ?? 'GET').toUpperCase(),
        body: typeof init?.body === 'string' ? init.body : null,
      })
      for (const [path, route] of Object.entries(routes)) {
        if (url.includes(path)) return jsonResponse(route.body, route.status ?? 200)
      }
      return jsonResponse({ detail: 'not found' }, 404)
    }),
  )
  return calls
}

/** Read a StatCard's rendered value by its label, so counters are asserted exactly. */
function statValue(label: string): string {
  const block = screen.getByText(label).closest('.stat-block')
  if (!block) throw new Error(`no stat card labelled ${label}`)
  return block.querySelector('.stat-big')?.textContent?.trim() ?? ''
}

beforeEach(() => {
  mockApi()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SpecWatchPage', () => {
  it('states the watcher is not available instead of faking a status', async () => {
    renderAt('/console/spec-watch', <SpecWatchPage />)
    expect(await screen.findByRole('heading', { name: 'Spec Watch' })).toBeInTheDocument()
    expect(screen.getByText('Not available')).toBeInTheDocument()
    expect(screen.getByText('Not implemented')).toBeInTheDocument()
    // No fabricated poll time or avoided-call counter.
    expect(screen.queryByText(/^Watching$/)).not.toBeInTheDocument()
  })

  it('lists the backend dependencies it is waiting on', async () => {
    renderAt('/console/spec-watch', <SpecWatchPage />)
    await screen.findByRole('heading', { name: 'Spec Watch' })
    expect(screen.getByText(/SPEC_WATCH_INTERVAL_S/)).toBeInTheDocument()
    expect(screen.getByText(/failed_calls_before_heal/)).toBeInTheDocument()
  })
})

describe('PaymentsSandboxPage', () => {
  it('shows an honest empty ledger rather than synthetic amounts', async () => {
    renderAt('/console/payments-sandbox', <PaymentsSandboxPage />)
    expect(await screen.findByRole('heading', { name: 'Payments Sandbox' })).toBeInTheDocument()
    expect(screen.getByText('No ledger endpoint is implemented.')).toBeInTheDocument()
    expect(screen.getByText(/never display synthetic amounts/)).toBeInTheDocument()
  })

  it('renders unknown counters as an em dash', async () => {
    renderAt('/console/payments-sandbox', <PaymentsSandboxPage />)
    await screen.findByRole('heading', { name: 'Payments Sandbox' })
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })
})

describe('RepairSettingsPage', () => {
  it('reports the configured policy and never the key value', async () => {
    renderAt('/console/settings', <RepairSettingsPage />)
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByText('gemini-test')).toBeInTheDocument()
    expect(screen.getByText('Not configured')).toBeInTheDocument()
    expect(screen.getByText('Read-only')).toBeInTheDocument()
  })

  it('does not claim a model is connected when no key is present', async () => {
    mockApi({ '/api/status': { ...STATUS, llm_configured: false } })
    renderAt('/console/settings', <RepairSettingsPage />)
    await screen.findByRole('heading', { name: 'Settings' })
    expect(screen.getByText('Not configured')).toBeInTheDocument()
    expect(screen.queryByText('Configured')).not.toBeInTheDocument()
  })
})

describe('SecurityPage', () => {
  it('shows the verified chain and the key fingerprint', async () => {
    renderAt('/console/security', <SecurityPage />)
    expect(await screen.findByRole('heading', { name: 'Security' })).toBeInTheDocument()
    expect(screen.getByText('Intact')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('abcd1234efgh5678')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Verify chain' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tamper schema' })).toBeInTheDocument()
  })

  it('labels the tamper control as a controlled test', async () => {
    renderAt('/console/security', <SecurityPage />)
    await screen.findByRole('heading', { name: 'Security' })
    expect(screen.getByText(/Controlled test on the local mock only/)).toBeInTheDocument()
  })

  it('reports a broken chain with the offending entry, not a reassurance', async () => {
    mockApi({
      '/api/security/status': {
        ...SECURITY,
        chain: { ok: false, checked: 7, first_broken_id: 42 },
      },
    })
    renderAt('/console/security', <SecurityPage />)
    await screen.findByRole('heading', { name: 'Security' })
    expect(screen.getByText('Broken')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
  })

  it('shows a failed provenance check instead of staying silent', async () => {
    mockApi({
      '/api/security/status': {
        ...SECURITY,
        provenance: {
          ...SECURITY.provenance,
          ok: false,
          signature_verified: false,
          sha256: null,
          error: 'invalid signature',
        },
      },
    })
    renderAt('/console/security', <SecurityPage />)
    await screen.findByRole('heading', { name: 'Security' })
    expect(screen.getByText(/Last provenance check failed: invalid signature/)).toBeInTheDocument()
    expect(screen.getByText(/nothing was patched/)).toBeInTheDocument()
  })

  it('surfaces a persistence failure rather than pretending data is stored', async () => {
    mockApi({
      '/api/security/status': { ...SECURITY, persistence_error: 'OperationalError: no such file' },
    })
    renderAt('/console/security', <SecurityPage />)
    await screen.findByRole('heading', { name: 'Security' })
    expect(screen.getByText(/Persistence unavailable/)).toBeInTheDocument()
  })
})

describe('RealWorldPage', () => {
  it('links a case to the Runs timeline when a run exists', async () => {
    renderAt('/console/real-world', <RealWorldPage />)
    const link = await screen.findByRole('link', { name: 'Open trace' })
    expect(link).toHaveAttribute('href', '/console/runs/run-abc')
  })

  it('distinguishes reviewed from draft cases', async () => {
    renderAt('/console/real-world', <RealWorldPage />)
    await screen.findByRole('heading', { name: 'Real-World Benchmark' })
    const table = screen.getByRole('table')
    expect(within(table).getByText('Reviewed')).toBeInTheDocument()
    expect(within(table).getByText('Draft')).toBeInTheDocument()
    // The human-review column is a Label, not a claim that results are verified.
    expect(within(table).getByText('Label')).toBeInTheDocument()
    // Server-payload verification per run shows DASH for a case that has not run.
    expect(within(table).getByText('Result check')).toBeInTheDocument()
    expect(screen.getByText(/1 reviewed cases · target 10\+/)).toBeInTheDocument()
  })
})

describe('RealWorldPage > Run Benchmark', () => {
  const realCase = REALWORLD.cases[0]
  const EMPTY_RW = {
    cases: [realCase],
    summary: { registered: 1, reviewed: 1, evaluated: 0, recovered: 0, correct_refusals: 0, wrong_patches: 0, failed: 0 },
  }
  const DONE_RW = {
    cases: [{ ...realCase, baseline_outcome: 'failed', reflex_outcome: 'recovered', run_id: 'run-42' }],
    summary: { registered: 1, reviewed: 1, evaluated: 1, recovered: 1, correct_refusals: 0, wrong_patches: 0, failed: 0 },
  }
  const RUNNING = {
    run_id: 'run-42',
    status: 'running',
    case_ids: [realCase.id],
    repeats: 1,
    started_at: '2026-01-01T00:00:00Z',
    finished_at: null,
    error: null,
    records: [],
    event_count: 0,
  }
  const FINISHED = {
    ...RUNNING,
    status: 'finished',
    records: [
      { case_id: realCase.id, agent: 'baseline', outcome: 'failed' },
      { case_id: realCase.id, agent: 'healing', outcome: 'recovered' },
    ],
  }

  it('calls the start-run API with only the reviewed real case ids', async () => {
    const calls = recordingFetch({
      '/api/realworld/cases': { body: EMPTY_RW },
      '/api/runs/run-42': { body: FINISHED },
      '/api/runs': { body: { ...RUNNING, run_id: 'run-42' } },
    })
    renderAt('/console/real-world', <RealWorldPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Run Benchmark/ }))

    await waitFor(() => {
      const start = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/runs'))
      expect(start).toBeDefined()
      expect(JSON.parse(start!.body ?? '{}')).toEqual({
        case_ids: [realCase.id],
        repeats: 1,
      })
    })
    // The unreviewed draft must never be sent.
    const start = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/runs'))
    expect(start!.body).not.toContain('draft_unreviewed')
  })

  it('polls the run, disables the button, and reports progress', async () => {
    const calls = recordingFetch({
      '/api/realworld/cases': { body: EMPTY_RW },
      '/api/runs/run-42': { body: RUNNING },
      '/api/runs': { body: { ...RUNNING, run_id: 'run-42' } },
    })
    renderAt('/console/real-world', <RealWorldPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Run Benchmark/ }))

    // A poll must happen: one refresh straight after starting is not enough.
    await waitFor(() =>
      expect(calls.some((c) => c.url.endsWith('/api/runs/run-42'))).toBe(true),
    )
    const button = screen.getByRole('button', { name: /Running…/ })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('0 of 2 records')
    expect(screen.getByRole('status')).toHaveTextContent(/Benchmark run run-42 in progress/)
  })

  it('fills outcomes, counters and the trace link once the run finishes', async () => {
    let runPolls = 0
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String(input)
        const method = (init?.method ?? 'GET').toUpperCase()
        if (url.includes('/api/realworld/cases')) {
          return jsonResponse(runPolls > 0 ? DONE_RW : EMPTY_RW)
        }
        if (url.endsWith('/api/runs/run-42')) {
          runPolls += 1
          return jsonResponse(FINISHED)
        }
        if (url.endsWith('/api/runs') && method === 'POST') {
          return jsonResponse({ ...RUNNING, run_id: 'run-42' })
        }
        return jsonResponse({ detail: 'not found' }, 404)
      }),
    )

    renderAt('/console/real-world', <RealWorldPage />)
    // Wait for the loaded view before reading the pre-run counters.
    await waitFor(() => expect(statValue('Correct recoveries')).toBe('0'))

    fireEvent.click(await screen.findByRole('button', { name: /Run Benchmark/ }))

    // Baseline / Reflex cells fill in from the run records.
    await waitFor(() => expect(screen.getByText('failed')).toBeInTheDocument())
    expect(screen.getByText('recovered')).toBeInTheDocument()

    // All four counters move off their pre-run values.
    await waitFor(() => {
      expect(statValue('Failed')).toBe('0')
      expect(statValue('Correct recoveries')).toBe('1')
      expect(statValue('Correct refusals')).toBe('0')
      expect(statValue('Wrong patches')).toBe('0')
    })

    // The trace link is active, pointing at this run.
    const link = await screen.findByRole('link', { name: 'Open trace' })
    expect(link).toHaveAttribute('href', '/console/runs/run-42')

    // Progress notice is gone and the button is usable again.
    expect(screen.queryByText(/in progress/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run Benchmark/ })).toBeEnabled()
  })

  it('shows an error banner when starting the run fails', async () => {
    recordingFetch({
      '/api/realworld/cases': { body: EMPTY_RW },
      '/api/runs': { body: { detail: 'a run is already in progress' }, status: 409 },
    })
    renderAt('/console/real-world', <RealWorldPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Run Benchmark/ }))

    const banner = await screen.findByText(/a run is already in progress/)
    expect(banner).toBeInTheDocument()
    // Not silent: the button returns to a usable state so it can be retried.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Run Benchmark/ })).toBeEnabled(),
    )
  })

  it('surfaces a run that finishes with an error instead of only partial data', async () => {
    recordingFetch({
      '/api/realworld/cases': { body: EMPTY_RW },
      '/api/runs/run-42': { body: { ...FINISHED, status: 'error', error: 'host unreachable' } },
      '/api/runs': { body: { ...RUNNING, run_id: 'run-42' } },
    })
    renderAt('/console/real-world', <RealWorldPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Run Benchmark/ }))

    await waitFor(() =>
      expect(screen.getByText(/finished with an error: host unreachable/)).toBeInTheDocument(),
    )
  })

  it('reports a lost connection while polling rather than showing stale zeros', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : String(input)
        const method = (init?.method ?? 'GET').toUpperCase()
        if (url.includes('/api/realworld/cases')) return jsonResponse(EMPTY_RW)
        if (url.endsWith('/api/runs/run-42')) {
          return Promise.reject(new Error('network down'))
        }
        if (url.endsWith('/api/runs') && method === 'POST') {
          return jsonResponse({ ...RUNNING, run_id: 'run-42' })
        }
        return jsonResponse({ detail: 'not found' }, 404)
      }),
    )
    renderAt('/console/real-world', <RealWorldPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Run Benchmark/ }))

    await waitFor(() =>
      expect(screen.getByText(/Lost contact with run run-42/)).toBeInTheDocument(),
    )
  })

  it('explains that there is nothing to run when no case is reviewed', async () => {
    const unreviewedOnly = {
      cases: [{ ...realCase, reviewed: false, run_id: null }],
      summary: { ...REALWORLD.summary, reviewed: 0 },
    }
    recordingFetch({ '/api/realworld/cases': { body: unreviewedOnly } })
    renderAt('/console/real-world', <RealWorldPage />)
    await screen.findByRole('heading', { name: 'Real-World Benchmark' })
    expect(screen.getByRole('button', { name: /Run Benchmark/ })).toBeDisabled()
  })
})

describe('EvaluationPage', () => {
  it('renders the split selector and refuses to invent rates', async () => {
    renderAt('/console/evaluation', <EvaluationPage />)
    expect(await screen.findByRole('heading', { name: 'Reliability' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tuning' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Held-out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fuzz' })).toBeInTheDocument()
    expect(screen.getByText(/rates stay unknown until one exists/)).toBeInTheDocument()
  })
})

describe('AuditPage', () => {
  it('shows the repair path so a rule and an LLM decision are distinguishable', async () => {
    renderAt('/console/audit', <AuditPage />)
    await screen.findByRole('heading', { name: 'Audit log' })
    expect(screen.getByRole('columnheader', { name: 'Repair Path' })).toBeInTheDocument()
    expect(screen.getByText('LLM')).toBeInTheDocument()
  })
})

describe('secret hygiene', () => {
  it('never renders a configured key value', async () => {
    const secret = 'super-secret-key-value'
    mockApi({
      '/api/status': { ...STATUS, llm_configured: true, api_key: secret, google_api_key: secret },
    })
    const { container } = renderAt('/console/settings', <RepairSettingsPage />)
    await screen.findByRole('heading', { name: 'Settings' })
    await waitFor(() => expect(screen.getByText('Configured')).toBeInTheDocument())
    expect(container.textContent).not.toContain(secret)
  })
})
