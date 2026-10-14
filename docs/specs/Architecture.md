# Architecture.md

## 1. Stack and processes

- Frontend: React + Vite + TypeScript, Recharts for simple charts, Vitest + React Testing Library.
- Backend: Python 3.11+, FastAPI, Uvicorn, `jsonschema`, `httpx`, pytest.
- LLM: Gemini via Google AI Studio, behind `LLMClient`. Baseline: LangChain.
- Storage: in-memory registry; JSONL audit log; JSONL run results.

| Process | Port | Role |
|---|---|---|
| Mock API | 8000 | The "third-party" API. Its schema changes at runtime. |
| Control API | 8001 | Backend for the UI. Runs agents, healer, runner. Holds all secrets. |
| React dev server | 5173 | UI. Proxies `/api` to the control API. |

The browser talks only to the control API. Only the control API and trusted test runner know the admin key. The mock API admin key must never be shipped to the browser or exposed to either agent.

## 2. Folder layout

```
repo/
  backend/
    app/
      config.py
      mock_api/      main.py active_schema.py validator.py openapi_gen.py mutations.py faults.py
      control_api/   main.py routes_*.py run_manager.py sse.py scenarios.py models.py
      registry/      tool_registry.py tools.py tasks.py executor.py
      healing/       classifier.py schema_fetch.py schema_diff.py conversions.py secrets.py
                     hypothesize.py validate.py healer.py events.py response_check.py llm_fallback.py
      llm/           base.py gemini.py fake.py
      agents/        healing_agent.py baseline_agent.py
      audit/         canonical.py audit_log.py
      runner/        cases.py records.py run_suite.py metrics.py correctness.py
    tests/
    scripts/         verify_llm.py e2e_smoke.py
    cli/demo.py
    requirements.txt
  frontend/
    src/  api/ types/ components/ pages/ hooks/ styles/
    vite.config.ts  package.json
  results/   audit/   docs/
  PRD.md Architecture.md rules.md phases.md design.md execution_plan.md memory.md(later)
  .env.example  .gitignore  README.md
```

## 3. Components

| Component | Job |
|---|---|
| Mock API | Real API with one active schema, runtime mutation, fault injection. |
| Tool registry | Versioned in-memory tool definitions; atomic compare-and-swap apply and rollback. |
| Executor | Builds requests from the current registry definition. No healing. |
| Classifier | Decides if an error is drift. |
| Healer | Fetch schema, diff, hypothesize, validate, apply, retry, verify, rollback. |
| Event emitter | Emits typed trace events (also used by the baseline). |
| Audit log | Records patches, refusals, rollbacks, human-review cases. |
| Agents | Self-healing agent and baseline agent. |
| Runner and metrics | Repeated runs, correctness check, fixed metric formulas. |
| Control API | Serves the UI. Runs and streams runs. Reads audit and results. |
| React UI | Seven sections, real data only. |

## 4. Mock API (one schema, two uses)

FastAPI builds validation from Pydantic models at startup and caches its own OpenAPI. Changing the OpenAPI JSON alone would not change real validation. So:

- One in-memory `ActiveSchema`: `version`, `request_schemas` (JSON Schema per endpoint), `required_headers` (name, format), `response_schemas`, `error_style` (clear / vague / none), `missing_header_status` (422 or 401).
- Endpoints do not use Pydantic body models. They read raw JSON and headers.
- `validate_request(endpoint, body, headers, active)` uses `jsonschema` and returns errors in the active style.
- `/openapi.json` is custom. It is built from `ActiveSchema` on every request and includes `version`. FastAPI's own docs/OpenAPI are disabled for the mock API.
- The admin mutation swaps `ActiveSchema` atomically (lock) and bumps `version`. Versions never go down, even after reset.
- Admin endpoints need `X-Admin-Key`. They are not listed in `/openapi.json`.

**Endpoints:** `POST /user/fetch` (read-only, idempotent), `POST /user/update` (write, supports `dry_run`), `GET /openapi.json`, `POST /admin/mutate`, `POST /admin/reset`, `POST /admin/fault`, `GET /admin/state`, `GET /admin/last_payload/{endpoint}`.

**Initial schema v1:** `/user/fetch` body `{"user_id": "<string>"}`. `/user/update` body `{"user_id": "<string>", "display_name": "<string>"}`. Response `{"data": {"name": ..., "email": ...}}`.

