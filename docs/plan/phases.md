# phases.md --- Implementation Phases and Task Breakdown

**Project:** Self-Healing Tool Registry Under Runtime API Schema Drift\
**Deadline:** 48 hours\
**Execution environment:** Google Antigravity IDE\
**Source of truth:** `PRD.md`; then `Architecture.md`, `rules.md`, and
`design.md`. If these conflict with the official hackathon PS, the PS
wins.

## Delivery rules

-   Execute one task at a time. Use the matching task prompt in
    `execution_plan.md`.
-   Do not start a dependent task until its prerequisites pass.
-   Estimates include implementation and local verification, not long
    breaks. The 48-hour plan includes integration and demo buffer.
-   Mark a task complete only after its acceptance criteria pass. Record
    evidence, blockers, and decisions in `memory.md` after Phase 1 and
    after every later phase.
-   The React UI is mandatory. Cut advanced UI polish before cutting
    core tests, audit logging, baseline comparison, or the basic working
    dashboard.
-   Gemini API/model availability must be verified; never assume
    Antigravity's own model access is usable by the application.

## 48-hour allocation

  --------------------------------------------------------------------------
  Phase                 Scope                                    Target time
  --------------------- ----------------------- ----------------------------
  0                     Repository,                                      2 h
                        environment, API/model  
                        verification            

  1                     Real runtime-mutating                            5 h
                        mock API                

  2                     Tool registry,                                   3 h
                        executor, classifier    

  3                     Core healing engine and                          6 h
                        safety                  

  4                     Audit log and schema                             2 h
                        hashing                 

  5                     LLM interface and                                4 h
                        baseline/self-healing   
                        agents                  

  6                     Test runner, metrics,                            4 h
                        held-out cases          

  7                     Minimal response                                 2 h
                        validation              

  8                     Optional LLM mapping                     1 h maximum
                        fallback                

  9                     React UI and                                     8 h
                        integration             

  10                    End-to-end validation,                           7 h
                        fixes, demo and pitch   

  **Total**             Includes prioritization         **44 h planned + 4 h
                        buffer inside phases                   contingency**
  --------------------------------------------------------------------------

## Phase 0 --- Repository and environment

**Goal:** Establish a reproducible working environment and verify
external dependencies early.

### T0.1 --- Inspect repository and existing documentation

-   **Estimate:** 20 min. **Dependencies:** none.
-   **Scope:** Inspect repository, Git status, Python/Node versions,
    existing files, and the six project documents.
-   **Expected files:** No application changes; update only if a genuine
    documentation inconsistency is found.
-   **Verification:** Record repository tree and available commands.
-   **Acceptance:** Existing work is preserved; no destructive cleanup;
    known starting state is recorded.

### T0.2 --- Configure Python and frontend environments

-   **Estimate:** 45 min. **Dependencies:** T0.1.
-   **Scope:** Use Python 3.11+, create backend virtual environment,
    configure frontend with supported Node and package manager, install
    only required dependencies.
-   **Expected files:** `backend/requirements.txt`,
    `frontend/package.json`, lockfiles, `.gitignore` as needed.
-   **Verification:** Python imports, frontend install, minimal
    test/build commands.
-   **Acceptance:** Backend and frontend dependencies install
    reproducibly; `.env` and generated results/secrets are handled
    safely.

### T0.3 --- Verify Gemini API capability and configuration

-   **Estimate:** 35 min. **Dependencies:** T0.2.
-   **Scope:** Check model availability, API key, quota, tool/function
    calling, and returned usage metadata using a minimal isolated
    script. Use supported model settings; do not assume deprecated
    parameters work.
-   **Expected files:** `backend/app/config.py`,
    `backend/scripts/verify_llm.py`, `.env.example`.
-   **Verification:** Script reports success or a clear blocker without
    printing the key.
-   **Acceptance:** API capabilities are recorded. If blocked, core
    development continues with a fake/test LLM; real-model runs are
    marked blocked, not fabricated.

### T0.4 --- Establish configuration, health checks, and baseline commands

-   **Estimate:** 20 min. **Dependencies:** T0.2.
-   **Scope:** Add typed settings and minimal health checks or test
    stubs for the mock/control services.
