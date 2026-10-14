export type ErrorStyle = 'clear' | 'vague' | 'none'

export interface StatusResponse {
  mock_api_reachable: boolean
  control_api: string
  schema_version: number | null
  schema_hash: string | null
  llm_configured: boolean
  busy: boolean
  last_run: RunSummary | null
}

export interface SchemaResponse {
  version: number
  sha256: string
  short_hash: string
  request_schemas: Record<string, JSONSchema>
  required_headers: { name: string; format: string | null }[]
  response_schemas: Record<string, JSONSchema>
  error_style: ErrorStyle
}

export type JSONSchema = Record<string, unknown>

export interface MutationInfo {
  id: string
  label: string
  description: string
  requires_header_secret: boolean
}

export interface CaseInfo {
  id: string
  task_id: string
  expected_outcome: string
  mutation_id: string | null
  error_style: ErrorStyle
  expected_reason: string | null
  split: string
}

export interface ScenarioInfo {
  id: string
  label: string
  case_id: string
  description: string
}

export interface ConsistencyCheck {
  name: string
  ok: boolean
  detail: string
}

export interface ConsistencyResult {
  pass: boolean
  version: number
  checks: ConsistencyCheck[]
}

export interface TraceEvent {
  run_id: string
  seq: number
  ts: string
  agent: 'baseline' | 'healing' | 'system'
  type: string
  data: Record<string, unknown>
}

export interface RunRecord {
  run_id: string
  case_id: string
  agent: string
  framework: string
  error_style: string
  mutation_ids: string[]
  split: string
  repeat: number
  attempts: number
  t_break: number | null
  t_recovery: number | null
  outcome: string
  expected_outcome: string
  correct: boolean | null
  healing_path: string
  tokens_heal: number
  tokens_total: number
  schema_attempts: number
  infra_retries: number
  server_payload_ok: boolean
  model: string
  settings: Record<string, unknown>
  reason_code: string | null
  expected_reason: string | null
}

export interface RunSummary {
  run_id: string
  status: 'running' | 'finished' | 'error'
  case_ids: string[]
  repeats: number
  started_at: string
  finished_at: string | null
  error: string | null
  records: RunRecord[]
  event_count: number
}

export interface AuditEntry {
  ts: string
  run_id: string
  tool: string
  error: Record<string, unknown>
  classification: string
  schema_version_before: number | null
  schema_version_after: number | null
  schema_sha256: string
  old_definition: Record<string, unknown> | null
  new_definition: Record<string, unknown> | null
  evidence: string[]
  confidence: number
  outcome: string
  reason_code: string | null
  healing_path: string
}

export interface MetricSummary {
  available: boolean
  n?: number
  ztar?: number | null
  recovered?: number
  recoverable?: number
  correct_refusals?: number
  wrong_patches?: number
  failures?: number
  not_drift_reported?: number
  mttr_median?: number | null
  mttr_p95?: number | null
  t_heal?: number
  t_base?: number
  t_ratio?: number | null
  tokens_total?: number
  schema_attempts?: number
  infra_retries?: number
}

export interface AgentMetrics {
  overall: MetricSummary
  by_error_style: Record<string, MetricSummary>
  by_healing_path: Record<string, MetricSummary>
  by_split: Record<string, MetricSummary>
}

export interface MetricsResponse {
  available: boolean
  n_records?: number
  agents?: Record<string, AgentMetrics>
}

export interface ScenarioResult {
  scenario_id: string
  label: string
  case_id: string
  outcome: string
  reason_code: string | null
  explanation: string
  agent: string
  attempts: number
  schema_attempts: number
  mttr: number | null
  response_data: Record<string, unknown> | null
  finished_at: string
  events: TraceEvent[]
}