**Mutation catalog:** `M_RENAME`, `M_TYPE`, `M_NEST` (`user_id` → `target.id`), `M_HEADER` (new required credential header such as `X-Tenant-Token`), `M_REQUIRED_BODY` (a new required body field), `M_RENAME_NEST`, `M_NEST_TYPE_HEADER` (the PS demo), `M_AMBIGUOUS` (two equal candidates), `M_LOSSY_TYPE` (string → integer, tested with `"00123"`), and in Phase 7 `M_RESP_NEST`, `M_RESP_AMBIG`.

`M_REQUIRED_BODY` is recoverable only when the value maps unambiguously from original task arguments or another approved non-secret source. It must also have a paired no-source case that refuses; the healer never invents a default.

**Faults:** `http500`, `timeout`, `http429`, `reject_credential`. Faults never change the schema or version. A wrong value for a required credential header returns 401. Admin routes are not exposed to the browser or agent tool registry; the control API uses the admin key server-side and validates mutation requests.

**Consistency test (after every mutation):**
1. The old payload is rejected.
2. The new payload is accepted.
3. `/openapi.json` version equals the active version and its schemas equal `ActiveSchema`.
4. Missing header → rejected. With header → accepted.
5. No route serves a schema different from the active one.
A negative test proves the suite fails if they ever differ.

## 5. Healing flow

```
Call → response
  ├─ 2xx → response check (Phase 7) → return
  └─ error → Classify
        ├─ not drift → handle separately (backoff retry or report). No patch.
        └─ possible drift → Fetch verified schema (log version + SHA-256)
              → Diff → Candidate patch → Validate
              → valid: Apply (keep old version) → Retry
                    → success: Verify, audit, done
                    → fail: Decide by evidence (§7)
              → invalid / ambiguous / no evidence: Refuse + audit
```

## 6. Error classification

| Status | Treatment |
|---|---|
| 400, 422 | Possible drift, not proof. Fetch and diff the verified schema; if no relevant delta explains the validation error, classify it as business/data validation and do not patch. |
| 401, 403 | Not drift by default. Consider a missing header only if the verified schema requires a header our tool lacks AND a credential exists in the secrets store. If the credential is rejected or permission is denied → stop. Never bypass auth. |
| 5xx, timeout, connection error, 429 | Not drift. Backoff retry (`MAX_INFRA_RETRIES`), then report. No patch. |
| 404 and other 4xx | Not drift by default. Report. |

## 7. Rollback decisions (by evidence)

| Result after patch | Action |
|---|---|
| Same 400/422, or an error pointing to the patched field | Patch probably wrong → roll back |
| New 400/422 about a different field | Patch probably right → keep, re-fetch schema, diff again |
| 5xx, timeout, 429 | Not drift → keep patch, backoff retry, no healing |
| 401/403 | Stop. Do not bypass auth. Log. |
| Schema version changed between attempts | New mutation → re-diff from the new schema |

After any failed attempt: re-fetch the verified schema and log version and hash before deciding. Schema attempts count toward `MAX_SCHEMA_ATTEMPTS`. Infrastructure retries are counted separately.

No candidate patch is replayed after it fails. A later attempt must use a newly fetched schema and a materially different, evidence-supported candidate (for example, a newly exposed second required field), and still obey the cap.

## 8. Trace events

Every event: `{run_id, seq, ts, agent: "baseline"|"healing"|"system", type, data}`. Types: `run_started`, `task_started`, `call_attempt`, `error_detected`, `error_classified`, `schema_fetched`, `schema_diff`, `candidate_patch`, `validation_result`, `patch_applied`, `retry`, `verified`, `rollback`, `refused`, `needs_human_review`, `response_check`, `not_drift`, `run_finished`.
Events are emitted by the real engine and agents. They never contain secrets or header values. The UI never creates events itself.

## 9. Hypothesis rules (generic, diff-based, no hardcoded names)

- **Rename:** a field is gone and a new field of compatible type appears. Score by name tokens, type, description. Accept only if one candidate clearly leads (margin threshold).
- **Nesting:** a top-level field is gone and a nested path appears. Same scoring on leaf and path tokens.
- **Unique by elimination:** exactly one removed field and exactly one new required field of compatible type → accept at medium confidence, only if validation passes.
- **Type change:** convert only if lossless (rules.md §C). The value check happens in validation with the real args.
- **New required body field:** accept only when an approved provenance source supplies the value and the mapping is unambiguous. Otherwise refuse `missing_required_value`; do not synthesize a default.
- **New header:** name and format from the verified schema. Value from the secrets provider. No value → refuse `missing_credential`.
- **Combined:** loop the pipeline (re-fetch, re-diff) until the call passes or the cap is reached.
- **Ambiguous:** two or more near-equal candidates → refuse `ambiguous_mapping`.
- Patches describe mappings and conversions only. They never contain new values.
- Reason codes: `ambiguous_mapping`, `lossy_conversion`, `missing_credential`, `validation_failed`, `no_evidence`, `retry_cap_reached`, `needs_human_review`, `ambiguous_response_mapping`, `not_drift`, `auth_rejected`.

