# PPT Content: Self-Healing Tool Registry Under Runtime API Schema Drift

## How to use this material

This is a slide-ready content brief, not a claim that every planned capability has been completed or evaluated. The project documentation and source code were reviewed. The repository memory records a prior verification run, but the tests were not rerun for this presentation brief. Use the implementation-status slide to separate what exists in code from what still needs live verification. Add only measured numbers from the latest results file after running the evaluation suite.

## Suggested deck structure

Use slides 1-17 for a hackathon presentation. Keep slides 18-20 as appendix or backup slides if the time limit is short.

### Slide 1 — Self-Healing Tool Registry Under Runtime API Schema Drift

**Subtitle:** PS 01 | Evidence-guided adaptation for agents that call changing APIs

**On-slide content:**

- Project: Reflex
- Team members: [add names]
- Hackathon: Quest It, VESIT

**Presenter notes:** Introduce the problem in one sentence: an agent's API tool definition can become stale while the API is still running. Reflex detects a likely contract change, seeks evidence, validates a safe patch, and either recovers without restart or refuses clearly.

**Visual:** A small before/after payload example. Before: `{"user_id":"123"}`. After: `{"target":{"id":123}}` plus a required tenant header.

### Slide 2 — Project Overview

**On-slide content:**

Reflex is a prototype that lets an API-calling agent recover when a mock API changes its request contract at runtime.

- Detects likely request-schema drift after a relevant 400/422 response.
- Fetches the current schema from the trusted mock API and compares it with the tool definition.
- Builds a candidate mapping, validates it, and updates the in-memory registry without restarting.
- Retries within a cap, verifies the outcome, and records the decision.
- Refuses when evidence or a safe value source is missing.

**Presenter notes:** The system demonstrates a safe recovery mechanism in a controlled mock environment. It does not claim production compatibility with arbitrary third-party APIs.

### Slide 3 — Problem Statement

**On-slide content:**

Agents often call APIs through a static function or tool schema. When an API changes a field name, type, nesting, or required header, the agent can keep sending an obsolete request.

**Possible outcomes:**

- Repeated 400/422 errors and a stalled task.
- A workflow that needs manual repair or a process restart.
- An unsafe guessed default that silently changes the meaning of data.

**Core challenge:** Repair only when the evidence supports the change; otherwise stop safely.

**Presenter notes:** The problem statement highlights runtime adaptation, no restart, auditability, and avoiding invented values. The 18-point solution proposal expands this into evidence collection, decision gates, abstention, and controlled evaluation.

### Slide 4 — Project Objectives and Success Criteria

**On-slide content:**

1. Detect likely request-schema drift during a tool call.
2. Determine what changed by comparing the registry definition to the verified current schema.
3. Apply only a validated, evidence-backed patch in memory.
4. Complete a recoverable task without restarting the process.
5. Refuse ambiguous or unsafe cases and log the reason.
6. Compare with a fixed-schema baseline using the same tasks and retry cap.

**Measures:** Zero-Touch Adaptation Rate (ZTAR), Mean Time to Recovery (MTTR), token usage/overhead, correct refusals, wrong patches, and failures.

**Presenter notes:** The PS target of MTTR under four seconds is an experimental target, not a result to claim until repeated measurements support it.

### Slide 5 — Proposed Solution

**Title takeaway:** Evidence-gated repair with a safe refusal path

**On-slide content:**

- Observe the failed request and classify the failure.
- Retrieve the authoritative current mock schema.
- Diff it against the tool's current request and header definitions.
- Generate mapping/conversion candidates from generic rules.
- Check ambiguity, value provenance, schema validity, and write safety.
- Atomically patch the registry, retry once with that candidate, and verify.
- Roll back only when evidence shows that the patch was wrong; record every decision.

**Presenter notes:** The repair policy is deliberately conservative. Structural validity alone cannot prove semantic correctness, so ambiguous mappings and missing values lead to abstention.

### Slide 6 — Scope and Assumptions

**In scope:**

- A local mock API with real runtime schema mutation.
- Request-side field rename, type change, nesting, required header, and combined changes.
- A versioned in-memory registry, a healing engine, a fixed-schema baseline, JSONL audit, runner, control API, and React UI.
- Minimal response-shape checking for a clear one-to-one path move.

**Assumptions and limits:**

- The mock API's `/openapi.json` is trusted for this prototype.
- The API remains available for schema fetch and retry.
- Demo results come from synthetic mock cases, not real third-party traffic.
- No silent-drift detection is included in the MVP.

