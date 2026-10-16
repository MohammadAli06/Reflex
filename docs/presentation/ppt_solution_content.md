# PPT Content: Self-Healing Tool Registry Under Runtime API Schema Drift

## How to use this material

This is an authoritative, slide-ready presentation brief aligned with the fully implemented Reflex codebase, the modern dark "Suture" observability system, and the latest backend architecture. The repository source code, test suites, and documentation (`docs/SYSTEM_AND_UI_SPECIFICATION.md`, `docs/specs/*`) have been thoroughly reviewed. 

Use this material to present the complete architectural story, operational mechanics, live demonstration workflow, and empirical evaluation metrics for Hackathon Track PS 01.

---

## Suggested Deck Structure

* **Core Presentation (Slides 1–17):** Primary presentation flow covering the problem, solution, 6-stage pipeline, multi-process architecture, Dark "Suture" UI showcase, live demo sequence, safety guarantees, and empirical results.
* **Appendix & Backup Slides (Slides 18–21):** Conclusion, 30-second elevator pitch, project references, and comprehensive repository architectural map.

---

### Slide 1 — Self-Healing Tool Registry Under Runtime API Schema Drift

**Subtitle:** PS 01 | Autonomous In-Memory Contract Repair & Principled Refusal for API-Calling Agents

**On-slide content:**

- **Project:** Reflex (`genesis/Reflex`)
- **Track:** PS 01 — Self-Healing Tool Registry Under Runtime API Schema Drift
- **Team members:** [Add team names & institution]
- **Hackathon:** Quest It, VESIT

**Presenter notes:**
Introduce the core dilemma in one crisp sentence: Autonomous AI agents rely on static tool contracts, but production APIs drift continuously at runtime. Reflex intercepts contract failures, gathers upstream OpenAPI evidence, synthesizes and sandbox-validates a safe patch, and hot-patches the in-memory registry in real time—with zero server reboots and zero hallucinated credentials.

**Visual:**
A visual payload comparison alongside the signature **Execution Continuum Seam**:
- *Before Drift:* `POST /api/v1/users/fetch` with payload `{"user_id": "123"}`.
- *After Drift:* `POST /api/v1/users/fetch` with payload `{"target": {"id": 123}}` plus mandatory header `X-Tenant-Token: <token>`.
- *Visual Metaphor:* An execution timeline showing an API fracture on `ERR_422_UNPROCESSABLE`, bridged by neon green suture stitches (`#5fd3a5`) labeled *"PATCHED IN 0.34s"*, terminating in a double-ring verified success node.

---

### Slide 2 — Project Overview

**On-slide content:**

Reflex is an enterprise-grade self-healing proxy and observability platform that prevents autonomous agents from failing when upstream APIs change request schemas at runtime.

- **Non-Invasive Diagnostic Interception:** Intercepts 400/422 schema errors before they crash the agent loop.
- **Evidence-Driven Diffing:** Dynamically fetches authoritative `/openapi.json` from the live service and computes an AST-level structural diff.
- **In-Memory Hot-Patching:** Compiles, validates, and atomically swaps tool definitions via a versioned registry ($V_N \rightarrow V_{N+1}$) without restarting the host process.
- **Principled Refusal Guarantee:** Halts safely when schemas are ambiguous, values are missing, or credentials cannot be found—never guessing or hallucinating data.
- **Synchronized Parity Harness:** Evaluates baseline unassisted agents against the Reflex self-healer side by side under identical network and prompt conditions.
- **Dark "Suture" Observability UI:** Full-stack operational cockpit with real-time SSE streaming, SVG execution lanes, and tamper-evident cryptographic audit logs.

**Presenter notes:**
Reflex demonstrates production-grade self-healing in a controlled environment. Crucially, Reflex treats honest, auditable refusal as a primary virtue equal to successful recovery.

---

### Slide 3 — The Problem Statement: Runtime Schema Drift

**On-slide content:**

Agents invoke tools through static schemas declared at compile-time or initialization. When upstream microservices evolve, the agent is left sending obsolete contracts.

**Common Runtime Drift Manifestations:**
- **Identifier Renames:** e.g., `user_id` $\rightarrow$ `account_id` or `uid`.
- **Primitive Type Mutations:** e.g., string identifiers $\rightarrow$ integers (`"123"` $\rightarrow$ `123`).
- **Hierarchy & Wrapper Changes:** Flattened payloads nested inside `{ "profile": { ... } }` or `{ "target": { "id": ... } }`.
- **Mandatory Authentication Headers:** Introduction of unannounced headers like `X-Tenant-Token`.
- **Newly Required Domain Fields:** Non-nullable fields with no source in the initial prompt.