-   **Expected files:** `backend/app/config.py`, initial app modules,
    README commands.
-   **Verification:** Config tests and startup smoke check.
-   **Acceptance:** No secret is hardcoded; startup failures are clear.

**Phase exit criteria:** Environment works; LLM status is known; safe
fallback plan exists.

## Phase 1 --- Genuine runtime-mutating mock API

**Goal:** The active schema controls both actual validation and the
schema endpoint.

### T1.1 --- Implement ActiveSchema and canonical schema model

-   **Estimate:** 45 min. **Dependencies:** Phase 0.
-   **Expected files:** `backend/app/mock_api/active_schema.py`, schema
    fixtures.
-   **Scope:** Version, request schemas by endpoint, required headers,
    response schemas, error style. Version increases monotonically.
-   **Tests:** Schema model and version tests.
-   **Acceptance:** A single active schema object is the source of
    truth.

### T1.2 --- Implement raw-body validation and mock endpoints

-   **Estimate:** 60 min. **Dependencies:** T1.1.
-   **Expected files:** `mock_api/main.py`, `validator.py`.
-   **Scope:** Read raw JSON and headers; validate with `jsonschema`;
    include one read/idempotent endpoint and one write endpoint with
    `dry_run`.
-   **Tests:** Valid/invalid body and header tests.
-   **Acceptance:** Real request handling rejects payloads that do not
    match the active schema.

### T1.3 --- Generate `/openapi.json` from ActiveSchema

-   **Estimate:** 35 min. **Dependencies:** T1.1.
-   **Expected files:** `mock_api/openapi_gen.py`.
-   **Scope:** Custom schema response with active version; do not rely
    on stale FastAPI-generated schemas.
-   **Tests:** Endpoint schema/version match.
-   **Acceptance:** Returned schema exactly reflects the current active
    schema.

### T1.4 --- Add protected mutation, reset, and fault endpoints

-   **Estimate:** 60 min. **Dependencies:** T1.2, T1.3.
-   **Expected files:** `mock_api/mutations.py`, `faults.py`, route
    modules.
-   **Scope:** Core mutations (rename, type, request nesting, required
    header), combined PS demo, ambiguous/lossy cases,
    clear/vague/no-hint errors, 5xx/timeout/429/rejected-credential
    faults. Protect admin routes; agents cannot access them.
-   **Tests:** Authentication and each mutation/fault.
-   **Acceptance:** Mutations update validation and schema together;
    fault injection does not change schema version.

### T1.5 --- Add schema consistency test suite

-   **Estimate:** 60 min. **Dependencies:** T1.2--T1.4.
-   **Expected files:** `backend/tests/mock_api/test_consistency.py`.
-   **Scope:** After each mutation, old payload rejected, new payload
    accepted, schema version/content match, header requirement checked;
    include a negative test proving the suite catches mismatch.
-   **Acceptance:** All consistency tests pass before proceeding.

### T1.6 --- Add server-side correctness recording

-   **Estimate:** 30 min. **Dependencies:** T1.2.
-   **Expected files:** mock API state/diagnostic module and tests.
-   **Scope:** Record last accepted payload safely for correctness
    verification, excluding secrets.
-   **Acceptance:** Test runner can verify server-side data correctness,
    not merely HTTP 200.

### T1.7 --- Create initial `memory.md`

-   **Estimate:** 15 min. **Dependencies:** T1.1--T1.6.
-   **Scope:** Record decisions, implemented items, test evidence,
    blockers, and next tasks; no secrets.
-   **Acceptance:** `memory.md` exists and is concise.

**Phase exit criteria:** Real schema mutation changes validation and
`/openapi.json`; consistency suite passes.

## Phase 2 --- Registry, executor, and classification

### T2.1 --- Implement versioned in-memory tool registry

-   **Estimate:** 45 min. **Dependencies:** Phase 1.
-   **Expected files:** `backend/app/registry/tool_registry.py`,
    `tools.py`.
-   **Scope:** Store current and previous tool definitions, versions,
    atomic compare-and-swap apply/restore operations.
-   **Tests:** Apply, version increments, rollback, stale compare-and-swap
    rejection and concurrent-update protection.