**Presenter notes:** A schema hash is useful for change tracking, but it does not authenticate the schema source.

### Slide 7 — Drift Scenarios Covered

| Change | Example | Safe condition |
|---|---|---|
| Rename | `user_id` becomes `uid` | One candidate clearly matches |
| Type change | string identifier becomes integer | Conversion preserves the exact value |
| Nesting | `user_id` becomes `target.id` | Path mapping is unambiguous |
| Required header | API adds `X-Tenant-Token` | Header requirement comes from schema and secret exists in backend config |
| Required body field | API adds `tenant_id` | An approved argument/source provides the value; otherwise refuse |
| Ambiguous change | `account.id` or `profile.id` | Refuse instead of choosing arbitrarily |

**Presenter notes:** The additional required-body-field scenario is a design extension. It is only recoverable when a real value already exists with clear provenance. The missing-value case should demonstrate refusal.

### Slide 8 — End-to-End Flow

**On-slide flow:**

1. Agent calls the tool with the current registry schema.
2. Mock API validates the request against its active schema.
3. A 400/422 triggers diagnosis, not automatic repair.
4. Healer fetches `/openapi.json`, records version/hash, and computes a diff.
5. Candidate generation and offline validation check type, required values, headers, provenance, and write safety.
6. Registry compare-and-swap applies the validated definition.
7. Agent retries within the schema-attempt cap; backend result is checked.
8. System verifies success or rolls back/refuses and emits trace plus audit record.

**Presenter notes:** 401/403, rate limits, timeouts, connection errors, 5xx, unrelated 4xx, and business-validation errors must not be mistaken for schema drift. A failed candidate is never replayed unchanged.

**Visual:** Draw this as a left-to-right process with a branch from validation to “apply” or “refuse”; include rollback from failed verification.

### Slide 9 — System Architecture

**On-slide diagram (editable boxes/arrows):**

```text
React UI (5173)
      | REST + SSE
Control API (8001) ---- Run manager / scenarios / metrics
      |                         |                 |
      | admin key server-side   |                 +--> JSONL results
      v                         +--> baseline + healing agent
Mock API (8000)                         |             |
  ActiveSchema                          |             +--> versioned tool registry
   |            |                       |                       |
   +--> request validator               +--> healer <------------+
   +--> generated /openapi.json                  |
   +--> mutation/fault controls                  +--> JSONL audit
```

**Component responsibilities:**

- **Mock API:** One active schema controls both request validation and published OpenAPI. Admin mutation and fault endpoints support the demo.
- **Registry and executor:** Keep versioned tool definitions, build requests from current definitions, and track value provenance.
- **Healer:** Classify, fetch, diff, hypothesize, validate, patch, retry, verify, and make evidence-based rollback/refusal decisions.
- **Control API:** Orchestrate runs, expose state, and stream trace events.
- **React UI:** Show schema, comparisons, live trace, audit, metrics, and safety scenarios from backend state.
- **Runner/audit:** Persist run records and redacted JSONL decisions for metrics and review.

### Slide 10 — Healing Decision Logic

**On-slide content:**

| Evidence/result | Decision |
|---|---|
| 400/422 and a relevant verified-schema delta | Continue to candidate validation |
| 400/422 without a relevant delta | Refuse as no evidence / report validation issue |
| One strong mapping and value provenance | Validate and consider patch |
| Multiple near-equal mappings | Refuse as ambiguous |
| Lossy conversion or missing required value | Refuse |
| Missing credential | Refuse; never invent or extract a secret |
| 5xx, timeout, connection failure, 429 | No schema patch; handle infrastructure/rate limit separately |
| Same patch fails | Do not replay; roll back/refuse based on evidence |
| Registry revision became stale | Discard candidate and re-fetch/re-diff |

**Presenter notes:** For write calls, the implementation marks the call as dry-run before retry. In a real payment/order API, safe retry would require idempotency support or outcome verification.

### Slide 11 — Safety and Trust Boundaries

**On-slide content:**

- The agent cannot call mock admin endpoints.
- Admin key, Gemini key, and header credentials stay on the backend.
- The browser invokes privileged operations through the control API.
- Required header names/formats come from the verified schema; secret values come from configured backend secrets.
- LLM output, if enabled, may suggest mappings only and must pass the same validator.
- Logs/events redact credentials; the audit hash tracks changes but does not establish authenticity.
- Ambiguity, unavailable values, unsafe writes, and exhausted retry caps stop the automated path.

