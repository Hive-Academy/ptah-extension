# Batch 1 Report — Migration 0044 Memory Lifecycle

## Task completion

### Task 1.1 — Migration 0044 and migration ratchets

Completed.

Evidence:

- Added forward-only, static migration `0044_memory_lifecycle` as plain `sql`; it is not vec-gated and has no imperative `run` function.
- Appended version 44 to `MIGRATIONS` after version 43 without changing any older migration SQL or comments.
- Added `archived_at`, dropped the two obsolete indexes before the rebase updates, created all three lifecycle/corpus indexes, applied both specified salience rebase updates, and added all nine retention-state columns exactly as specified in Component 1.
- Added real-SQLite coverage that opens only a fresh temporary database, applies all base SQL migrations through version 43, and fails rather than skips if neither `better-sqlite3` nor `node:sqlite` is available.
- The behavioral spec proves the required salience values (`0.75 -> 0.30`, `1.9 -> 1.0`, `0.5 -> 0.05`, sessionless `0.6 -> 0.6`, pinned `1.0 -> 1.0`), archival-only timestamp backfill, old/new index state, and the defaults/nullability of all nine new run-record columns.
- Bumped all eight migration-version ratchets from 43 to 44.

## Files

Created:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0044_memory_lifecycle.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0044_memory_lifecycle.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\.ptah\specs\TASK_2026_443_40ec\batch-1-report.md`

Modified:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0028_gateway_conversation_workspace_root.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0030_skill_event_metrics.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0038_gateway_message_turn_state.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0039_reap_orphaned_queue_rows.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0040_skill_candidate_workspace_root.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0041_skill_md_migration_state.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0042_db_integrity_check_state.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0043_memory_retention.spec.ts`

No files outside Batch 1 ownership were modified. `batches.md` was not edited.

## Verification

### Test

Command:

```text
npx nx run-many -t test -p @ptah-extension/persistence-sqlite
```

Nx header and project count:

```text
NX   Running target test for project @ptah-extension/persistence-sqlite:

- @ptah-extension/persistence-sqlite
```

The installed Nx version rendered the one-project header with singular `project`; the header listed exactly one project.

Observed result:

```text
Test Suites: 9 skipped, 30 passed, 30 of 39 total
Tests:       80 skipped, 399 passed, 479 total
Snapshots:   0 total
Time:        60.219 s, estimated 65 s
Ran all test suites.

NX   Successfully ran target test for project @ptah-extension/persistence-sqlite
```

The nine skipped suites are existing native `better-sqlite3` ABI-dependent suites. The new 0044 suite follows the required `better-sqlite3` -> `node:sqlite` fallback and contains an explicit binding assertion, so it did not silently skip.

### Typecheck

Command:

```text
npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite
```

Nx header and project count:

```text
NX   Running target typecheck for project @ptah-extension/persistence-sqlite:

- @ptah-extension/persistence-sqlite
```

Observed result:

```text
> tsc --noEmit --project libs/backend/persistence-sqlite/tsconfig.lib.json

NX   Successfully ran target typecheck for project @ptah-extension/persistence-sqlite
```

### Lint

Command:

```text
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite
```

Nx header and project count:

```text
NX   Running target lint for project @ptah-extension/persistence-sqlite:

- @ptah-extension/persistence-sqlite
```

Observed result:

```text
Linting "@ptah-extension/persistence-sqlite"...

All files pass linting

NX   Successfully ran target lint for project @ptah-extension/persistence-sqlite
```

An earlier lint run identified a dynamic template literal in test fixture data under the migrations directory. The fixture was changed to a static string, and all three commands above were rerun after that correction. The outputs above are the final runs.

## Assumptions and risks

### Assumptions

| Assumption | Batch 1 handling |
| --- | --- |
| A1 sqlite-vec loading in later store/integration specs | Not exercised by this non-vec-gated migration. The 0044 spec applies base SQL only and requires a real SQLite binding through the established opener fallback. |
| A2 lifecycle batch timing under the production binding | Outside Batch 1. No timing claim was made and no production database or snapshot was opened. |
| A3 ranked statements bind `now` correctly | Outside Batch 1; this batch changes schema and stored values only. |
| A4 only the lifecycle store sets `tier = 'archival'` | The migration backfills every pre-existing archival row exactly once; the spec proves archival rows receive `archived_at` while recall rows remain null. |
| A5 production snapshot remains unchanged | Preserved. This batch never opened, copied, inspected, or modified the snapshot or any user Ptah database. Tests used fresh OS temporary files only. |

### Validation risks

