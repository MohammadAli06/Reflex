# memory.md — Reflex build memory

Living record of decisions, completed work, evidence and open questions.
No secrets are stored here.

## Decisions

- Three processes as designed: mock API (8000), control API (8001), React UI (5173).
- The mock API derives both real validation and `/openapi.json` from one
  `ActiveSchema`; admin routes are key-protected and never listed in the schema.
- Healing is rule-based and deterministic. `T_heal = 0` is measured (no LLM
  call), flagged `rule_based` — never estimated.
- Baseline is a plain tool-calling loop with a fixed tool schema (LangChain
  time-boxed out). It may succeed on non-drift; its failures are reported as-is.
- Newly required body fields are patched only with approved provenance from the
  original args; otherwise `missing_required_value`. No defaults are invented.
- Registry updates use revision compare-and-swap; rollback restores the previous
  revision as a new one and never overwrites a newer revision.
- Dedicated reason codes for refusals; every refusal emits a trace event and a
  redacted audit record.
- Audit hash = SHA-256 of canonical JSON (change tracking only, not authenticity).
- LLM repair fallback gates on `LLM_REPAIR_ENABLED` (default false). Rules run
  first; the LLM is called at most once per failure event and only on `no_evidence`
  / `ambiguous_mapping` rule refusals — safety refusals and the retry cap are
  final. The proposal parses against a strict JSON schema (extra keys, unknown
  fields, low confidence -> `llm_*` reason codes) and re-enters the shared
  validate/CAS/audit/rollback path. `healing_path` (`rule`/`llm`) is the
  recorded source; prompt bodies are never logged (only their SHA-256), and the
  prompt carries field names/types plus a truncated, value-scrubbed error body.
- Integration panel + CLI: the Settings panel now shows real Python/PowerShell/
  curl snippets for `/api/sdk/call` (the old snippet called APIs that did not
  exist), each with copy, plus a real "Run this" sample call that shows actual
  HTTP status/body/outcome and the recovery time recorded on the run record —
  never a stopwatch, never invented values. `python -m reflex_sdk demo` drives
  health checks, a real mock mutation (ADMIN_KEY from settings), a real direct
  baseline call built from `/api/sdk/tools` definitions, the real SDK call
  (outcome/reason/`healing_path`, registry revision before→after from
  `/api/registry`, recorded recovery), and opt-in `--reset`. `reflex-demo`
  console script was skipped — repo has no packaging, and adding pyproject.toml
  is out of scope.
- Try-your-own-API dry-run: `app/dryrun/engine.py` reuses the real pipeline as
  pure functions (classifier/diff/hypothesize/validator + the flag-gated LLM
  gate) on pasted specs (JSON or `yaml.safe_load` YAML, 512 KB/64 KB caps, JSON
  depth limit, local-only `$ref` with cycle guard — remote refs never fetch).
  Endpoints `POST /api/dryrun/analyze` and `POST /api/dryrun/parse` make zero
  outbound calls (test-enforced by blocking the real HTTP transports) and
  persist nothing: metrics, runs and the audit chain are untouched by design.
  The Benchmarks › Real-world tab gains a `Reviewed cases | Try your own API`
  toggle with an example-filled panel reusing SchemaDiffView, ValidatorChecks
  and DefinitionSplit; refusals render first-class; the banner is always
  present.
- Security phase (hardened demo): `app/security/` (policy/throttle/budget/
  ssrf/repair_policies) is one source of truth for limits, the route role
  table and guard defaults. Operator routes are session-gated (bcrypt login),
  SDK keys are sha256-hashed with show-once creation + revocation + last-used
  + minimum-time compare, `/api/sdk/call` is open until the first key exists
  then key-gated; unknown /api routes are refused 404 (deny-by-default,
  test-enumerated). SSRF: `GuardedClient` enforces the host allowlist +
  resolution checks + no redirects + response caps for ALL outbound calls
  (executor, schema fetch, control-to-mock). RunBudget + payload fingerprints
  + per-host breakers refuse with new codes `retry_budget_exceeded`,
  `loop_detected`, `circuit_open`; repair policies refuse `overbroad_patch`
  and map number/float transitions to `unsafe_conversion` instead of
  no_evidence; patching is fail-closed (audit-before-CAS, failures refuse
  `audit_unavailable`) and provenance (host/sha/version/signature) is recorded
  on every applied patch entry. Operator-only `POST /api/registry/rollback`
  CAS-restores a revision, audited-first. `/api/security/status` (operator)
  reports only real enforced state; the Settings page renders exactly that
  and the SDK copy adapts to the real key state. Bearer/JWT strings are
  masked with the stable "[REDACTED]" marker at every redaction boundary.
