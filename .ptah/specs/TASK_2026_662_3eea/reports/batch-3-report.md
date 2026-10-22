# Batch 3 report

## Files changed

- `libs/backend/skill-synthesis/src/lib/skill-invocation-event.store.ts:1-144` — new event-only SQLite store with prepared insert and run/session lookups. New events default to a NULL grade; `is_error` comes only from the explicit flag.
- `libs/backend/skill-synthesis/src/lib/skill-invocation-event.store.spec.ts:1-86` — covers nullable grades, independent error flags, run lookup, scoped skill lookup, dominant skill, and recent session ordering.
- `libs/backend/skill-synthesis/src/lib/di/register.ts:18-19,72-75` — registers the new singleton before the telemetry seam adapter. The 646 port token stays unchanged.
- `libs/backend/skill-synthesis/src/lib/outcome-seam/skill-telemetry-seam.adapter.ts:7-13,25-43,76-82` — adapter reads event rows through the new store. The constructor uses the two-method reader shape so an existing out-of-batch trigger spec can still construct it; runtime DI resolves the new store.
- `libs/backend/skill-synthesis/src/lib/outcome-seam/skill-telemetry-seam.adapter.spec.ts:2-8,39-50,118-150` — exercises the adapter against the new store, including ambiguous runs and malformed telemetry.

## Write path and readers

`SkillInvocationEventStore.recordSkillEvent` inserts into `skill_invocation_events`: `id`, `skill_slug`, `session_id`, `context_id`, `source`, `succeeded`, `is_error`, `invoked_at`, token and cost metrics, `task_id`, `workspace_root`, and `run_id`. `succeeded` defaults to NULL, while `is_error` is always based on the caller's explicit `isError`. `SkillTelemetrySeamAdapter` reads that table through `SkillInvocationEventStore.findSubagentRuns` and `listSkillsForScopes`; the store also provides dominant skill and recent session readers. `SessionVerdictStore` remains the reader for legacy session evidence. The existing candidate-store write path remains in place for the later migration phase.

## Decisions

- **Nullable new grade:** Chose an optional `succeeded` input whose omitted value writes NULL. The alternatives were to require a nullable input or retain optimistic boolean success. Migration 0056 and implementation-plan.md:99 require ungraded rows to remain NULL. This is reversible at the store API boundary.
- **Explicit error:** Chose to require `isError` independently of `succeeded`; deriving it from a missing or false grade would misclassify unknown grades. Supported by the batch quality requirement and migration 0056. Reversible without a schema change.
- **Adapter reader shape:** Chose `Pick<SkillInvocationEventStore, 'findSubagentRuns' | 'listSkillsForScopes'>` for the constructor while retaining `@inject(SkillInvocationEventStore)`. An existing trigger spec outside batch ownership passes a candidate store to the adapter; this preserves compile compatibility without changing runtime DI. Reversible when that spec migrates.
- **DI token:** Used the class token, following `SkillCandidateStore` registration; no new token was needed. The 646 port token remains unchanged. Reversible within this library's DI registration.

## Verification

No tests, Nx, build, lint, or e2e were run, as instructed. Scoped `ptah_get_diagnostics` reported zero errors after the final edit. The orchestrator owns the project test and typecheck command.
