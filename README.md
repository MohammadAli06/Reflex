# Reflex — Self-Healing Tool Registry Under Runtime API Schema Drift

An agent calls an API through an in-memory tool definition. When the API changes
its request schema at runtime, a healing layer detects the drift, diffs it
against the verified schema, validates a patch, hot-patches the tool definition
in memory (no restart) and completes the task. It refuses — and logs why — when
a safe fix cannot be proved. A baseline agent without healing is compared on
equal terms, and a React UI shows everything live from real backend data.

Hackathon PS 01 (Quest It, VESIT). See `docs/` for the PRD, architecture, rules,
phases, design and execution plan.

## Stack

- **Backend:** Python 3.11+, FastAPI, Uvicorn, `jsonschema`, `httpx`, pytest,
  SQLAlchemy 2.0 + SQLite (Control API persistence; mock API stays in-memory),
  `bcrypt` (password hashing), `cryptography` (Ed25519 schema provenance),
  PyYAML (reviewed real-spec cases).
- **Frontend:** React + Vite + TypeScript, Recharts, Vitest.
- **LLM:** Gemini via Google AI Studio behind a replaceable `LLMClient`
  (a deterministic fake client is used when no key is configured).
- **LLM repair fallback:** off by default (`LLM_REPAIR_ENABLED=false`). When on,
  the rules engine still runs first; the LLM is consulted at most once per
  failure event and only when the rules report no confident candidate
  (`no_evidence` / `ambiguous_mapping`) — never on safety refusals (lossy
  conversion, missing values/credentials, policy blocks). The proposal must
  parse against a strict JSON schema, reference only fields that exist in the
  old tool schema or the live contract, and never invent values; it then passes
  through the same `validate_patch()` gate, compare-and-swap registry update,
  audit chain and retry/rollback loop as rule patches. Without a configured
  key the attempt refuses with `llm_unavailable`. Every patch/refusal records
  `healing_path` (`rule` / `llm`) plus additive `llm_usage` and `llm_meta`
  (model, prompt hash — never the prompt body — token counts, latency,
  confidence, verdict); metrics add per-source counts and `ztar_rules_only`.
- **Baseline:** plain tool-calling loop (LangChain is optional; documented in the
  parity report as a fairness caveat).

## Processes

| Process | Port | Command |
|---|---|---|
| Mock API | 8000 | `uvicorn app.mock_api.main:app --port 8000` |
| Control API | 8001 | `uvicorn app.control_api.main:app --port 8001` |
| React UI | 5173 | `npm run dev` |

The browser talks only to the control API. The mock's admin key, the Gemini key
and header credentials stay on the backend.

## Setup

```bash
# 1. backend env
cd backend
python -m venv .venv
.venv/Scripts/activate        # Windows;  source .venv/bin/activate on Unix
pip install -r requirements.txt

# 2. copy secrets template (repo root) and fill in values
#    GOOGLE_API_KEY, ADMIN_KEY, and a matching MOCK_TENANT_TOKEN / HEADER_X_TENANT_TOKEN
cp ../.env.example ../.env

# 3. frontend deps
cd ../frontend
npm install
```

## Run (three terminals)

```bash
# terminal 1
cd backend && .venv/Scripts/activate && uvicorn app.mock_api.main:app --port 8000

# terminal 2
cd backend && .venv/Scripts/activate && uvicorn app.control_api.main:app --port 8001

# terminal 3
cd frontend && npm run dev
```

Open http://localhost:5173.

## Console Navigation & Capabilities

The React console implements an industrial "Suture" dark aesthetic with strict data integrity (zero synthetic metrics, unknown fields rendered as `—`):

| Section | Route | Purpose | Backend Endpoints |
|---|---|---|---|
| **Overview** | `/console` | Health pills, schema version + hash, aggregate ZTAR / refusals / wrong patches, last 5 runs, latest comparison summary | `/api/status`, `/api/metrics`, `/api/runs` |
| **Schema** | `/console/schema` | Live active schema viewer, mutation trigger (M_RENAME, M_NEST, etc.), consistency checker | `/api/schema`, `/api/mutations`, `/api/mutate`, `/api/consistency` |
| **Comparison** | `/console/compare` | Head-to-head Baseline vs Reflex test runner with real-time SSE execution trace | `/api/cases`, `/api/runs`, SSE `/api/runs/{id}/events` |
| **Runs** | `/console/runs(:runId)` | Event timeline per run with the audit decision pinned below, plus the decision ledger (old Trace + Audit merged) | `/api/runs`, `/api/runs/{id}/events`, `/api/audit` |
| **Benchmarks** | `/console/benchmarks` | Scorecard (perf matrix), Real-world (vendored spec cases), Reliability (split analysis with 95% CIs) — one scorecard, no duplicates | `/api/metrics`, `/api/realworld/cases`, `/api/evaluation/config` |
| **Safety** | `/console/safety` | 6 mandatory refusal scenarios (lossy types, ambiguous mappings, missing auth, etc.) | `/api/scenarios`, `/api/scenarios/{id}/run` |
| **Settings** | `/console/settings` | What the backend enforces today (guardrails, signing, sessions, tamper demo) + SDK snippet and Control API URL | `/api/status`, `/api/security/status`, `/api/security/sessions` |

