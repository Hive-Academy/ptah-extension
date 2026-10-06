# Batch 18 report

Tasks 18.1, 18.2, 18.3 done. 18.4 (FM-7) skipped (awaiting G-E).

## Files (all under libs/backend/agent-sdk/src/lib/helpers)
- compaction-config-provider.ts: `warnOnce(key, msg, data)` backed by `warnedBudgets`; threshold warn, env-ignored warn, env-clamped warn and budget warn all route through it (key + type + value). Budget defaults resolved once in the constructor (`budgetDefaults` map).
- compaction-config-provider.spec.ts: two `getConfig()` calls produce one threshold warn and one env-clamp warn.
- compaction/tool-output-capper.ts: `numLines` after an outline counts outline lines only (text before the `\n\n[outline: ` trailer; 0 if only the trailer).
- compaction/tool-output-capper.spec.ts: numLines expectation updated to exclude the trailer.
- post-tool-use-hook-handler.ts: `options?: { signal?: AbortSignal }`, `options?.signal`, `signal?.` guards; a missing signal is never aborted.
- post-tool-use-hook-handler.spec.ts: hook invoked without options returns `{ continue: true }`, capper called once.

## Checks
- `npx nx run-many -t typecheck,lint,test -p agent-sdk`: exit 1. Lint passed. Failures are all outside this batch's files (other agents' in-flight edits): TS2554 in session-budget/session-budget-stage.ts:276 and session-lifecycle/session-query-executor.service.spec.ts:991; failing suites deleted-exports.contract, register.compaction-boundary-registry.smoke, sdk-adapter-events.service, session-budget-stage, session-budget.service, session-query-executor.service. The three specs of this batch pass (140 suites passed, 2954 tests).
- `nx run di-lint:lint`: exit 0. `nx run degradation-audit:lint`: exit 0.
- No baseline PNGs rewritten.

## Open notes
- Task 18.4 remains for Batch 27 pending G-E.
- Re-run agent-sdk typecheck/test once the session-budget batch lands to get a clean exit.
