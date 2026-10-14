# execution_plan.md --- Antigravity Execution Guide

**Project:** Self-Healing Tool Registry Under Runtime API Schema Drift\
**Time budget:** approximately 48 hours\
**UI:** React + Vite + TypeScript (mandatory)\
**Backend:** FastAPI\
**Execution rule:** one task per run; verify; report; stop.

## A. How to use this plan

1.  Keep this file and `phases.md` at the repository root.
2.  Paste the **MASTER CONTROLLER PROMPT** into Antigravity once for the
    project session.
3.  For each task, copy its exact task prompt from Section D and send it
    as the next instruction.
4.  Do not ask Antigravity to implement all phases in one run.
5.  After each task, inspect the diff, run the listed tests, and confirm
    the completion report.
6.  Create `memory.md` only at the end of Phase 1 (T1.7); update it
    after every later phase and important decision.
7.  Never paste secrets into prompts. Configure them locally in `.env`. Never run `git add`, `git commit`, `git push`, `git reset`, `git rebase`, or other history-changing Git commands; the user handles Git operations manually.

## B. MASTER CONTROLLER PROMPT

Copy and paste this prompt into Antigravity:

``` text
You are the implementation controller for "Self-Healing Tool Registry Under Runtime API Schema Drift".

SOURCE DOCUMENTS
Before implementation, read:
- PRD.md
- Architecture.md
- rules.md
- phases.md
- design.md
- execution_plan.md
- memory.md, only when it exists

SOURCE OF TRUTH
The official hackathon Problem Statement wins if any document conflicts with it. Follow the approved documents. Do not silently alter architecture or scope.

WORK STYLE
- Inspect the repository, Git status, current branch, existing files, and test commands before every task.
- Execute only the task ID explicitly assigned by the user. Do not implement the next task automatically.
- Check dependencies in phases.md and confirm they are complete before starting.
- Preserve existing user work. Never delete or overwrite files without a clear task requirement.
- Use small, typed, testable modules and add tests for new behaviour.
- Keep React + Vite + TypeScript as the only dashboard stack. Do not use Streamlit.
- Keep FastAPI services, registry, healer, audit, agents, runner and UI responsibilities aligned with Architecture.md.
- Do not introduce dependencies without a clear need and a brief reason in the completion report.
- Do not hardcode schema field names in healing rules.
- Never invent field values, credentials, test results, metrics, or successful events.
- Never expose secrets in code, prompts, logs, JSONL, SSE events, API responses, frontend bundles or Git.
- The LLM may suggest mappings only; it must never provide values or credentials. All suggestions pass the same validation as rule-based patches.
- Do not patch infrastructure failures or bypass authentication.
- Do not weaken the baseline or tune tests to make the healing agent look better.
- Use actual API token usage metadata. If unavailable, report it as unavailable rather than estimating.
- Do not claim MTTR or success targets before measurement.
- Run the tests required by the assigned task and the regression commands documented in execution_plan.md.
- If a blocker occurs, attempt only reasonable diagnosis within the task scope. Do not silently work around a safety requirement. Report the blocker and stop if it prevents safe completion.
- Update relevant documentation when implementation changes an agreed interface. Report any proposed architecture change and wait for approval before making a material change.

MEMORY
- At the end of Phase 1, create memory.md because it does not exist initially.
- At the end of every subsequent phase and after important decisions, append a short update containing: decisions, completed tasks, tests/evidence, blockers, measured results, open questions, and next task.
- Never put secrets in memory.md.

COMPLETION REPORT
At the end of the assigned task, report:
1. Status: COMPLETE / PARTIAL / BLOCKED.
2. Task ID and objective.
3. Files created or changed.
4. Implementation summary.
5. Commands/tests run and exact outcomes.
6. Acceptance criteria passed/failed.
7. Known issues and blockers.
8. Assumptions or decisions needing approval.
9. Documentation/memory changes.
10. Exact next task ID and prerequisites.

STOP after this report. Do not begin the next task until explicitly instructed.
```

