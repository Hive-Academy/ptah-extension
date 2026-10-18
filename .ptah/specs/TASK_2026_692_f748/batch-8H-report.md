# Batch 8H report

## Task 8H.1

- `CompactionConfigProvider` now resolves and validates the two shared idle defaults in its constructor, alongside `budgetDefaults`, and stores them in readonly fields. The existing error messages and default keys are unchanged.
- `getIdleCompactionConfig()` still reads live settings on each call. Missing or invalid live values use the stored defaults and cannot trigger the former shared-default throws on read. The 5,000,000 upper bound was not changed.
- Added constructor regression cases for each missing shared idle default and a case that changes live values after construction, checking non-boolean and invalid token values fall back without throwing. Existing invalid-value cases also cover non-integer and below-100,000 values.
- This resolves F1's provider throw-on-read: a malformed static shared default fails when the provider is constructed, before an idle session pipeline uses it. The separate per-signal containment fix belongs to Batch 8G.

## Verification

- `NX_NO_CLOUD=true npx nx test @ptah-extension/agent-sdk --parallel=1 -- --maxWorkers=2` (filtered `Tests:|Test Suites:|FAIL|failed`, exit 0):
  ```text
  (node:37756) Warning: Failed to load the ES module: ...\jest.config.ts.
  A worker process has failed to exit gracefully and has been force exited.
  Test Suites: 2 skipped, 169 passed, 169 of 171 total
  Tests:       3 skipped, 3598 passed, 3601 total
  ```
- `NX_NO_CLOUD=true npx nx typecheck @ptah-extension/agent-sdk --parallel=1` (last 15 lines, exit 0):
  ```text
  > tsc --noEmit --project libs/backend/agent-sdk/tsconfig.lib.json
  NX   Successfully ran target typecheck for project @ptah-extension/agent-sdk
  Run duration: 6.9s
  Cache: 0/1 hit (0%)
  ```
- `NX_NO_CLOUD=true npx nx lint @ptah-extension/agent-sdk --parallel=1` (last 20 lines, exit 0):
  ```text
  ✖ 75 problems (0 errors, 75 warnings)
  NX   Successfully ran target lint for project @ptah-extension/agent-sdk
  Run duration: 8.4s
  Cache: 0/1 hit (0%)
  ```
- Scoped `ptah_get_diagnostics` after formatting: 0 errors, 0 warnings, clean coverage.
- Both edited TypeScript files have LF endings and are under 500 lines (309 and 379 lines).

## Decisions

- Stored idle defaults in two readonly fields, following the existing constructor-resolved budget default pattern. A map or helper would add structure for only two differently typed values. This is reversible.

## Files created or modified

- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\libs\backend\agent-sdk\src\lib\helpers\compaction-config-provider.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\idle-compaction\.ptah\specs\TASK_2026_692_f748\batch-8H-report.md`
