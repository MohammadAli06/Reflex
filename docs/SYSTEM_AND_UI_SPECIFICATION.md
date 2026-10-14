# Reflex — Complete System & Frontend UI Specification

> **Hackathon Track:** PS 01 — Self-Healing Tool Registry Under Runtime API Schema Drift  
> **Target Audience:** Designers, Frontend Engineers, AI Architects, and Hackathon Evaluators  
> **Purpose:** Comprehensive blueprint of the complete backend mechanics, frontend pages, user flows, UI components, data structures, and redesign guidance for generating modern, production-grade UI interfaces.

---

## 1. Problem Statement & Planned Solution (Executive Summary)

### The Problem: Silent Failure in Autonomous Agent Tool Execution
Autonomous AI agents interact with external environments by invoking HTTP tools whose contracts are fixed during prompt or tool declaration. However, production microservices and third-party APIs undergo continuous runtime schema drift: endpoints rename query parameters, mutate primitive data types (e.g., strings to nested objects or integer timestamps to ISO strings), restructure payload hierarchies, or introduce mandatory authorization headers. When schema drift occurs at runtime, standard agent loops (such as ReAct or LangChain tool-callers) experience unhandled 4xx HTTP client errors. Deprived of diagnostic insight, agents either fail catastrophically, enter infinite retrying loops, or hallucinate synthetic payload values and bogus credentials, resulting in task abortion, security violations, or corrupted backend states.

### The Reflex Solution: Runtime Hot-Patching Without Restarts
Reflex introduces a resilient, in-memory self-healing layer positioned between the autonomous agent and external APIs. When a tool call encounters an HTTP 4xx error, Reflex intercepts the failure before it terminates the agent's execution context. The diagnostic engine classifies the error to confirm true schema drift, fetches the live OpenAPI contract from the upstream service, and computes an exact bidirectional structural diff against the cached tool definition. It then synthesizes an adapter patch using deterministic graph-matching heuristics or a targeted Gemini LLM fallback. The patch is rigorously validated in a sandbox and hot-patched into the in-memory tool registry in real time—with zero server reboots and zero manual developer intervention—allowing the agent to complete its primary mission seamlessly.

### Principled Refusal: The Non-Negotiable Safety Boundary
A self-healing system that guesses or invents data is dangerous. Reflex enforces strict safety guarantees: it **never** hallucinates missing authentication tokens, never fabricates arbitrary default values for mandatory domain fields, and never performs lossy type conversions where semantic fidelity is compromised. If multiple target fields are equally plausible (ambiguous mapping) or required credentials cannot be found in the authorized secure secrets vault, Reflex formally refuses the patch. It immediately emits an immutable refusal event, logs the exact mathematical reason code and considered evidence to an auditable log, and gracefully notifies the operator. Safety and honest failure are treated as primary virtues equal to successful recovery.

### Dual-Agent Parity & Rigorous Empirical Proof
To prove genuine superiority rather than synthetic benchmarks, Reflex operates a synchronized side-by-side evaluation harness. Every test case is executed concurrently against an unassisted baseline agent (standard LangChain / direct tool-calling loop) and the Reflex self-healing agent under identical network conditions, identical prompt tokens, and identical runtime mutations. Performance is measured across three core metrics: Zero-Touch Adaptation Rate (ZTAR), Mean Time to Recovery (MTTR, strictly targeted at under 4 seconds), and Token Overhead Ratio. A live React frontend visualizes the entire system in real time, exposing raw telemetry, schema diffs, execution traces, cryptographic audit chains, and head-to-head scorecards.

---

## 2. Complete Backend Architecture & System Mechanics

### 2.1 Multi-Process Topography
The system operates as three coordinated local processes:

```
┌─────────────────────────────────────────────────────────────┐
│                       Browser / UI                          │
│               React + Vite + TypeScript (Port 5173)         │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / SSE (Origin Guarded)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Reflex Control API (Port 8001)           │
│  - FastAPI Control Plane & Run Manager                      │
│  - Self-Healing Agent & Baseline Agent Runner               │
│  - In-Memory Versioned Tool Registry                        │
│  - Schema Diffing & Patch Synthesis Engine                  │
│  - Heuristic Engine & Gemini LLM Client                     │
│  - Server-Sent Events (SSE) Broadcast Hub                   │
│  - Append-Only Cryptographic Audit Log (JSONL + SHA-256)    │
└──────────────────────────────┬──────────────────────────────┘
                               │ Internal HTTP (Admin Key Protected)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     Mock Target API (Port 8000)             │
│  - Simulated 3rd-Party Service with Active In-Memory Schema │
│  - Dynamic OpenAPI Generator (/openapi.json)                │
│  - Mutation Injection Engine (Admin endpoints)              │
│  - Fault & Error Response Emulation (Clear / Vague / None)  │
│  - Strict Request Validator & Payload Inspection Store      │
└─────────────────────────────────────────────────────────────┘
```

1. **Mock API (Port 8000):** Emulates third-party services (e.g., customer management, payments). It maintains a single source of truth (`ActiveSchema`) that validates incoming requests and dynamically renders `/openapi.json`. It provides administrative endpoints (protected by `X-Admin-Key`) to inject schema mutations, toggle error styles (`clear`, `vague`, `none`), and simulate faults. Agents never have access to admin keys or admin routes.
2. **Control API (Port 8001):** The central nervous system. It orchestrates test runs, manages agent execution lifecycles, runs the self-healing pipeline, records immutable audit trails, and streams live telemetry via Server-Sent Events (SSE). It serves as the secure backend proxy; the browser never communicates directly with the Mock API or sees sensitive credentials.
3. **Frontend Application (Port 5173):** Interactive single-page React application delivering deep operational visibility, schema mutation triggering, side-by-side agent comparison, live trace streaming, cryptographic verification, and metric reporting.

### 2.2 The Self-Healing Pipeline
When an API error occurs, Reflex executes a 6-stage pipeline:

```
[4xx Error Detected] 
         │
         ▼
[Stage 1: Classification] ──── (Not Drift / 500) ────▶ [Fail Honestly]
         │
         ▼ (True Schema Drift)
[Stage 2: Evidence Gathering] ──▶ Fetches upstream /openapi.json & extracts diff
         │
         ▼
[Stage 3: Patch Synthesis] ───▶ Heuristic Matcher ──(fallback)──▶ Gemini LLM
         │
         ▼
[Stage 4: Safety & Verification Gate] ──(Ambiguity / Missing Credential)──▶ [Formal Refusal]
         │
         ▼ (Passed)
[Stage 5: In-Memory Hot Patch] ──▶ Replaces Tool Definition (No reboot)
         │
         ▼
[Stage 6: Retry & Verification] ──▶ Re-executes tool with adapted payload
         │
         ▼
[Cryptographic Audit Entry & SSE Broadcast]
```

* **Classification:** Differentiates schema mismatch (400/422) from auth failures (401/403) or server crashes (500).
* **Evidence Gathering:** Performs canonical diffing between the in-memory tool signature and the live active schema.
* **Patch Synthesis:** Heuristic engine tests for renamed keys, nested wrappers, type coercions, and required headers from local environment stores. If heuristics fail, it calls Gemini with constrained JSON outputs.
* **Safety Verification:** Validates proposed payloads against JSONSchema. Refuses if mapping is ambiguous or requires fabricated data.
* **Hot-Patching:** Atomically registers version $N+1$ in the tool registry.
* **Audit Trail:** Writes immutable record with timestamp, version bump, tool name, schema SHA-256 hash, patch diff, and reasoning code.

---

## 3. Frontend Architecture & Current Theme Critique