## C. Reusable task-level prompt

Use this only as a template if the task-specific prompt in Section D
needs to be adapted. Preserve the task ID and acceptance criteria from
`phases.md`.

``` text
Execute only task [TASK_ID — TASK NAME] from phases.md.

Read PRD.md, Architecture.md, rules.md, phases.md, design.md,
execution_plan.md, and memory.md if it exists. Inspect the repository
and Git status. Verify the task's dependencies are complete.

Implement only the task's stated scope. Follow the expected file list
where possible; if a file layout conflict exists, explain it before
making a material architecture change. Add tests for new behaviour.
Run the task tests and relevant regression commands. Do not fake
success, invent values, expose secrets, or start another task.

Report status, changed files, commands and test results, acceptance
criteria, known issues, blockers, documentation updates, and the exact
next task. Stop after the report.
```

## Delivery priorities for the 48-hour limit

Keep the 48-hour limit strict. Build in this order: (1) runtime-mutating mock API and schema consistency; (2) deterministic healer and safe refusal/rollback; (3) audit trail and redaction; (4) fair baseline; (5) correctness and metrics; (6) a working, backend-driven React UI with all seven required sections; (7) demo rehearsal and measured results.

If time slips, cut in this order: advanced chart/UI polish first, then optional LLM mapping fallback (Phase 8), then response-side adaptation if it is not required for the core demo. Do **not** cut schema consistency tests, safety/refusal cases, audit redaction, baseline comparison, metric correctness, the basic React UI, or live demo rehearsal. Mark any skipped feature clearly; do not claim it is complete. The CLI demo is fallback only, not a replacement for the required React UI.

For Gemini, T0.3 verifies actual API access, quota, tool calling, and usage metadata. A valid model ID alone is not proof of access. If live access is blocked, proceed with the deterministic fake client for core tests and label live-model results as blocked; do not invent successful calls or token counts.

## D. Task-specific Antigravity prompts

Each task below has exactly one prompt. IDs and titles match
`phases.md`.

### Phase 0 --- Repository and environment

#### T0.1 --- Inspect repository and existing documentation

``` text
Task T0.1 — Inspect repository and existing documentation.

Read PRD.md, Architecture.md, rules.md, phases.md, design.md and
execution_plan.md. Inspect the repository tree, Git status/branch,
available Python and Node versions, existing environments, current
test commands, and existing application code. Do not delete or
reformat existing work. Identify mismatches between files and report
them without silently resolving material design decisions.

Acceptance: provide a concise baseline report with repo layout,
commands, existing work, blockers and safe next steps. No application
code changes unless a tiny inspection note is explicitly needed.
Stop after the report.
```

#### T0.2 --- Configure Python and frontend environments

``` text
Task T0.2 — Configure Python and frontend environments.

Prerequisite: T0.1 complete. Read the project documents and inspect
existing setup first. Configure Python 3.11+ in a backend virtual
environment and React/Vite/TypeScript in frontend/. Use the repository's
existing package manager if already chosen; otherwise choose one and
document it. Add only required dependencies and lockfiles. Ensure .env
and local secrets are ignored by Git; create .env.example with empty
placeholders only. Do not implement project features.

Verify Python imports, frontend install, frontend build, and a minimal
backend test command. Report exact commands and outcomes, then stop.
```

#### T0.3 --- Verify Gemini API capability and configuration

``` text
Task T0.3 — Verify Gemini API capability and configuration.

Prerequisite: T0.2 complete. Inspect current configuration. Verify the
configured model ID against the team's actual Google AI Studio API
access. Check key presence without printing it, quota/error status,
tool/function calling, and actual input/output usage metadata. Use only
supported model settings; do not assume deprecated parameters work.
Implement a minimal verification script at backend/scripts/verify_llm.py
and config placeholders as needed. For `gemini-3.8-flash`, use only
supported `thinking_level` values (`low`, `medium`, `high`); do not send
`temperature`, `top_p`, or `top_k`. Verify tool/function calling and
provider-reported input/output token usage. Never make repeated costly calls.

If credentials or quota are unavailable, mark live verification BLOCKED
and ensure later development can use a deterministic fake client. Do not
invent a successful result. Report findings and stop.
```

