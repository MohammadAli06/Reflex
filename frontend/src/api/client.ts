import type {
  AuditEntry,
  CaseInfo,
  ConsistencyResult,
  EvaluationConfig,
  MetricsResponse,
  MutateResult,
  MutationInfo,
  RealWorldResponse,
  RunSummary,
  ScenarioInfo,
  ScenarioResult,
  SchemaResponse,
  SecurityStatus,
  SessionInfo,
  StatusResponse,
  TamperResult,
  ErrorStyle,
  TraceEvent,
} from '../types'

const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      const inner = body?.detail
      if (typeof inner === 'string') {
        detail = inner
      } else if (inner && typeof inner === 'object') {
        detail = typeof inner.message === 'string' ? inner.message : JSON.stringify(inner)
      } else if (typeof body?.error === 'string') {
        detail = body.error
      }
    } catch {
      /* keep statusText */
    }
    throw new ApiError(response.status, detail || `HTTP ${response.status}`)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  login: (username: string, password: string) =>
    request<{ username: string }>('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => request<{ status: string }>('/logout', { method: 'POST' }),
  me: () => request<{ username: string }>('/me'),
  status: () => request<StatusResponse>('/status'),
  schema: () => request<SchemaResponse>('/schema'),
  mutations: () => request<{ mutations: MutationInfo[] }>('/mutations'),
  cases: () => request<{ cases: CaseInfo[] }>('/cases'),
  consistency: () => request<ConsistencyResult>('/consistency'),
  mutate: (mutationId: string, errorStyle?: ErrorStyle) =>
    request<MutateResult>('/mutate', {
      method: 'POST',
      body: JSON.stringify({ mutation_id: mutationId, error_style: errorStyle }),
    }),
  reset: () => request<{ version: number; consistency: ConsistencyResult }>('/reset', { method: 'POST' }),
  startRun: (caseIds: string[], repeats = 1) =>
    request<RunSummary>('/runs', { method: 'POST', body: JSON.stringify({ case_ids: caseIds, repeats }) }),
  listRuns: () => request<{ runs: RunSummary[] }>('/runs'),
  getRun: (runId: string) => request<RunSummary>(`/runs/${runId}`),
  listExchanges: (runId: string) =>
    request<{ run_id: string; exchanges: TraceEvent[] }>(`/runs/${runId}/exchanges`),
  audit: (params?: { outcome?: string; runId?: string; limit?: number }) => {
    const search = new URLSearchParams()
    if (params?.outcome) search.set('outcome', params.outcome)
    if (params?.runId) search.set('run_id', params.runId)
    if (params?.limit) search.set('limit', String(params.limit))
    const qs = search.toString()
    return request<{ entries: AuditEntry[] }>(`/audit${qs ? `?${qs}` : ''}`)
  },
  metrics: () => request<MetricsResponse>('/metrics'),
  scenarios: () => request<{ scenarios: ScenarioInfo[] }>('/scenarios'),
  runScenario: (scenarioId: string) =>
    request<ScenarioResult>(`/scenarios/${scenarioId}/run`, { method: 'POST' }),
  realWorldCases: () => request<RealWorldResponse>('/realworld/cases'),
  buildRealWorldCases: () => request<{ drafts: unknown[]; total: number; reviewed: number }>(
    '/realworld/build', { method: 'POST' }),
  evaluationConfig: () => request<EvaluationConfig>('/evaluation/config'),
  securityStatus: () => request<SecurityStatus>('/security/status'),
  tamperSchema: () => request<TamperResult>('/security/tamper', { method: 'POST' }),
  revertTamper: () => request<{ tampered: boolean }>('/security/tamper', {
    method: 'POST',
    body: JSON.stringify({ revert: true }),
  }),
  sessions: () => request<{ sessions: SessionInfo[] }>('/security/sessions'),
  revokeSession: (sessionId: number) =>
    request<{ revoked: number }>(`/security/sessions/${sessionId}/revoke`, { method: 'POST' }),
}