### 3.1 Why the Current UI Looks "Cheap & Dull"
The existing frontend was implemented as a utilitarian proof-of-concept. While functionally complete and reliable, its visual aesthetics suffer from:
1. **Flat, Low-Contrast Color Scheme:** Dominated by washed-out light gray (`#f6f7f9`) backgrounds and plain white card containers (`#ffffff`) separated by faint 1px borders (`#e5e7eb`).
2. **Lack of Visual Depth:** Absence of elevation shadows, blurred backdrops, glassmorphism, accent borders, or gradients.
3. **Generic Native Form Elements:** Raw browser `<select>` dropdowns and basic HTML buttons with standard blue `#2563eb` hover states.
4. **Standard Typography:** Relies on default `system-ui` sans-serif fonts without distinctive typographic scale, custom geometric headings, or high-contrast monospace code styling.
5. **Static, Monotonous Tables:** Dense, unstyled HTML tables lacking pill filters, row highlights, interactive states, or smooth transitions.
6. **Underwhelming Real-Time Visuals:** Real-time event streams display as plain unstyled text blocks without animated flow lines, glowing timeline pins, or status transitions.

### 3.2 Current CSS Variables & Palette Tokens
Defined in `frontend/src/styles.css`:

| CSS Variable | Current Hex Value | Role / Usage |
|---|---|---|
| `--bg` | `#f6f7f9` | Primary page canvas background |
| `--card` | `#ffffff` | Panel, card, and modal container surface |
| `--border` | `#e5e7eb` | Universal structural border |
| `--text` | `#1f2937` | Base body text color (dark charcoal) |
| `--muted` | `#6b7280` | Secondary metadata and hints |
| `--primary` | `#2563eb` | Primary CTA buttons and active nav links |
| `--success` | `#15803d` | Success badges, 200 OK statuses, recovered tags |
| `--success-bg` | `#dcfce7` | Soft green background for success pills |
| `--failure` | `#b91c1c` | Error alerts, baseline fail states, 4xx/5xx badges |
| `--failure-bg` | `#fee2e2` | Soft red background for failure pills |
| `--warning` | `#b45309` | Warning badges, busy state spinners |
| `--warning-bg` | `#fef3c7` | Soft amber background for warnings |
| `--refusal` | `#4338ca` | Safe refusal badges and panels (indigo) |
| `--refusal-bg` | `#e0e7ff` | Soft indigo background for refusal banners |
| `--neutral` | `#374151` | Neutral badges, version chips |
| `--neutral-bg` | `#f3f4f6` | Soft gray backgrounds |

### 3.3 Core AppShell Structure
The entire application is framed inside `frontend/src/components/AppShell.tsx`:
* **Top Navigation Bar:**
  * **Brand Identity:** Left-aligned text `Reflex · Self-Healing Tool Registry`.
  * **Real-Time Service Health Dots:** Three live status indicators showing connection status:
    * `Mock API` (Green dot for Port 8000 reachable / Red for unreachable)
    * `Control API` (Green dot for Port 8001 ok / Red for error)
    * `LLM` (Green dot if Gemini API key configured / Gray if offline)
    * `Busy Indicator` (Pill badge showing `busy` when a suite or run is executing)
* **Left Navigation Sidebar (Width: 210px, Sticky):**
  * Vertical list of 6 navigation items with active highlight styling:
    1. Dashboard (`/`)
    2. Schema Mutation (`/schema`)
    3. Agent Comparison (`/compare`)
    4. Audit Log (`/audit`)
    5. Results & Metrics (`/results`)
    6. Safety Demo (`/safety`)
* **Main Content Area:** Fluid layout container rendering the active routed page.

---

## 4. In-Depth Specification: Every Page, Component & Feature

### Page 1: System Dashboard (`/`)
* **Route:** `/`
* **File:** `frontend/src/pages/Dashboard.tsx`
* **Purpose:** Executive overview providing at-a-glance system health, active schema cryptographic fingerprint, and the latest comparison test outcomes.