*Old routes redirect: `/console/trace` → `/console/runs`, `/console/audit` → `/console/runs?tab=ledger`, `/console/results` → `/console/benchmarks`, `/console/real-world` → `/console/benchmarks?tab=real-world`, `/console/evaluation` → `/console/benchmarks?tab=reliability`, `/console/security` → `/console/settings`. Spec Watch and Payments Sandbox live behind `VITE_SHOW_PLANNED` (default off) and redirect to `/console`. The operator menu in the topbar covers session removal.*

## Tests & Verification

```bash
# Backend pytest suite
cd backend
python -m pytest -q

# Real-world and Fuzz evaluation CLIs
python -m app.runner.run_suite --source real        # vendored OpenAPI contract cases
python -m app.runner.run_suite --fuzz 200 --seed 7  # property-based fuzz generation
python -m app.runner.run_suite --replay-seed 700004 # deterministic replay of fuzz cases

# Frontend vitest suite & production build
cd ../frontend
npm test -- --run
npm run build
```

The mock schema-consistency suite and the healing safety suite are mandatory
gates; they must pass before a demo. A non-zero `wrong_patches=` from the
evaluation CLI is also a hard failure.

## CLI fallback

If the UI or network fails during the demo:

```bash
cd backend && python cli/demo.py
```

## Python SDK

`reflex_sdk` is a thin, provider-neutral remote client for the Control API. It
does not contain a second healing implementation: `/api/sdk/call` creates a
normal Reflex run and delegates to the existing registry, `HealingAgent`,
`Healer`, audit ledger and trace event stream. The SDK can load the two
engine-owned tools (`fetch_user`, `update_user`); tool definitions cannot be
arbitrarily registered or patched by a caller.

With the two backend services running, use it from the `backend` directory:

```python
from reflex_sdk import ReflexClient

with ReflexClient("http://localhost:8001") as reflex:
    tool = reflex.load_tool("fetch_user")  # validates that Reflex owns it
    result = reflex.call("fetch_user", user_id="123")
    if result.ok:
        print(result.data)                 # {"name": ..., "email": ...}
    elif result.refused:
        print(result.reason_code, result.run_id)
```

`result.run_id` is the same ID shown by **Runs** (timeline) and used to filter
entries in the **Decision ledger**. Open `/console/runs/<run_id>` to inspect the
call, schema diff, patch and verification events alongside the pinned audit
decision. The example `backend/examples/sdk_agent_tool.py` shows the same call
inside an ordinary Python `get_user` function; it can be registered with
LangChain, OpenAI, Gemini, Claude, or another framework without adding any
provider-specific dependency to Reflex.

For a local demonstration, call `POST /api/mutate` with `M_NEST` from the
Schema page (or its existing Control API endpoint), then call the SDK function:
`result.ok` stays true and `result.healed` is true. Reset, mutate with
`M_AMBIGUOUS`, then call it again: it returns `result.refused == True` and
`reason_code == "ambiguous_mapping"`; no guessed patch is applied. Both calls
are visible in **Runs** and the **Decision ledger**. Calls made directly to a
target API do not pass through Reflex and therefore cannot be healed or
observed by this SDK.

## Security & Reliability Notes

- **Zero White-Screen Guarantee**: Global and console-level React `<ErrorBoundary>` components catch render glitches and surface structured error details with instant recovery actions.
- **Strict Route Aliasing**: All console sections gracefully resolve hyphenated and unhyphenated variations with console-level fallback redirection.
- **Ed25519 Schema Provenance**: Upstream schemas can be digitally signed and verified against pinned public keys, rejecting tampered contracts before repair synthesis.
- **Audit Hash Chaining**: Every repair decision is hashed with its predecessor ($H_i = \text{SHA256}(H_{i-1} \parallel \text{Entry}_i)$); chain integrity is verified on-demand via the Settings page.
- **Credential Redaction**: API keys, Gemini tokens, and `X-Tenant-Token` credentials are scrubbed server-side before persisting audit events or emitting SSE streams.
- **Origin Guard**: Privileged Control API endpoints reject requests where the `Origin` header does not match the configured frontend URL.
