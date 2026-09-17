# Batch 4 Fixes Report — Task 4.3

Status: PASS

## S1 — Bound pending-payload byte measurement

### Production change

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.ts:100`
  - The docblock records that the five payload columns are not covered by `idx_obs_queue_drain`, so the query requires one base-table lookup per pending row.
  - It records the measured case of approximately 26 ms at approximately 5,000 pending rows and the null-above-bound behavior.
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.ts:104`
  - Exports `PENDING_BYTES_MAX_ROWS = 5_000` from the store module.
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.ts:461`
  - Runs `PENDING_BYTES_SQL` only when the pending summary succeeded and `pending.rows <= PENDING_BYTES_MAX_ROWS`.
  - Above the bound (or when the prerequisite pending read fails), returns `pendingBytes: null` and adds exactly `pendingBytes: not measured above 5000 pending rows` without calling the warning-producing `read()` wrapper.
  - The other live reads remain unchanged.

### Real-SQLite regression specs

File: `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.spec.ts`

- Line 549: `does not measure pending bytes above 5000 pending rows`
  - Seeds exactly 5,001 pending rows through the existing real-SQLite test opener.
  - Asserts `pendingRows === 5001`.
  - Asserts `pendingBytes === null`.
  - Asserts `oldestPendingAt === NOW - 20 * DAY`.
  - Asserts `stuckEligibleRows === 5001`.
  - Asserts `readErrors` equals exactly `['pendingBytes: not measured above 5000 pending rows']`.
  - Asserts zero issued SQL statements containing `octet_length`.
  - Asserts the policy skip emits no logger warning.
- Line 574: `measures exact pending bytes at the 5000-row bound`
  - Seeds exactly 5,000 pending rows with a three-byte `toolResponseText` payload per row.
  - Asserts `pendingRows === 5000` and `pendingBytes === 15_000`.
  - Asserts the policy-skip token is absent.
  - Asserts exactly one issued SQL statement contains `octet_length`.

Focused Jest result:

- Command: `npx jest --config D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\jest.config.ts --runTestsByPath D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.spec.ts --runInBand`
- Result: 1 suite passed; 22 tests passed; 0 skipped.

## M1 — Record the diagnostics invariant

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\diagnostics.service.ts:61`
  - Adds a one-line comment at the required `storage` assignment documenting reliance on the `MemoryRetentionService` never-throws contract and its degradation-spec coverage.
  - No fallback DTO and no local try/catch were added; `storage` remains required.

Focused Jest result for the existing pass-through contract:

- File: `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\diagnostics.service.spec.ts`
- Relevant test: `returns the storage health object from the retention service unchanged`.
- Command: `npx jest --config D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\jest.config.ts --runTestsByPath D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\diagnostics.service.spec.ts --runInBand`
- Result: 1 suite passed; 7 tests passed; 0 skipped.

## Required verification

Command:

`$env:NX_TASKS_RUNNER_DYNAMIC_OUTPUT='false'; npx nx run-many -t typecheck test lint --parallel=1 -p @ptah-extension/memory-curator @ptah-extension/rpc-handlers @ptah-extension/shared`

- Header: `Running targets typecheck, test, lint for 3 projects`.
- Overall: PASS; all 9 requested targets succeeded; 4 of 9 targets used cached output.
- Shared: 57 suites passed; 1,398 tests passed; 0 skipped.
- Memory-curator: 35 suites passed, 2 pre-existing native-gated suites skipped; 549 tests passed, 59 skipped.
- RPC-handlers: 99 suites passed; 2,993 tests passed, 33 skipped.
- Aggregate tests: 191 suites passed, 2 suites skipped; 4,940 tests passed, 92 skipped.
- Typecheck: all 3 projects passed.
- Lint: all 3 projects passed with 0 errors; only existing warnings were reported.
- `git diff --check` passed for all three Task 4.3 source/spec files.

Only the three authorized source/spec files and this required report were edited for Task 4.3. Batch 5 files were not touched.

## Round 2

Status: PASS

### Misleading prerequisite-failure token

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.ts:461`
  - Initializes `pendingBytes` to `null`.
  - Line 462 enters pending-byte policy only when the pending-summary read succeeded.
  - Lines 463-473 measure bytes at or below `PENDING_BYTES_MAX_ROWS`, and emit `pendingBytes: not measured above 5000 pending rows` only when the successful count exceeds the bound.
  - When the pending-summary read fails, no fabricated bound token is added; the existing `pending: <error>` entry remains the sole explanation for that prerequisite failure.

### Regression spec

- File: `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\memory-curator\src\lib\retention\observation-retention.store.spec.ts`
- Line 603 test: `does not report a backlog-bound skip when the pending summary fails`.
- Uses the existing real-SQLite opener and drops `idx_obs_queue_drain` to make the indexed pending-summary statement fail during execution.
- Exact assertions:
  - `pendingRows === null`.
  - `pendingBytes === null`.
  - `readErrors` contains an entry matching `^pending: `.
  - `readErrors` does not contain `pendingBytes: not measured above 5000 pending rows`.
  - Zero issued statements contain `octet_length`.
- Focused file result: 1 suite passed; 23 tests passed; 0 skipped.

### Verification

Command:

`$env:NX_TASKS_RUNNER_DYNAMIC_OUTPUT='false'; npx nx run-many -t typecheck test lint --parallel=1 -p @ptah-extension/memory-curator`

- Header: `Running targets typecheck, test, lint for project @ptah-extension/memory-curator` and listed exactly 1 project.
- Overall: PASS; typecheck, test, and lint all succeeded.
- Tests: 35 suites passed, 2 pre-existing native-gated suites skipped; 550 tests passed, 59 skipped.
- The new regression test executed and passed; it was not skipped.
- Lint: 0 errors; only 6 existing warnings were reported.
