# PR #521 review fixes report

Task: `TASK_2026_443_40ec`

Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle`

## Item 1 — preserve invalidation after a committed archival eviction

Acceptance spec written first:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.spec.ts:271`
- The spec makes archival eviction commit 500 rows, makes recall eviction throw `RetentionStepError`, then requires the committed count and `markWorkspacesChanged(['/a'])`.

Pre-fix command:

```text
npx nx test @ptah-extension/memory-curator --testPathPatterns=memory-lifecycle.service.spec --runInBand
```

Pre-fix failure:

```text
FAIL memory-curator memory-lifecycle.service.spec.ts
MemoryLifecycleService › invalidates a workspace when archival eviction commits before recall eviction fails
Expected: [["/a"]]
Received: []
Test Suites: 1 failed, 1 total
Tests:       1 failed, 12 passed, 13 total
NX Running target test for project @ptah-extension/memory-curator failed
```

Fix:

- Modified `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.ts`.
- `runEviction` now receives a `markChanged` callback and calls it immediately after each returned batch with `evicted > 0`. Both archival and recall calls add that workspace root through the callback. A later batch or tier can therefore throw without losing invalidation for an earlier committed batch.
- Removed the delayed comparison that ran only after both eviction tiers returned.

Post-fix command: same as pre-fix.

Post-fix pass:

```text
NX Successfully ran target test for project @ptah-extension/memory-curator
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

Archive/delete loop audit: these loops were already safe. Their `consume` callback increments the committed counter and adds every returned `workspaceRoot` immediately after the store batch returns, before a subsequent iteration can throw. A store call that throws does not reach `consume`; its transaction is rolled back, so there is no committed root to invalidate. No archive/delete change was needed.

## Item 2 — invalidate the all-workspace search generation

Acceptance spec written first:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts:645`
- The real-SQLite spec seeds one archival memory in `/workspace-a`, runs lifecycle deletion, and requires the `''` generation to advance.

Pre-fix command:

```text
npx nx test @ptah-extension/memory-curator --testPathPatterns=memory-retention.integration.spec --testNamePattern="advances the unscoped search generation" --runInBand
```

Pre-fix failure:

```text
FAIL memory-curator memory-retention.integration.spec.ts
memory lifecycle — integration › advances the unscoped search generation after a lifecycle delete in a workspace
Expected: 1
Received: 0
Test Suites: 1 failed, 1 total
Tests:       1 failed, 16 skipped, 17 total
NX Running target test for project @ptah-extension/memory-curator failed
```

Fix:

- Modified `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.ts`.
- `markWorkspacesChanged` preserves each scoped generation bump and also bumps `''` once when at least one changed root was supplied. If the iterable already contains `null` or `''`, that existing bump satisfies the unscoped invalidation and is not duplicated.
- `bumpWriteCounter` itself was not changed, so ordinary-write behavior remains unchanged.

Post-fix command: same as pre-fix.

Post-fix pass:

```text
NX Successfully ran target test for project @ptah-extension/memory-curator
Test Suites: 1 passed, 1 total
Tests:       1 passed, 16 skipped, 17 total
```

## Item 3 — report lifecycle-settings fallback

Acceptance spec written first:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts:1065`
- The spec supplies a throwing workspace settings provider and requires both lifecycle defaults and a `lifecycleSettings` read error.

Pre-fix command:

```text
npx nx test @ptah-extension/memory-curator --testPathPatterns=memory-retention.service.spec --testNamePattern="returns lifecycle defaults and a read error" --runInBand
```

Pre-fix failure:

```text
FAIL memory-curator memory-retention.service.spec.ts
MemoryRetentionService — storageHealth › returns lifecycle defaults and a read error when lifecycle settings cannot be read
Matcher error: received value must not be null nor undefined
Received has value: undefined
Test Suites: 1 failed, 1 total
Tests:       1 failed, 50 skipped, 51 total
NX Running target test for project @ptah-extension/memory-curator failed
```

Fix:

- Modified `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-storage-health.ts`.
- The existing fallback catch now appends `lifecycleSettings: <error>` to `readErrors`. The final existing `readErrors.map(input.sanitizeError)` path sanitizes it before it reaches the diagnostics DTO, while the lifecycle defaults remain unchanged.
- The catch annotation is now `degradation-audit: reported` because the fallback is visible to operators.

Post-fix command: same as pre-fix.

Post-fix pass:

```text
NX Successfully ran target test for project @ptah-extension/memory-curator
Test Suites: 1 passed, 1 total
Tests:       1 passed, 50 skipped, 51 total
```

## Item 4 — performance-rule documentation

Modified `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\test-report.md:297`:

```diff
- the rule is `max ≤ 120 OR p95 ≤ 100`
+ the rule is `max ≤ 120 AND p95 ≤ 100`
```

This now agrees with the table and with the reported failure of the 200-row batch.

## Full verification

### Tests

```text
npx nx run-many -t test -p @ptah-extension/memory-curator

NX Running target test for project @ptah-extension/memory-curator:
- @ptah-extension/memory-curator

Test Suites: 2 skipped, 40 passed, 40 of 42 total
Tests:       59 skipped, 645 passed, 704 total
Snapshots:   0 total
NX Successfully ran target test for project @ptah-extension/memory-curator
Exit code: 0
```

### Typecheck

```text
npx nx run-many -t typecheck -p @ptah-extension/memory-curator

NX Running target typecheck for project @ptah-extension/memory-curator:
- @ptah-extension/memory-curator

tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json
NX Successfully ran target typecheck for project @ptah-extension/memory-curator
Exit code: 0
```

### Lint

```text
npx nx run-many -t lint -p @ptah-extension/memory-curator

NX Running target lint for project @ptah-extension/memory-curator:
- @ptah-extension/memory-curator

✖ 5 problems (0 errors, 5 warnings)
NX Successfully ran target lint for project @ptah-extension/memory-curator
Exit code: 0
```

The five warnings are the existing non-null assertion, two existing unused type imports, and two existing max-lines warnings; none is in a file changed for these fixes.

### Degradation audit

```text
npx nx run degradation-audit:lint

degradation-audit: scanned 2848 file(s)
libs/backend/memory-curator: 20 ok (baseline 20)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX Successfully ran target lint for project degradation-audit
Exit code: 0
```

No per-library baseline grew.

### Electron / better-sqlite3

```text
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/memory-curator/jest.config.ts --testPathPatterns '"memory-retention|memory-lifecycle|memory.store.spec"' --runInBand

Test Suites: 42 passed, 42 total
Tests:       704 passed, 704 total
Snapshots:   0 total
Ran all test suites matching memory-retention|memory-lifecycle|memory.store.spec.
Exit code: 0
```

## Cross-batch constraints

- XB1: the item 1 and item 3 specs prepare no SQL. The item 2 integration spec uses the existing `seedMemory` helper, whose prepared insert statements bind every placeholder; the new spec adds no raw or partially-bound SQL.
- XB2: no new fail-open catch was added. The existing lifecycle-settings catch now carries `// degradation-audit: reported - ...`, and the audit passed with `libs/backend/memory-curator: 20 ok (baseline 20)`.
- XB3: governor sequencing is unchanged. `beforeBatch` remains `hardStop()` → `memoryRowRoom()` → `waitForGovernor()`, and only after it returns does either loop execute its batch. The eviction callback runs after the committed store batch returns and does not move or bypass the wait.

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-lifecycle.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\memory.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.integration.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-storage-health.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\memory-curator\src\lib\retention\memory-retention.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\test-report.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\pr-521-fixes-report.md`
