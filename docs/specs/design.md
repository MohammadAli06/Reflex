# design.md — React UI design

The UI shows real backend state. It is built with React + Vite + TypeScript. The healing engine and tests matter most; the UI must be clear, correct and reliable, not fancy.

## 1. Principles

1. Real data only. Every number and event comes from the control API.
2. Never show success until the backend confirms it.
3. Failures and refusals are shown clearly, with reasons.
4. Plain words: "patched", "refused", "needs human review", "not schema drift".
5. No secrets anywhere in the UI.
6. Simple layout. No decorative animation.

## 2. Layout and navigation

- App shell: top bar (project name, status dot for mock API and control API) and a left sidebar. On narrow screens the sidebar becomes a top menu.
- Navigation: Dashboard `/`, Schema `/schema`, Compare `/compare`, Trace `/trace/:runId`, Audit `/audit`, Results `/results`, Safety `/safety`.
- Content area: max width about 1200 px, cards on a light background.

## 3. Pages

### 3.1 Dashboard (`/`)
Cards: schema version, schema hash (short, full on hover or expand), system status (mock API, control API, LLM configured yes/no), latest run result (both agents), recovery and refusal summary (from `/api/metrics`). Refresh button. Empty state: "No runs yet. Go to Compare to start one."

### 3.2 Schema Mutation (`/schema`)
- Left: active schema view (request schemas per endpoint, required headers, version, hash).
- Right: controls. Mutation selector (single and combined), error style selector (clear / vague / none), Apply button, Reset (with confirm), Consistency check button.
- Workflow: choose → Apply → button shows loading → UI shows the new version only after the backend confirms and `/api/schema` is re-fetched → consistency result is shown. A failure shows the backend message, never success.

### 3.3 Agent Comparison (`/compare`)
- Choose a case and error style. Press Run. The backend runs both agents under identical fresh conditions, one after the other.
- Two `AgentCard`s side by side: status, attempts, last error, final result, recovery time, tokens.
- Below: the live trace for the selected run.
- Baseline failures and baseline successes are shown as returned. There is no control that changes the baseline.
- If a run is already active, show "busy" (409) and disable Run.

### 3.4 Live Healing Trace (`/trace/:runId` and embedded)
- Vertical timeline of real events: error detected, classification, schema fetched (version + hash), schema diff, candidate patch (evidence, confidence), validation, patch applied, retry, verification, rollback, refusal (reason code).
- Each event shows agent label, time, and a compact data view. Schema diffs use `SchemaDiffView`.
- States: waiting for events, streaming, finished, disconnected (with reconnect note).

### 3.5 Audit Log (`/audit`)
Table: time, tool, outcome (badge), schema versions, short hash, evidence, confidence, reason code. Filter by outcome. Click a row to expand old and new definitions in `JsonViewer`. Secrets never shown.

### 3.6 Results and Metrics (`/results`)
- Table cards: ZTAR, MTTR median and p95, tokens (`T_heal`, `T_base`, ratio, totals), retries before stop, correct refusals, wrong patches, failed cases.
- Second table: results by error style. Separate rows for rule-based and LLM-fallback when present.
- One simple Recharts bar chart (for example success by error style).
- Footer: runs per case (N), model, settings, date, held-out noted separately.
- Null values show "n/a". Empty state: "No results yet. Run the suite (T6.4)."

### 3.7 Safety Demonstration (`/safety`)
Four scenario cards with Run buttons:
1. Recovery after a schema change (PS demo).
2. Refusal: missing credential.
3. Refusal: ambiguous mapping.
4. Not schema drift (5xx and bad credential): classified correctly, no patch.
Each result shows outcome, reason code, a plain-English explanation, and the trace. `RefusalPanel` answers: why it refused, what evidence was missing, what a human must do.

## 4. Components

AppShell, NavBar, StatCard, StatusBadge, DataTable, JsonViewer (redacts known secret keys), SchemaView, SchemaDiffView, TraceViewer, TraceEvent, AgentCard, RefusalPanel, MetricsChart, LoadingState, ErrorState, EmptyState.

## 5. Colors (consistent meaning)

| Meaning | Color | Use |
|---|---|---|
| Success | green | recovered, verified, passed |
| Failure | red | failed, wrong patch, error |
| Warning | amber | needs human review, retry, busy |
| Refusal | indigo | safe refusal (not a failure) |
| Neutral | gray | info, waiting |

Text contrast must be readable. Do not rely on color alone; badges carry text.

## 6. States

- Loading: short text or skeleton. Buttons show a loading state and are disabled.
- Error: message from the backend, a Retry button. Backend down: a clear banner.
- Empty: what is missing and what to do next.
- SSE: connecting, streaming, finished, disconnected.

## 7. Responsive behavior

- Breakpoints: 640 px and 1024 px.
- Under 1024 px: sidebar collapses to a top menu; agent cards stack.
- Under 640 px: single column; tables scroll horizontally; controls full width.
- Test at 375, 768 and 1280 px.

## 8. CLI fallback

`backend/cli/demo.py` runs the same real flow in the terminal: consistency check → normal task → mutate → baseline → self-healing → audit tail → refusal case → results table from `results/`. It is a fallback for testing and demo recovery. It does not replace the React UI. A labelled recording of a real run may be kept for emergencies.

## 9. Demo script (UI)

1. Dashboard: show healthy status and the current schema version.
2. Schema page: run the consistency check (shows the five checks pass).
3. Compare: run the normal case; both agents succeed.
4. Schema page: apply the PS demo mutation (`user_id` → `target.id`, type change, new header). Show the new version.
5. Compare: run again. Baseline result shown as returned. Self-healing agent: watch the live trace (error, classify, fetch, diff, patch, validate, apply, retry, verify). Show the measured time. Do not state a target as achieved.
6. Audit: open the new entry (old and new definition, evidence, confidence, version, hash).
7. Safety: run the missing-credential or ambiguous scenario. Read the refusal explanation.
8. Results: show the table from real runs, by error style, with held-out noted.
9. If the UI fails: switch to the CLI fallback.

## 10. Results table template (fill from real runs only)

| Metric | Baseline | Self-Healing |
|---|---|---|
| ZTAR | | |
| Correct refusals | | |
| Wrong patches | | |
| MTTR median / p95 (s) | | |
| `T_heal` / `T_base` / ratio | | |
| Total task tokens | | |
| Schema attempts before stop | | |

Second table: same metrics by error style (clear / vague / none). Note: N runs per case, model, settings, date, held-out result, limitations.

## 11. Wording rules

- Always show the reason for a refusal.
- Never show a number that was not measured.
- Never show secret values.
- State limitations plainly.

## 12. 30-second pitch (outline; finalize after results)

1. Problem: APIs change; agents crash, loop, or send bad data.
2. Idea: a layer that detects the change, finds a safe fix from verified evidence, patches in memory, logs everything.
3. Proof: live change on stage, then measured results.
4. Key message: "It recovers reliably, refuses when unsure, and logs everything."

## 13. Write-up outline (short)

1. Problem and approach. 2. Diagnosis: classification, schema diff, evidence order. 3. Patch logic: rules, validation, apply, rollback. 4. Safety rules and refusals. 5. Fair baseline setup and caveats. 6. Measured results. 7. Limitations (response-nesting scope, weak-evidence renames, baseline may succeed, quota, LLM wrapper difference).