-   **Acceptance:** Definition changes take effect without process
    restart.

### T2.2 --- Implement executor and task definitions

-   **Estimate:** 45 min. **Dependencies:** T2.1.
-   **Expected files:** `registry/executor.py`, `tasks.py`.
-   **Scope:** Build requests from current registry definition; preserve
    original values and track provenance; executor itself does not heal.
-   **Tests:** Payload building and provenance.
-   **Acceptance:** Executor uses current registry definition on each
    call.

### T2.3 --- Implement error classifier and infrastructure handling

-   **Estimate:** 45 min. **Dependencies:** Phase 1.
-   **Expected files:** `backend/app/healing/classifier.py`.
-   **Scope:** 400/422 possible drift; 401/403 not drift by default;
    5xx/timeouts/429/404 are not patched. Separate schema-attempt and
    infrastructure-retry counts.
-   **Tests:** Every status class.
-   **Acceptance:** Unrelated errors never trigger schema patching.

### T2.4 --- Add typed run and trace event models

-   **Estimate:** 45 min. **Dependencies:** T2.1--T2.3.
-   **Expected files:** `control_api/models.py`, `healing/events.py`.
-   **Scope:** Stable run IDs, sequence IDs, typed event payloads,
    redaction.
-   **Acceptance:** Events contain no credentials or secret header
    values.

**Phase exit criteria:** Registry changes are live, executor uses
current definitions, classifier prevents unrelated healing.

## Phase 3 --- Core healing engine and safety

### T3.1 --- Fetch verified schema and compute canonical hash

-   **Estimate:** 45 min. **Dependencies:** Phase 2.
-   **Expected files:** `healing/schema_fetch.py`, `audit/canonical.py`.
-   **Scope:** Fetch trusted mock `/openapi.json`; canonical JSON sorted
    keys, compact separators, UTF-8; SHA-256 for change tracking only.
-   **Tests:** Stable hashes and schema-version capture.
-   **Acceptance:** Same schema produces same hash; hash is not
    described as proof of authenticity.

### T3.2 --- Implement generic schema diff

-   **Estimate:** 60 min. **Dependencies:** T3.1.
-   **Expected files:** `healing/schema_diff.py`.
-   **Scope:** Compare old tool schema and verified current schema;
    identify removed/added fields, types, paths, and headers without
    hardcoded field names.
-   **Tests:** Core and combined mutations.
-   **Acceptance:** Diff describes changes without inventing values.

### T3.3 --- Implement safe conversion and candidate patch rules

-   **Estimate:** 60 min. **Dependencies:** T3.2.
-   **Expected files:** `healing/conversions.py`, `hypothesize.py`.
-   **Scope:** Unique rename/path mapping, lossless conversions only,
    required-header lookup from approved secrets provider, and newly required
    body fields only when their values have approved provenance. Never let LLM
    or error text supply values.
-   **Tests:** Ambiguous mapping, `"00123"`, `"123"`, missing
    credential, and missing required-body-value refusal.
-   **Acceptance:** Ambiguous/lossy/unprovided values are refused.

### T3.4 --- Implement offline validation and write safety

-   **Estimate:** 45 min. **Dependencies:** T3.3.
-   **Expected files:** `healing/validate.py`.
-   **Scope:** Validate payload against schema, required headers, extra
    fields, and value provenance. Write calls require dry-run; otherwise
    human review.
-   **Acceptance:** Invalid patches cannot be applied.

### T3.5 --- Implement apply, retry, verify, and evidence-based rollback

-   **Estimate:** 90 min. **Dependencies:** T3.1--T3.4.
-   **Expected files:** `healing/healer.py`.
-   **Scope:** Patch registry in memory; retry cap; after failure
    refetch schema and hash. Roll back only when evidence says patch is
    wrong. Never replay a failed candidate; a new field error can lead to
    one materially different, re-diffed candidate within the cap.
    Infrastructure failures do not trigger rollback.
-   **Tests:** Each rollback table outcome, combined mutation, schema
    changes twice.
-   **Acceptance:** No endless loops; one incorrect patch cannot be
    retried indefinitely.

### T3.6 --- Add refusal reason codes and safety regression tests

