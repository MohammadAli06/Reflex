# Docs index

Project documentation, grouped by purpose.

| Folder | Contents |
|---|---|
| [`problem-statement/`](./problem-statement/) | The official hackathon PS 01 PDF. |
| [`specs/`](./specs/) | Core specification: PRD, Architecture, design, rules. |
| [`plan/`](./plan/) | Execution plan and phased task breakdown. |
| [`reviews/`](./reviews/) | Solution alignment review. |
| [`presentation/`](./presentation/) | Slide-ready deck content. |

## Quick links

- [Problem statement (PS 01)](./problem-statement/01-Self-Healing%20Tool%20Registries.pdf)
- [PRD](./specs/PRD.md)
- [Architecture](./specs/Architecture.md)
- [Design](./specs/design.md)
- [Rules](./specs/rules.md)
- [Phases](./plan/phases.md)
- [Execution plan](./plan/execution_plan.md)
- [Solution alignment review](./reviews/solution_alignment_review.md)
- [Presentation content](./presentation/ppt_solution_content.md)
- [Full-Stack Architecture & Codebase Analysis](./ARCHITECTURE_ANALYSIS.md)

## Console pages

| Route | Purpose | Backend |
|---|---|---|
| `/console` | Dashboard: adaptation rate, last run, system status | `/api/status`, `/api/metrics` |
| `/console/schema` | Apply a breaking change and run consistency checks | `/api/mutate`, `/api/consistency` |
| `/console/compare` | Baseline vs Reflex on one case, live trace | `/api/runs`, SSE |
| `/console/real-world` | Reviewed breaking changes from vendored OpenAPI pairs | `/api/realworld/cases` |
| `/console/evaluation` | Splits, seeds, Wilson intervals, failure replay | `/api/evaluation/config`, `/api/metrics` |
| `/console/trace` | Run list and event timeline | `/api/runs/{id}/events` (SSE) |
| `/console/audit` | Append-only decision record, incl. repair path | `/api/audit` |
| `/console/results` | Per-agent metrics, by error style / split / source | `/api/metrics` |
| `/console/spec-watch` | Pre-emptive drift detection | **not implemented** — page states what is missing |
| `/console/safety` | Six safety scenarios, incl. `tampered_schema` | `/api/scenarios` |
| `/console/payments-sandbox` | Idempotent writes and postcondition checks | **not implemented** — page states what is missing |
| `/console/security` | Audit chain, schema provenance, sessions | `/api/security/status`, `/api/security/sessions` |
| `/console/settings` | Repair policy (read-only until the backend enforces it) | `/api/status` |
| `/console/profile` | Operator identity, role, active session, and logout | `/api/me`, `/api/logout` |

Pages whose backend does not exist yet render an explicit unavailable state and
list the endpoints and settings they depend on. They never show placeholder
numbers, and unknown metrics render as `—`.

All pages are protected by top-level and console `<ErrorBoundary>` layers to eliminate
white-screen crashes, with route aliases (`realworld`, `specwatch`, `payments`) and fallback
redirection.

## Evaluation CLI

```bash
cd backend
python -m app.runner.run_suite --source real        # vendored OpenAPI cases
python -m app.runner.run_suite --source synthetic   # built-in catalogue
python -m app.runner.run_suite --fuzz 200 --seed 7  # generated cases
python -m app.runner.run_suite --replay-seed 700004 # one recorded fuzz case
```

Each run prints a per-case table and ends with `wrong_patches=`. A non-zero value
is a failure: the healer claimed a recovery the server-side payload contradicts.
Failing seeds print a one-line `--replay-seed` command.

Source-of-truth order: the official PS wins; then `specs/PRD.md`, then
`specs/Architecture.md`, `specs/rules.md`, `specs/design.md`.
