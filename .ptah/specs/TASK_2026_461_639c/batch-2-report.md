# Batch 2 report — persistence-sqlite migration 0045

## Backend implementation — `TASK_2026_461_639c`, batch 2

**Tasks completed**: Task 2.1 — migration `0045_skill_backlog_cleanup`, real-SQLite spec, registry append, and nine migration-version ratchets.

**Files**:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\persistence-sqlite\src\lib\migrations\0045_skill_backlog_cleanup.ts` — static, idempotent one-row cleanup-state table with seven zero-defaulted counters.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\persistence-sqlite\src\lib\migrations\0045_skill_backlog_cleanup.spec.ts` — registry, static-SQL, idempotency, schema/default, and single-row CHECK coverage against real SQLite.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\persistence-sqlite\src\lib\migrations\index.ts` — appended plain-SQL migration version 45.
- MODIFIED the nine assigned ratchet specs (`0028`, `0030`, `0038`, `0039`, `0040`, `0041`, `0042`, `0043`, `0044`) — highest bundled migration 44 → 45 with provenance comments only; no shipped migration SQL changed.

**Stack observed**: Node 24 (`.nvmrc`), TypeScript 5.9 and Nx 22.6.5 (`package.json`), Jest 30 with ts-jest (`libs/backend/persistence-sqlite/jest.config.ts`), forward-only append-only SQLite migrations (`libs/backend/persistence-sqlite/CLAUDE.md`), and dual real-SQLite coverage through `node:sqlite` plus Electron's `better-sqlite3` binding.

**Plan deviations**: none in source. Verification used `NX_DAEMON=false` without `nx reset` to avoid the shared daemon. The worktree resolves tooling from `D:\projects\ptah-extension\node_modules`; the Electron binding command explicitly used the main checkout as required by HANDOFF rule 3. The run killed during the machine-wide hold was discarded and is not counted below.

**Out-of-scope observations**: the concurrent Batch 1 lane modified only `libs/backend/skill-synthesis`; those files and unrelated pre-existing task-document changes were not touched. The designated separate-model reviewer remains an orchestrator step; this batch lane did not manufacture a reviewer verdict.

## Implementation checks

- `ptah_get_diagnostics` before edits: `Errors: 0 | Warnings: 0`.
- `ptah_get_diagnostics` after edits: `Errors: 0 | Warnings: 0`.
- `git diff --check -- libs/backend/persistence-sqlite/src/lib/migrations`: exit 0, no output.
- Migration 0045 is one `CREATE TABLE IF NOT EXISTS`; it contains no INSERT, UPDATE, DELETE, index, backfill, outcome CHECK, or template interpolation.
- Every prepared statement in the new spec binds every positional parameter.

## Batch 2 verification

### Test — one project

Command:

```powershell
$env:NX_DAEMON='false'
npx nx run-many -t test -p @ptah-extension/persistence-sqlite --outputStyle=static
```

Project header and result:

```text
NX   Running target test for project @ptah-extension/persistence-sqlite:

- @ptah-extension/persistence-sqlite

Test Suites: 9 skipped, 32 passed, 32 of 41 total
Tests:       80 skipped, 438 passed, 518 total
Snapshots:   0 total
Time:        57.301 s, estimated 74 s
Ran all test suites.

NX   Successfully ran target test for project @ptah-extension/persistence-sqlite
```

Nx 22.6.5 renders the one-project header in the singular (`for project`); the header lists exactly the one requested project. The skipped suites are pre-existing native-only suites whose ordinary Node process cannot load the Electron-ABI native module. The migration specs required by this batch did execute; the explicit Electron run below proves the other binding.

### Typecheck — one project

Command:

```powershell
$env:NX_DAEMON='false'
npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite --outputStyle=static
```

```text
NX   Running target typecheck for project @ptah-extension/persistence-sqlite:

- @ptah-extension/persistence-sqlite

> tsc --noEmit --project libs/backend/persistence-sqlite/tsconfig.lib.json

NX   Successfully ran target typecheck for project @ptah-extension/persistence-sqlite
```

### Lint — one project

Command:

```powershell
$env:NX_DAEMON='false'
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite --outputStyle=static
```

```text
NX   Running target lint for project @ptah-extension/persistence-sqlite:

- @ptah-extension/persistence-sqlite

Linting "@ptah-extension/persistence-sqlite"...
✔ All files pass linting

NX   Successfully ran target lint for project @ptah-extension/persistence-sqlite
```

## XB1 — both SQLite bindings

Before each binding-specific Jest run, the required process listing found no live Jest, Nx run, or Nx run-executor process. An earlier check did find the concurrent Batch 1 `@ptah-extension/skill-synthesis` test executor; Batch 2 waited until it exited and rechecked clean before starting.

### `node:sqlite`

Command (pattern containing `|` quoted exactly as required):

```powershell
$mainCheckout = 'D:\projects\ptah-extension'
& "$mainCheckout\node_modules\.bin\jest.cmd" `
  --config libs/backend/persistence-sqlite/jest.config.ts `
  --testPathPatterns '"0045_skill_backlog_cleanup|0044_memory_lifecycle|0043_memory_retention"' `
  --runInBand
```

