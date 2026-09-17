# Batch 7 Task 7.5 — retention reclaim constants

## Status

PASS. The measured production-pragmas values are applied: the reclaim step starts at 256 pages and adaptively floors at 64 pages. The 32,768-page per-run cap is unchanged. No A2 checkpoint mitigation was added.

## Changes

- `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts:63-70`
  - Old: `Initial incremental_vacuum step (8 MB at 4 KB pages)` with `RETENTION_RECLAIM_PAGES_PER_STEP = 2_048`.
  - New: `Initial incremental_vacuum step (1 MB at 4 KB pages)` with `RETENTION_RECLAIM_PAGES_PER_STEP = 256`; the doc comment records that halving resets per run, the initial step must remain below 120 ms, and Task 7.4 measured p95 44 ms on a 1.18 GB copy under production pragmas.
  - Old: `Floor for the adaptive reclaim step` with `RETENTION_MIN_RECLAIM_PAGES_PER_STEP = 256`.
  - New: `Adaptive floor for the reclaim step` with `RETENTION_MIN_RECLAIM_PAGES_PER_STEP = 64`.
- `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts:72`
  - Unchanged: `RETENTION_MAX_RECLAIM_PAGES_PER_RUN = 32_768`.
- `libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts:272-275`
  - Old: no direct regression assertion for the measured defaults.
  - New: asserts `MEMORY_RETENTION_LIMITS.reclaimPagesPerStep === 256` and `minReclaimPagesPerStep === 64`.
- `libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts:473-478`
  - Old: test name ended in `down to 256`; expected `[2048, 1024, 512, 256, 256]`.
  - New: test name ends in `down to 64`; the default-backed harness expects `[256, 128, 64, 64]`.
- `libs/backend/memory-curator/CLAUDE.md:83`
  - Old: `the reclaim step (floor 256)`.
  - New: `the reclaim step (starts at 256 pages, floor 64)`.
  - No other text in the paragraph changed.

## Scoped grep

Command:

```powershell
rg -n -i --glob '!node_modules/**' --glob '!dist/**' --glob '!coverage/**' '(reclaim[^\r\n]{0,100}(2048|2,048|8 MB|floor 256)|(?:2048|2,048|8 MB)[^\r\n]{0,100}reclaim|reclaim step \(floor 256\))' 'D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator' 'D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime'
```

Result after edits: no matches (`rg` exit 1, normalized by the wrapper to `STALE_RECLAIM_GREP: no matches`). Unrelated 2048 values were not changed. The thoth-runtime `incremental_vacuum` log-message assertion does not state a size or floor and was left unchanged.

## Verification

Required command:

```powershell
npx nx run-many -t typecheck test lint --parallel=1 -p @ptah-extension/memory-curator
```

The header confirmed exactly one project:

```text
NX   Running targets typecheck, test, lint for project @ptah-extension/memory-curator:

- @ptah-extension/memory-curator
```

First invocation: exit 1 after an unrelated transient timeout in `src/lib/triggers/boot-scan-runner.spec.ts` (`BootScanRunner › aborts mid-scan when AbortSignal triggers`, 5,000 ms timeout). Typecheck passed; lint completed with 0 errors and 6 existing warnings. Summary:

```text
Test Suites: 1 failed, 2 skipped, 34 passed, 35 of 37 total
Tests:       1 failed, 59 skipped, 550 passed, 610 total
NX   Running targets typecheck, test, lint for project @ptah-extension/memory-curator failed
Failed tasks:
- @ptah-extension/memory-curator:test
```

Exact-command rerun: exit 0. Nx identified the preceding test target failure as flaky. Output:

```text
Test Suites: 2 skipped, 35 passed, 35 of 37 total
Tests:       59 skipped, 551 passed, 610 total
Snapshots:   0 total
Time:        27.887 s
Ran all test suites.

> nx run @ptah-extension/memory-curator:typecheck
> tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json

> nx run @ptah-extension/memory-curator:lint
✖ 6 problems (0 errors, 6 warnings)

NX   Successfully ran targets typecheck, test, lint for project @ptah-extension/memory-curator
Nx read the output from the cache instead of running the command for 1 out of 3 tasks.
NX   Nx detected a flaky task
@ptah-extension/memory-curator:test
```

Per-file Jest JSON confirmation:

```text
memory-retention.service.spec.ts
success: True
suites: 1
tests: 31
passed: 31
failed: 0
skipped: 0
exitCode: 0

memory-retention.integration.spec.ts
success: True
suites: 1
tests: 5
passed: 5
failed: 0
skipped: 0
exitCode: 0
```

Both commands used `--runInBand --json` with their respective `--testPathPatterns`. `git diff --check` also passed with no output.