- Frontend forced to `NODE_ENV=test` under Vitest so React's dev build is used.
- Control API (8001) persists to SQLite (`data/reflex.db`, SQLAlchemy 2.0,
  WAL + busy_timeout); mock API (8000) stays in-memory. Postgres later = one
  connection-string change.
- Audit hash chain enforced in DB: `sha256(prev_hash + canonical_json(entry))`,
  `GET /api/audit/verify` names the broken row. JSONL still dual-written.
- Registry CAS backed by `UNIQUE(tool_name, revision)`; concurrent writers race,
  loser gets `StaleRevisionError`. `POST /api/reset` is non-destructive
  (bumps revision, keeps history).
- Trace events flushed in batches (20/flush, timestamps taken before write) so
  MTTR excludes DB time; SSE replays from `trace_events` by global index.
- Auth backend: bcrypt-hashed users + HttpOnly session cookie
  (`POST /api/login|logout`, `GET /api/me`); admin seeded from
  `ADMIN_USER`/`ADMIN_PASS`, never overwritten.
- Real-spec cases reuse the existing pipeline. The mock learns
  `POST /admin/load_openapi`, serves that operation's path, and the harness is
  pointed at the OLD revision while the mock serves the NEW one. No healer or
  executor special-casing.
- `ToolDefinition` endpoints may be concrete paths with params substituted while
  the served document keys schemas by template, so `VerifiedSchema.request_schema`
  resolves template → concrete. Without this the diff saw every field as removed.
- Case splits: `tuning` / `held_out` / generated `fuzz`, plus `source`
  (`synthetic` / `real` / `fuzz`) carried onto every `RunRecord`.
- Proportions carry Wilson 95% intervals (`ztar_ci`, `correct_refusal_ci`);
  metrics group by `by_source` as well as `by_split`.
- Fuzz composition is restricted to recoverable mutations. Measured: composing a
  refuse-type mutation (`M_REQUIRED_BODY` + `M_NEST`) can still recover, so
  asserting a refusal there would report a safe, verified recovery as a failure.
  `M_LOSSY_TYPE` is excluded entirely — its outcome depends on the task args.
- Schema provenance: the mock signs the canonical JSON of `/openapi.json` with
  Ed25519. The signature is always taken over the *honest* document, so the
  `/admin/tamper` demo serves a body that cannot match its signature — the real
  attacker capability. An unverifiable schema is refused with `untrusted_schema`
  and never diffed or patched. Pinning one key is a prototype trust model.