#### Visual Layout & Elements:
1. **Header Row:** Page Title ("Dashboard") and a "Refresh" button.
2. **Top Metric Strip (4 Stat Cards):**
   * **Card 1: Schema Version:** Large bold version indicator (e.g., `v1`, `v2`, `v3`).
   * **Card 2: Schema Hash:** Truncated SHA-256 fingerprint (e.g., `73fc1aae9473`) of the canonical JSON schema, tracking exact structural state.
   * **Card 3: System Status:** Dual pill badges: `mock up` / `mock down` and `control up`. Secondary caption indicates LLM configuration status (`LLM configured: yes/no`).
   * **Card 4: Recovery / Refusals:** Large percentage badge showing Zero-Touch Adaptation Rate (e.g., `100% ZTAR`) with subtext displaying correct refusals count and wrong patches count (e.g., `4 correct refusals · 0 wrong patches`).
3. **Latest Comparison Run Panel:**
   * Contains a 2-column side-by-side comparison grid of the two agents from the most recent run:
     * **Left Card: Baseline Agent** (Outcome badge, attempts count, recovery status).
     * **Right Card: Self-Healing Agent** (Outcome badge, recovery time MTTR in seconds, tokens used, healing path).
   * If no run has executed yet, displays an `EmptyState` placeholder: "No runs yet. Go to Agent Comparison to start one."

#### Data & Logic Hooks:
* Calls `api.status()`: fetches reachability, active schema version, canonical hash, busy flag, and last run record.
* Calls `api.metrics()`: fetches cumulative aggregate ZTAR, MTTR percentiles, and refusal metrics.

---

### Page 2: Schema Mutation Studio (`/schema`)
* **Route:** `/schema`
* **File:** `frontend/src/pages/SchemaPage.tsx`
* **Purpose:** The live interactive testing laboratory where developers and hackathon judges can manually mutate the target API schema at runtime, toggle error verbosity, and verify schema-code synchronization.

#### Visual Layout & Elements:
1. **Header Row:** Page Title ("Schema Mutation").
2. **Two-Column Interactive Workspace:**
   * **Left Column: Active Schema Inspection Panel:**
     * Rendered via `SchemaView.tsx`.
     * Shows current schema version badge (e.g., `v1`), schema canonical hash, required HTTP headers list (e.g., `X-Tenant-Token`), and full JSON endpoint specifications for `/api/v1/users/fetch` and `/api/v1/users/update`.
   * **Right Column: Mutation Control Console:**
     * **Mutation Selector Dropdown:** Selects one of the built-in runtime drift scenarios:
       * `M_NEST_TYPE_HEADER` — Wraps user payload into nested object, changes ID type, adds required header (The official PS Demo mutation).
       * `M_RENAME_USER_ID` — Renames `user_id` to `account_id`.
       * `M_TYPE_STRING_TO_INT` — Changes numeric identifier string to integer.
       * `M_WRAP_PAYLOAD` — Nests request fields inside `{ "profile": { ... } }`.
       * `M_NEW_REQUIRED_HEADER` — Enforces an unknown header `X-Custom-Auth`.
       * `M_ADD_REQUIRED_FIELD_UNAVAILABLE` — Introduces required field with no known value source.
       * `M_AMBIGUOUS_RENAME` — Creates two equally likely candidate fields.
     * **Error Style Selector Dropdown:** Selects how the Mock API responds to errors:
       * `clear` — Returns explicit JSON detailing missing fields and invalid paths.
       * `vague` — Returns generic error strings ("Invalid request payload").
       * `none` — Returns raw 400 Bad Request with empty response body.
     * **Action Buttons:**
       * `Apply mutation` (Primary Blue): Triggers immediate schema drift on Port 8000.
       * `Reset schema` (Neutral Border): Reverts schema back to clean initial baseline.
       * `Check consistency` (Secondary): Runs the automated consistency validation test suite.
