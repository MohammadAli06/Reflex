import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ComparePage } from '../pages/ComparePage'
import { SchemaPage } from '../pages/SchemaPage'
import { EventTimeline } from '../components/EventTimeline'
import { ExchangeCard, DefinitionSplit, ValidatorChecks } from '../components/ExchangeCard'
import { SchemaDiffView } from '../components/SchemaDiffView'
import type { TraceEvent } from '../types'

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
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : String(input)
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) return jsonResponse(body)
    }
    return jsonResponse({ detail: 'not found' }, 404)
  }))
}

/** Stub EventSource: the timeline renders without a live stream. */
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

afterEach(() => vi.unstubAllGlobals())

// ---------------------------------------------------------------------------
// ExchangeCard: full, partial and missing records
// ---------------------------------------------------------------------------

const FULL_EXCHANGE: TraceEvent['data'] & Record<string, unknown> = {
  step: 'retry_call',
  method: 'POST',
  url: 'http://localhost:8000/user/fetch',
  attempt: 2,
  request_headers: { 'content-type': 'application/json', 'X-Tenant-Token': '[REDACTED]' },
  request_body: { target: { id: 123 } },
  response_status: 200,
  response_body: { data: { name: 'Ada', email: 'ada@example.com' } },
  started_at: '2026-01-01T00:00:00Z',
  duration_ms: 12.3,
}