| Risk | Batch 1 handling |
| --- | --- |
| R-TL1 restore detection in `recordUse` | Outside Batch 1; no domain query or usage recorder was touched. |
| R-TL2 DTO fields crossing batch commits | Outside Batch 1; no memory-curator DTO was touched. |
| R-TL3 decay field removal ordering | Outside Batch 1; no removed symbol or shared/frontend contract was touched. |
| R-TL4 wizard seed missing `archived_at` binding | Batch 1 provides the required additive column. The later writer/schema fixture update remains assigned to Task 3.3. |
| R-TL5 timing accidentally touches live/snapshot data | Avoided: no timing harness or migration runner was run against user data, and no forbidden database/snapshot path was opened. |
| R-TL6 parallel batches transiently interfere | File-disjoint ownership was maintained: only persistence-sqlite migration files and this report were touched. Final checks passed in the shared worktree. |
| R-TL7 local timing spec enters Jest/commit | Not applicable; no timing spec was created. |
| R-TL8 pre-existing load flakes | Not observed in final commands; no serial rerun was needed. |
| R-TL9 vec test-support file breaks typecheck | Not applicable; no test-support file was created and typecheck passed. |
| R-TL10 retention service exceeds line ceiling | Outside Batch 1; no retention service file was touched. |
| R1 contentless FTS drift after deletes | Outside scope and unaffected by this additive migration. |
| R2 cap deletes begin after grace | Outside Batch 1; no delete policy was implemented. |
| R3 first run archives a large backlog | This batch provides the reversible lifecycle storage (`archived_at`) only; runtime batching remains in later tasks. |
| R4 vec unavailable makes deletes unsafe | Migration 0044 is explicitly not vec-gated and performs no deletes. |
| R5 migration boot cost | The SQL follows the measured plan order: obsolete indexes are dropped before the rebase updates, and `observation_queue` is not scanned. Formal snapshot timing remains Task 10.3. |
| R6 unscoped `memory:list` loses its tier index | The old tier index is deliberately replaced by the two lifecycle composite indexes exactly as planned; remeasurement remains Task 10.3. |
| R7 `better-sqlite3` timing unmeasured | No unsupported timing claim was made. The behavior suite fell back to real `node:sqlite` because the installed native ABI differs from the current Node ABI. |
| R8 prompt-path usage writes | Outside Batch 1; no prompt-path code was touched. |
| R9 wizard key-file duplicate after archival | Accepted out of scope by the plan; no wizard code was touched. |
| R10 two hosts share the file | This static migration relies on the existing migration runner transaction/ledger; no parallel writer path was introduced. |

### Edge cases

- The Batch 1 edge case “M counted from `archived_at`, never from `last_used_at`” is enabled by adding `archived_at` and backfilling it to migration time for every pre-existing archival row. The spec proves a seeded archival row receives a non-null timestamp independently of its seeded `last_used_at`.
- All other listed edge cases belong to later lifecycle store/service/host batches. This batch did not preempt those contracts or add behavior outside the migration.

## Plan deviations

None. The SQL body matches Component 1 exactly, remains static and non-vec-gated, and older migration SQL/comments remain unchanged.

## Out-of-scope observations

- Existing native `better-sqlite3` suites reported a Node module ABI mismatch and skipped by their established behavior; the new migration suite used `node:sqlite` and ran successfully.
- Nx printed its existing “AI agent configuration is outdated” advisory after commands; it did not affect any target result and is outside this batch.

## Revision 1

Revision 1 applied the approved five-item test/comment fix list. Final production SQL in `0044_memory_lifecycle.ts` and the registry in `migrations/index.ts` were not changed.

### Fix-list evidence

1. **M1 — clamp UPDATE coverage:** Added pinned salience `1.7`, sessionless unpinned salience `-0.2`, and sessionless unpinned salience `1.3` fixtures. After migration they are asserted as `1.0`, `0.0`, and `1.0`.
2. **M2 — epoch-ms scale:** The spec records the current second immediately before migration execution and `Date.now()` after execution. It asserts the archival timestamp is an integer, divisible by 1000, and inside that time window.
3. **m3 — archival preservation:** The archival fixture retains `tier = 'archival'` and salience `0.6` while gaining its timestamp.
4. **m4 — provenance:** All eight version-check specs retain the version-43 history and add `44 since TASK_2026_443 appended 0044_memory_lifecycle.`
5. **XB1 — bound parameters:** The memory insert has six positional placeholders and supplies all six arguments. The suite also passes under Electron's stricter `better-sqlite3` binding.

Revision files modified:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0044_memory_lifecycle.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0028_gateway_conversation_workspace_root.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0030_skill_event_metrics.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0038_gateway_message_turn_state.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0039_reap_orphaned_queue_rows.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0040_skill_candidate_workspace_root.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0041_skill_md_migration_state.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0042_db_integrity_check_state.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase2-memory-lifecycle\libs\backend\persistence-sqlite\src\lib\migrations\0043_memory_retention.spec.ts`

### Mutation check

The clamp UPDATE was temporarily deleted, the focused suite was run, and the exact SQL was immediately restored. The expected failure was:

```text
FAIL persistence-sqlite libs/backend/persistence-sqlite/src/lib/migrations/0044_memory_lifecycle.spec.ts
Expected: 1
Received: 1.7
at expect(byId.get('pinned-high')?.salience).toBe(1)