-   **Estimate:** 45 min. **Dependencies:** T3.3--T3.5.
-   **Expected files:** healing tests.
-   **Scope:** `missing_credential`, `ambiguous_mapping`,
    `lossy_conversion`, `no_evidence`, `validation_failed`,
    `retry_cap_reached`, `needs_human_review`, `not_drift`,
    `auth_rejected`.
-   **Acceptance:** Each refusal has a reason and trace event; wrong
    patches target is zero in tests.

**Phase exit criteria:** Core rule-based request healing works, refuses
unsafe cases, and passes safety tests.

## Phase 4 --- Audit log

### T4.1 --- Implement redacted JSONL audit writer

-   **Estimate:** 45 min. **Dependencies:** Phase 3.
-   **Expected files:** `backend/app/audit/audit_log.py`.
-   **Scope:** Log patch, refusal, rollback, human-review, and not-drift
    decisions with run ID, versions, hashes, evidence, confidence,
    outcome, reason code, token usage if known.
-   **Acceptance:** Append-only JSONL; no secret values.

### T4.2 --- Add audit integrity and redaction tests

-   **Estimate:** 30 min. **Dependencies:** T4.1.
-   **Scope:** Plant known test secrets and ensure they never appear in
    logs/events/API outputs.
-   **Acceptance:** Redaction tests pass.

**Phase exit criteria:** Every patch/refusal is auditable and safe to
display.

## Phase 5 --- LLM interface and agents

### T5.1 --- Implement replaceable LLM interface and fake client

-   **Estimate:** 45 min. **Dependencies:** Phase 0.
-   **Expected files:** `backend/app/llm/base.py`, `fake.py`.
-   **Scope:** Standard result with text/tool calls, input/output
    tokens, latency, model. Fake client supports deterministic tests.
-   **Acceptance:** Core tests run without API access.

### T5.2 --- Implement Gemini adapter and capability check

-   **Estimate:** 45 min. **Dependencies:** T0.3, T5.1.
-   **Expected files:** `llm/gemini.py`.
-   **Scope:** Use supported API settings and usage fields. SDK import
    stays in this module.
-   **Acceptance:** Live test passes or limitation is documented; no key
    printed.

### T5.3 --- Implement baseline agent

-   **Estimate:** 60 min. **Dependencies:** T2.2, T2.3, T5.1.
-   **Expected files:** `backend/app/agents/baseline_agent.py`.
-   **Scope:** Fixed tool schema, same task,
    model/settings/evidence/retry cap, can read errors and current
    schema, no healing/registry patching.
-   **Acceptance:** Baseline is not deliberately weakened; its outcomes
    are recorded honestly.

### T5.4 --- Implement self-healing agent orchestration

-   **Estimate:** 60 min. **Dependencies:** Phase 3, T4.1, T5.1.
-   **Expected files:** `agents/healing_agent.py`.
-   **Scope:** Join task execution, healing, trace events, audit log,
    result record.
-   **Acceptance:** End-to-end run works without restart.

### T5.5 --- Verify parity and token usage

-   **Estimate:** 30 min. **Dependencies:** T5.2--T5.4.
-   **Expected files:** parity report/tests.
-   **Scope:** Check same model/settings and access; document different
    wrappers if present; read actual usage fields.
-   **Acceptance:** No estimated token counts are reported as actual.

**Phase exit criteria:** Both agents can run the same task; differences
are documented fairly.

## Phase 6 --- Test runner and metrics

### T6.1 --- Define cases, generated variants, and held-out set

-   **Estimate:** 45 min. **Dependencies:** Phase 3.
-   **Expected files:** `backend/app/runner/cases.py`.
-   **Scope:** Clear/vague/no-hint errors, core/combined mutations,
    ambiguous/lossy/missing-credential cases, non-drift faults. Keep
    held-out cases separate.
-   **Acceptance:** Cases have expected outcomes and stable IDs.

### T6.2 --- Implement run records and correctness checks

-   **Estimate:** 45 min. **Dependencies:** T1.6, Phase 5.
-   **Expected files:** `runner/records.py`, `correctness.py`.
-   **Scope:** Record outcome, timing, attempts, tokens, model, split,
    server-side payload correctness.
