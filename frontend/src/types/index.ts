export type ErrorStyle = 'clear' | 'vague' | 'none'

export interface StatusResponse {
  mock_api_reachable: boolean
  control_api: string
  schema_version: number | null
  schema_hash: string | null
  llm_configured: boolean
  busy: boolean
  last_run: RunSummary | null
  llm_model?: string
  llm_thinking_level?: string
  llm_repair_enabled?: boolean
  max_schema_attempts?: number
  max_infra_retries?: number
  schema_signing_enabled?: boolean
  schema_key_pinned?: boolean
  spec_watch_interval_s?: number
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
  source?: 'synthetic' | 'real' | 'fuzz'
  api?: string | null
  operation?: string | null
  change_kind?: string | null
  reviewed?: boolean
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

/** Full HTTP exchange captured by the backend for one request/response pair. */
export interface ExchangeRecord {
  step?: string
  method?: string
  url?: string | null
  attempt?: number | null
  request_headers?: Record<string, string> | null
  request_body?: Record<string, unknown> | string | null
  response_status?: number | null
  response_headers?: Record<string, string> | null
  response_body?: Record<string, unknown> | string | null
  started_at?: string | null
  duration_ms?: number | null
  error?: string | null
  truncated?: boolean
}

/** OpenAPI contract view captured before/after a mutation (real mock specs). */
export interface SpecView {
  version?: number | null
  sha256?: string | null
  request_schemas?: Record<string, unknown>
  required_headers?: Record<string, unknown>[]
  response_schemas?: Record<string, unknown>
  error_style?: string | null
  operation?: unknown
}

export interface MutateResult {
  version: number
  consistency: ConsistencyResult
  mutation?: { id?: string; description?: string } | null
  spec_before?: SpecView | null
  spec_after?: SpecView | null
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
  source?: string
  seed?: number | null
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
  /** Optional: http_exchange events shipped with the run (newer runs). */
  exchanges?: TraceEvent[]
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
  ztar_ci?: { low: number; high: number } | null
  recovered?: number
  recoverable?: number
  correct_refusals?: number
  correct_refusal_rate?: number | null
  correct_refusal_ci?: { low: number; high: number } | null
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
  by_source?: Record<string, MetricSummary>
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

export interface RealWorldSummary {
  registered: number
  reviewed: number
  evaluated: number
  recovered: number
  correct_refusals: number
  wrong_patches: number
  failed: number
}

export interface RealWorldCase {
  id: string
  api: string
  operation: string
  old_ref: string
  new_ref: string
  change_kind: string
  label: 'recoverable' | 'refuse_expected' | string
  expected_reason: string | null
  reviewed: boolean
  task_args: Record<string, string>
  baseline_outcome: string | null
  reflex_outcome: string | null
  reflex_correct: boolean | null
  server_payload_ok: boolean | null
  run_id: string | null
}

export interface RealWorldResponse {
  cases: RealWorldCase[]
  summary: RealWorldSummary
}

export interface ChainStatus {
  ok: boolean | null
  checked: number
  first_broken_id: number | null
}

export interface Provenance {
  ok: boolean | null
  verified_at: string | null
  version: number | null
  sha256: string | null
  signature_verified: boolean
  key_fingerprint: string
  fingerprint: string
  key_configured: boolean
  key_pinned_in_settings: boolean
  error: string | null
}

export interface SecurityStatus {
  chain: ChainStatus
  provenance: Provenance
  signing_enabled: boolean
  persistence_error?: string | null
}

export interface SessionInfo {
  id: number
  username: string
  created_at: string
  expires_at: string
  expired: boolean
}

export interface TamperResult {
  tamper: { tampered: boolean; served_version?: number }
  heal_attempt: { outcome: string; reason_code: string | null }
}

export interface EvaluationConfig {
  splits: string[]
  error_styles: string[]
  fuzzable_mutations: string[]
  refuse_type_mutations: string[]
  reviewed_real_cases: string[]
}