- Verification is enforced only when a public key resolves (pinned in settings,
  or discovered from the mock's admin catalog). With the flag on and no key
  anywhere, the fetch refuses rather than trusting blindly.
- A relative `sqlite:///data/...` URL is rebased onto the repo root. SQLAlchemy
  resolves it against the CWD, which silently pointed at a non-existent
  `backend/data/` and produced a broken DB that looked like an auth failure.
- `/console/real-world` follows the run instead of refreshing once. The run
  executes on a background thread and persists records as it goes, so a single
  refresh immediately after `POST /api/runs` reads pre-run state (`evaluated: 0`,
  no run id) and the page then never updated again — the button looked inert.
  The page now polls `/api/runs/{id}`, shows `n of N records`, keeps the button
  disabled, and surfaces a failed run or a lost poll instead of staying silent.
- Only *reviewed* real cases are runnable. `all_cases()` uses `reviewed_cases()`,
  so neither the API nor `run_suite` can run an unreviewed draft; the UI still
  lists drafts from `cases.yaml` and labels them unreviewed.
- Test-suite stability on Windows: each `TestClient` starts an anyio portal, and
  this Python build has no native `socket.socketpair`, so every event loop costs
  loopback TCP sockets. A fresh client pair per test exhausted the ephemeral
  buffers mid-suite (`OSError: [WinError 10055]`, in `socket.py`'s
  `_fallback_socketpair` bind). API-level tests now share one module-scoped
  client pair and make assertions order-independent (never "the DB is empty").
- Thread and sequential-client probes: 40 sequential create/exit cycles and six
  full mock+control+run cycles leave one live thread, so nothing accumulates in
  the app itself — the constraint is per-suite client churn, not a product leak.

## Completed

- Backend: config, mock API (active schema, validator, openapi, mutations, faults,
  server-side payload recording), registry + executor + classifier + events,
  healing engine (fetch/diff/hypothesize/validate/apply/retry/verify/rollback),
  response validation + 1-to-1 adaptation, audit log + canonical hash, LLM
   interface (base/fake/gemini), agents, runner + metrics, control API with SSE.
- Frontend: Vite + React + TS scaffold, typed client, app shell, seven pages
  (Dashboard, Schema, Compare, Trace, Audit, Results, Safety), reusable components.
- CLI fallback, LLM verification script, e2e smoke script, README runbook.
- SQLite persistence (Control API only): `backend/app/db/` (engine/WAL,
  7 models, one repo per table), audit hash chain + `/api/audit/verify`,
  DB-backed runs/records/events + SSE replay + metrics, registry revision
  history + `/api/registry`, schema snapshots on verified fetch, users/sessions
  + login/logout/me endpoints. Dual-write JSONL kept; `POST /api/reset`
  non-destructive.
- DB tests: `backend/tests/db/test_persistence.py` (chain tamper, concurrent
  CAS, restart survival, SSE replay, login cookie, password-seed safety).
- Real-spec harness: `realworld/case_builder.py` (drafts from a vendored diff,
  `reviewed` gate), `realworld/cases.yaml` (1 hand-reviewed case),
  `runner/realworld.py` (tool + task from the OLD revision, load the NEW one),
  spec-operation serving in the mock.
- Evaluation CLI: `python -m app.runner.run_suite --source real|synthetic|all`,
  `--fuzz N --seed S`, `--replay-seed X`, `--json`. Prints a per-case table and a
  replay command per failing seed.
- Fuzzer `runner/fuzz.py`: seeded, 1–3 mutations, composition oracle, per-case
  replay seed.
- Security: Ed25519 schema signing + `/admin/tamper`,
  `GET /api/security/status`, `GET /api/security/sessions`,
  `POST /api/security/sessions/{id}/revoke`, `POST /api/security/tamper`,
  a 6th `tampered_schema` safety scenario, and `untrusted_schema` provenance
  refusals recorded as `provenance.ok = false`.
- LLM repair fallback: `healing/llm_fallback.py` (strict `RepairProposal`
  parser, sanitized context builder, `RepairProposer` protocol,
  `GeminiRepairProposer`, `FakeRepairClient`), healer hook at the
  hypothesize-refusal fork with the flag gate, new reason codes
  (`llm_uncertain`, `llm_invalid_output`, `llm_validation_failed`,
  `llm_unavailable`), `llm_proposal`/`llm_refused` trace events, additive
  `AuditEntry.llm_usage`/`llm_meta` (renamed from raw `llm_tokens` because the
  key-name redactor masks anything containing "token"), honest token passthrough
  in HealingAgent, `/api/sdk/call` `healing_path`, metrics `patch_sources` +
  `ztar_rules_only`, and UI: "Repaired by" chips (decision card, Reflex lane),
  Settings repair-fallback status row, conditional Landing sentence.
- Control API endpoints for the console: `/api/realworld/cases`,
  `/api/realworld/build`, `/api/evaluation/config`, plus repair-policy fields on
  `/api/status` and `persistence_error` on `/api/status` and
  `/api/security/status`.
- Frontend: 5 new pages — `/console/evaluation`, `/console/security`,
  `/console/spec-watch`, `/console/payments-sandbox`, `/console/settings` —
  plus a grouped sidebar, a Repair-path column on the Audit page, and
  `RealWorldPage` moved onto `/api/realworld/cases` with a label filter.
- Backend tests: `tests/mock_api/test_signing.py`,
  `tests/realworld/test_realworld_harness.py`, `tests/runner/test_fuzz.py`,
  `tests/test_config_database.py`.
- Frontend tests: `src/test/pages.test.tsx` (14 tests: honest unavailable states,
  em-dash for unknown metrics, trace linking, reviewed vs unreviewed, repair
  path, broken chain, failed provenance, persistence failure, secret hygiene).

## Evidence

- Backend: `python -m pytest -q` → 175 passed: the LLM fallback (20), CLI demo
  (8), dry-run (11) plus the security phase (26 new): `test_security.py`
  (route classification enumeration + deny-by-default, auth matrix, key
  lifecycle, oversize/header caps, SSRF loopback/metadata/rebinding,
  redirect 307 handling, 429+Retry-After, demo-flow-unthrottled) and
  `test_guardrails.py` (budget caps + loop fingerprints, breaker state
  machine incl. half-open, healer circuit-open refusal, overbroad-policy
  check, provenance on applied patches, fail-closed audit, operator
  rollback success/stale/missed + audited, JWT/bearer masking, unsafe
  conversion refusal). Flag-off real-source run unchanged: 1 case, baseline
  failed, Reflex recovered, `wrong_patches=0`.
- Frontend: `npm run build` succeeds; `npm run test:run` → 82 passed
  (79 pre-security + 3: real access state rendered from the backend status,
  dashes when the fields are absent, integration copy adapting to the SDK
  key state).
- Live default-config demo: `python -m reflex_sdk demo --mutation
  M_NEST_TYPE_HEADER --reset --no-color` → recovered in one patch attempt
  (recorded recovery 0.006s) with the security layer on; live HTTP flow:
  unauthenticated `POST /api/mutate` → 401 'authentication required', login
  → 200, mutate → 200, `auth_required` events visible on the audit chain,
  logout → blocked again. Normal demo usage is never throttled (limits: 10
  login / 120 operator / 60 SDK / 20 dry-run per minute).
- Real-spec benchmark: `python -m app.runner.run_suite --source real` →
  1 case, baseline `failed`, Reflex `recovered`, `wrong_patches=0`.
- Live servers: `python -m reflex_sdk demo --mutation M_NEST_TYPE_HEADER
  --reset --no-color` prints real steps (mutation applied, baseline 4xx,
  healed attempt 2, recorded recovery 0.009s/0.006s, reset applied).
- Live dry-run: POST /api/dryrun/analyze with the demo specs → 200
  `proposed` / `source=rule` / corrected body `{"account": {"id": "123"}}`,
  and `/api/metrics` identical before and after.
- Fuzz: `--fuzz 200 --seed 7` → 200 cases, `wrong_patches=0`.
- Provenance: tampered `/openapi.json` → `refused` / `untrusted_schema` with the
  registry revision unchanged (API and scenario paths both).
- Live servers: `scripts/e2e_smoke.py` → 10/10 checks (status, consistency,
  mutation, run, SSE, audit, metrics, refusal scenario).
- CLI: `python cli/demo.py` shows baseline failing and healing recovering after
  the PS mutation, then a missing-credential refusal.

## Blockers

- Gemini live access unverified (`GOOGLE_API_KEY` empty). Model ID
  `gemini-3.8-flash` must be checked with real credentials. Core development and
  tests use the deterministic fake client. Live-model runs are labelled BLOCKED.

## Open questions

- Whether LangChain should replace the plain-loop baseline if time permits
  (runtime, not parity, is the only difference).
- Response-side adaptation currently covers clear 1-to-1 path moves only.

## Next

- Remove JSONL dual-write (audit + results) once the DB path is proven live.
- Configure a real `.env` (ADMIN_KEY, header token, GOOGLE_API_KEY) and run
  `scripts/verify_llm.py`.
- Run the full suite from the UI and freeze results before the held-out run.
- Additional error styles (`problem_json`, `nested_array`, `localized_text`) with
  the invariance test: same mutation must yield an identical outcome across all
  styles, proving the healer reads the OpenAPI diff and not error text.
- Silent drift (`M_SILENT_RENAME` / `M_SILENT_TYPE`, `postconditions` on
  `ToolDefinition`) and the spec-watch background task
  (`SPEC_WATCH_INTERVAL_S` is read and reported by `/api/status` but nothing
  polls yet — `/console/spec-watch` states this plainly).
- Payments/idempotency (Phase 5): mock ledger, `Idempotency-Key`,
  `timeout_after_commit`, `ToolDefinition.idempotency` / `readback`,
  `duplicate_writes`.
- Phase 6 remainder: argon2, operator/viewer roles, login rate limiting, and the
  operator id on every audit entry. `GET /api/security/sessions` deliberately
  returns metadata only — never a token.