## 10. Validation

- **Offline:** the patched payload matches the verified schema (types, required fields, headers, extra fields).
- **Provenance:** every value in the payload comes from the original args or a secret.
- **Write calls:** use `dry_run`. If not possible → `needs_human_review`, do not apply.
- **Read-only and idempotent calls:** the offline check plus the retry is enough.
- LLM-suggested patches use the same validation.

## 10.1 Registry concurrency

- Each tool definition carries a monotonically increasing registry revision in addition to the API schema version.
- Apply and rollback use compare-and-swap against the revision used to build the candidate. If another run updates that tool first, discard the stale candidate, fetch the current definition and schema, and re-diff.
- Registry history retains the immediate pre-patch definition and the evidence record needed for rollback. A rollback never overwrites a newer revision.

## 11. Audit log and hashing

JSONL, one entry per patch, refusal, rollback, human-review case:

```json
{"ts":"","run_id":"","case_id":"","tool":"","error":{"status":0,"style":"","body":""},
 "classification":"","schema_version_before":0,"schema_version_after":0,"schema_sha256":"",
 "old_definition":{},"new_definition":{},"evidence":[],"confidence":0.0,
 "outcome":"applied|refused|rolled_back|needs_human_review|not_drift",
 "reason_code":null,"healing_path":"rule|llm","llm_tokens":{"input":0,"output":0}}
```

**Hashing:** canonical JSON (sorted keys, separators `,` and `:`, UTF-8) then SHA-256. The hash tracks changes only. It is not proof of authenticity. Secret values are redacted before any write.

## 12. Response validation (Phase 7)

- The tool definition keeps an expected response schema (only fields the tool uses).
- After every 200, validate the body. On mismatch: fetch the verified schema and diff the response shape.
- Adapt only on a clear 1-to-1 path move (for example `data.name` → `data.user.name`). Otherwise refuse, return no data to the agent, log `ambiguous_response_mapping`.

## 13. LLM interface and fairness

```python
class LLMClient:
    def generate(self, messages, tools=None) -> LLMResult
# LLMResult: text, tool_calls, input_tokens, output_tokens, latency_s, model
```

- Only `llm/gemini.py` imports the Gemini SDK. Settings come from config through one typed `LLMSettings` object. For `gemini-3.8-flash`, configure `thinking_level` using only the supported values `low`, `medium`, or `high`; do not send `temperature`, `top_p`, or `top_k`. Keep provider-specific settings inside the Gemini adapter.
- Token counts come from API usage fields.
- The LLM fallback (Phase 8) may return a field mapping only. Never values or credentials.
- **Known fairness caveat:** the baseline uses LangChain's Gemini wrapper, our agent uses `LLMClient`. Same model and settings, different code path. List this in the parity report and the write-up.

## 14. Baseline agent

- LangChain agent (or a plain tool-calling loop if blocked more than 3 hours; state it in results).
- Same LLM, settings, initial tool definitions, tasks, mock API, mutations, retry cap, error text.
- Same evidence: raw error text and a `fetch_schema` tool that reads the same `/openapi.json`.
- Only difference: no healing layer and no registry patching. Its tool argument schema is fixed.
- Cannot reach admin endpoints.

## 15. Control API

All under `/api`:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness |
| `GET /status` | Mock API reachable, schema version and hash, `llm_configured` (boolean only), last run summary |
| `GET /schema` | Active schema (from mock `/openapi.json`), version, hash |
| `GET /mutations`, `GET /cases` | Catalogs |
| `POST /mutate`, `POST /reset` | Use the admin key server-side. Success only after consistency check passes. |
| `GET /consistency` | Runs the five checks |
| `POST /runs`, `GET /runs`, `GET /runs/{id}` | Start and read comparison runs (one at a time; 409 if busy) |
| `GET /runs/{id}/events` | SSE stream (replay, then live; event id = seq; heartbeat) |
| `GET /audit` | Audit entries (filters, redacted) |
| `GET /metrics` | Computed from `results/` only; `available: false` if none |
| `GET /scenarios`, `POST /scenarios/{id}/run` | Safety demos: `recover_ps_demo`, `missing_credential`, `ambiguous_mapping`, `not_drift_5xx`, `not_drift_bad_credential` |