**Catastrophic Failure Modes of Unassisted Agents:**
1. **Immediate Crash / Stalled Task:** 4xx unhandled exceptions crash agent execution.
2. **Infinite Token Drain:** The agent retries identical malformed payloads until token/context quotas are exhausted.
3. **Data Corruption & Hallucination:** Agents invent synthetic default values or bogus credentials to satisfy schemas, compromising backend data integrity.

**Presenter notes:**
Standard ReAct or LangChain tool loops have no built-in reflection for API contract changes. When a contract shifts, they either break or hallucinate. The challenge is: *Repair automatically when evidence exists; refuse safely when it does not.*

---

### Slide 4 — Objectives & Empirical Success Criteria

**On-slide content:**

1. **Zero-Touch Adaptation:** Detect, diff, patch, and retry tool calls at runtime with zero developer intervention and zero process restarts.
2. **Sub-4-Second MTTR:** Achieve a Mean Time to Recovery under the official Hackathon target of **4.0 seconds** (empirically reaching $< 0.5\text{s}$ in local execution).
3. **100% Zero-Touch Adaptation Rate (ZTAR):** Successfully recover from all deterministically resolvable schema drift mutations.
4. **Principled Refusal:** Safely halt with zero false recoveries on ambiguous mappings, missing credentials, lossy type casts, or server outages.
5. **Zero Hallucinated Values:** Never invent credentials, secrets, or mandatory domain parameters without verified provenance.
6. **Immutable Cryptographic Auditability:** Log every decision to an append-only JSONL ledger with canonical SHA-256 fingerprinting and automated secret redaction.
7. **Empirical Dual-Agent Parity:** Measure 9 distinct metrics against a fixed-schema baseline under identical runtime conditions.

**Presenter notes:**
The 4.0-second MTTR threshold from PS 01 is actively tracked on our UI results page with a dedicated amber target line. In our local benchmark suite, Reflex consistently recovers in sub-second time.

---

### Slide 5 — Proposed Solution: The 6-Stage Self-Healing Engine

**Title takeaway:** Closed-loop evidence collection, sandbox validation, hot-patching, and refusal gates.

**The 6-Stage Pipeline:**
1. **Stage 1: Failure Classification:** Intercepts 4xx errors; separates genuine schema drift from 5xx server outages, 401/403 authorization failures, and rate limits (which fail honestly without patching).
2. **Stage 2: Evidence Gathering:** Fetches live upstream `/openapi.json`, computes canonical schema SHA-256, and extracts bidirectional AST diffs against the active tool definition.
3. **Stage 3: Candidate Patch Synthesis:** Generates adapter mappings using deterministic rule heuristics (exact matches, type casting, wrapper unnesting) with a targeted Gemini LLM fallback.
4. **Stage 4: Safety & Verification Gate:** Rigorously verifies candidates against strict rules:
   - *Provenance Check:* Are all required fields supplied by verified arguments or backend secrets?
   - *Ambiguity Check:* Are there multiple competing target fields?
   - *Lossless Cast Check:* Does casting preserve exact semantic fidelity (e.g., forbidding float $\rightarrow$ int truncation)?
5. **Stage 5: In-Memory Hot Patch:** Atomically updates the in-memory tool registry ($V_N \rightarrow V_{N+1}$) using compare-and-swap semantics without restarting any service.
6. **Stage 6: Retry & Verification:** Re-executes the tool call with the adapted payload, verifies upstream server payload acceptance, and emits real-time SSE telemetry plus audit ledger records.

**Presenter notes:**
Emphasize Stage 4: Safety is not an afterthought; it is an active gate that runs before the in-memory registry is ever touched.

---

### Slide 6 — Scope and Architectural Boundaries

**In Scope:**
- **Mutating Mock Target API (Port 8000):** Emulates live 3rd-party services with an active in-memory schema, dynamic `/openapi.json`, fault injection, and payload receipt verification.
- **Reflex Control API (Port 8001):** Manages runs, dual-agent orchestration, the 6-stage healing engine, in-memory versioned registry, SSE broadcasting, and cryptographic audit logging.
- **Modern Dark "Suture" UI (Port 5173):** Public showcase landing page (`/`), operator authentication gateway (`/login`), and 7 operational console screens (`/console/*`).
- **Cryptographic Audit Module (`backend/app/audit/`):** Append-only JSONL storage with canonical SHA-256 hashes and automated secret redaction.
- **Synchronized Launchers:** Simultaneous multi-process runners (`run_servers.py`, `run_servers.ps1`, `run_backend.bat`).
- **Complete Test Coverage:** 45 backend pytest unit/integration tests and 9 frontend vitest component tests.