**Presenter notes:** The configured API schema is treated as trusted within the local mock demo. Production use would need an authenticated schema source, stronger authorization/CSRF controls, and careful operation-specific retry policies.

### Slide 12 — Prototype and Live Demo

**Demo sequence:**

1. Show the initial schema and run a normal request.
2. Trigger the PS combined mutation: nest the identifier, change its type, and add a required tenant header.
3. Show the baseline response and the self-healer trace side by side.
4. Inspect the candidate, validation result, in-memory registry revision, retry, and final verification.
5. Open the audit record and show redacted evidence and schema hash.
6. Run missing-credential, ambiguous-mapping, and non-drift scenarios to show safe refusal.

**Presenter notes:** The mutation changes the actual mock validator and the generated OpenAPI schema together. It is not a frontend-only simulation. Use measured timings from the current run only.

### Slide 13 — Evaluation Plan and Metrics

**On-slide content:**

- **ZTAR:** correctly completed recoverable mutations without a human step divided by recoverable mutations.
- **MTTR:** first failed call after mutation to first verified successful call; report median and p95 for recoveries.
- **Token overhead:** provider-reported input/output usage for healing diagnosis/recovery compared with baseline tokens; mark rule-based healing as zero LLM tokens only when no healing LLM call occurred.
- **Safety outcomes:** correct refusals, wrong patches, failed cases, and non-drift misclassifications.
- **Stratification:** clear/vague/no-hint errors; rule-based versus optional LLM path; tuning versus held-out cases.
- **Correctness source:** mock server's recorded payload and expected case outcome, not the agent's success claim alone.

**Presenter notes:** Fix formulas before experiments, repeat tuning cases, keep a held-out set untouched during tuning, and report small sample sizes and limitations. Do not use estimates for token counts.

### Slide 14 — Current Implementation Status

**Implemented in repository code:**

- Runtime-mutating mock API with shared active schema, validator, OpenAPI generation, mutations, faults, and payload recording.
- Versioned registry with compare-and-swap and rollback as a new revision.
- Error classifier, generic schema diff, candidate rules, lossless conversion checks, secret provider, value-provenance checks, validation, retry cap, response check, audit log, and trace events.
- Plain-loop baseline with fixed tool schema and same task/schema evidence access; deterministic fake LLM for tests and no-key development.
- Runner, cases, records, metrics, control API routes/SSE, React sections, and CLI fallback.

**Partial or unverified:**

- LangChain baseline is not implemented; the code uses a plain tool-calling loop after the documented time-box fallback.
- Live Gemini model/key/quota/tool-call/token metadata are unverified because the project memory records no API key. The model name in config must be checked against the actual account before a live run.
- The optional LLM mapping fallback is not connected to the healer; current healing path is rule-based.
- One existing result file records one PS-demo comparison pair only. It is not enough for a broad performance claim or final held-out evaluation.
- Code review found a stale registry compare-and-swap branch that emits a refusal event and returns, but does not write an audit entry or automatically re-fetch/re-diff as the architecture describes. Close this gap before claiming every stale-update decision is audited and retried safely.
- Repository memory records prior checks (45 backend tests, 6 frontend tests, 10/10 smoke checks), but those were not rerun for this presentation summary.

**Presenter notes:** Update this slide immediately before presenting. If you rerun the suite or configure Gemini, replace these notes only with evidence from the resulting logs and records.

### Slide 15 — Preliminary Evidence and What It Shows

**On-slide content:**

- The existing result record shows the PS-demo baseline ending in failure while the rule-based healer recovered.
- The repository records automated tests for schema consistency, healing/refusal behavior, audit redaction, runner/metrics, control routes, and frontend behavior.
- The code includes scenarios for missing credentials, ambiguous mappings, lossy conversion, 5xx, rejected credentials, and response nesting.
- Current saved result data is a single paired run, so it demonstrates the flow but does not establish a stable success rate or MTTR distribution.

**Presenter notes:** Put current result counts and timing on screen only after reading them from the run output. Avoid saying “beats baseline” as a general result from one pair. State the exact case and sample size.

### Slide 16 — Limitations and Risks

**On-slide content:**

- The prototype evaluates synthetic changes against a local mock API.
- Schema access is assumed to be reliable and trusted; a hash alone does not authenticate schema contents.
- Semantic meaning cannot always be inferred from structure. The system refuses ambiguous mappings, which can lower automatic recovery coverage.
- The baseline implementation is a plain loop, so comparisons should disclose this framework deviation from the original LangChain plan.
- Gemini performance and provider-reported usage remain unverified until an API key and quota are tested.
- Response adaptation is restricted to clear one-to-one path moves.
- Writes use dry-run for the demo; production mutations need API-specific idempotency and verification.