3. **Consistency Verification Results Card (Appears on action):**
   * Shows an overall green `PASS` or red `FAIL` badge.
   * Lists granular audit checks:
     * `schema_version_matches`: OpenAPI version matches internal memory.
     * `exposed_schema_matches_active`: Public schema equals active validation rules.
     * `missing_header_rejected`: Confirms requests without required headers receive 4xx.
     * `valid_payload_accepted`: Confirms valid payload produces 200 OK.

#### Data & Logic Hooks:
* `api.schema()`: Reads live OpenAPI document.
* `api.mutations()`: Lists available mutation scenarios.
* `api.mutate(id, errorStyle)`: Sends admin mutation command to backend.
* `api.reset()`: Resets mock schema.
* `api.consistency()`: Executes end-to-end consistency suite.

---

### Page 3: Agent Comparison Arena (`/compare`)
* **Route:** `/compare`
* **File:** `frontend/src/pages/ComparePage.tsx`
* **Purpose:** The centerpiece demonstration page. Pitches the baseline agent against the self-healing agent in real-time under identical drift conditions.

#### Visual Layout & Elements:
1. **Run Configuration Card:**
   * **Case Selector Dropdown:** Pre-populated with tuning suite test cases:
     * `ps_demo` — Standard hackathon problem statement scenario.
     * `case_rename_param` — Field rename test.
     * `case_nest_object` — Payload structure morphing.
     * `case_type_cast` — Integer/string coercion.
   * **Execution Button:** "Run comparison" button with loading spinner state ("Running…").
   * **Status Notice:** Shows real-time warnings (e.g., "A run is already in progress").
2. **Head-to-Head Agent Scorecards (2-Column Grid):**
   * **Left Card: Baseline Agent (`AgentCard.tsx`):**
     * Title: "Baseline Agent".
     * Status Badge: `failed` (Red) or `succeeded` (Green).
     * Metrics List: Total Attempts, Schema Attempts, Recovery Time (`n/a` on failure), Total Token Consumption, Failure Reason Code (`schema_error`).
     * Server Payload Validation: Shows whether the payload reached the server cleanly (`no`).
   * **Right Card: Self-Healing Agent (`AgentCard.tsx`):**
     * Title: "Self-Healing Agent".
     * Status Badge: `recovered` (Green) or `refused` (Indigo).
     * Metrics List: Total Attempts (usually 2: initial fail + recovered retry), Schema Attempts, Recovery Time (MTTR e.g., `0.342s`), Total Tokens, Healing Path (`heuristic` or `gemini`), Server Payload Validation (`yes`).
3. **Live Healing Trace Feed (`TraceViewer.tsx`):**
   * Interactive real-time log displaying events as they stream over SSE:
     * Event badges color-coded by agent (`baseline` vs `healing`).
     * Step titles: `Run started`, `Call attempt`, `Error detected (422)`, `Classified as drift`, `Schema fetched`, `Schema diff computed`, `Candidate patch synthesized`, `Validation passed`, `Patch applied in-memory`, `Retry succeeded`, `Verified`.
   * **Embedded Schema Diff View (`SchemaDiffView.tsx`):**
     * Displays visual code changes within the trace stream:
     * Red minus lines (`− old_field`) for removed keys.
     * Green plus lines (`+ new_field`) for added keys.
     * Yellow delta lines (`± id: string → integer`) for type changes.
     * Green header lines (`+ header X-Tenant-Token`) for required headers.

#### Data & Logic Hooks:
* `api.startRun([caseId], repeats=1)`: Dispatches run job to backend.
* `useRunEvents(runId)`: Custom React hook listening to Server-Sent Events at `/api/runs/{run_id}/events`.
* Interval poller (400ms): Polls `/api/runs/{run_id}` until execution status changes from `running` to `completed`.

---

### Page 4: Live Healing Trace Inspector (`/trace`, `/trace/:runId`)
* **Route:** `/trace` and `/trace/:runId`
* **File:** `frontend/src/pages/TracePage.tsx`
* **Purpose:** Deep-dive forensic debugger for inspecting complete execution timelines of past and current runs.

