# PRD.md — Self-Healing Tool Registry Under Runtime API Schema Drift

Hackathon PS 01 (Quest It, VESIT). Time budget: about 48 hours.
The official PS is the primary requirement. If this file disagrees with the PS, the PS wins.

## 1. What we build

An agent calls an API through a tool definition kept in memory. The API changes its request schema while running. A healing layer:

1. Detects that the error is schema drift (not another kind of failure).
2. Finds what changed, using verified evidence.
3. Validates, then patches the in-memory tool definition (no restart).
4. Retries and finishes the task.
5. Logs every patch.
6. Stops and refuses when it cannot be safe.

We compare it with a baseline agent (LangChain, no healing layer). A React UI shows all of this live, using real backend data.

## 2. Official PS requirements (source of truth)

- Catch 4xx errors at runtime and find the difference between expected and actual schema.
- Hot-patch tool definitions in memory and log every patch.
- Finish the task with no manual restart.
- Handle field rename, type change, nesting change, new required header.
- Never pass invented values. Stop retrying once a patch fails.
- Live demo where the mock API schema changes on stage.
- Baseline agent on a standard framework.
- Metrics: Zero-Touch Adaptation Rate, MTTR (PS target: under 4 seconds), Token Overhead.
- Deliverables: 30-second pitch, short write-up of diagnosis and patch logic, baseline vs ours comparison.

## 3. Goals

- G1: Safe adaptation. Recover when evidence supports one safe fix. Refuse when it does not.
- G2: Every patch and refusal is auditable.
- G3: A fair, honest comparison with the baseline.
- G4: A live demo that is real: the mock API truly changes its validation.
- G5: A working, interactive React UI that shows real state and results.

## 4. Non-goals (do not build)

- Real third-party APIs, live probing, staging replay.
- Bypassing authentication or permissions in any way.
- Response-side healing beyond clear 1-to-1 path moves.
- Advanced charts, animations, extra visual features.
- Any other dashboard framework. The UI is React only.

## 5. Approved stack

| Part | Choice |
|---|---|
| Frontend | React, Vite, TypeScript, responsive CSS, Recharts (simple charts only) |
| Backend | Python 3.11+, FastAPI, Uvicorn, jsonschema |
| AI | Gemini via Google AI Studio, model ID `gemini-3.8-flash`, behind a replaceable LLM interface |
| Baseline | LangChain (strict time limit; plain tool-calling loop if blocked) |
| Other | In-memory versioned tool registry, JSONL audit log, pytest, Vitest, Python test runner, `.env` for secrets |

Three local processes: mock API (port 8000), control API (port 8001, serves the UI), React dev server (port 5173). The browser talks only to the control API.

## 6. Functional requirements

| ID | Requirement | PS link |
|---|---|---|
| FR-1 | Mock API with one active schema controlling both real request validation and `/openapi.json` | Live demo |
| FR-2 | Admin mutation endpoint (admin key), reset, and fault injection (5xx, timeout, 429, rejected credential) | Live demo |
| FR-3 | Versioned, concurrency-safe in-memory tool registry; patches apply with no restart | Hot-patch |
| FR-4 | Error classifier: drift vs not drift | Catch 4xx |
| FR-5 | Verified schema fetch and schema diff | Diagnose |
| FR-6 | Rule-based candidate patches: rename, type change, request nesting, new header, and a newly required body field only when its value has approved provenance; combined mutations | Mutations |
| FR-7 | Validation before applying (offline check; `dry_run` for writes; else needs human review) | Safe adaptation |
| FR-8 | Apply, retry, verify, evidence-based rollback | No looping |
| FR-9 | Retry cap, same for both agents | No looping |
| FR-10 | JSONL audit log with canonical-JSON SHA-256 schema hashes | Log every patch |
| FR-11 | Baseline agent (LangChain) with same LLM settings, tools, tasks, cap and evidence | Baseline |
| FR-12 | Test runner with repeated runs, held-out cases and fixed metric formulas | Metrics |
| FR-13 | Minimal response validation and 1-to-1 response path adaptation (after core works) | "Nesting a response" |
| FR-14 | Optional LLM fallback suggesting field mappings only | Core challenge |
| FR-15 | Control API: status, schema, mutate, reset, consistency, runs, SSE events, audit, metrics, scenarios | UI backend |
| FR-16 | React UI with sections A–G (see §7) | Live demo |
| FR-17 | CLI fallback demo for recovery if the UI or network fails | Demo safety |

## 7. UI requirements (mandatory)

The UI uses real backend data only. No fake metrics, no hardcoded results, no success shown unless the backend confirms it.