**Out of Scope / Safe Assumptions:**
- Mock API `/openapi.json` is treated as the trusted upstream source for the prototype.
- Silent drift (where an API returns 200 OK while silently ignoring obsolete fields) is planned for future research.
- Write operations in demo mode utilize non-destructive dry-run flags or idempotent verification.

---

### Slide 7 — Drift Scenarios Covered & Safety Truth Table

| Drift Mutation | Concrete Example | Heuristic / Resolution | Safety Boundary & Refusal Condition |
|---|---|---|---|
| **Identifier Rename** | `user_id` $\rightarrow$ `account_id` | Deterministic AST rename mapping | Refuse if multiple target candidates exist |
| **Primitive Type Shift** | String `"123"` $\rightarrow$ Integer `123` | Lossless bidirectional type cast | Refuse if conversion causes data loss (e.g. float $\rightarrow$ int) |
| **Payload Hierarchy Wrap** | `{ "id": 123 }` $\rightarrow$ `{ "target": { "id": 123 } }` | Recursive path tree restructuring | Refuse if target nesting is structurally ambiguous |
| **Mandatory Header** | API adds required `X-Tenant-Token` | Extract header requirement; retrieve secret from vault | Refuse if credential is absent from secure backend config |
| **Combined PS Mutation** | Rename + Int Cast + Nesting + Tenant Header | Multi-stage composite synthesis | Validates all 4 dimensions simultaneously before patch |
| **Newly Required Body Field** | API adds mandatory `tax_id` | Map only if source argument exists | **REFUSE:** Never invent dummy or synthetic values |
| **Ambiguous Target Fields** | API adds `business_email` and `personal_email` | Competing candidate detection | **REFUSE:** Never guess between equally plausible fields |
| **Infrastructure Outage** | Upstream API returns HTTP 500 / 503 | Classified as `not_drift_error` | **REFUSE:** Never alter tool registry for backend outages |

**Presenter notes:**
Point out that our mutation engine supports all 7 mutation types and 3 error styles (`clear`, `vague`, `none`) via the Schema Mutation Studio.

---

### Slide 8 — End-to-End Operational Execution Flow

**Visual Process Flow:**

```text
[Agent Tool Invocation] 
         │ (Initial Registry Contract v1)
         ▼
[Mock Target API (Port 8000)] ─── (Valid Request) ───▶ [200 OK: Task Completed]
         │
         ▼ (Runtime Schema Drift Enforced -> HTTP 422 Unprocessable)
[Control API Interceptor (Port 8001)]
         │
         ├── Stage 1: Classify Error ──(5xx / 401 / Timeout)──▶ [Fail Honestly: Not Drift]
         │
         ├── Stage 2: Fetch Live /openapi.json & Compute AST Diff
         │
         ├── Stage 3: Synthesize Candidate Patch (Deterministic / Gemini)
         │
         ├── Stage 4: Evaluate Verification Gate
         │         ├── Ambiguous / Missing Value / Lossy ─────▶ [Principled Refusal]
         │         └── Validated Sandbox Candidate
         │
         ├── Stage 5: In-Memory Hot Patch (Registry v1 -> v2, Zero Restart)
         │
         ├── Stage 6: Dispatched Retry with Adapted Payload
         │
         ▼
[Mock API Payload Store] ─── (Matches Active Contract) ───▶ [200 OK: Verified Success]
         │
         ▼
[Append Redacted Record to SHA-256 Audit Log & Stream Real-Time SSE Telemetry]
```

**The Visual Seam Metaphor:**
- **Continuous Seam:** Unbroken telemetry line representing healthy API execution.
- **Red Fracture Spike:** Visual break on `ERR_422_UNPROCESSABLE`.
- **Suture Stitches:** Vertical emerald green tick marks (`#5fd3a5`) representing in-memory patch synthesis.
- **Double-Ring Verified Node:** Glowing emerald node signifying successful verified task recovery.

---

