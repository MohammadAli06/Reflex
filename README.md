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

- **Backend:** Python 3.11+, FastAPI, Uvicorn, `jsonschema`, `httpx`, pytest.
- **Frontend:** React + Vite + TypeScript, Recharts, Vitest.
- **LLM:** Gemini via Google AI Studio behind a replaceable `LLMClient`
  (a deterministic fake client is used when no key is configured).
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

## Tests

```bash
# backend (from backend/)
python -m pytest -q

# frontend (from frontend/)
npm test -- --run
npm run build
```

The mock schema-consistency suite and the healing safety suite are mandatory
gates; they must pass before a demo.

## CLI fallback

If the UI or network fails during the demo:

```bash
cd backend && python cli/demo.py
```

## Security notes

- `.env` is git-ignored; `.env.example` holds placeholders only.
- The control API binds to localhost and rejects privileged browser requests
  whose `Origin` is not the configured frontend origin.
- Agents never reach the mock's admin routes and never see the admin key.
- Secrets are redacted from events, API responses and the audit log.