A run resets the mock API, runs the pre-mutation task, applies the mutation, then runs each agent under identical fresh conditions, one after the other. The `missing_credential` scenario uses an in-memory empty secrets provider for that run only. It never edits `.env`.

## 16. Frontend structure

- Routes: `/` Dashboard, `/schema`, `/compare`, `/trace/:runId`, `/audit`, `/results`, `/safety`.
- `src/api/` typed client; `src/types/`; `src/hooks/` (`useApi`, `useRunEvents`); `src/components/` (AppShell, StatCard, StatusBadge, DataTable, JsonViewer, SchemaView, SchemaDiffView, TraceViewer, AgentCard, RefusalPanel, MetricsChart, LoadingState, ErrorState, EmptyState); `src/pages/`.
- Live updates use `EventSource` (SSE). Events come from the backend only.

## 17. Security

- Keys and credentials only in backend `.env`. Never in React code, Vite env, responses, events or logs.
- The control API binds to `127.0.0.1` by default for the local demo and allows only the configured frontend origin. CORS is not authentication. Reject browser-facing privileged requests with a missing or untrusted `Origin` header, and validate requests server-side. Do not expose the control API publicly during the demo.
- Mutation and reset requests must pass through the control API. Validate the requested operation and use the mock API admin key only on the backend. Never expose the key to the browser, agents, events, responses, or logs.
- Origin validation is not authentication for non-browser clients. Any remote deployment must implement proper server-side authentication and CSRF protection before enabling privileged operations.
- The production bundle is scanned for secrets (T9.13).
- Agents have no access to admin endpoints.

## 18. Config (`.env.example`, placeholders only)

```
GOOGLE_API_KEY=
LLM_MODEL=gemini-3.8-flash
LLM_THINKING_LEVEL=low
ADMIN_KEY=
MOCK_API_URL=http://localhost:8000
CONTROL_API_URL=http://localhost:8001
MOCK_TENANT_TOKEN=
HEADER_X_TENANT_TOKEN=
MAX_SCHEMA_ATTEMPTS=3
MAX_INFRA_RETRIES=2
LLM_FALLBACK_ENABLED=false
AUDIT_LOG_PATH=audit/audit.jsonl
RESULTS_DIR=results
```
`HEADER_<UPPER_SNAKE_HEADER_NAME>` holds a header secret. The team chooses a dev value for `MOCK_TENANT_TOKEN` and the same value for `HEADER_X_TENANT_TOKEN`. Never commit it.

## 19. Runtime configuration and startup verification

- `.env.example` contains placeholders only; the real `.env` is ignored by Git. Never print or return secret values.
- `LLM_MODEL` defaults to `gemini-3.8-flash`; `LLM_THINKING_LEVEL` accepts only `low`, `medium`, or `high`. Do not configure `temperature`, `top_p`, or `top_k` for this model.
- Task T0.3 must verify the model ID against the actual API key/project access, key presence without disclosure, quota/access errors, function/tool calling, and provider-reported input/output token usage. Record exact pass/fail/blocker evidence. A model ID being valid does not prove that the user has access or quota.
- If live API access is blocked, keep deterministic fake-client tests working and label live-model verification as BLOCKED. Never fabricate a live run or token counts.
- Bind the mock and control services to localhost for the demo. Admin routes require a server-side key, are not listed in the mock OpenAPI schema, and cannot be called by agents. CORS alone is not an access-control mechanism.

## 20. Tests, cases and run record

- Mutations: rename, type change, nesting, new header. Combined: rename+nesting, PS demo (nesting+type+header), a second mutation during healing.
- Error styles: clear, vague, none.
- Must refuse: ambiguous mapping, lossy conversion, missing credential, no evidence.
- Must not heal: 5xx, timeout, 429, 401 with rejected credential.
- Response (Phase 7): clear path move adapts; ambiguous refuses.
- Generated variants (different names and values) plus a fixed held-out set that is not used for tuning.
- `RunRecord`: `run_id, case_id, agent, framework, error_style, mutation_ids, split, repeat, t_break, t_recovery, outcome (recovered|refused|failed|not_drift_reported|wrong_patch|invalid), expected_outcome, correct, healing_path, tokens_heal, tokens_total, schema_attempts, infra_retries, server_payload_ok, model, settings`.
- Correctness is checked from the mock API's server-side recorded payload, not from the agent's claim.
