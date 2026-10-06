# Batch 27 report

Files changed (under D:\projects\ptah-extension\.claude-worktrees\task-614-f-g\libs\backend\agent-sdk\src\lib\helpers):
- stream-transformer.ts: Task 27.1. Added a private module-level `runGuardedCallback(logger, failureMessage, context, callback)` and replaced the twin try/catch for `onMessage` and `onStreamEnd` with it. Log messages and fields (`sessionId`, `messageType`, `error` name) are unchanged.
- session-lifecycle-manager.ts: Task 27.2. `onMessage` and `onStreamEnd` on `ExecuteQueryResult` now each have their own doc. A single `compactionTap` object is not introduced (recorded only).

The spec was not changed; existing specs cover both callbacks.

Checks:
- `nx run-many -t typecheck,lint,test -p agent-sdk`: typecheck and lint passed. The test target failed on the first run; the cause was not captured (suspected flaky or timeout, run under load).
- `nx run agent-sdk:test --skip-nx-cache`: exit 0, 146 suites passed, 3131 tests passed, 3 skipped.
- `nx run di-lint:lint`: exit 0.
- `nx run degradation-audit:lint`: exit 0.

Open notes: the first-run test failure is unexplained; the rerun was clean. Task 18.4 is covered by 27.2 (the doc is now split per property).