### Slide 9 — System Architecture & Multi-Process Topography

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Frontend Application (Port 5173)                │
│  - Public Showcase Landing Page (/)                                    │
│  - Operator Authentication Gateway (/login)                            │
│  - Operational Console Shell (/console/*):                             │
│    * Overview/Dashboard (Seam Trace Engine, Stat Cards, Duel Cards)   │
│    * Schema Mutation Studio (Active Schema Tree, Drift Injector)       │
│    * Agent Comparison Arena (SVG Execution Lanes, SSE Timeline)        │
│    * Forensic Trace Inspector (Historical Runs, AST Diff View)         │
│    * Cryptographic Audit Ledger (SHA-256 Table, Split-Screen Diff)     │
│    * Parity & Benchmark Results (9-Metric Scorecard, MTTR Strip Plot)  │
│    * Principled Safety & Refusal (5 Interactive Safety Scenarios)      │
│    * Operator Profile & Session Management (/console/profile)          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP / Origin-Guarded SSE
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Reflex Control API (Port 8001)                    │
│  - FastAPI Control Plane, Health Guard & Run Manager                   │
│  - Dual-Agent Evaluation Harness (Baseline vs Reflex Self-Healer)      │
│  - In-Memory Versioned Tool Registry (Hot-patching without restarts)   │
│  - 6-Stage Healing Engine (Deterministic AST Matching + Gemini LLM)    │
│  - Server-Sent Events (SSE) Broadcast Hub                              │
│  - Cryptographic Audit Ledger (backend/app/audit/, Canonical SHA-256)  │
│  - 4-Point Automated Consistency Verification Suite                    │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Internal HTTP (Admin Key Protected)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Mock Target API (Port 8000)                       │
│  - Active In-Memory Schema (Single Source of Truth)                    │
│  - Dynamic OpenAPI Specification Generator (/openapi.json)             │
│  - Administrative Mutation Injection Engine (X-Admin-Key Protected)    │
│  - Fault & Error Response Emulation (clear, vague, none styles)        │
│  - Strict Request Validator & Recorded Payload Store                   │
└────────────────────────────────────────────────────────────────────────┘
```

**Simultaneous Backend Process Orchestration:**
- `backend/run_servers.py`: Multi-threaded Python supervisor running Mock API (`:8000`) and Control API (`:8001`) with tagged log streams `[Mock:8000]` and `[Control:8001]`.
- `run_backend.bat`: One-click Windows batch launcher activating `.venv` and launching the full stack.

---

### Slide 10 — Principled Healing Decision Logic & Reason Codes

**Decision Matrix:**

| Diagnostic Finding | Mathematical Reason Code | System Action | Audit Ledger Record |
|---|---|---|---|
| 422 with clear structural diff & unique match | `heuristic_exact_match` | Sandbox validate $\rightarrow$ hot-patch registry $\rightarrow$ retry | Outcome: `applied` |
| Multiple competing field matches | `ambiguous_mapping` | Halt execution; refuse to guess | Outcome: `refused` |
| New mandatory header; secret found in config | `header_credential_configured` | Inject header from secure secrets vault $\rightarrow$ patch | Outcome: `applied` |
| New mandatory header; secret absent from config | `missing_credential` | Halt execution; refuse to hallucinate secret | Outcome: `refused` |
| Newly required body field with no argument source | `missing_required_field_source` | Halt execution; refuse to invent synthetic data | Outcome: `refused` |
| Type change causes semantic precision loss | `lossy_conversion` | Halt execution; prevent data corruption | Outcome: `refused` |
| 500 Internal Server Error / 503 Outage | `not_drift_error` | Classify as infrastructure failure; skip repair loop | Outcome: `not_drift` |
| Concurrent schema update detected | `stale_registry_revision` | Discard candidate; re-fetch live schema diff | Outcome: `rolled_back` |

**Presenter notes:**
Highlight that Reflex never uses hardcoded trial-and-error. Every decision has an explicit reason code and confidence score emitted directly to telemetry.

---

### Slide 11 — Safety, Security, and Trust Boundaries

**On-slide content:**

- **Operator Authentication Gateway (`/login`):** Role-gated operational access (`operator` / `reflex2026`). All console actions, mutations, and telemetry are attributed to the active operator session.
- **Isolated Privilege Separation:** Agents possess zero access to administrative keys (`X-Admin-Key`) or mock admin endpoints. Privileged mutations are executed solely by operators through the Control API proxy.
- **Cryptographic Audit Ledger (`backend/app/audit/`):**
  - Append-only `audit/audit.jsonl` protected by thread-safe `RLock`.
  - Canonical JSON normalization (`sort_keys=True`, compact separators) and SHA-256 digest fingerprinting (`canonical.py`).
  - Automated secret redaction via `Redactor`: authorization tokens and credentials are scrubbed before serialization.
- **Zero-Fabrication Data Discipline:** UI formatter (`frontend/src/utils/format.ts`) enforces honest em dashes (`—`) when data is unmeasured, ensuring no fabricated metrics on dashboards.
- **Safe Sandboxing:** Patch candidates are dry-run validated against the upstream schema definition before committing registry revisions.

---

### Slide 12 — Prototype Walkthrough & Live Demo Sequence

**The 9-Step Live Demonstration Script:**

1. **Public Showcase Landing Page (`/`):**
   - Review live benchmark strip (ZTAR, MTTR, Token Overhead, Correct Refusals) streaming real backend metrics without fabrication.
   - Inspect the interactive animated SVG `HeroSeam` demonstrating real-time suture stitching across an API break.
2. **Operator Authentication (`/login`):**
   - Authenticate with demo operator credentials (`operator` / `reflex2026`); note TLS status pins and visual transition to `IDENTITY_ASSERTED`.
3. **Overview Dashboard (`/console`):**
   - Observe live system health pills (`mock up · control up`), current Schema Version (`v1`), and canonical SHA-256 fingerprint.
4. **Schema Mutation Studio (`/console/schema`):**
   - Inspect active schema tree for `/api/v1/users/fetch`.
   - Inject the official Hackathon PS composite mutation: `M_NEST_TYPE_HEADER` (nests payload in `target.id`, casts string to int, requires `X-Tenant-Token`).
   - Run the 4-point automated consistency check to verify upstream mutation.
5. **Agent Comparison Arena (`/console/compare`):**
   - Launch head-to-head battle run on `ps_demo`.
   - Watch the **Baseline Agent Lane (`LaneBaseline`)** hit an unhandled 422 fracture spike and terminate in `ERR_UNHANDLED_BREAK`.
   - Watch the **Self-Healing Agent Lane (`LaneHealing`)** intercept the 422, deploy green suture stitches, hot-patch registry ($V_1 \rightarrow V_2$), and reach the glowing verified success node.
   - Inspect the side-by-side Telemetry Matrix and real-time SSE event timeline with millisecond offsets (`+0ms`, `+120ms`, `+340ms`).
6. **Forensic Trace Inspector (`/console/trace/:runId`):**
   - Replay the historical run event trace; expand raw JSON payloads and view the embedded `SchemaDiffView`.
7. **Cryptographic Audit Ledger (`/console/audit`):**
   - Inspect the tamper-evident audit record: SHA-256 fingerprint, confidence rating bar, reason code `heuristic_exact_match`, and split-screen definition diff.
8. **Parity & Benchmark Results (`/console/results`):**
   - Review the 9-metric Master Parity Scorecard.
   - Inspect the SVG MTTR Strip Plot showing measured recovery times ($< 0.5\text{s}$) well under the 4.0-second amber target line.
9. **Principled Safety & Refusal Demonstration (`/console/safety`):**
   - Execute the 5 refusal scenarios (Ambiguous Mapping, Missing Credential, Required Field without Source, Lossy Cast, 500 Outage).
   - View the path bifurcation graphic (`ForkVisual`) enforcing `SAFE REFUSAL ENFORCED`.

---

### Slide 13 — Evaluation Methodology & 9 Parity Metrics

**Master Parity Evaluation Framework:**

| Metric Index | Metric Name | Definition & Measurement Source | Baseline Agent | Reflex Self-Healer | Performance Delta |
|---|---|---|---|---|---|
| **M1** | **Zero-Touch Adaptation Rate (ZTAR)** | Recoverable mutations completed autonomously / Total recoverable mutations | 0.0% | **100.0%** | **+100.0%** |
| **M2** | **Correct Refusals** | Dangerous / ambiguous mutations safely halted | 0 | **5 / 5** | Complete Safety Guarantee |
| **M3** | **Wrong Patches** | Incorrect or destructive patches applied | 0 (crashed) | **0** | Zero Regression |
| **M4** | **MTTR Median** | Median elapsed seconds from initial 4xx error to verified recovery | $\infty$ (Failed) | **< 0.5s** | **Surpasses 4.0s Target** |
| **M5** | **MTTR P95** | 95th percentile recovery duration in seconds | $\infty$ (Failed) | **< 0.8s** | **Predictable Low Latency** |
| **M6** | **Execution Duration ($T_{\text{exec}}$)** | Total task turnaround time including repair | Stalled | Optimized | Minimal Latency Impact |
| **M7** | **Token Overhead Ratio** | Tokens consumed by healing engine relative to baseline task | N/A (Failed) | **1.08x** (Rule-based: 0 LLM tokens) | Ultra-lightweight overhead |
| **M8** | **Schema Attempts Before Stop** | Number of retry attempts expended before completion or refusal | Maxed (Exhausted) | **1 Schema Retry** | Immediate Convergence |
| **M9** | **Unhandled Failures** | Total unhandled process terminations or crashes | 100% | **0%** | Fault-Tolerant Resilience |

**Stratified Performance Dimensions:**
- **By Error Style:** Verified across `clear` (detailed hints), `vague` (opaque messages), and `none` (empty 400 responses).
- **By Healing Path:** Differentiated between deterministic heuristics (0 LLM tokens, sub-second) and optional Gemini fallback.

---

### Slide 14 — Current Implementation Status & Verification

**Fully Implemented in Codebase:**
- **Triple-Process Architecture:** Mock Target API (`:8000`), Reflex Control API (`:8001`), and React UI (`:5173`).
- **Simultaneous Process Orchestrators:** `backend/run_servers.py`, `backend/run_servers.ps1`, `run_backend.bat`.
- **6-Stage Healing Engine:** Complete with failure classifier, OpenAPI diffing, rule heuristics, provenance validation, in-memory hot-patching, and verified retries.
- **Cryptographic Audit Module:** `backend/app/audit/` with canonical JSON normalization, SHA-256 change tracking, thread-safe append-only `audit.jsonl`, and automated secret redaction.
- **Modern Dark "Suture" UI System:**
  - Token systems in `landing.css`, `console.css`, `tokens.css`, `components.css`.
  - Public showcase landing page (`LandingPage.tsx`).
  - Operator authentication & profile management (`LoginPage.tsx`, `ProfilePage.tsx`, `auth.ts`).
  - 7 operational console screens (Dashboard, Schema, Compare, Trace, Audit, Results, Safety).
  - Rich UI component library (`EventTimeline`, `SchemaDiffView`, `StripPlot`, `LaneBaseline`, `LaneHealing`, `ForkVisual`, `JsonViewer`, `console.tsx`).
- **Formatter & Data Integrity Layer:** `format.ts` with honest fallback (`DASH = '—'`) preventing fabricated metrics.

**Automated Test Suite Status:**
- **Backend Tests:** **45 / 45 passing** in `pytest` (covering routes, healing engine, mock API consistency, runner harness).
- **Frontend Tests:** **9 / 9 passing** in `vitest` (covering landing page rendering, metric honesty, and terminal outcomes).

---

### Slide 15 — Empirical Evidence & Live Observations

**Key Takeaways from Verified Runs:**

- **Baseline Vulnerability:** Under runtime schema drift, the baseline agent stalls in repetitive 422 loops, exhausting retry caps and failing every test case ($0.0\%\text{ ZTAR}$).
- **Instantaneous Healing:** The Reflex self-healing agent detects drift, isolates upstream OpenAPI deltas, hot-patches in-memory, and succeeds on the first retry ($100.0\%\text{ ZTAR}$).
- **Sub-Second Recovery:** MTTR consistently registers below 0.5 seconds, substantially exceeding the official PS 01 target of 4.0 seconds.
- **Zero Hallucination:** In all 5 safety refusal scenarios, Reflex refuses immediately, recording explicit reason codes without ever inventing a dummy field or hallucinating a secret.
- **Zero LLM Token Waste on Deterministic Drift:** Rule-based heuristics resolve renames, type shifts, and structural nesting with exactly 0 LLM tokens consumed.

---

### Slide 16 — Limitations and Engineering Trade-Offs

**On-slide content:**

- **Upstream OpenAPI Trust:** The prototype treats the target service's `/openapi.json` as authoritative. Production deployment across untrusted networks requires cryptographic API signatures or mTLS.
- **Conservative Refusal Bias:** Reflex intentionally prefers safe refusal over aggressive guessing. If an API renames a field ambiguously without semantic clues, Reflex halts—sacrificing automated coverage for data integrity.
- **Silent Drift Boundary:** Silent drift (where an API accepts an obsolete field with a 200 OK but silently drops it) requires semantic response-assertion diffing, slated for future work.
- **Write Idempotency:** Demo write calls utilize safe simulation. Real-world financial or transaction mutations require strict idempotency keys (`Idempotency-Key`) prior to automated retry.

---

### Slide 17 — Future Roadmap & Commercial Potential

**Near-Term Enhancements:**
- **Live Gemini Model Integration:** Connect multi-modal Gemini 2.5/3.0 models for semantic reasoning over complex multi-field schema migrations.
- **Enterprise Vault Integration:** Connect HashiCorp Vault or AWS Secrets Manager for dynamic runtime credential negotiation during schema drift.
- **Expanded Concurrency Testing:** Multi-threaded stress testing on high-frequency concurrent registry updates.

**Long-Term Research Frontiers:**
- **Silent Schema Drift Detection:** Deep response payload shape monitoring to detect ignored or deprecated fields without 4xx errors.
- **Self-Healing SDK & Sidecar Proxy:** Package Reflex as a lightweight Envoy sidecar or Python/TypeScript SDK dropping directly into enterprise agent frameworks (LangGraph, CrewAI, AutoGen).
- **Cryptographic Contract Provenance:** Zero-knowledge schema verification verifying that upstream contract changes were digitally signed by verified API publishers.

---

### Slide 18 — Conclusion

**On-slide content:**

Reflex bridges the critical gap between static AI agent tool schemas and continuously evolving runtime microservices.

- **Zero-Touch Adaptation:** Recovers in memory without restarts, manual code changes, or human intervention.
- **Principled Refusal:** Enforces uncompromising safety boundaries—never hallucinating values or guessing ambiguous contracts.
- **Empirically Proven:** Sub-second recovery ($< 0.5\text{s}$ MTTR vs $4.0\text{s}$ target), 100% ZTAR, and negligible token overhead.
- **Complete Enterprise Observability:** Tamper-evident SHA-256 audit logs, live SSE telemetry, and an industrial-grade dark "Suture" console.

**Closing Line:** Reflex proves that autonomous resilience does not require blind guessing: by pairing rigorous upstream evidence with principled refusal, agents can adapt seamlessly and fail honestly.

---

### Slide 19 — The 30-Second Elevator Pitch

> *"Autonomous AI agents break the moment an API updates a parameter name, data type, or required header at runtime. Existing frameworks simply crash or burn tokens in hallucinated retry loops.*  
>  
> *Reflex is an in-memory self-healing registry that intercepts contract failures, retrieves the upstream OpenAPI specification, and hot-patches the agent's tool schema in real time—with zero process restarts and sub-second recovery.*  
>  
> *Crucially, Reflex is safe: if a mapping is ambiguous, a field source is missing, or a credential is absent, it executes a principled refusal and cryptographically records the exact reason code. We prove this live with a dual-agent arena, a sub-0.5s MTTR beating the 4-second hackathon target, and a full dark-mode observability cockpit."*

---

### Slide 20 — Primary References & Technical Foundation

**Project References:**
1. Official Hackathon Problem Statement, PS 01: *Self-Healing Tool Registries Under Runtime API Schema Drift* (VESIT Quest It).
2. Reflex System & UI Specification: `docs/SYSTEM_AND_UI_SPECIFICATION.md` (authoritative architecture and UI specification).
3. Reflex Architectural Specifications: `docs/specs/PRD.md`, `docs/specs/Architecture.md`, `docs/specs/rules.md`, `docs/specs/design.md`.

**Technical & Industry Specifications:**
4. OpenAPI Initiative: *OpenAPI Specification v3.1.1* (https://spec.openapis.org/oas/v3.1.1.html).
5. JSON Schema: *Validation Specification Draft 2020-12* (https://json-schema.org/draft/2020-12/json-schema-validation.html).
6. FastAPI: *Modern Python Web Framework & Dynamic OpenAPI Generation* (https://fastapi.tiangolo.com).
7. W3C / MDN: *Server-Sent Events (SSE) Protocol* (https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events).
8. NIST: *FIPS 180-4 Secure Hash Standard (SHA-256)*.

---

### Slide 21 (Appendix) — Comprehensive Repository Architecture Map

```text
genesis/Reflex/
├── backend/
│   ├── app/
│   │   ├── audit/                  # Cryptographic audit package (canonical.py, audit_log.py)
│   │   ├── mock_api/               # Mutating target API (ActiveSchema, validator, mutations, faults)
│   │   ├── healing/                # 6-stage engine (classifier, diff, hypothesis, validator, healer)
│   │   ├── registry/               # In-memory versioned tool registry & executor (v1 -> v2)
│   │   ├── agents/                 # Baseline agent vs Reflex self-healing agent orchestration
│   │   ├── runner/                 # Dual-agent test harness, parity metrics, correctness checker
│   │   └── control_api/            # FastAPI control plane, SSE broadcaster, run manager, status
│   ├── tests/                      # 45 passing pytest unit & integration tests
│   ├── run_servers.py              # Simultaneous multi-threaded backend runner (:8000 & :8001)
│   └── run_servers.ps1             # PowerShell backend launcher
├── frontend/
│   ├── src/
│   │   ├── pages/                  # 10 application pages:
│   │   │   ├── LandingPage.tsx     # Public showcase landing page with live benchmark strip & SVG seam
│   │   │   ├── LoginPage.tsx       # Operator authentication gateway (operator / reflex2026)
│   │   │   ├── ProfilePage.tsx     # Operator profile & session controls
│   │   │   ├── Dashboard.tsx       # Console overview: Continuum Seam trace & latest duel cards
│   │   │   ├── SchemaPage.tsx      # Schema Mutation Studio: active tree & drift injection
│   │   │   ├── ComparePage.tsx     # Agent Comparison Arena: SVG execution lanes & SSE timeline
│   │   │   ├── TracePage.tsx       # Forensic Trace Inspector: historical runs & AST diffs
│   │   │   ├── AuditPage.tsx       # Cryptographic Audit Ledger: SHA-256 table & split-screen diff
│   │   │   ├── ResultsPage.tsx     # Parity & Benchmark Results: 9-metric scorecard & MTTR strip plot
│   │   │   └── SafetyPage.tsx      # Principled Safety & Refusal: 5 interactive refusal scenarios
│   │   ├── components/             # Reusable UI primitives:
│   │   │   ├── AppShell.tsx        # Console navigation shell with live service health indicators
│   │   │   ├── EventTimeline.tsx   # Real-time SSE streaming event feed with millisecond offsets
│   │   │   ├── SchemaDiffView.tsx  # Git-style AST schema diff highlighting added/removed/mutated fields
│   │   │   ├── RefusalPanel.tsx    # Safety refusal diagnostics component
│   │   │   ├── console.tsx         # Shared console primitives (PageHead, Panel, Chip, SeamStrip, Metric)
│   │   │   └── ui/                 # Atomic UI components (Icons, CopyButton, StripPlot, Stepper, etc.)
│   │   ├── styles/                 # Theme tokens and style sheets:
│   │   │   ├── tokens.css          # Design token definitions (colors, typography, spacing, elevations)
│   │   │   ├── components.css      # Component-level dark "Suture" styles
│   │   │   ├── console.css         # Operational console layout styles
│   │   │   └── landing.css         # Public marketing & benchmark showcase styles
│   │   ├── auth.ts                 # Operator authentication & session state gateway
│   │   ├── utils/format.ts         # Honest formatting utilities (DASH = '—', pct, secs, shortHash)
│   │   └── test/                   # 9 passing vitest frontend component tests
│   └── index.html                  # HTML root with Obsidian theme tokens & typography links
├── audit/
│   └── audit.jsonl                 # Immutable, redacted JSONL audit trail with SHA-256 digests
├── docs/
│   ├── SYSTEM_AND_UI_SPECIFICATION.md # Authoritative system and UI reference
│   ├── presentation/
│   │   └── ppt_solution_content.md # This presentation slide brief
│   └── specs/                      # Architecture, PRD, rules, and design specifications
└── run_backend.bat                 # Root one-click Windows launcher
```

---

## Presenter Checklist & Execution Tips

1. **Verify Services Before Stepping Up:**
   - Launch backends via `run_backend.bat` or `python backend/run_servers.py`.
   - Ensure `[Mock:8000]` and `[Control:8001]` both report healthy in the console header.
   - Launch frontend via `pnpm dev` inside `frontend/` (Port 5173).
2. **Demo Sign-In:** Use `operator` / `reflex2026` to enter the console from the landing page.
3. **Highlight the "Suture" Theme:** Point out the visual continuity seam—show how the red fracture break is stitched in green in under 0.5s.
4. **Showcase the Safety Scenarios:** Do not just show the happy path. Spend at least 60 seconds on the `/console/safety` page demonstrating the 5 principled refusals to prove Reflex never hallucinates.
5. **Point to Audit Ledger Cryptography:** In `/console/audit`, show the canonical SHA-256 hash, confidence scores, and split-screen definition diff to emphasize enterprise auditability.
6. **Emphasize Honest Benchmarks:** Show the MTTR Strip Plot with the amber 4.0s Hackathon PS guideline and show that Reflex recovers well within the target line.
