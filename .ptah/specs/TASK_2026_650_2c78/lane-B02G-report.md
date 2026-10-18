# B02G guidance execution report

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-setup.types.ts` — optional cancel outcome and committed state facts.
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts` — atomic reservation, route/source resolution, abort and commit boundary.
- `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.spec.ts` — lock and cancellation regressions.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts` — bound branch behind existing methods and internal cancel/lookup.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.spec.ts` — bound authorization, source, lock and lookup regressions.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.schema.ts` — tab/run binding schemas.
- `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.schema.spec.ts` — bound schema regressions.
- `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.ts` — exact tab/run tracking and terminal state.
- `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.spec.ts` — lookup, cancel and commit-window regressions.

No export lines were changed in `libs/backend/agent-generation/src/index.ts` or `wizard-generation-binding.ts`.

## Acceptance evidence

1. Tabless `runWizard` and `regenerate` still await the existing service result: `enhanced-prompts-rpc.handlers.ts:250-412,503-553`. The bound branch is conditional on `tabBinding` at lines 231-248 and 499-501.
2. The service owns the sole slot and reserves it synchronously before acceptance: `enhanced-prompts.service.ts:309-352,450-480,689-705`; handler acquisition and blocked response: `enhanced-prompts-rpc.handlers.ts:618-630`. Supervisor tracks binding/controller/state only: `guidance-generation-run.supervisor.ts:13-48`.
3. Host/tab/request workspace and analysis-directory checks precede bound execution and client analysis parsing: `enhanced-prompts-rpc.handlers.ts:231-248,560-617`. Bound client `analysisData` is discarded. Latest freshness decision: `enhanced-prompts.service.ts:361-392`; manifest verification: `enhanced-prompts-rpc.handlers.ts:673-696`. Discovery source blocks later phase enrichment: `enhanced-prompts.service.ts:584-590`.
4. Provider and supported effective model are resolved before acceptance with a 15-second preparation bound: `enhanced-prompts-rpc.handlers.ts:632-650,698-717`; effective provider/model are returned and stored by `guidance-generation-run.supervisor.ts:26-48`. Resolver handles unsupported requested-model fallback: `enhanced-prompts.service.ts:354-359`.
5. External abort reaches discovery checkpoints, SDK controller/stream and precommit checkpoints: `enhanced-prompts.service.ts:484-517,592-625,904-1015`. Trace precedes state: `enhanced-prompts.service.ts:655-677`. Acknowledged cancellation is refused after commit begins: `guidance-generation-run.supervisor.ts:50-57,84-89`; stream progress is suppressed after abort: `enhanced-prompts-rpc.handlers.ts:727-745`.
6. Exact internal cancellation and same-tab/workspace lookup are available without RPC registration: `enhanced-prompts-rpc.handlers.ts:801-834`, `guidance-generation-run.supervisor.ts:84-131`. A tabless owner reports blocked without binding; a same-workspace other tab exposes only `ownerTabId`.
7. Failed/cancelled runs report `committedState: 'unknown'`; completed runs report `committed`: `guidance-generation-run.supervisor.ts:64-82`, `rpc-setup.types.ts:64,74`.
8. Duplicate same-tab start reuses its binding: `enhanced-prompts-rpc.handlers.ts:587-607`. Trace/state failure yields failed retry state through service failure and supervisor terminal handling: `enhanced-prompts.service.ts:658-705`, `enhanced-prompts-rpc.handlers.ts:748-795`. Timeout/abort cannot be reported as success; unresolved commit state is unknown.
9. Status, enablement, content, download and cache behavior remain on their existing methods: `enhanced-prompts-rpc.handlers.ts:139-221,422-484,836-978`; tabless regenerate still uses its original awaited service path at lines 503-553.

## Specs

- Handler: `enhanced-prompts-rpc.handlers.spec.ts` — tabless awaited result, foreign tab/directory, fresh/stale source, unsupported-model fallback snapshot, blocked slot, duplicate start, lost-response lookup and exact cancellation.
- Schema: `enhanced-prompts-rpc.schema.spec.ts` — valid guidance tab, wrong workflow and malformed run ID.
- Supervisor: `guidance-generation-run.supervisor.spec.ts` — blocked owner visibility, tabless owner, exact cancel outcomes, unknown committed state and commit-window refusal.
- Service: `enhanced-prompts.service.spec.ts` — single lock reservation, abort during stream and before trace, trace-write failure, lock release and tabless behavior.

## Final line counts

- `rpc-setup.types.ts`: 619
- `enhanced-prompts.service.ts`: 1423
- `enhanced-prompts.service.spec.ts`: 1935
- `enhanced-prompts-rpc.handlers.ts`: 1111
- `enhanced-prompts-rpc.handlers.spec.ts`: 999
- `enhanced-prompts-rpc.schema.ts`: 77
- `enhanced-prompts-rpc.schema.spec.ts`: 47
- `guidance-generation-run.supervisor.ts`: 165
- `guidance-generation-run.supervisor.spec.ts`: 82

## Checks

- Prettier `--write` ran on every changed file.
- Focused Jest: RPC handler/schema/supervisor 36 tests passed; service 61 tests passed before the final commit-window assertion.
- Final `nx run-many -t typecheck,lint` for the seven requested projects: 14 targets passed.
- Final `nx run-many -t test` for the two requested projects: passed; header confirmed `Running target test for 2 projects`.
- Scoped `ptah_get_diagnostics` was invoked after edits but its compiler backend timed out at 45 seconds and reported unavailable. Nx typecheck passed independently.

## Decisions

- **One service lock:** options were a second supervisor lock or reserving the existing `isGenerating` slot. Chose the existing slot (`enhanced-prompts.service.ts:309-352`) to meet the plan's single-owner rule. Reversible: yes.
- **Commit-window cancel:** options were acknowledging abort during an in-flight write or refusing cancellation after the commit boundary. Chose refusal (`guidance-generation-run.supervisor.ts:50-57,84-89`) so an acknowledged cancel guarantees no later trace/state write. Reversible: yes.
- **Bound source:** options were rechecking freshness during execution or fixing the accepted source. Chose fixed source and disabled later phase enrichment after a discovery decision (`enhanced-prompts.service.ts:584-590`). Reversible: yes.

## Open points

- B03 must register and publish the prepared cancel and lookup methods, and own DI/registry/manifest changes. This batch intentionally registers no new RPC names.
- `ptah_get_diagnostics` remained unavailable within its 45-second limit; the required Nx typecheck and lint gates passed.

## Proposed Removals

None. No existing capability was removed.
