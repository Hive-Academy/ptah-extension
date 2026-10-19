# Batch 22 report

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\skill-synthesis\src\lib\skill-scorecard.service.ts:54` — grade-backed invocation stats, with telemetry count and distinct contexts read directly from the event table.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\skill-synthesis\src\lib\skill-scorecard.service.spec.ts:75` — mixed and zero-grade cases; checks no candidate-store read.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.ts:1779` and `:2336` — invocationStats and clone summary use scorecard stats, with the existing telemetry invocation count retained.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.spec.ts:966` and `:1970` — clone and RPC assertions for mixed/zero grades, all clone kinds, telemetry contexts, and no candidate-store call.

## Read-path trace

`skill_task_grades` -> `SkillTaskGradeStore.getAggregates(kind, [slug])` (`skill-task-grade.store.ts:187-200`) -> `SkillScorecardService.getInvocationStats` (`skill-scorecard.service.ts:54`) -> `SkillsSynthesisRpcHandlers.registerInvocationStats` (`skills-synthesis-rpc.handlers.ts:1779`) -> RPC `stats.total/succeeded/failed`. Clone summaries use the same scorecard method with `row.kind` (`:2336`) -> `successRate`. With zero grades, the rate is null. `skill_invocation_events` -> scorecard telemetry query (`skill-scorecard.service.ts:65-69`) -> `distinctContexts` in the RPC and `invocationCount` in clone summaries. Neither handler method calls the candidate store.

## Decisions

- Use the existing scorecard service and its already registered grade-store token as the handler boundary. The alternative was adding grade and database injections to the handler. Existing scorecard registration and its grade-store dependency support this choice; reversible by moving the composition if the service boundary changes.
- Keep clone `invocationCount` sourced from event telemetry while grade counts drive the rate. The alternatives were displaying graded task count as invocation count or retaining the candidate-store read. The existing clone field is an invocation count, and the batch requires no candidate-store read in these paths; reversible if the DTO is changed later.
- Preserve `distinctContexts` by querying `skill_invocation_events` through the existing SQLite connection registered for skill synthesis. The event store has no context-count read method and is outside this batch's ownership. Reversible if such a method is later added.

## Verification

Scoped `ptah_get_diagnostics` found zero TypeScript errors in the four changed files. Tests, lint, build, and Nx commands were not run, as instructed. No DI registration change was needed.

## Fix round 1

- Defect: optional scorecard absence raised from both RPC read paths and could fail the Library list. `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.ts:1778` now returns zero graded counts and contexts; `:2334` now gives clone summaries `successRate: null` and `invocationCount: 0`. Specs at `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.handlers.spec.ts:1020` and `:2027` cover both absent-scorecard paths and no candidate-store call.
- Defect: scorecard service owned raw event SQL and cast its result. `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\skill-synthesis\src\lib\skill-invocation-event.store.ts:31` and `:82` now own the same per-slug `COUNT(*)` / `COUNT(DISTINCT context_id)` query with Zod row parsing. The query has no source or workspace filter. `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\skill-synthesis\src\lib\skill-scorecard.service.ts:46` and `:61` inject and call the already registered event store instead of the SQLite connection. The event-store spec at `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\skill-synthesis\src\lib\skill-invocation-event.store.spec.ts:10` checks counts, distinct non-null contexts, slug filtering, and zero rows with an in-memory database; the scorecard mock at `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\skill-synthesis\src\lib\skill-scorecard.service.spec.ts:33` checks delegation.
- Read path: `skill_task_grades` -> `SkillTaskGradeStore.getAggregates` -> `SkillScorecardService.getInvocationStats` -> RPC graded counts and rate. `skill_invocation_events` -> `SkillInvocationEventStore.getUsageStats` -> scorecard -> RPC `distinctContexts` and clone `invocationCount`. No DI registration edit was needed: `SkillInvocationEventStore` is already registered as a concrete singleton in `di/register.ts:79`.
- Verification: tests, typecheck, lint, build, Nx and Jest commands were not run as directed; the orchestrator owns those checks.

### Decisions

- Inject the existing concrete `SkillInvocationEventStore` into the scorecard service. The alternative was adding a DI token and registration outside batch ownership. The existing singleton registration supports direct constructor injection, and this is reversible if a broader token boundary is later required.