#### T0.4 --- Establish configuration, health checks, and baseline commands

``` text
Task T0.4 — Establish configuration, health checks, and baseline commands.

Prerequisite: T0.2 complete. Add typed configuration and minimal health
checks/startup smoke tests for the planned services. Keep secrets out of
code and responses. Document exact local test/start commands in README.
Do not implement mock API mutations or healing logic yet.

Acceptance: config tests pass; invalid/missing required settings produce
clear errors; no secret is logged. Report files, tests, and stop.
```

### Phase 1 --- Genuine runtime-mutating mock API

#### T1.1 --- Implement ActiveSchema and canonical schema model

``` text
Task T1.1 — Implement ActiveSchema and canonical schema model.

Prerequisite: Phase 0 complete. Implement one in-memory ActiveSchema
with monotonic version, request schemas per endpoint, required headers,
response schemas and error style. Keep the model independent from
FastAPI's cached OpenAPI generation. Add fixtures for the initial schema.
Do not implement routes or healing.

Test schema validation and monotonic version increments. Acceptance:
one active object is the source of truth and tests pass. Stop and report.
```

#### T1.2 --- Implement raw-body validation and mock endpoints

``` text
Task T1.2 — Implement raw-body validation and mock endpoints.

Prerequisite: T1.1. Implement FastAPI mock endpoints that read raw JSON
and headers and validate them with jsonschema against ActiveSchema.
Include a read-only/idempotent fetch endpoint and a write endpoint
supporting dry_run. Do not use Pydantic body models for mutable endpoints.

Test valid/invalid payloads, types, required fields and headers.
Acceptance: actual endpoint behaviour follows ActiveSchema. Stop.
```

#### T1.3 --- Generate `/openapi.json` from ActiveSchema

``` text
Task T1.3 — Generate `/openapi.json` from ActiveSchema.

Prerequisite: T1.1. Implement a custom OpenAPI/schema endpoint generated
from the active schema on every request. Include the active version and
disable/avoid serving stale generated schema for the mock API. Do not
change runtime validation logic in this task.

Test that returned schema and version exactly match ActiveSchema.
Stop after reporting.
```

#### T1.4 --- Add protected mutation, reset, and fault endpoints

``` text
Task T1.4 — Add protected mutation, reset, and fault endpoints.

Prerequisites: T1.2 and T1.3. Add admin-protected runtime mutation,
reset and fault injection. Support field rename, type change, request
nesting, new required header, combined PS demo, ambiguous/lossy cases,
clear/vague/no-hint errors, and separate 5xx/timeout/429/rejected
credential faults. Protect admin routes with a backend-only admin key;
agents must not access them. Fault injection must not mutate schema.

Add focused tests for auth, mutations and faults. Stop.
```

#### T1.5 --- Add schema consistency test suite

``` text
Task T1.5 — Add schema consistency test suite.

Prerequisite: T1.4. Test after each mutation: old payload rejected,
new payload accepted, exposed schema version/content matches active
schema, required header rejected when absent and accepted when valid,
and no route exposes a different schema. Include a negative test that
proves the suite fails when a mismatch is deliberately introduced in a
test fixture.

Acceptance: consistency suite passes. Stop.
```

#### T1.6 --- Add server-side correctness recording

``` text
Task T1.6 — Add server-side correctness recording.

Prerequisite: T1.2. Record accepted payload/correctness data needed by
the runner, without storing secrets or unnecessary personal data.
Expose this only to trusted test/control code, not agents. Add tests
showing correctness can be checked independently of HTTP status.

Acceptance: tests can distinguish correct payload from merely receiving
200. Stop.
```

#### T1.7 --- Create initial `memory.md`