#### Visual Layout & Elements:
1. **Run Selector Dropdown:**
   * Lists past execution runs with Run ID, final status, and associated case IDs.
2. **Timeline Trace Panel (`TraceViewer.tsx`):**
   * Chronological event feed with high-resolution timestamps.
   * Compact argument visualizer rendering sanitized payload attributes (`user_id=12345`, `status=active`).
   * Expandable event detail rows showing exact error response payloads and patch validation output.
3. **Navigation Link:** Direct link back to the Agent Comparison Arena.

#### Data & Logic Hooks:
* `api.listRuns()`: Retrieves history of stored test runs.
* `useRunEvents(activeRunId)`: Replays stored SSE events or streams live events for active runs.

---

### Page 5: Cryptographic Audit Log (`/audit`)
* **Route:** `/audit`
* **File:** `frontend/src/pages/AuditPage.tsx`
* **Purpose:** Enterprise compliance and tamper-evident proof. Displays the cryptographic audit record of every hot-patch and refusal made by the healing layer.

#### Visual Layout & Elements:
1. **Filter Header:**
   * Dropdown filter to filter by outcome: `all`, `applied`, `refused`, `rolled_back`, `needs_human_review`, `not_drift`.
2. **Audit Data Table (`DataTable.tsx`):**
   * **Timestamp Column:** Formatted local datetime of the event.
   * **Tool Column:** Name of the patched tool (e.g., `fetch_user_profile`).
   * **Outcome Column:** Colored status badge:
     * `applied` (Green)
     * `refused` (Indigo)
     * `rolled_back` (Amber)
     * `not_drift` (Gray)
   * **Schema Version Transition:** Shows version bump (e.g., `v1 → v2`).
   * **Hash Column:** Truncated 10-character SHA-256 hash tooltip with full cryptographic digest.
   * **Confidence Score:** Algorithm confidence rating (e.g., `1.00` or `0.85`).
   * **Reason Code:** Monospace badge indicating internal decision rule (e.g., `heuristic_exact_match`, `ambiguous_mapping`).
   * **Actions Column:** "Details" toggle button.
3. **Expanded Side-by-Side Definition Diff:**
   * Selecting a row opens a split view below the table:
     * **Left Box: Old Definition:** Rendered JSON viewer showing pre-drift tool signature.
     * **Right Box: New Definition:** Rendered JSON viewer showing hot-patched tool signature.

#### Data & Logic Hooks:
* `api.audit({ outcome, limit: 100 })`: Fetches immutable entries from the backend's append-only JSONL log.

---

### Page 6: Parity & Benchmark Results (`/results`)
* **Route:** `/results`
* **File:** `frontend/src/pages/ResultsPage.tsx`
* **Purpose:** Academic and benchmark scorecard proving Reflex outperforms the baseline across statistical metrics, error styles, and healing paths.

#### Visual Layout & Elements:
1. **Master Scorecard Table (Baseline vs Self-Healing):**
   * Displays direct head-to-head comparison across 9 critical metrics:
     1. **ZTAR (Zero-Touch Adaptation Rate):** Baseline (typically `0%`) vs Self-Healing (typically `100%`).
     2. **Correct Refusals:** Number of dangerous scenarios successfully identified and halted.
     3. **Wrong Patches:** Number of incorrect/corrupted patches (strictly target: `0`).
     4. **MTTR Median / P95 (seconds):** Mean recovery time (e.g., `0.280s / 0.410s` vs `n/a`).
     5. **T_heal / T_base:** Execution duration comparison.
     6. **Token Ratio:** Relative token consumption ratio.
     7. **Total Task Tokens:** Total LLM token overhead.
     8. **Schema Attempts Before Stop:** Retries before safe termination.
     9. **Failures:** Total unhandled crashes.
2. **Performance Segmented by Error Style:**
   * Table comparing Baseline ZTAR/MTTR vs Healing ZTAR/MTTR across:
     * `clear` (Explicit JSON validation errors)
     * `vague` (Obfuscated error strings)
     * `none` (Silent 400 Bad Request)
