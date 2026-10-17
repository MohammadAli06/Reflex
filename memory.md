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

- Backend: `python -m pytest -q` → 130 passed (110 pre-LLM-fallback + 20 new
  in `tests/healing/test_llm_fallback.py`: flag-off identity,
  rules-primacy, one-proposal-per-event, invalid outputs, validator
  rejection, rollback-on-failed-retry, provider errors, prompt sanitization
  (planted secret and payload value absent), injection containment, audit
  fields, per-source metrics, SDK `healing_path`). Flag-off real-source run
  unchanged: 1 case, baseline failed, Reflex recovered, `wrong_patches=0`.
- Frontend: `npm run build` succeeds; `npm run test:run` → 71 passed
  (64 pre-change + 6 LLM-fallback UI tests: decision-card
  Rules/LLM-fallback/dash, Reflex-lane chips, Settings real fallback state +
  dash for absent field, Landing copy quiet while the flag is off).
- Real-spec benchmark: `python -m app.runner.run_suite --source real` →
  1 case, baseline `failed`, Reflex `recovered`, `wrong_patches=0`.
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