-   **Acceptance:** A 200 response alone does not imply correctness.

### T6.3 --- Implement repeated runner and metric formulas

-   **Estimate:** 60 min. **Dependencies:** T6.1, T6.2.
-   **Expected files:** `runner/run_suite.py`, `metrics.py`.
-   **Scope:** Repeated runs, ZTAR denominator, MTTR median/p95, token
    ratio, total task tokens, retries, correct refusals, wrong patches
    and failures; split by error style and healing path.
-   **Acceptance:** Empty data returns `available: false`/n/a; no
    invented values.

### T6.4 --- Run held-out set once and export results

-   **Estimate:** 30 min. **Dependencies:** T6.3.
-   **Expected files:** `results/` data and report.
-   **Scope:** Do not inspect held-out outcomes while tuning. Record
    model/settings/date and repeat counts.
-   **Acceptance:** Results are reproducible and limitations visible.

**Phase exit criteria:** Metrics are calculated from actual run records
and test cases.

## Phase 7 --- Minimal response validation

### T7.1 --- Add response schema validation

-   **Estimate:** 45 min. **Dependencies:** Phase 3.
-   **Expected files:** `healing/response_check.py`.
-   **Scope:** Validate successful response bodies against expected
    fields the tool uses.
-   **Acceptance:** Shape mismatch is detected without treating it as a
    4xx request failure.

### T7.2 --- Add clear 1-to-1 response path adaptation

-   **Estimate:** 45 min. **Dependencies:** T7.1, T4.1.
-   **Scope:** Adapt only an unambiguous path move. Ambiguous response
    mapping returns no data to the agent and logs refusal.
-   **Acceptance:** Clear path move passes; ambiguous case refuses.

**Phase exit criteria:** Minimal response nesting is demonstrated, or
explicitly marked cut with judging risk.

## Phase 8 --- Optional LLM mapping fallback

### T8.1 --- Add constrained mapping-only fallback

-   **Estimate:** Maximum 60 min. **Dependencies:** Phase 3, Phase 5.
-   **Scope:** LLM suggests field mapping only; it cannot supply values
    or credentials and cannot override a rule-based ambiguity refusal.
-   **Tests:** Malformed output, fabricated value attempt, ambiguity.
-   **Acceptance:** All suggestions pass the same validation. If time or
    quota is insufficient, mark phase skipped.

**Phase exit criteria:** Fallback is tested and constrained, or
deliberately skipped.

## Phase 9 --- React UI and integration

### T9.1 --- Scaffold React/Vite/TypeScript application

-   **Estimate:** 45 min. **Dependencies:** Phase 0.
-   **Expected files:** `frontend/`.
-   **Scope:** Routing, styling baseline, Vitest/React Testing Library,
    Vite proxy to control API.
-   **Acceptance:** Frontend starts and builds.

### T9.2 --- Implement typed API client, shared types, and app shell

-   **Estimate:** 45 min. **Dependencies:** T9.1, control API contracts
    agreed.
-   **Expected files:** `frontend/src/api/`, `types/`,
    `components/AppShell`.
-   **Acceptance:** API errors are handled; no privileged keys in
    browser.

### T9.3 --- Implement control API status/schema/mutation endpoints

-   **Estimate:** 60 min. **Dependencies:** Phase 1, Phase 4.
-   **Expected files:** `backend/app/control_api/`.
-   **Scope:** Health, status, schema, mutation/reset, consistency,
    cases/scenarios, audit, metrics.
-   **Acceptance:** Privileged actions use server-side admin key;
    success follows consistency verification.

### T9.4 --- Implement Dashboard and Schema Mutation pages

-   **Estimate:** 60 min. **Dependencies:** T9.2, T9.3.
-   **Acceptance:** Shows real status/schema/hash; mutation controls
    update only after backend confirmation.

### T9.5 --- Implement run API, run manager, and SSE trace

-   **Estimate:** 60 min. **Dependencies:** Phase 5, T9.3.
-   **Expected files:** control API run routes, `sse.py`, run manager.
-   **Acceptance:** Events come from real agents; replay and reconnect
    work; concurrent run returns 409.

### T9.6 --- Implement Agent Comparison and Live Trace pages

