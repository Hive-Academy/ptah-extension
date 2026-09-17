# Background-Work Governor Wait Report — `TASK_2026_440_834c`

Retention job (`@ptah/memory-retention`) yields to the background-work governor before each write batch (purge, quarantine, ledger prune, and page reclaim steps).

---

## 1. Design Choices & Implementation

All changes are strictly scoped to `libs/backend/memory-curator/`.

### `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts`
- **Lane & Admission Contract** (`:48`, `:58`):
  Imported `type BackgroundWorkAdmission` from `@ptah-extension/vscode-core` and declared `const GOVERNOR_LANE = 'memory-retention'`.
- **Constructor Injection** (`:120-121`):
  Added optional 7th parameter `@inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true }) private readonly governor: BackgroundWorkAdmission | null = null`. Placing this parameter last ensures complete backward-compatibility with all existing tests constructing `MemoryRetentionService` directly with positional arguments.
- **`yieldToGovernor` Helper** (`:550-577`):
  Private helper that fast-paths when `this.governor === null || this.governor.isClear()`. When governor is active/busy, awaits `this.governor.whenClear({ signal, lane: GOVERNOR_LANE })`.
  - On `AbortError`: resolves `'aborted'`, triggering an immediate clean halt.
  - On unexpected error: logs a warning once (`[memory-curator] background-work wait failed — continuing retention anyway`) and fails open by returning `'continue'`.
- **`yieldGovernor` Closure** (`:355-363`):
  Wraps `yieldToGovernor` in `execute()`, immediately checking `hardStop()` if wait consumed the wall clock (`now() >= deadline`), returning `'time-budget'` so the run records as `partial` with `backlogRemaining: true`.
- **Batch Yield Placements**:
  - Purge batches (`:379`): Before each `this.store.purgeProcessedBatch`.
  - Quarantine batches (`:414`): Before each `this.store.quarantineStuckBatch`.
  - Ledger prune (`:444`): Before `this.store.pruneLedger`.
  - Page reclaim (`:497`, `:509`): Passed into `reclaimPages` and awaited before each `this.reclaimer.reclaimStep`.

### `libs/backend/memory-curator/CLAUDE.md`
- Added the retention governor wait convention under Background Work & Performance.

---

## 2. Files Changed (Absolute Paths)

- `D:\projects\ptah-extension\.claude-worktrees\task-440-review-fixes\libs\backend\memory-curator\CLAUDE.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-review-fixes\libs\backend\memory-curator\src\lib\di\register.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-review-fixes\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-review-fixes\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-review-fixes\libs\backend\memory-curator\src\lib\retention\memory-retention.service.ts`

---

## 3. Specs Added

### DI Registration Spec
`libs/backend/memory-curator/src/lib/di/register.spec.ts`:
- `injects TOKENS.BACKGROUND_WORK_GOVERNOR into MemoryRetentionService when registered`

### Service Unit Specs
`libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts` (`describe('MemoryRetentionService — background-work governor')`):
- `waits when governor is busy; no batch runs until cleared`
- `ends as partial with time-budget and backlog remaining when wait consumes the wall budget`
- `cleanly stops with aborted outcome when governor aborts; earlier committed batches are preserved`
- `fails open and continues run when governor rejects unexpectedly, logging warn once`
- `proceeds when governor times out`

### Real SQLite Integration Spec
`libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts`:
- `waits on governor before purging rows from real SQLite`

---

## 4. Verification & Command Outputs

