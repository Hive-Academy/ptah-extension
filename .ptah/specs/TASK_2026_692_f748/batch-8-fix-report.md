# Batch 8 service defect fixes

## Defect 1: stale idle notice after a new run

Root cause: the reducer closed the old attempt on a changed run token but emitted no `clear-notice` effect. The service retained the old boundary's notice, so a later manual boundary under the same session ID could observe it. The missing transition effect truly belongs in the reducer: it owns attempt and notice lifecycle decisions.

Fix: `idle-session.reducer.ts:59-61` emits `clear-notice` on a new run; `idle-session.reducer.ts:129-131` does the same when a manual PreCompact closes a postcompacted attempt. `idle-compaction.service.ts:185-190` clears notices for every alias in the group, including the ID under which an earlier boundary was recorded. The acting and OBSERVE_ONLY regression rows at `idle-compaction.service.coalesce.spec.ts:150` are now ordinary passing tests, with all assertions retained.

## Defect 2: old group deletes a rebound group's aliases

Root cause: the old group's delayed `finalize` looked up the current alias set by key. If a released session rebound under that key while the old send was unresolved, finalization deleted the new group's aliases and current ID. Also, release left aliases registered until finalization, allowing late feedback to open an unwanted group.

Fix: `idle-compaction.service.ts:112-113` gives each group its own alias-set identity. `idle-compaction.service.ts:155-169` cleans up only while that group still owns the key. `idle-compaction.service.ts:281-285` removes aliases immediately after the release signal reaches the group, before queued feedback can resolve. The rebind regression at `idle-compaction.service.coalesce.spec.ts:266` is now an ordinary passing test, with all assertions retained. The service is 356 lines, below the 500-line limit.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-session.reducer.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction\idle\idle-compaction.service.coalesce.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-8-fix-report.md`

## Verification

- `ptah_get_diagnostics` on the three changed TypeScript files: 0 errors, 0 warnings.
- `NX_NO_CLOUD=true npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/compaction/idle --coverage=false --maxWorkers=2`: 6 suites passed; 71 tests passed; exit 0.
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/agent-sdk --parallel=1`: passed; exit 0.

The first Jest pass after the ownership change exposed the release-feedback gap (2 failed tests). After immediate release cleanup was added, the final scoped Jest and typecheck runs passed. No build, serve, e2e, or workspace-wide check was run.

## Decisions

- Put notice invalidation in the reducer rather than adding signal-specific rules to the service. The reducer already decides when an attempt closes and emits `clear-notice` for input and completed turns; the service owns only the keyed notice storage. This is reversible.