``` text
Task T1.7 — Create memory.md after Phase 1.

Prerequisites: T1.1–T1.6 pass. Create concise memory.md with agreed
decisions, completed work, test evidence, blockers, open questions,
measured results (if any), and the next task. Never include secrets.
Do not create or modify unrelated features.

Acceptance: memory.md reflects actual repository state and Phase 1 exit
criteria pass. Stop and report.
```

### Phase 2 --- Registry, executor, and classification

#### T2.1 --- Implement versioned in-memory tool registry

``` text
Task T2.1 — Implement versioned in-memory tool registry.

Prerequisite: Phase 1 exit criteria pass. Implement current/previous
tool definitions, version tracking, atomic compare-and-swap apply and
restore operations. Updates must be visible to the next call without
process restart. Reject stale updates and ensure a rollback cannot overwrite
a newer revision. Add tests for version increments, apply, rollback and
concurrent-update protection. Stop.
```

#### T2.2 --- Implement executor and task definitions

``` text
Task T2.2 — Implement executor and task definitions.

Prerequisite: T2.1. Build requests from the current registry definition
on every call. Preserve original argument values and track value
provenance. The executor performs calls only; it must not heal or patch.
Add payload-building and provenance tests. Stop.
```

#### T2.3 --- Implement error classifier and infrastructure handling

``` text
Task T2.3 — Implement error classifier and infrastructure handling.

Prerequisite: Phase 1. Classify 400/422 as possible drift; 401/403 as
not drift by default; 5xx, timeouts, connection failures, 429, 404 and
other unrelated errors as not drift by default. Infrastructure retry
counts must be separate from schema-attempt counts. Never patch
infrastructure errors or bypass auth. Test each category. Stop.
```

#### T2.4 --- Add typed run and trace event models

``` text
Task T2.4 — Add typed run and trace event models.

Prerequisites: T2.1–T2.3. Define run IDs, sequence numbers, timestamps,
agent labels, event types and safe payload schemas for trace events.
Redact secret values. Add model/serialization/redaction tests. Stop.
```

### Phase 3 --- Core healing engine and safety

#### T3.1 --- Fetch verified schema and compute canonical hash

``` text
Task T3.1 — Fetch verified schema and compute canonical hash.

Prerequisite: Phase 2. Fetch the trusted mock API schema, capture version,
canonicalize JSON with sorted keys, compact separators and UTF-8, then
calculate SHA-256. State clearly that the hash tracks changes and does
not prove authenticity. Test stable hashes and version capture. Stop.
```

#### T3.2 --- Implement generic schema diff

``` text
Task T3.2 — Implement generic schema diff.

Prerequisite: T3.1. Compare the old tool schema with the verified current
schema to identify removed/added fields, changed types, path moves and
required headers. Do not hardcode example names such as user_id or target.
Add tests for each core and combined mutation. Stop.
```

#### T3.3 --- Implement safe conversion and candidate patch rules

``` text
Task T3.3 — Implement safe conversion and candidate patch rules.

Prerequisite: T3.2. Propose mapping/conversion operations only. Accept
rename/path moves only when one candidate clearly leads. Permit only
meaning-preserving conversions. Header names/formats come from verified
schema; credential values come only from approved secrets configuration.
A newly required body field is allowed only when it maps unambiguously to an
original task argument or explicitly configured non-secret source. Never use
error text/schema/LLM to invent values. Test ambiguous mapping, "00123",
"123", missing credentials, and a missing required-body-value refusal. Stop.
```

#### T3.4 --- Implement offline validation and write safety

``` text
Task T3.4 — Implement offline validation and write safety.

Prerequisite: T3.3. Validate patched payload types, required fields,
headers, extra fields and value provenance against the verified schema.
Write operations require mock dry_run; otherwise return
needs_human_review without applying the patch. Ensure LLM suggestions
will use the same validator. Add positive and negative tests. Stop.
```

#### T3.5 --- Implement apply, retry, verify, and evidence-based rollback