Test Suites: 1 failed, 1 total
Tests:       1 failed, 5 passed, 6 total
Snapshots:   0 total
Ran all test suites matching 0044_memory_lifecycle.
```

This proves deletion of the clamp UPDATE is detected. After restoring it, the required verbose run passed with zero skipped:

```text
npx jest --config libs/backend/persistence-sqlite/jest.config.ts --testPathPatterns=0044_memory_lifecycle --verbose

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Snapshots:   0 total
Time:        5.976 s, estimated 8 s
Ran all test suites matching 0044_memory_lifecycle.
```

### Electron / better-sqlite3 verification

The worktree has no local `node_modules`, so the command used the equivalent absolute parent installation paths:

```text
$env:ELECTRON_RUN_AS_NODE='1'; & 'D:\projects\ptah-extension\node_modules\.bin\electron.cmd' 'D:\projects\ptah-extension\node_modules\jest\bin\jest.js' --config libs/backend/persistence-sqlite/jest.config.ts --testPathPatterns 0044_memory_lifecycle --runInBand

Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Snapshots:   0 total
Time:        5.855 s, estimated 6 s
Ran all test suites matching 0044_memory_lifecycle.
```

A direct Electron-as-Node in-memory opener probe printed `binding=better-sqlite3`. Because `resolveOpener()` tries `better-sqlite3` first, the Electron suite used **better-sqlite3**.

### Final Nx verification

```text
npx nx run-many -t test -p @ptah-extension/persistence-sqlite

NX   Running target test for project @ptah-extension/persistence-sqlite:
- @ptah-extension/persistence-sqlite

Test Suites: 9 skipped, 30 passed, 30 of 39 total
Tests:       80 skipped, 399 passed, 479 total
Snapshots:   0 total
Time:        77.988 s
Ran all test suites.

NX   Successfully ran target test for project @ptah-extension/persistence-sqlite
```

The nine skips are unchanged pre-existing Node/native-ABI-dependent suites. The focused 0044 run above independently shows 0 skipped.

```text
npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite

NX   Running target typecheck for project @ptah-extension/persistence-sqlite:
- @ptah-extension/persistence-sqlite

> tsc --noEmit --project libs/backend/persistence-sqlite/tsconfig.lib.json

NX   Successfully ran target typecheck for project @ptah-extension/persistence-sqlite
```

```text
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite

NX   Running target lint for project @ptah-extension/persistence-sqlite:
- @ptah-extension/persistence-sqlite

Linting "@ptah-extension/persistence-sqlite"...
All files pass linting

NX   Successfully ran target lint for project @ptah-extension/persistence-sqlite
```

Each Nx header lists exactly one project.

### Diff evidence

```text
git diff --stat -- libs/backend/persistence-sqlite

.../0028_gateway_conversation_workspace_root.spec.ts | 3 ++-
.../0030_skill_event_metrics.spec.ts                 | 3 ++-
.../0038_gateway_message_turn_state.spec.ts          | 3 ++-
.../0039_reap_orphaned_queue_rows.spec.ts            | 3 ++-
.../0040_skill_candidate_workspace_root.spec.ts      | 3 ++-
.../0041_skill_md_migration_state.spec.ts            | 3 ++-
.../0042_db_integrity_check_state.spec.ts            | 3 ++-
.../0043_memory_retention.spec.ts                    | 4 +++-
libs/backend/persistence-sqlite/src/lib/migrations/index.ts | 6 ++++++
9 files changed, 23 insertions(+), 8 deletions(-)
```

This folder-level stat is cumulative from HEAD: `index.ts` is the original approved Batch 1 registry addition and remains uncommitted; ordinary `git diff --stat` omits the two untracked 0044 files. Revision 1 did not change `index.ts`, and the temporary SQL mutation was restored. Restricting the stat to tracked Revision 1 ratchet specs shows only spec files:

```text
.../0028_gateway_conversation_workspace_root.spec.ts | 3 ++-
.../0030_skill_event_metrics.spec.ts                 | 3 ++-
.../0038_gateway_message_turn_state.spec.ts          | 3 ++-
.../0039_reap_orphaned_queue_rows.spec.ts            | 3 ++-
.../0040_skill_candidate_workspace_root.spec.ts      | 3 ++-
.../0041_skill_md_migration_state.spec.ts            | 3 ++-
.../0042_db_integrity_check_state.spec.ts            | 3 ++-
.../0043_memory_retention.spec.ts                    | 4 +++-
8 files changed, 17 insertions(+), 8 deletions(-)
```

Final status lists `0044_memory_lifecycle.spec.ts` and `0044_memory_lifecycle.ts` as the original untracked Batch 1 files. No app, agent-sdk, vscode-lm-tools, memory-contracts, or platform-core file was changed by Revision 1.
