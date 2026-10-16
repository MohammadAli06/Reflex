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

## Evidence

- Backend: `python -m pytest -q` → 51 passed (45 prior: mock consistency incl.
  negative test, healer recovery + all refusal branches, no-infinite-loop cap,
  audit redaction, runner/metrics, control API routes incl. 409 + origin guard;
  plus 6 new DB tests: audit chain tamper naming, concurrent CAS single-winner,
  restart survival of runs/audit/registry, SSE replay from `Last-Event-ID`,
  login cookie + `/api/me`, admin password-seed safety).
- Frontend: `npm run build` succeeds; `npm run test:run` → 6 passed.
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

- Switch frontend login from localStorage to the cookie endpoints
  (`POST /api/login`, `GET /api/me`, `credentials: include`); delete the
  hardcoded `operator/reflex2026` client check.
- Remove JSONL dual-write (audit + results) once the DB path is proven live.
- Configure a real `.env` (ADMIN_KEY, header token, GOOGLE_API_KEY) and run
  `scripts/verify_llm.py`.
- Run the full suite from the UI and freeze results before the held-out run.