``` text
Task T3.5 — Implement apply, retry, verify, and evidence-based rollback.

Prerequisite: T3.1–T3.4. Apply valid patches to the in-memory registry,
retry within the shared schema-attempt cap, verify the server-side result,
and refetch schema/version/hash after failed attempts. Roll back only
when evidence indicates the patch is wrong. Never replay a failed candidate.
Keep a patch on unrelated 5xx/timeout/429. If a new field error appears,
re-diff and consider only a materially different candidate within the cap.
Handle schema changes during healing as new mutations. Add tests for every
decision branch and prove there is no infinite loop. Stop.
```

#### T3.6 --- Add refusal reason codes and safety regression tests

``` text
Task T3.6 — Add refusal reason codes and safety regression tests.

Prerequisite: T3.3–T3.5. Implement/test reason codes for missing
credential, ambiguous mapping, lossy conversion, no evidence, validation
failure, retry cap, human review, not drift and rejected auth. Every
refusal emits a trace event and safe audit record. Test that no unsafe
patch is applied. Stop.
```

### Phase 4 --- Audit log

#### T4.1 --- Implement redacted JSONL audit writer

``` text
Task T4.1 — Implement redacted JSONL audit writer.

Prerequisite: Phase 3. Append patch, refusal, rollback, human-review and
not-drift records with run ID, versions, hashes, evidence, confidence,
outcome, reason and actual token counts when available. Redact secrets
before serialization. Do not log raw credentials. Test JSONL validity
and append behaviour. Stop.
```

#### T4.2 --- Add audit integrity and redaction tests

``` text
Task T4.2 — Add audit integrity and redaction tests.

Prerequisite: T4.1. Plant known dummy secrets in test inputs and inspect
logs, events and control API serialization. Verify none leak. Test that
each required decision produces an audit entry. Stop.
```

### Phase 5 --- LLM interface and agents

#### T5.1 --- Implement replaceable LLM interface and fake client

``` text
Task T5.1 — Implement replaceable LLM interface and fake client.

Prerequisite: Phase 0. Define one LLM interface returning text/tool
calls, input/output token counts when supplied by provider, latency and
model ID. Add deterministic fake client for tests. Only llm/gemini.py
may import the Gemini SDK. Core tests must work without an API key.
Stop.
```

#### T5.2 --- Implement Gemini adapter and capability check

``` text
Task T5.2 — Implement Gemini adapter and capability check.

Prerequisites: T0.3 and T5.1. Implement the configured Gemini adapter
using supported model settings. Verify tool calling and actual usage
metadata. Do not log the API key. If unavailable, retain fake-client
support and document the live integration blocker. Stop.
```

#### T5.3 --- Implement baseline agent

``` text
Task T5.3 — Implement baseline agent.

Prerequisites: T2.2, T2.3 and T5.1. Implement LangChain baseline with
fixed tool schema and the same model/settings, initial tools, tasks,
mock API, error text, schema access and retry cap as the healer. It has
no healing layer or registry patching. Time-box LangChain integration;
do not rig baseline failures. Test success and failure recording. Stop.
```

#### T5.4 --- Implement self-healing agent orchestration

``` text
Task T5.4 — Implement self-healing agent orchestration.

Prerequisites: Phase 3, T4.1 and T5.1. Connect task execution, healer,
trace events, audit writer and result records. Verify end-to-end recovery
and refusal without restarting the process. Test the PS demo mutation.
Stop.
```

#### T5.5 --- Verify parity and token usage

``` text
Task T5.5 — Verify parity and token usage.

Prerequisites: T5.2–T5.4. Check identical model/settings and equivalent
evidence access. Capture provider-reported token usage; do not estimate.
Document wrapper differences if LangChain and the custom adapter differ.
Stop with a parity report and test evidence.
```

### Phase 6 --- Test runner and metrics

#### T6.1 --- Define cases, generated variants, and held-out set

``` text
Task T6.1 — Define cases, generated variants, and held-out set.

Prerequisite: Phase 3. Define stable cases for clear/vague/no-hint
errors, core/combined mutations, ambiguity, lossy conversion, missing
credential and non-drift faults. Separate held-out cases from tuning
cases and do not inspect held-out results while tuning. Stop.
```