3. **Recharts Visual Comparison Chart (`MetricsChart.tsx`):**
   * Responsive Bar Chart comparing recovered task counts across error styles for Baseline (Red bars) vs Self-Healing (Green bars).
4. **Breakdown by Healing Path:**
   * Table displaying frequency and success rates of patches resolved via:
     * `heuristic` (Fast, zero-token deterministic graph matching)
     * `llm` (Targeted Gemini schema inference)

#### Data & Logic Hooks:
* `api.metrics()`: Computes real-time statistical aggregations across all historical runs stored on the backend.

---

### Page 7: Safety & Principled Refusal Demonstration (`/safety`)
* **Route:** `/safety`
* **File:** `frontend/src/pages/SafetyPage.tsx`
* **Purpose:** Demonstrates the system's safety boundaries, proving Reflex halts safely rather than fabricating inputs when safe adaptation is impossible.

#### Visual Layout & Elements:
1. **Grid of 5 Interactive Safety Scenario Cards:**
   * **Scenario 1: Ambiguous Field Mapping:** API adds two similar fields (`business_email` and `personal_email`). Reflex refuses because guessing violates domain integrity.
   * **Scenario 2: Missing Required Credential:** API introduces a new security header (`X-Partner-Secret`). Reflex refuses because credentials cannot be hallucinated.
   * **Scenario 3: Missing Required Field with No Value Source:** API requires a non-nullable `tax_id` not present in agent parameters. Reflex refuses rather than inventing dummy data.
   * **Scenario 4: Lossy Type Conversion:** API changes a floating-point transaction value to an integer. Reflex halts because truncating decimals destroys financial data.
   * **Scenario 5: Non-Drift Server Outage:** Target API throws a 500 Internal Server Error. Reflex correctly classifies this as an infrastructure fault, refuses to mutate tool schemas, and halts.
2. **Interactive Controls on Each Card:**
   * Description of the safety hazard.
   * "Run" button with real-time executing state.
3. **Execution Feedback & Refusal Panel (`RefusalPanel.tsx`):**
   * Prominent refusal badge (`refused` or `not_drift_reported`).
   * Exact decision reason code (e.g., `ambiguous_mapping`, `missing_credential`).
   * Human-readable explanation explaining why halting was the only safe action.
   * List of evidence evaluated before refusal.
   * Expandable accordion showing the step-by-step trace of the refusal decision.

#### Data & Logic Hooks:
* `api.scenarios()`: Lists configured safety scenarios.
* `api.runScenario(id)`: Dispatches scenario test and receives detailed refusal diagnostics.

---

## 5. Shared Reusable UI Components Library

| Component Name | File Path | Description & Props |
|---|---|---|
| `AppShell` | `frontend/src/components/AppShell.tsx` | Main application frame. Contains topbar with live service status indicators and sticky sidebar navigation. |
| `StatCard` | `frontend/src/components/StatCard.tsx` | Standard metric card. Props: `label`, `value`, `hint`. Used for high-level dashboard KPIs. |
| `Card` | `frontend/src/components/StatCard.tsx` | Versatile content container with title header, action slot, and padded content body. |
| `AgentCard` | `frontend/src/components/AgentCard.tsx` | Dual-purpose card displaying agent execution metrics, status badges, attempts, and recovery times. |
| `StatusBadge` | `frontend/src/components/StatusBadge.tsx` | Color-coded status pill with semantic tones (`success`, `failure`, `warning`, `refusal`, `neutral`). |
| `DataTable` | `frontend/src/components/DataTable.tsx` | Generic typed table component supporting custom cell renderers and column definitions. |
| `TraceViewer` | `frontend/src/components/TraceViewer.tsx` | Timeline component rendering real-time streaming SSE trace events with timestamping and payload formatting. |
| `SchemaDiffView` | `frontend/src/components/SchemaDiffView.tsx` | Visual git-style diff viewer highlighting additions (`+`), removals (`−`), type mutations (`±`), and headers. |
| `SchemaView` | `frontend/src/components/SchemaView.tsx` | Structured OpenAPI inspector rendering endpoints, HTTP methods, headers, and formatted JSON schemas. |
| `RefusalPanel` | `frontend/src/components/RefusalPanel.tsx` | Specialized security alert box detailing reason codes, decision rationales, and evaluated evidence for safe refusals. |
| `JsonViewer` | `frontend/src/components/JsonViewer.tsx` | Syntax-highlighted formatted JSON inspector for exploring raw payloads and tool signatures. |
| `MetricsChart` | `frontend/src/components/MetricsChart.tsx` | Recharts bar chart component rendering comparative recovery distributions across error styles. |
| `StateViews` | `frontend/src/components/StateViews.tsx` | Standardized UI state handlers: `LoadingState`, `ErrorState` (with retry button), and `EmptyState`. |