### 1. Nx Test
```
npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/thoth-runtime
```
**Output:**
```
 NX   Running target test for 2 projects:

- @ptah-extension/memory-curator
- @ptah-extension/thoth-runtime

Test Suites: 5 passed, 5 total
Tests:       90 passed, 90 total
Snapshots:   0 total
Time:        39.073 s, estimated 96 s
Ran all test suites.

> nx run @ptah-extension/memory-curator:test

 PASS   memory-curator  libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/embedder/embedder-worker-client.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory.store.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-search.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/observation-queue.store.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/observation-queue.store.rekey.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-decay.job.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-writer.dedup-parity.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.integration.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.coalesce.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/knowledge-agents/knowledge-agent.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-writer.adapter.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/diagnostics.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.boot-defer.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/transcript-windows.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/clamp-transcript.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-curator.admission.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/workspace-fingerprint.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/queue-slot-timeout.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/episode-tracker.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/boot-scan-scheduler.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/knowledge-agents/corpus-filter.util.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/fts-query.util.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/embedder/embedder-status.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/di/register.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.boot-scan-budget.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/retention/observation-retention.store.spec.ts

Test Suites: 2 skipped, 37 passed, 37 of 39 total
Tests:       59 skipped, 584 passed, 643 total
Snapshots:   0 total
Time:        26.202 s
Ran all test suites.

 NX   Successfully ran target test for 2 projects
```

### 2. Nx Typecheck
```
npx nx run-many -t typecheck -p @ptah-extension/memory-curator @ptah-extension/thoth-runtime
```
**Output:**
```
 NX   Running target typecheck for 2 projects:

- @ptah-extension/memory-curator
- @ptah-extension/thoth-runtime

> nx run @ptah-extension/memory-curator:typecheck
> tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json

> nx run @ptah-extension/thoth-runtime:typecheck
> tsc --noEmit --project libs/backend/thoth-runtime/tsconfig.lib.json

 NX   Successfully ran target typecheck for 2 projects
```

### 3. Nx Lint
```
npx nx run-many -t lint -p @ptah-extension/memory-curator @ptah-extension/thoth-runtime
```
**Output:**
```
 NX   Running target lint for 2 projects:

- @ptah-extension/memory-curator
- @ptah-extension/thoth-runtime

> nx run @ptah-extension/thoth-runtime:lint
Linting "@ptah-extension/thoth-runtime"...
✔ All files pass linting

> nx run @ptah-extension/memory-curator:lint
Linting "@ptah-extension/memory-curator"...
✖ 6 problems (0 errors, 6 warnings)

 NX   Successfully ran target lint for 2 projects
```
*(All 6 warnings are pre-existing in unrelated files: `memory-decay.job.spec.ts`, `memory-search.service.ts`, `memory-search.service.spec.ts`, `memory-trigger.coalesce.spec.ts`, and `memory-trigger.service.ts`. None in touched files.)*

### 4. Real better-sqlite3 / Electron Test Runner
```
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns retention register --runInBand
```
**Output:**
```
PASS memory-curator libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts
PASS memory-curator libs/backend/memory-curator/src/lib/di/register.spec.ts
PASS memory-curator libs/backend/memory-curator/src/lib/retention/observation-retention.store.spec.ts
PASS memory-curator libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts

Test Suites: 4 passed, 4 total
Tests:       69 passed, 69 total
Snapshots:   0 total
Time:        5.218 s
Ran all test suites matching retention|register.
```

---

## 5. Git Diff Stat

```
 libs/backend/memory-curator/CLAUDE.md              |   1 +
 .../memory-curator/src/lib/di/register.spec.ts     |  12 ++
 .../retention/memory-retention.integration.spec.ts |  53 ++++-
 .../lib/retention/memory-retention.service.spec.ts | 216 ++++++++++++++++++++-
 .../src/lib/retention/memory-retention.service.ts  |  93 ++++++++-
 5 files changed, 364 insertions(+), 11 deletions(-)
```

---

## Revision 1

Address two review findings:
1. **Wall budget enforcement during governor wait** (`libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:319`, `:359-363`, `:553`, `:559-565`):
   - Defined `msLeft = (): number => deadline - now()`.
   - Threaded `msLeft` into `yieldToGovernor`.
   - In `yieldToGovernor`:
     - If `remainingMs <= 0`, skips calling `whenClear` and returns immediately so `hardStop()` yields `time-budget`.
     - Otherwise, passes `maxDeferMs: Math.max(1, remainingMs)` into `governor.whenClear(...)`.
     - When governor resolves `'timeout'`, execution proceeds to `hardStop()`, which ends the run as `partial` / `time-budget` with backlog remaining.