#### T6.2 --- Implement run records and correctness checks

``` text
Task T6.2 — Implement run records and correctness checks.

Prerequisites: T1.6 and Phase 5. Record case, agent, split, repeat,
timings, outcome, expected outcome, tokens, attempts, retries, model and
server-side correctness. Add serialization and correctness tests. Stop.
```

#### T6.3 --- Implement repeated runner and metric formulas

``` text
Task T6.3 — Implement repeated runner and metric formulas.

Prerequisite: T6.1–T6.2. Calculate ZTAR using recoverable cases as the
denominator, MTTR median/p95 for successful recoveries, actual token
counts/ratio, total task tokens, retries, correct refusals, wrong patches
and failures. Split by error style and rule/LLM path. Empty results must
show unavailable/n/a. Add formula tests with known fixture data. Stop.
```

#### T6.4 --- Run held-out set once and export results

``` text
Task T6.4 — Run the held-out cases once after tuning is frozen.
Prerequisite: T6.3. Record actual results, model/settings, date, run
counts and limitations. Do not tune after viewing held-out outcomes
without declaring a new evaluation. Export machine-readable results and
a concise report. Never fill gaps with invented metrics. Stop.
```

### Phase 7 --- Minimal response validation

#### T7.1 --- Add response schema validation

``` text
Task T7.1 — Add response schema validation.
Prerequisite: Phase 3. Validate successful response bodies against the
expected response schema for fields the tool actually uses. Keep this
separate from 4xx request drift classification. Test valid and changed
response shapes. Stop.
```

#### T7.2 --- Add clear 1-to-1 response path adaptation

``` text
Task T7.2 — Add clear 1-to-1 response path adaptation.
Prerequisites: T7.1 and T4.1. Adapt only a clear one-to-one path move.
For ambiguity, do not return response data to the agent; log
ambiguous_response_mapping and refuse. Test both clear and ambiguous
cases. Stop.
```

### Phase 8 --- Optional LLM mapping fallback

#### T8.1 --- Add constrained mapping-only fallback

``` text
Task T8.1 — Add constrained LLM mapping-only fallback.
Prerequisites: Phase 3 and Phase 5. Implement only if core tests, UI,
baseline and audit are on schedule. LLM may suggest a mapping, never a
value/credential, and cannot override deterministic ambiguity refusal.
Validate output with the same validator. Test malformed output and
fabricated-value attempts. If blocked by time/quota, mark SKIPPED and
do not delay mandatory work. Stop.
```

### Phase 9 --- React UI and integration

#### T9.1 --- Scaffold React/Vite/TypeScript application

``` text
Task T9.1 — Scaffold React/Vite/TypeScript application.
Prerequisite: T0.2. Create frontend routes, responsive CSS foundation,
Vitest/React Testing Library and Vite proxy to control API. Do not use
Streamlit or hardcoded result data. Verify dev server and production
build. Stop.
```

#### T9.2 --- Implement typed API client, shared types, and app shell

``` text
Task T9.2 — Implement typed API client, shared types, and app shell.
Prerequisite: T9.1. Add typed request helpers, shared response/event
types, navigation and common loading/error/empty states. Do not place
secrets in Vite env or browser code. Add client tests. Stop.
```

#### T9.3 --- Implement control API status/schema/mutation endpoints

``` text
Task T9.3 — Implement control API status/schema/mutation endpoints.
Prerequisites: Phase 1 and Phase 4. Provide health/status/schema,
mutation/reset, consistency, cases/scenarios, audit and metrics routes.
Admin credentials remain server-side. Mutation success is returned only
after the consistency check passes. Add API tests and redaction checks.
Stop.
```

#### T9.4 --- Implement Dashboard and Schema Mutation pages

``` text
Task T9.4 — Implement Dashboard and Schema Mutation pages.
Prerequisites: T9.2 and T9.3. Dashboard displays real status, schema
version/hash and available results. Schema page shows active schema,
mutation/error-style controls, reset confirmation and consistency test.
Only update success state after backend confirmation. Include loading,
error and empty states; add UI tests. Stop.
```

