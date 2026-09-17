# Batch 1 Codex Report

Batch 1 is complete. The internal-query global default is 3; the two governed
background lanes share a derived cap of `limit - 1` with a minimum of 1; and
service diagnostics now distinguish a background-cap wait from global, lane,
and governor waits.

## Files modified

- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\libs\backend\agent-sdk\src\lib\internal-query\internal-query-concurrency-gate.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\libs\backend\agent-sdk\src\lib\internal-query\internal-query-concurrency-gate.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\libs\backend\platform-core\src\file-settings-keys.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\libs\backend\platform-core\src\file-settings-keys.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\libs\backend\agent-sdk\src\lib\errors\internal-query-queue-timeout.error.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\libs\backend\agent-sdk\CLAUDE.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\libs\backend\memory-curator\src\lib\curator-llm\curator-job-queue.ts`

This report was created at
`D:\projects\ptah-extension\.claude-worktrees\task-463-437-leftovers\.ptah\specs\TASK_2026_463_f13d\b1-codex-report.md`.

Parallel-session changes already present in `.github/workflows/**` and
`scripts/perf/**` were not edited or formatted by this batch.

## Task 1.0: degradation reference

Before the first edit, the required runner-count check returned `0`. The first
exact Nx invocation exited 0 but its dynamic terminal renderer emitted only the
Node color warnings to the captured stream. Running the target's declared
read-only command directly immediately afterward produced the baseline:

```text
degradation-audit: scanned 2848 file(s)
  libs/backend/agent-sdk: 4 ok (baseline 4)
  libs/backend/memory-curator: 20 ok (baseline 20)
  libs/backend/platform-core: 7 ok (baseline 7)
degradation-audit: TOTAL 303 unsuppressed site(s)
```

There was no `FAIL` row. Task 1.0 reference TOTAL: **303**.

## Task 1.1: gate

- Default 3 and the rationale are at
  `internal-query-concurrency-gate.ts:63-92`.
- Pure `backgroundLimit` and the accepted configured-limit behavior are at
  `internal-query-concurrency-gate.ts:94-105`: limit 1 keeps one background
  slot, and limit 2 caps background at one.
- The read-only sum over `GOVERNED_BACKGROUND_LANES` is at
  `internal-query-concurrency-gate.ts:295-302`; no counter, map, timer, or
  listener was added.
- The single admission predicate uses the current `this.limit` at
  `internal-query-concurrency-gate.ts:468-474`; `drain()` remains unchanged.
- The three-term and reserved-slot documentation is at
  `internal-query-concurrency-gate.ts:200-232`.
- The fallback-default test is updated at
  `internal-query-concurrency-gate.spec.ts:156-170`.
- The six background-cap regression cases are at
  `internal-query-concurrency-gate.spec.ts:173-310`. They prove: both
  background families plus a user action start at defaults; a capped head does
  not block a user action; freeing foreground alone does not admit capped
  background; freeing background does; limit 1 runs background; the pure limit
  table is correct; and a governor-held waiter does not count as in-flight.
- Final line counts: gate 525 lines; gate spec 694 lines, both under 700.

## Task 1.2: service

- `backgroundInFlight` and `backgroundCapped` are computed once for the wait
  check and log at `internal-query.service.ts:150-171`.
- `blockedBy` order is global, lane, background, governor at
  `internal-query.service.ts:175-184`.
- Configured 4/4 behavior and the fourth-lane global-ceiling case are pinned at
  `internal-query.service.spec.ts:419-477`.
- User action beside both default background holders is pinned at
  `internal-query.service.spec.ts:479-487`.
- The background diagnostic, including `backgroundInFlight: 2`,
  `backgroundCapped: true`, and `blockedBy: 'background'`, is pinned at
  `internal-query.service.spec.ts:489-514`.

## Task 1.3: settings and documentation

- The per-lane key is registered at `file-settings-keys.ts:374`; defaults are
  global 3 and per-lane 1 at `file-settings-keys.ts:634-635`.
- The default-source and prior missing-key comments are at
  `file-settings-keys.ts:364-375` and `file-settings-keys.ts:627-636`.
- Registration, routing, and hard-coded drift checks are at
  `file-settings-keys.spec.ts:818-895`.
- The timeout error no longer duplicates a numeric default at
  `internal-query-queue-timeout.error.ts:5-8`.
- The background cap, the limit-1 safety rule, the accepted limit-2
  serialization risk, and the shared foreground-slot residual are documented
  in `agent-sdk/CLAUDE.md:87-88`.
- The memory curator comment now says “both background slots” at
  `curator-job-queue.ts:39`.

## Risk and edge-case handling

- **A user action while both background lanes are busy:** background can hold
  only 2 of the default 3 slots. Both gate and service regression tests prove
  immediate admission of `user-action`.
- **Capped queue head:** `drain()` scans the queue and the cap is part of
  `admissible()`, so a foreground waiter behind capped background is admitted.
- **Limit 1:** `backgroundLimit(1) === 1`; memory curation and skill synthesis
  do not silently stop.
- **Limit 2:** the cap is 1 and the two background families serialize again;
  this accepted A-D2-1 risk is explicit in code and `CLAUDE.md`.
- **Governor-held work:** only admitted holders in `activeByLane` contribute to
  the background count.
- **Unknown lanes:** only the allow-listed background lanes are capped, so
  unknown lanes remain foreground/fail-open.
- **Shared foreground residual:** `default` and `user-action` share the one
  reserved slot. If `default` already holds it, a click can still wait; this is
  documented rather than hidden.
- Lane strings and public signatures are unchanged, so the reasoned consumers
  (`rpc-handlers` lane drift and `agent-generation` local concurrency) retain
  their contracts.

## Verification output

### 1. Tests

Command:

```text
npx nx run-many -t test -p @ptah-extension/agent-sdk @ptah-extension/platform-core --parallel=1 -- --maxWorkers=2
```

Literal final output lines:

```text
NX   Running target test for 2 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/platform-core
Test Suites: 41 passed, 41 total
Tests:       4 todo, 781 passed, 785 total
Test Suites: 2 skipped, 110 passed, 110 of 112 total
Tests:       3 skipped, 1976 passed, 1979 total
NX   Successfully ran target test for 2 projects
```

The project-count header is exactly 2.

### 2. Typecheck

```text
NX   Running target typecheck for 3 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/platform-core
- @ptah-extension/memory-curator
NX   Successfully ran target typecheck for 3 projects
```

The project-count header is exactly 3.

### 3. Lint

```text
NX   Running target lint for 3 projects:
- @ptah-extension/agent-sdk
- @ptah-extension/platform-core
- @ptah-extension/memory-curator
✖ 9 problems (0 errors, 9 warnings)
✖ 42 problems (0 errors, 42 warnings)
✖ 5 problems (0 errors, 5 warnings)
NX   Successfully ran target lint for 3 projects
```

There are 0 errors. All 56 warnings are pre-existing and occur outside the nine
touched files; no new warning names a Batch 1 file.

### 4. Degradation audit

```text
degradation-audit: scanned 2848 file(s)
  libs/backend/agent-sdk: 4 ok (baseline 4)
  libs/backend/memory-curator: 20 ok (baseline 20)
  libs/backend/platform-core: 7 ok (baseline 7)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

TOTAL 303 equals Task 1.0. There is no `FAIL` row.

### 5. Prettier and diff hygiene

```text
Checking formatting...
All matched files use Prettier code style!
```

The check covered all nine Batch 1 files. `git diff --check` exited 0 with no
output. No git write operation and no `nx reset` was performed.

### 6. Workflow checks

N/A for Batch 1.