2. **Stop reason precedence in page reclaim** (`libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:463`):
   - Restored precedence to `if (reclaim.stop && stop === null)` so that a preceding `row-budget` stop is preserved when reclaim stops on its own budget (`reclaim-budget`).
   - Retained the entry guard `if (continueAfterRows && (stop === null || stop === 'row-budget'))` that skips reclaim when ledger prune stopped on `aborted` or `time-budget`.

### Specs Added / Updated

`libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts`:
- Tightened: `ends as partial with time-budget and backlog remaining when wait consumes the wall budget` (asserts `waitOpts?.maxDeferMs` is defined, ≤ `maxRunMs`, > 0, and not the 600,000 ms default; resolves `'timeout'` at that ceiling and verifies `partial` / `time-budget` with backlogRemaining).
- Added: `preserves row-budget reason when purge hits row cap and reclaim stops on reclaim budget` (asserts report `reason` is `row-budget`).
- Added: `skips governor whenClear call when deadline has already passed` (asserts `whenClear` is not invoked and report reason is `time-budget`).

### Verification & Command Outputs

#### 1. Nx Test
```
npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/thoth-runtime
```
**Output:**
```
 NX   Running target test for 2 projects:

- @ptah-extension/memory-curator
- @ptah-extension/thoth-runtime

Test Suites: 5 passed, 5 total
Tests:       90 passed, 90 total
Snapshots:   0 total
Time:        44.724 s
Ran all test suites.

> nx run @ptah-extension/memory-curator:test

Test Suites: 2 skipped, 37 passed, 37 of 39 total
Tests:       59 skipped, 586 passed, 645 total
Snapshots:   0 total
Time:        25.531 s
Ran all test suites.

 NX   Successfully ran target test for 2 projects
```

#### 2. Nx Typecheck
```
npx nx run-many -t typecheck -p @ptah-extension/memory-curator @ptah-extension/thoth-runtime
```
**Output:**
```
 NX   Running target typecheck for 2 projects:

- @ptah-extension/memory-curator
- @ptah-extension/thoth-runtime

> nx run @ptah-extension/memory-curator:typecheck
> tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json

> nx run @ptah-extension/thoth-runtime:typecheck
> tsc --noEmit --project libs/backend/thoth-runtime/tsconfig.lib.json

 NX   Successfully ran target typecheck for 2 projects
```

#### 3. Nx Lint
```
npx nx run-many -t lint -p @ptah-extension/memory-curator @ptah-extension/thoth-runtime
```
**Output:**
```
 NX   Running target lint for 2 projects:

- @ptah-extension/memory-curator
- @ptah-extension/thoth-runtime

> nx run @ptah-extension/thoth-runtime:lint
✔ All files pass linting

> nx run @ptah-extension/memory-curator:lint
Linting "@ptah-extension/memory-curator"...
✖ 6 problems (0 errors, 6 warnings)

 NX   Successfully ran target lint for 2 projects
```

#### 4. Real better-sqlite3 / Electron Test Runner
```
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"src/lib/retention|di/register"' --runInBand
```
**Output:**
```
PASS memory-curator libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts
PASS memory-curator libs/backend/memory-curator/src/lib/di/register.spec.ts
PASS memory-curator libs/backend/memory-curator/src/lib/retention/observation-retention.store.spec.ts
PASS memory-curator libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts

Test Suites: 4 passed, 4 total
Tests:       71 passed, 71 total
Snapshots:   0 total
Time:        7.053 s
Ran all test suites matching src/lib/retention|di/register.
```

### Git Diff Stat

```
 libs/backend/memory-curator/CLAUDE.md              |   1 +
 .../memory-curator/src/lib/di/register.spec.ts     |  12 +
 .../retention/memory-retention.integration.spec.ts |  53 +++-
 .../lib/retention/memory-retention.service.spec.ts | 268 ++++++++++++++++++++-
 .../src/lib/retention/memory-retention.service.ts  | 104 +++++++-
 5 files changed, 427 insertions(+), 11 deletions(-)
```