#### T9.5 --- Implement run API, run manager, and SSE trace

``` text
Task T9.5 — Implement run API, run manager, and SSE trace.
Prerequisites: Phase 5 and T9.3. Add start/read/list run routes and SSE
events with replay, sequence IDs, heartbeat and reconnect behaviour.
Permit one active comparison run and return 409 when busy. Events must
come from actual backend execution. Test stream lifecycle and stop.
```

#### T9.6 --- Implement Agent Comparison and Live Trace pages

``` text
Task T9.6 — Implement Agent Comparison and Live Trace pages.
Prerequisite: T9.5. Show both agents' actual statuses, attempts, errors,
results, timing and token usage. Render real SSE events in a timeline,
including patch, validation, rollback and refusal. Never simulate events.
Test streaming, disconnection and completed states. Stop.
```

#### T9.7 --- Implement Audit, Results, and Safety pages

``` text
Task T9.7 — Implement Audit, Results, and Safety pages.
Prerequisites: Phase 4, Phase 6 and T9.3. Build audit filters/details,
metrics tables/charts, and safety scenarios for successful recovery,
missing credential, ambiguous mapping and non-drift errors. Display
actual backend data only; explain refusal reasons in plain English.
Test empty data and refusal rendering. Stop.
```

#### T9.8 --- Add loading/error/empty/responsive states and security checks

``` text
Task T9.8 — Add loading/error/empty states consistently to every page.
Test widths 375, 768 and 1280 pixels. Ensure no API/admin/header secret
appears in bundle, events or responses. Disable privileged actions while
requests are pending and handle backend-down state clearly. Run frontend
secret scan and UI tests. Stop.
```

#### T9.9 --- Frontend tests and backend integration tests

``` text
Task T9.9 — Run frontend and backend integration checks across dashboard,
schema mutation, run start, SSE trace, audit, metrics and safety scenarios.
Fix defects within this task only. Confirm all pages use real API data
and no fake events/results exist. Run production build and relevant
backend tests. Report exact outcomes and stop.
```

### Phase 10 --- End-to-end validation and demo

#### T10.1 --- Add CLI fallback and startup/runbook instructions

``` text
Task T10.1 — Add a minimal CLI fallback that uses the same real backend
flow: consistency check, normal run, mutation, baseline/healer run,
audit tail, refusal and results. Document startup commands for mock API,
control API and React frontend. Do not replace or downgrade the React UI.
Test the CLI smoke flow and stop.
```

#### T10.2 --- Run full regression and end-to-end suite

``` text
Task T10.2 — Run all consistency, safety, audit-redaction, baseline parity,
metrics, response-check (if implemented), control API, UI and end-to-end
tests. Check that the mock schema and OpenAPI always agree. Do not claim
pass when a test was skipped. Produce a clear pass/fail/blocker list and
stop.
```

#### T10.3 --- Fix critical integration defects

``` text
Task T10.3 — Fix only reproducible critical defects found by T10.2.
Prioritize security, incorrect patches, fake results, broken core demo,
schema inconsistency and UI/backend integration. Add regression tests
for every fix. Do not add features or change architecture silently.
Re-run affected tests and stop.
```

#### T10.4 --- Rehearse live demo and verify fallback

``` text
Task T10.4 — Rehearse the demo in this order: health/consistency, both
agents on normal task, apply real PS mutation, baseline result, live
healing trace, audit record, safe refusal, measured results, CLI fallback.
Verify every screen is backend-driven and reset works. Record issues and
fix only demo-blocking problems. Stop with rehearsal checklist.
```

#### T10.5 --- Final write-up, 30-second pitch, and limitations

``` text
Task T10.5 — Write the 30-second pitch and short technical write-up
from actual implementation and results. Explain diagnosis, patch logic,
safety checks, baseline, measured metrics, limitations and any skipped
features. Do not claim unmeasured targets or imply real third-party API
testing. Verify all figures against results files. Stop.
```