```text
Test Suites: 3 passed, 3 total
Tests:       25 passed, 25 total
Snapshots:   0 total
Time:        14.449 s, estimated 33 s
Ran all test suites matching 0045_skill_backlog_cleanup|0044_memory_lifecycle|0043_memory_retention.
```

The main checkout's `better-sqlite3` binary is built for Electron ABI 143 and cannot load in the ordinary Node ABI 137 process, so the established opener deterministically falls through to Node 24's `node:sqlite`.

### Electron-as-Node / `better-sqlite3`

Command:

```powershell
$mainCheckout = 'D:\projects\ptah-extension'
$env:ELECTRON_RUN_AS_NODE = '1'
& "$mainCheckout\node_modules\.bin\electron.cmd" `
  "$mainCheckout\node_modules\jest\bin\jest.js" `
  --config libs/backend/persistence-sqlite/jest.config.ts `
  --testPathPatterns '"0045_skill_backlog_cleanup|0044_memory_lifecycle|0043_memory_retention"' `
  --runInBand
```

```text
Test Suites: 3 passed, 3 total
Tests:       25 passed, 25 total
Snapshots:   0 total
Time:        10.249 s, estimated 14 s
Ran all test suites matching 0045_skill_backlog_cleanup|0044_memory_lifecycle|0043_memory_retention.
```

## XB2 — degradation audit

Command:

```powershell
$env:NX_DAEMON='false'
npx nx run degradation-audit:lint --outputStyle=static
```

Relevant result:

```text
degradation-audit: scanned 2850 file(s)
degradation-audit: per-directory totals
  libs/backend/persistence-sqlite: 5 ok (baseline 5)
degradation-audit: TOTAL 303 unsuppressed site(s)

NX   Successfully ran target lint for project degradation-audit
```

Exit code: 0. No baseline update was run.

## Highest-version ratchet acceptance grep

Command:

```powershell
rg -n 'MIGRATIONS\.map' libs/backend/persistence-sqlite/src
```

Highest-version assertions in its output:

```text
0028_gateway_conversation_workspace_root.spec.ts:80: expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(45);
0030_skill_event_metrics.spec.ts:34: const maxVersion = Math.max(...MIGRATIONS.map((m) => m.version));
0030_skill_event_metrics.spec.ts:35: expect(maxVersion).toBe(45);
0038_gateway_message_turn_state.spec.ts:88: expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(45);
0039_reap_orphaned_queue_rows.spec.ts:62: expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(45);
0040_skill_candidate_workspace_root.spec.ts:75: expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(45);
0041_skill_md_migration_state.spec.ts:59: expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(45);
0042_db_integrity_check_state.spec.ts:67: expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(45);
0043_memory_retention.spec.ts:51: expect(Math.max(...MIGRATIONS.map((m) => m.version))).toBe(45);
0044_memory_lifecycle.spec.ts:66: expect(Math.max(...MIGRATIONS.map((migration) => migration.version))).toBe(
0044_memory_lifecycle.spec.ts:67:   45,
0045_skill_backlog_cleanup.spec.ts:30: const versions = MIGRATIONS.map((migration) => migration.version);
0045_skill_backlog_cleanup.spec.ts:32: expect(Math.max(...versions)).toBe(45);
```

No stale `toBe(44)` / multiline `44` highest-version ratchet remains.

## Required mutation — remove `CHECK (id = 1)`

Mutation applied only to the DDL line:

```diff
-  id INTEGER PRIMARY KEY CHECK (id = 1),
+  id INTEGER PRIMARY KEY,
```

Fail command:

```powershell
& 'D:\projects\ptah-extension\node_modules\.bin\jest.cmd' `
  --config libs/backend/persistence-sqlite/jest.config.ts `
  --testPathPatterns 0045_skill_backlog_cleanup --runInBand
```

Expected failing evidence:

```text
MUTATION_EXIT_CODE=1
FAIL persistence-sqlite libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.spec.ts

● migration 0045_skill_backlog_cleanup — behaviour › rejects id = 2 through the single-row CHECK

  expect(received).toThrow(expected)
  Expected pattern: /CHECK/i
  Received function did not throw

Test Suites: 1 failed, 1 total
Tests:       1 failed, 7 passed, 8 total
Snapshots:   0 total
Time:        7.677 s
Ran all test suites matching 0045_skill_backlog_cleanup.
```

The CHECK was restored immediately. Restore proof:

```text
RESTORE_EXIT_CODE=0
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        5.842 s, estimated 8 s
Ran all test suites matching 0045_skill_backlog_cleanup.
```

Restored-source check:

```text
0045_skill_backlog_cleanup.ts:20: id INTEGER PRIMARY KEY CHECK (id = 1),
```

`git diff --stat` after restore (Batch 2 scope; untracked 0045 files do not appear in ordinary `git diff --stat`):