-   **Estimate:** 60 min. **Dependencies:** T9.5.
-   **Acceptance:** Both agent outcomes and actual trace events are
    visible; no frontend-simulated events.

### T9.7 --- Implement Audit, Results, and Safety pages

-   **Estimate:** 75 min. **Dependencies:** Phase 4, Phase 6, T9.3.
-   **Acceptance:** Actual audit and metrics are shown; refusal
    explanations and empty states work.

### T9.8 --- Add loading/error/empty/responsive states and security checks

-   **Estimate:** 45 min. **Dependencies:** T9.4--T9.7.
-   **Acceptance:** Test at 375, 768, 1280 px; no secrets in bundle or
    responses; all views have states.

### T9.9 --- Frontend tests and backend integration tests

-   **Estimate:** 45 min. **Dependencies:** T9.4--T9.8.
-   **Acceptance:** UI tests pass and API integration paths are
    verified.

**Phase exit criteria:** All seven UI sections work against real backend
state.

## Phase 10 --- End-to-end validation and demo

### T10.1 --- Add CLI fallback and startup/runbook instructions

-   **Estimate:** 30 min. **Dependencies:** Phases 5--6.
-   **Expected files:** `backend/cli/demo.py`, `README.md`.
-   **Acceptance:** Real flow can run without the UI.

### T10.2 --- Run full regression and end-to-end suite

-   **Estimate:** 60 min. **Dependencies:** Phases 1--9 (Phase 8 may be
    skipped).
-   **Scope:** Consistency, safety, audit redaction, baseline parity, UI
    integration, response checks if implemented.
-   **Acceptance:** No known critical safety defect; failures
    documented.

### T10.3 --- Fix critical integration defects

-   **Estimate:** 90 min. **Dependencies:** T10.2.
-   **Scope:** Fix only reproducible blockers; no new features.
-   **Acceptance:** Regression suite remains green.

### T10.4 --- Rehearse live demo and verify fallback

-   **Estimate:** 45 min. **Dependencies:** T10.2--T10.3.
-   **Scope:** Rehearse healthy run, mutation, baseline, healing trace,
    audit, refusal, metrics, CLI fallback.
-   **Acceptance:** Demo follows `design.md` and uses measured data.

### T10.5 --- Final write-up, 30-second pitch, and limitations

-   **Estimate:** 30 min. **Dependencies:** T6.4, T10.4.
-   **Acceptance:** Claims match actual results; limitations and
    model/framework caveats are stated.

### T10.6 --- Final memory and status report

-   **Estimate:** 15 min. **Dependencies:** all completed work.
-   **Scope:** Update memory and report complete/partial/skipped tasks,
    tests, actual results, and known blockers.
-   **Acceptance:** Repository state and demo commands are clear.

**Phase exit criteria:** Project is demo-ready; results are real; safety
limitations are explicit.

## Dependencies and parallel work

-   Phase 1 is the main prerequisite for the healer and UI schema page.
-   Phase 2 and Phase 3 are sequential; Phase 4 follows the first audit
    events from Phase 3.
-   Phase 5 needs registry/executor/classifier and healing core.
-   Phase 6 needs agents and server-side correctness recording.
-   UI scaffolding (T9.1) may run in parallel with Phases 1--4 if API
    contracts are kept stable. UI integration and pages depend on
    control API endpoints.
-   Response validation and optional LLM fallback must not block core UI
    integration.
-   Only one task should be assigned to a given Antigravity session at a
    time. Parallelize only independent tasks with separate
    worktrees/branches or explicit file ownership.

## Cut order if behind schedule

1.  Skip Phase 8 LLM fallback.
2.  Cut advanced charts and visual polish; keep all seven basic UI
    sections.
3.  Reduce non-held-out repetitions/extra generated variants; never
    inspect or tune on held-out cases.
4.  Skip Phase 7 response adaptation only if absolutely necessary;
    document the PS-related limitation.
5.  Time-box LangChain at three hours; use a plain tool-calling loop if
    blocked and state this in results.
6.  Keep CLI minimal.

**Never cut:** mock schema consistency tests, safety tests, audit log,
baseline comparison, real metrics, working React UI, refusal demo, final
rehearsal.