#### T10.6 --- Final memory and status report

``` text
Task T10.6 — Update memory.md and prepare the final status report.
List completed/partial/skipped tasks, exact test outcomes, measured
results, known limitations, startup/demo commands and repository status.
Do not include secrets. Verify documentation matches the actual
implementation. Stop after the report.
```

## E. Regression commands

Adapt only if repository inspection proves the command differs; document
the actual command if changed.

``` bash
# Backend, from backend/
python -m pytest -q

# Frontend, from frontend/
npm test -- --run
npm run build
```

Before demo, also run the schema consistency test and the end-to-end
smoke script. Do not mark a test as passed if it was not run.

## F. Phase prompts

Use these short phase wrappers together with the task-specific prompt(s)
above. Execute tasks individually, not as a single large phase batch.

-   **Phase 0:** Complete T0.1--T0.4 in order. Verify environment and
    record Gemini access status. Stop at phase exit criteria.
-   **Phase 1:** Complete T1.1--T1.7 in order. The mock must genuinely
    change validation and schema together. Create `memory.md` only at
    T1.7.
-   **Phase 2:** Complete T2.1--T2.4 in order; classifier may proceed
    alongside registry work only if files are separate.
-   **Phase 3:** Complete T3.1--T3.6 in order. Safety tests are
    mandatory.
-   **Phase 4:** Complete T4.1--T4.2 after first patch/refusal events
    exist.
-   **Phase 5:** Complete T5.1--T5.5. If Gemini is unavailable, test
    through fake client and clearly mark live-model tasks blocked.
-   **Phase 6:** Complete T6.1--T6.4. Freeze tuning before held-out
    evaluation.
-   **Phase 7:** Complete T7.1--T7.2 after core recovery works. If cut,
    document the limitation.
-   **Phase 8:** Attempt T8.1 only if core tests and UI schedule are
    safe.
-   **Phase 9:** Complete T9.1--T9.9. Basic seven-section UI is
    mandatory.
-   **Phase 10:** Complete T10.1--T10.6. Leave enough time for
    rehearsal.

## G. Dependency and recovery workflow

-   Start with T0.1; never skip repository inspection.
-   Phase 1 is the key prerequisite for real schema handling.
-   Phase 2 and Phase 3 build the registry and healer.
-   Phase 4 makes all decisions auditable.
-   Phase 5 connects agents; Phase 6 measures them.
-   T9.1 may run in parallel with backend work only if a separate owner
    handles it and API contracts remain aligned. T9.3--T9.7 depend on
    backend contracts.
-   Do not run two Antigravity tasks that edit the same files
    concurrently.
-   If a task fails: preserve the diff, capture the failing
    command/error, fix only within the task, rerun tests, then report
    PARTIAL/BLOCKED if unresolved. Do not move on with a broken
    prerequisite.
-   If the schedule slips, follow the cut order in `phases.md`; never
    cut safety tests, audit, baseline, measured results, mandatory basic
    UI, refusal demo or rehearsal.

## H. Live demo checklist

1.  Start mock API, control API, and React UI; check health.
2.  Run schema consistency checks.
3.  Show both agents succeeding before mutation.
4.  Trigger the real combined PS mutation through the UI.
5.  Show the baseline result without manipulating it.
6.  Show the self-healing trace and actual recovery time.
7.  Open the audit record with old/new definitions, evidence, version
    and hash.
8.  Demonstrate a missing-credential or ambiguous-mapping refusal.
9.  Show metrics calculated from real runs and state limitations.
10. If UI fails, use the CLI fallback.

## I. Final release gate

Do not call the project complete unless: - Mock validation and
`/openapi.json` are consistent after mutations. - Core safety tests and
audit redaction tests pass. - Baseline and healer use equivalent
cases/evidence and the same retry cap. - Results are computed from real
run records. - The React UI uses the real control API and has all seven
sections. - No secrets are exposed. - The pitch and write-up use only
measured results.