```text
0028_gateway_conversation_workspace_root.spec.ts | 3 ++-
0030_skill_event_metrics.spec.ts                 | 3 ++-
0038_gateway_message_turn_state.spec.ts          | 3 ++-
0039_reap_orphaned_queue_rows.spec.ts            | 3 ++-
0040_skill_candidate_workspace_root.spec.ts      | 3 ++-
0041_skill_md_migration_state.spec.ts             | 3 ++-
0042_db_integrity_check_state.spec.ts             | 3 ++-
0043_memory_retention.spec.ts                     | 3 ++-
0044_memory_lifecycle.spec.ts                     | 3 ++-
migrations/index.ts                              | 6 ++++++
10 files changed, 24 insertions(+), 9 deletions(-)
```

Final state: the mutation is not present; the CHECK is restored, the focused test is green, and the two untracked 0045 source/spec files contain the completed implementation.

## Revise round 1

Independent review verdict: **APPROVED**, score 8/10, with two minor findings. Both findings are fixed before the migration freezes.

### Fixes

1. `libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.spec.ts:191-225` now pins the exact `notnull` and `dflt_value` contract for every one of the 16 non-id columns:
   - `version`, `cutoff_created_at`, `started_at`: `notnull: 1`, `dflt_value: null`.
   - `cursor_created_at`, `cursor_id`, `finished_at`, `last_run_at`, `last_outcome`, `last_reason`: `notnull: 0`, `dflt_value: null`.
   - All seven counters: `notnull: 1`, `dflt_value: '0'` (and `type: 'INTEGER'`).
2. `libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.ts:9-11` now explains why `version`, `cutoff_created_at`, and `started_at` are deliberately `NOT NULL`: the first run writes all three together, and subsequent full-row writes must update in place or rebind all three.

Post-fix `ptah_get_diagnostics`: `Errors: 0 | Warnings: 0`. `git diff --check -- libs/backend/persistence-sqlite/src/lib/migrations`: exit 0, no output.

### Nullability mutation proof

Mutation applied:

```diff
-  started_at INTEGER NOT NULL,
+  started_at INTEGER,
```

Fail command:

```powershell
& 'D:\projects\ptah-extension\node_modules\.bin\jest.cmd' `
  --config libs/backend/persistence-sqlite/jest.config.ts `
  --testPathPatterns 0045_skill_backlog_cleanup --runInBand
```

Expected failure:

```text
MUTATION_EXIT_CODE=1
FAIL persistence-sqlite libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.spec.ts

● migration 0045_skill_backlog_cleanup — behaviour › declares the complete state shape and zero-defaulted counters

  expect(received).toMatchObject(expected)
  - Expected  - 1
  + Received  + 1
    Object {
      "dflt_value": null,
  -   "notnull": 1,
  +   "notnull": 0,
    }

Test Suites: 1 failed, 1 total
Tests:       1 failed, 7 passed, 8 total
Snapshots:   0 total
Time:        5.738 s
Ran all test suites matching 0045_skill_backlog_cleanup.
```

The mutation was restored immediately. Restored source:

```text
0045_skill_backlog_cleanup.ts:29: started_at INTEGER NOT NULL,
```

Restore run (`node:sqlite`) output:

```text
RESTORE_EXIT_CODE=0
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        6.715 s
Ran all test suites matching 0045_skill_backlog_cleanup.
```

### Both SQLite bindings

Before every Jest invocation, the process listing found no live Jest, Nx run, or Nx run-executor process. No Batch 1 run was overlapped.

`node:sqlite` (the restored mutation run above):

```text
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        6.715 s
Ran all test suites matching 0045_skill_backlog_cleanup.
```

Electron-as-Node `better-sqlite3` command:

```powershell
$mainCheckout = 'D:\projects\ptah-extension'
$env:ELECTRON_RUN_AS_NODE = '1'
& "$mainCheckout\node_modules\.bin\electron.cmd" `
  "$mainCheckout\node_modules\jest\bin\jest.js" `
  --config libs/backend/persistence-sqlite/jest.config.ts `
  --testPathPatterns 0045_skill_backlog_cleanup --runInBand
```

```text
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
Snapshots:   0 total
Time:        4.327 s, estimated 7 s
Ran all test suites matching 0045_skill_backlog_cleanup.
```

### Typecheck — one project

Command:

```powershell
$env:NX_DAEMON='false'
npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite --outputStyle=static
```

```text
NX   Running target typecheck for project @ptah-extension/persistence-sqlite:

- @ptah-extension/persistence-sqlite

> tsc --noEmit --project libs/backend/persistence-sqlite/tsconfig.lib.json

NX   Successfully ran target typecheck for project @ptah-extension/persistence-sqlite
```

### Lint — one project

Command:

```powershell
$env:NX_DAEMON='false'
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite --outputStyle=static
```

```text
NX   Running target lint for project @ptah-extension/persistence-sqlite:

- @ptah-extension/persistence-sqlite

Linting "@ptah-extension/persistence-sqlite"...
✔ All files pass linting

NX   Successfully ran target lint for project @ptah-extension/persistence-sqlite
```

Final revise-round state: both minor review findings are resolved, the mutation is restored, both SQLite bindings pass with 0 skipped tests, and the required one-project typecheck and lint targets pass.