- **A. Dashboard:** schema version, schema hash, system status, latest run results, recovery and refusal summary.
- **B. Schema Mutation:** active schema, predefined mutations (rename, type change, nesting, new header, combined), error style choice (clear / vague / none), new version after mutation.
- **C. Agent Comparison:** run baseline and self-healing on equal cases; show status, attempts, errors, final result, recovery time, tokens; failures shown honestly.
- **D. Live Healing Trace:** real events from the healing engine via SSE: detect, classify, fetch schema, diff, candidate patch, validate, apply, retry, verify, rollback or refusal.
- **E. Audit Log:** patch, refusal, rollback, human-review events with timestamps, versions, hashes, evidence, outcomes. No secrets.
- **F. Results and Metrics:** ZTAR, MTTR median and p95, tokens and ratio, retries, correct refusals, wrong patches, failures, by error style, rule-based vs LLM-fallback.
- **G. Safety Demonstration:** recovery; refusal on missing credential; refusal on ambiguous mapping; not-drift errors identified correctly. The UI explains why it refuses.

Security: API keys, admin key and header credentials stay on the backend. The browser never calls mutation endpoints with privileged credentials; privileged actions go through the control API.

## 8. Safety requirements

- SR-1: Never invent a value. A required value with no source → stop and report.
- SR-2: Header name and format come from the verified schema only.
- SR-3: Header secret values come only from `.env` or a secrets store. Never from an error body or schema.
- SR-4: Never bypass authentication or permissions. 401/403 are not drift by default.
- SR-5: Accept a rename, path move, or newly required body field only if the mapping and its value source are unambiguous. Otherwise refuse.
- SR-6: Only meaning-preserving type conversions are allowed.
- SR-7: LLM-suggested patches pass the same validation as rule-based patches. The LLM never supplies values or credentials.
- SR-8: Never patch infrastructure errors (5xx, timeout, 429) or unrelated errors.
- SR-9: Never claim a performance target is achieved before it is measured.
- SR-10: Never replay a failed patch. A different patch may be considered only after a newly fetched schema and a materially different, evidence-supported diff; all such attempts remain within the cap.

## 9. Metrics (formulas fixed before testing)

- **Zero-Touch Adaptation Rate (ZTAR)** = mutations completed correctly with no human step ÷ mutations that should be recoverable. Report separately: correct refusals, wrong patches (target 0, not assumed), failures.
- **MTTR** = time from the first failed call after the mutation to the first verified successful call. Median and p95. Refusals excluded. Rule-based and LLM-fallback reported separately.
- **Token overhead**
  - `T_heal` = actual LLM input + output tokens used for diagnosis and recovery. 0 only if no LLM call happened, flagged `rule_based`.
  - `T_base` = actual LLM input + output tokens from the first failure to the final stop in the baseline.
  - Report raw counts, ratio `T_heal / T_base`, and total task tokens for both agents.
  - Token counts come from API usage fields, not estimates.
- **Retries before stop:** schema-related attempts only. Infrastructure retries are counted separately.
- Each case runs several times. Report average and spread, split by error style (clear / vague / none). Held-out cases are reported separately.

## 10. Constraints and unverified items

- About 48 hours. Antigravity IDE builds the code step by step.
- Same model and settings for the baseline and any LLM fallback.
- Secrets in `.env` (git-ignored). `.env.example` has placeholders only.
- **Unverified (check in T0.3, never assume):** `gemini-3.8-flash` exists for our key; API key and quota; tool calling works; usage fields are returned. Antigravity's own model access is not API access for our app.
- For gemini-3.8-flash, use LLM_THINKING_LEVEL with a supported value (low, medium, or high). Do not configure temperature, top_p, or top_k.

## 11. Risks

1. The baseline may succeed when it can see the error and schema. We report this honestly.
2. Weak-evidence renames can be wrong. Mitigation: unique-mapping rule, thresholds, held-out tests.
3. Over-tuning to our own mutations. Mitigation: generated variants and a held-out set.
4. LangChain may cost too much time. Mitigation: 3-hour limit, then plain loop (stated in results).
5. The baseline uses LangChain's Gemini wrapper while our agent uses our LLM interface. Same model and settings, but the code paths differ. Listed in the parity report.
6. Quota or rate limits may limit repeated runs.
7. Response-side checks may raise false alarms. Check only fields the tool uses.
8. MTTR under 4 seconds is unproven. LLM-fallback cases may exceed it.
9. The UI and integration may take more time than planned. Mitigation: build the UI in small tasks, not one final task.

## 12. Limitations to state honestly

- Request-side drift is the main scope. Response-side adaptation is minimal and covers clear 1-to-1 path moves only. If Phase 7 is cut, the write-up says so and names the judging risk ("nesting a response" appears in the PS background).
- The schema hash tracks change. It does not prove the schema is authentic. The trusted source is the mock API's `/openapi.json`.
- Results come from a mock API, not real third-party APIs.

## 13. Definition of done

- All must-have PS items are shown live.
- The consistency test and the healing safety tests pass.
- The React UI is complete and verified: Dashboard, Schema Mutation, Agent Comparison, Live Healing Trace, Audit Log, Results and Metrics, Safety Demonstration, all on real backend data.
- No secrets in the frontend bundle, logs, audit file or Git.
- The results table is filled from real runs, with held-out results separate.
- 30-second pitch and short write-up are done and use measured numbers only.
- CLI fallback and runbook exist.
- Limitations are written down.
