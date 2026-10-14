# rules.md — Rules for the team and for Antigravity

If anything here conflicts with the official PS, the PS wins.

## A. Safety rules (never break)

1. Never invent a value. A required value with no source → stop and log.
2. Header name and format: from the verified schema only.
3. Header secret value: from `.env` or a secrets store only. Never from an error body or schema. Missing → refuse `missing_credential`.
4. Never bypass authentication or permissions. Never retry a rejected credential with other values.
5. Never write secrets to logs, prompts, events, API responses, audit files, the frontend or Git.
6. Accept a rename or path move only if one candidate clearly leads. Two or more near-equal candidates → refuse.
7. Every patch, rule-based or LLM, passes the same validation.
8. The LLM may suggest a field mapping only. Never values or credentials. It is not used to override a rule-based ambiguity refusal.
9. Retry cap: `MAX_SCHEMA_ATTEMPTS` (default 3), the same for both agents.
10. Write calls: if neither the offline check nor `dry_run` is possible → `needs_human_review`, do not apply.
11. A newly required body field is permitted only when its value has approved provenance from the original task arguments or an explicitly configured non-secret source. Otherwise refuse `missing_required_value`; never create a default.
12. Do not replay a failed candidate patch. Consider a further patch only after re-fetching the schema and finding a materially different, evidence-supported change; it still counts toward `MAX_SCHEMA_ATTEMPTS`.

## B. Error classification

- 400/422 → possible drift, not proof. If the verified schema has no relevant change that explains the validation error, classify it as business/data validation and do not patch.
- 401/403 → not drift by default. Consider a missing header only if the verified schema requires one we lack AND a credential exists in the secrets store.
- 5xx, timeout, connection error, 429 → not drift. Backoff retry (`MAX_INFRA_RETRIES`), then report. Never patch.
- 404 and other 4xx → not drift by default.
- Infrastructure retries do not use the schema-attempt cap.

## C. Lossless conversion

- String → integer: allowed only if converting back gives the exact original string. `"123"` OK. `"00123"`, `"1e3"`, `" 12"`, `"12.0"`, `"abc"` refused.
- Refuse integers above 2^53.
- Integer → string: allowed only if the format is unambiguous.
- If meaning could change, refuse and log with a reason.

## D. Rollback

- Roll back only when evidence says the patch is wrong (same error, or error pointing to the patched field).
- New error about a different field → keep the patch, re-fetch the schema, diff again.
- 5xx/timeout/429 → keep the patch, handle separately.
- After any failed attempt, re-fetch the verified schema and log version + SHA-256 before deciding.
- Schema version changed between attempts → treat as a new mutation.
- A failed candidate is never replayed. A newly discovered independent mismatch may produce one new candidate within the cap.

## D.1 Registry concurrency

- Every update uses compare-and-swap against the registry revision used to build the candidate.
- If the revision is stale, discard the candidate, fetch the current definition and schema, and re-diff. A rollback must not overwrite a newer revision.

## E. Schema verification

- Trusted source for the MVP: the mock API's `/openapi.json`.
- Hash = SHA-256 of canonical JSON (sorted keys, no extra spaces, UTF-8).
- The hash is for change tracking. Never say it proves authenticity.

## F. Fair comparison

Both agents use the same: LLM, model settings, initial tool definitions, tasks, mock API, mutations, retry cap, error text, and access to `/openapi.json`. The only difference is the healing layer and registry patching.
Do not weaken the baseline. Do not tune the cases to favor us. Show baseline successes honestly.

## G. Token counting

- Use API usage fields (input and output tokens). No estimates.
- `T_heal` = tokens for diagnosis and recovery only. If no LLM call, report 0 and flag `rule_based`.
- `T_base` = tokens from first failure to final stop.
- Report raw counts, the ratio, and total task tokens for both agents.
- Do not assume rule-based healing is cheaper overall. Measure.

## H. Testing

- Run the consistency test after every mutation and before every demo.
- Every new rule or feature gets a test.
- Each case runs several times. Report average and spread, split by error style.
- Keep a held-out set. Do not run or inspect it while tuning. It is run once in T6.4.
- Use generated variants so we do not over-tune.
- Wrong patches are counted and reported (target 0, never assumed).
- Check correctness from server-side recorded payloads, not only "got 200".
- Before finishing any task, run the regression commands in execution_plan.md §D.

## I. Claims

- Never write that a target (MTTR under 4 seconds, success rate, token savings) is achieved until measured.
- State limitations: response-nesting scope, weak-evidence renames, baseline may succeed, LangChain vs plain loop, quota limits, fairness caveat on the LLM wrapper.

## J. Backend coding rules

- Python 3.11+, type hints, small modules, one job per module.
- No hardcoded field names (like `user_id` or `target`) in healing rules. Rules work on schema diffs.
- Settings only from `.env` / `config.py`. No secrets in code.
- Only `llm/gemini.py` imports `google.genai`. Only `agents/baseline_agent.py` imports LangChain.
- Mock API endpoints use raw JSON and `jsonschema`. No Pydantic body models for mutable endpoints.
- Agents and healer never reference `ADMIN_KEY`.
- No new dependency without a one-line reason in the completion report.

## K. Frontend rules

- React + Vite + TypeScript only. No other dashboard framework. Recharts for simple charts only.
- Show only backend-confirmed state. No success state before the backend confirms.
- No hardcoded metrics, results or events. Test fixtures are allowed only inside tests.
- Do not simulate healing in the frontend. Trace events come from SSE.
- Every data view has loading, error and empty states.
- Reusable components. Consistent status colors (design.md §5).
- No unnecessary animation.

## L. Security

- `.env` is git-ignored. `.env.example` has placeholders only.
- The browser never holds the Gemini key, admin key or header credentials.
- Privileged actions go through the control API.
- Responses, events and logs are scanned in tests for planted secrets.

## M. Scope control

In scope: mock API, registry, classifier, healing core, audit log, baseline, self-healing agent, runner, metrics, control API, React UI, minimal response check, CLI fallback, optional LLM fallback.
Out of scope: probing, staging replay, real APIs, advanced charts, animations.
Cut order: Phase 8 (LLM fallback) → extra charts and polish → fewer variants/repeats (keep held-out) → Phase 7 → LangChain replaced by plain loop → CLI polish.
Never cut: consistency tests, healing safety tests, audit log, baseline comparison, real metrics, working UI (T9.4–T9.11 minimal), refusal demo.

## N. Antigravity workflow

- Do one task at a time. Read PRD.md, Architecture.md, rules.md, phases.md, design.md, and memory.md (when it exists).
- Inspect the repository before changing it.
- Do not change architecture silently. If a doc must change, say so in the report.
- Do not start the next task. Stop and report.
- Report blockers. Do not hide or fake them.

## O. memory.md

- It does not exist at the start. Create it at the end of Phase 1 (T1.7). Update it after every completed phase and every important decision.
- Contents: decisions, done, in progress, blocked, measured results, open questions, LLM verification summary.
- Keep entries short. No secrets.