### Slide 17 — Future Scope

**Near term:**

- Run repeated cases across all error styles and finish a held-out evaluation.
- Verify Gemini access, supported model configuration, function calling, quota, latency, and token metadata.
- Connect the optional mapping-only LLM fallback after deterministic rules and safety gates remain stable.
- Expand provenance-backed required-field tests and explicit registry concurrency tests.

**Further work:**

- Test against versioned real API specifications or provider sandboxes with permission.
- Add authenticated schema provenance/signatures and schema-source policy.
- Support operation-specific idempotency keys and postcondition checks for writes.
- Study silent drift, where the API accepts a request but ignores a stale field.
- Evaluate risk/coverage trade-offs across more mutation families and independently designed test sets.
- Add deployment observability and access controls before any remote production use.

**Presenter notes:** Silent drift and real API integrations are future research, not capabilities currently demonstrated by the MVP.

### Slide 18 — Conclusion

**On-slide content:**

Reflex demonstrates a runtime repair loop for changing API request schemas. It uses the mock API's current contract as evidence, validates mappings before changing the registry, and makes refusal an explicit outcome when a safe repair is not supported.

**Closing line:** The prototype's value is a controlled, auditable recovery path that can adapt without restarting and stop when it cannot justify a change.

### Slide 19 — 30-Second Pitch

“AI agents often fail when an API changes but the agent's tool schema stays fixed. Reflex detects likely schema drift, fetches the current API contract, and proposes a repair from the difference. It validates values and mappings before hot-patching the in-memory tool registry, then retries and verifies the task without a restart. If the mapping is ambiguous, a credential is missing, or the change is unsafe, it refuses and records why. We demonstrate the behavior against a mock API and compare it with a fixed-schema baseline using measured recovery, refusal, and token metrics.”

### Slide 20 — References

**Project sources:**

1. Official hackathon problem statement, PS 01: *Self-Healing Tool Registries Under Runtime API Schema Drift* (provided PDF).
2. Project proposal: *Self-Healing Tool Registry* (18-point solution PDF provided by the team).
3. Reflex project materials: `docs/specs/PRD.md`, `docs/specs/Architecture.md`, `docs/specs/rules.md`, `docs/specs/design.md`, `README.md`, `memory.md`, and implementation under `backend/app/` and `frontend/src/`.

**Technical sources:**

4. OpenAPI Initiative, *OpenAPI Specification v3.1.1*: https://spec.openapis.org/oas/v3.1.1.html
5. JSON Schema, *Validation Specification*: https://json-schema.org/draft/2020-12/json-schema-validation.html
6. FastAPI, *First Steps / OpenAPI and JSON Schema*: https://fastapi.tiangolo.com/tutorial/first-steps/
7. Google AI for Developers, *Function Calling with the Gemini API*: https://ai.google.dev/gemini-api/docs/function-calling
8. Google AI for Developers, *Understand and Count Tokens*: https://ai.google.dev/gemini-api/docs/tokens
9. MDN Web Docs, *Server-Sent Events*: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events

## Optional appendix slide — Repository map

- `backend/app/mock_api/`: active schema, validator, OpenAPI generation, mutations, faults.
- `backend/app/healing/`: classifier, schema fetch/diff, hypothesis, validation, healer, response checking, trace events.
- `backend/app/registry/`: tool definitions, executor, tasks, versioned registry.
- `backend/app/agents/`: baseline and healing orchestration.
- `backend/app/runner/`: cases, run harness, records, correctness checks, metrics.
- `backend/app/control_api/`: status, mutation, scenarios, run manager, SSE.
- `frontend/src/pages/`: dashboard, schema, comparison, trace, audit, results, safety.
- `audit/` and `results/`: JSONL audit and run records.

## Presenter checklist

- Replace team names and add institution branding.
- Verify current test status and run a fresh PS-demo comparison before presenting.
- Run repeated tuning cases before showing aggregate metrics; run held-out cases only after tuning is frozen.
- Confirm whether Gemini is live or deterministic fake for the demo and label it accurately.
- Disclose the plain-loop baseline in the comparison slide.
- Keep one paired PS-demo result labeled as an example, not a benchmark conclusion.
- Use screenshots or a live browser view for the actual trace and UI; do not fabricate dashboard metrics.