describe('ExchangeCard', () => {
  it('renders step, method, endpoint, status and duration from the record', () => {
    render(<ExchangeCard exchange={FULL_EXCHANGE as never} />)
    expect(screen.getByText('Verified retry')).toBeInTheDocument()
    expect(screen.getByText('POST')).toBeInTheDocument()
    expect(screen.getByText('http://localhost:8000/user/fetch')).toBeInTheDocument()
    expect(screen.getByText('200')).toBeInTheDocument()
    expect(screen.getByText('12.3ms')).toBeInTheDocument()
    expect(screen.getAllByText('Request body').length).toBeGreaterThan(0)
    // Planted secrets do not survive into the DOM.
    expect(screen.queryByText('super-secret')).not.toBeInTheDocument()
  })

  it('shows dash placeholders when fields are missing', () => {
    render(<ExchangeCard exchange={{ step: 'spec_fetch' }} />)
    expect(screen.getAllByText(/no detail recorded/i).length).toBeGreaterThanOrEqual(3)
    // No invented response status.
    expect(screen.queryByText('200')).not.toBeInTheDocument()
  })

  it('flags truncated records and attempt numbers', () => {
    render(
      <ExchangeCard
        exchange={{ ...FULL_EXCHANGE, truncated: true, request_body: null } as never}
      />,
    )
    expect(screen.getByText('Truncated')).toBeInTheDocument()
    expect(screen.getByText(/attempt 2/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// DefinitionSplit + ValidatorChecks
// ---------------------------------------------------------------------------

describe('DefinitionSplit', () => {
  it('renders both sides and dash states', () => {
    render(
      <DefinitionSplit
        labelBefore="Schema before"
        labelAfter="Schema after"
        before={{ a: 1 }}
        after={null}
      />,
    )
    expect(screen.getByText('Schema before')).toBeInTheDocument()
    expect(screen.getByText('Schema after')).toBeInTheDocument()
    expect(screen.getByText(/No definition recorded/)).toBeInTheDocument()
  })
})

describe('ValidatorChecks', () => {
  it('lists failing checks from the record and passes otherwise', () => {
    const { rerender } = render(
      <ValidatorChecks ok={false} errors={['user_id: required']} reasonCode="validation_failed" />,
    )
    expect(screen.getByText('user_id: required')).toBeInTheDocument()
    expect(screen.getByText('failed')).toBeInTheDocument()

    rerender(<ValidatorChecks ok errors={[]} />)
    expect(screen.getByText(/All recorded validator checks passed/)).toBeInTheDocument()
  })

  it('shows dash when no list was recorded', () => {
    render(<ValidatorChecks ok={null} errors={null} />)
    expect(screen.getByText(/No check list recorded/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// SchemaDiffView renders the recorded diff shapes
// ---------------------------------------------------------------------------

const DIFF_EVENT = {
  endpoint: '/user/fetch',
  removed: ['user_id'],
  added: ['target.id'],
  type_changed: [{ path: 'target.id', from: 'string', to: 'integer' }],
  added_headers: [{ name: 'X-Tenant-Token', format: 'opaque-token' }],
  removed_headers: [],
}

describe('SchemaDiffView', () => {
  it('renders rename (removed+added), type change and header chips', () => {
    render(<SchemaDiffView diff={DIFF_EVENT} />)
    expect(screen.getAllByText(/user_id/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/target\.id/).length).toBeGreaterThan(0)
    expect(screen.getByText(/integer/)).toBeInTheDocument()
    expect(screen.getByText(/X-Tenant-Token/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// ComparePage stepper + refusal lane derive purely from records
// ---------------------------------------------------------------------------

const CASES = {
  cases: [
    { id: 'ps_demo', task_id: 'normal_fetch', expected_outcome: 'recovered', mutation_id: 'M_NEST_TYPE_HEADER', error_style: 'clear', split: 'tuning', source: 'synthetic' },
    { id: 'ambiguous_mapping', task_id: 'normal_fetch', expected_outcome: 'refused', mutation_id: 'M_AMBIGUOUS', error_style: 'clear', split: 'tuning', source: 'synthetic' },
  ],
}

const RECOVERED_RUN = {
  run_id: 'run-1',
  status: 'finished',
  case_ids: ['ps_demo'],
  repeats: 1,
  started_at: '2026-01-01T00:00:00Z',
  finished_at: '2026-01-01T00:00:02Z',
  error: null,
  event_count: 0,
  records: [
    { run_id: 'run-1', case_id: 'ps_demo', agent: 'baseline', framework: 'plain-loop', attempts: 3, tokens_total: 210, outcome: 'failed', t_break: 0.01, t_recovery: null, server_payload_ok: false, reason_code: 'retry_cap_reached' },
    { run_id: 'run-1', case_id: 'ps_demo', agent: 'healing', framework: 'rule-based-healer', attempts: 2, tokens_total: 0, outcome: 'recovered', t_break: 0.01, t_recovery: 0.9, server_payload_ok: true, healing_path: 'rule' },
  ],
}

const REFUSED_RUN = {
  ...RECOVERED_RUN,
  case_ids: ['ambiguous_mapping'],
  records: [
    RECOVERED_RUN.records[0],
    { ...RECOVERED_RUN.records[1], case_id: 'ambiguous_mapping', outcome: 'refused', reason_code: 'ambiguous_mapping', t_recovery: null, server_payload_ok: false },
  ],
}

function renderCompare() {
  return render(
    <MemoryRouter>
      <ComparePage />
    </MemoryRouter>,
  )
}

describe('Comparison page', () => {
  it('a step with no records stays pending even when later steps exist', async () => {
    // No SSE events arrive (no error_detected record), but records exist.
    stubFetch({
      '/api/runs/run-1': RECOVERED_RUN,
      '/api/cases': CASES,
      '/api/runs': { run_id: 'run-1', status: 'running', records: [], case_ids: ['ps_demo'], repeats: 1, started_at: 'x', finished_at: null, error: null, event_count: 0 },
    })
    renderCompare()
    fireEvent.click(await screen.findByRole('button', { name: /Run both agents/ }))
    await waitFor(() => expect(screen.getByTitle(/Baseline finished/)).toBeInTheDocument())
    // Later steps can be complete while the break step has no record.
    expect(screen.getByTitle(/Break the API: pending/)).toBeInTheDocument()
  })

  it('shows changing flows from records only: refusal has no retry card', async () => {
    stubFetch({
      '/api/runs/run-1': REFUSED_RUN,
      '/api/cases': CASES,
      '/api/runs': { ...REFUSED_RUN, status: 'running', records: [] },
    })
    renderCompare()
    fireEvent.click(await screen.findByRole('button', { name: /Run both agents/ }))
    // Refusal shown first-class with the recorded reason code.
    expect(await screen.findByText('Refused')).toBeInTheDocument()
    expect(screen.getAllByText('ambiguous_mapping').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/No patch applied/).length).toBeGreaterThan(0)
    expect(screen.queryByText('Verified retry')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Schema page shows the recorded specs before and after the mutation
// ---------------------------------------------------------------------------

const MUTATIONS = {
  mutations: [{ id: 'M_RENAME', label: 'Rename field', description: 'Rename user_id to uid' }],
}

const SCHEMA_NOW = {
  version: 2,
  sha256: 'deadbeefdeadbeef',
  short_hash: 'deadbee',
  request_schemas: {},
  required_headers: [],
  response_schemas: {},
  error_style: 'clear',
}

const MUTATE_RESPONSE = {
  version: 2,
  consistency: { pass: true, version: 2, checks: [] },
  mutation: { id: 'M_RENAME', description: 'Rename user_id to uid' },
  spec_before: {
    version: 1,
    sha256: 'aa',
    request_schemas: { '/user/fetch': { properties: { user_id: { type: 'string' } } } },
    required_headers: [],
  },
  spec_after: {
    version: 2,
    sha256: 'bb',
    request_schemas: { '/user/fetch': { properties: { uid: { type: 'string' } } } },
    required_headers: [],
  },
}

describe('SchemaPage', () => {
  it('renders the recorded specs after applying a mutation (no fabricated baseline)', async () => {
    stubFetch({
      '/api/schema': SCHEMA_NOW,
      '/api/mutations': MUTATIONS,
      '/api/mutate': MUTATE_RESPONSE,
      '/api/consistency': MUTATE_RESPONSE.consistency,
    })
    render(
      <MemoryRouter>
        <SchemaPage />
      </MemoryRouter>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /Apply change/ }))
    await waitFor(() =>
      expect(screen.getByText(/Schema updated to v2/)).toBeInTheDocument(),
    )
    expect(screen.getByText(/Schema before \(v1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Schema after \(v2\)/)).toBeInTheDocument()
    // The spec after contains the real renamed field from the mock API.
    expect(screen.getAllByText(/uid/).length).toBeGreaterThan(0)
  })

  it('states honestly that no before spec is recorded before an apply', async () => {
    stubFetch({ '/api/schema': SCHEMA_NOW, '/api/mutations': MUTATIONS })
    render(
      <MemoryRouter>
        <SchemaPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/No recorded before spec/)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Runs timeline: events expand into exchange detail
// ---------------------------------------------------------------------------

const EXCHANGE_EVENT: TraceEvent = {
  run_id: 'run-1',
  seq: 3,
  ts: '2026-01-01T00:00:00.010Z',
  agent: 'healing',
  type: 'http_exchange',
  data: FULL_EXCHANGE,
}

describe('EventTimeline expansion', () => {
  it('expands an http_exchange event into the shared ExchangeCard', async () => {
    render(<EventTimeline events={[EXCHANGE_EVENT]} />)
    const toggles = await screen.findAllByRole('button', { name: 'Show details' })
    fireEvent.click(toggles[0])
    expect(await screen.findByText('Verified retry')).toBeInTheDocument()
    expect(screen.getByText('12.3ms')).toBeInTheDocument()
  })

  it('shows "no detail recorded" for an event without data', async () => {
    const bare: TraceEvent = { ...EXCHANGE_EVENT, type: 'run_started', data: {} }
    render(<EventTimeline events={[bare]} />)
    const toggles = await screen.findAllByRole('button', { name: 'Show details' })
    fireEvent.click(toggles[0])
    expect(await screen.findByText('No detail recorded for this event.')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// No hardcoded sample payloads in the shared components
// ---------------------------------------------------------------------------

const sources = import.meta.glob('../components/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

describe('no hardcoded payloads', () => {
  it('the exchange/diff components contain no sample request or response JSON', () => {
    const forbidden = /user_id"|"user_id"|"target":|"name": "Ada"|127\.0\.0\.1|localhost:8000/
    const offenders = Object.entries(sources)
      .filter(([key]) => /Exchange|DecisionCard|SchemaDiff|Validator/.test(key))
      .filter(([, text]) => forbidden.test(text))
      .map(([key]) => key)
    expect(offenders).toEqual([])
  })
})