---

## 6. Blueprint & Design Recommendations for Modernizing the UI

To transform this system from a dull prototype into an award-winning, visually stunning interface for hackathon presentations or enterprise deployment, apply the following design system recommendations:

### 6.1 Theme & Aesthetics Overhaul
* **Adopt a Dark Mode Cyber-Observability Aesthetic:**
  * Background: Deep slate / obsidian canvas (`#0b0f17` or `#0f172a`).
  * Card Surfaces: Elevated translucent glass panels (`rgba(30, 41, 59, 0.7)`) with subtle 1px border highlights (`rgba(255, 255, 255, 0.08)`) and backdrop blur (`backdrop-filter: blur(12px)`).
  * Accent Colors:
    * Primary Action / Brand: Electric Indigo (`#6366f1`) to Cyber Violet (`#8b5cf6`) gradient.
    * Success / Recovered: Neon Emerald (`#10b981`) with soft glow (`box-shadow: 0 0 12px rgba(16, 185, 129, 0.25)`).
    * Failure / Baseline Crash: Coral Crimson (`#ef4444`).
    * Principled Refusal: Electric Purple / Amethyst (`#a855f7`).
    * Warning / Drift Alert: Amber Glow (`#f59e0b`).
* **Typography:**
  * Primary Headings & UI: `Inter`, `Plus Jakarta Sans`, or `Space Grotesk`.
  * Telemetry, Code, Hashes & Hashes: `JetBrains Mono` or `Fira Code` with subtle syntax tinting.

### 6.2 Key Screen Compositions for Designers & Image Generators
When mocking or generating high-fidelity UI concepts, focus on these three hero screens:

1. **Hero Screen 1: The Agent Comparison Arena (`/compare`)**
   * Top bar showing active WebSocket / SSE connection glowing green.
   * Split-screen battle arena:
     * Left side: Baseline Agent card bordered in subtle red with a failed 422 alert and aborted execution line.
     * Right side: Self-Healing Agent card bordered in glowing emerald with an animated "Hot-Patch Deployed in 0.34s" badge.
   * Bottom half: Dark console stream showing live telemetry nodes connected by glowing vertical SVG line indicators, featuring an inline side-by-side git diff view (`- user_id` red, `+ account_id` green).
2. **Hero Screen 2: Schema Mutation Studio (`/schema`)**
   * Left: Clean code-editor style tree view of the OpenAPI schema with collapsible endpoints.
   * Right: Interactive control card with sleek custom toggle switches, error style pills (`Clear` / `Vague` / `None`), and a prominent glowing "Inject Schema Drift" button.
   * Bottom: An animated compliance checklist showing green validation ticks appearing in sequence.
3. **Hero Screen 3: Safety & Principled Refusal Hub (`/safety`)**
   * Grid of modern security cards with shield icons.
   * Prominent refusal showcase highlighting an "Ambiguous Rename" decision: showing the two competing candidates with 50%/50% confidence bars, an amber security badge, and an explanation card: *"Halting Safely — Zero Speculative Hallucination Policy"*.
