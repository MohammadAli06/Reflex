import type {
  AuditEntry,
  CaseInfo,
  ConsistencyResult,
  MetricsResponse,
  MutationInfo,
  RunSummary,
  ScenarioInfo,
  ScenarioResult,
  SchemaResponse,
  StatusResponse,
  ErrorStyle,
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
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!response.ok) {
    let detail = response.statusText
    try {
      const body = await response.json()
      detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* keep statusText */
    }
    throw new ApiError(response.status, detail)
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  status: () => request<StatusResponse>('/status'),
  schema: () => request<SchemaResponse>('/schema'),
  mutations: () => request<{ mutations: MutationInfo[] }>('/mutations'),
  cases: () => request<{ cases: CaseInfo[] }>('/cases'),
  consistency: () => request<ConsistencyResult>('/consistency'),
  mutate: (mutationId: string, errorStyle?: ErrorStyle) =>
    request<{ version: number; consistency: ConsistencyResult }>('/mutate', {
      method: 'POST',
      body: JSON.stringify({ mutation_id: mutationId, error_style: errorStyle }),
    }),
  reset: () => request<{ version: number; consistency: ConsistencyResult }>('/reset', { method: 'POST' }),
  startRun: (caseIds: string[], repeats = 1) =>
    request<RunSummary>('/runs', { method: 'POST', body: JSON.stringify({ case_ids: caseIds, repeats }) }),
  listRuns: () => request<{ runs: RunSummary[] }>('/runs'),
  getRun: (runId: string) => request<RunSummary>(`/runs/${runId}`),
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
}
