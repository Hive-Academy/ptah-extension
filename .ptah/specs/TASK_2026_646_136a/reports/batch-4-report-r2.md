# Batch 4 report — fix round 1 (r2)

Input: Mode 2 round 1 verdict (batches.md, "Batch 4 verification", 2026-10-15) — test
FAILED, 2 suites, 2 tests (601 passed); typecheck and lint passed. This round fixes both
failures and completes the audit the verdict asked for. Per decision #53, this lane ran
no Nx or Jest command; the team-leader re-verifies. No git writes; batches.md and
task.md untouched.

## Fix 1 — 0053 spec applied the whole registry

File: `libs/backend/persistence-sqlite/src/lib/migrations/0053_memory_boot_scan_failure_generation.spec.ts`

- :105 before: `).applyAll(MIGRATIONS);`
- :105 after: `).applyAll(MIGRATIONS.filter((m) => m.version <= 53));`
- The seed helper at :87 still inserts every version `< 53`, so the runner now applies
  exactly `[53]` and the unchanged assertion at :106 passes. Same pattern as
  `0052_memory_boot_scan_failures.spec.ts:101`.

## Fix 2 — NOT NULL on the three key columns (decision TL-B4-1)

File: `libs/backend/persistence-sqlite/src/lib/migrations/0054_lane_outcome_records.ts`

- :36 before `run_id TEXT PRIMARY KEY,` — after `run_id TEXT NOT NULL PRIMARY KEY,`
  (`lane_outcome_records`)
- :72 before `report_id TEXT PRIMARY KEY,` — after `report_id TEXT NOT NULL PRIMARY KEY,`
  (`lane_outcome_report_receipts`)
- :80 before `report_id TEXT PRIMARY KEY,` — after `report_id TEXT NOT NULL PRIMARY KEY,`
  (`lane_outcome_held_reports`)
- Header comment: one new paragraph (after the held-reports paragraph) records why:
  a rowid table otherwise accepts a NULL TEXT PRIMARY KEY, and a NULL key would defeat
  the SC-10 dedup.
- Nothing else changed: column sets, indexes, registration order and the 15 ratchet
  bumps are untouched. The spec's PRAGMA column tables already declared `notnull = 1`
  for the three keys (`RECORD_COLUMNS`, `RECEIPT_COLUMNS`, `HELD_COLUMNS`), so the
  assertions at :194, :197 and :200 now pass against the fixed DDL.

### New test case

File: `libs/backend/persistence-sqlite/src/lib/migrations/0054_lane_outcome_records.spec.ts`

- New case: `rejects a NULL primary key insert on all three tables` — table-driven, one
  INSERT per table with a NULL key; each insert must throw `/NOT NULL/i`. Placed after
  `declares the plan column sets exactly`, before the idempotence case.

## Mode 2 audit — every other unfiltered `applyAll(MIGRATIONS)`

The verdict asks to "check every other spec that calls `applyAll(MIGRATIONS)` with a
fixed `appliedVersions` list the same way". Audit: grep `applyAll(` across
`libs/backend/persistence-sqlite`.

- `0055_skill_invocation_run_id.spec.ts:117` — SAME PATTERN, FIXED THE SAME WAY:
  - before: `).applyAll(MIGRATIONS);`
  - after: `).applyAll(MIGRATIONS.filter((m) => m.version <= 55));`
  - Reason: it passed only because the seed stops below 55. When migration 0056
    registers, the unbounded call would apply `[55, 56]` against the fixed `[55]`
    expectation at :118 — the exact failure mode that broke the 0053 spec now. The file
    is a Batch 4 deliverable (this batch's own spec), so no other lane owns it.
- `migration-runner.spec.ts:662, :689, :690` — ratcheted assertions
  (`length > 0`, `finalVersion === MIGRATIONS[MIGRATIONS.length - 1].version`); no
  fixed list. No change.
- `sqlite-connection.service.ts:239` — production code; applying every migration is
  the intended behaviour. No change.
- All remaining `applyAll` call sites in `migrations/` pass a bounded list (a single
  migration object or `MIGRATIONS.filter((m) => m.version <= N)`), including
  `0054_lane_outcome_records.spec.ts:166`. No change.

## Files changed

1. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\persistence-sqlite\src\lib\migrations\0053_memory_boot_scan_failure_generation.spec.ts`
2. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\persistence-sqlite\src\lib\migrations\0054_lane_outcome_records.ts`
3. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\persistence-sqlite\src\lib\migrations\0054_lane_outcome_records.spec.ts`
4. `D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\persistence-sqlite\src\lib\migrations\0055_skill_invocation_run_id.spec.ts` (Mode 2 audit outcome, see above)

## Verification by this lane

- IDE TypeScript diagnostics scoped to the four changed files: 0 errors, 0 warnings.
- No Nx or Jest command was run (decision #53); the team-leader re-verifies.

## Not done

- No git commit, branch, stash or push (lane rule).
- batches.md and task.md were not edited (lane rule).
- Column sets, index definitions, registration order in `migrations/index.ts` and the
  15 ratchet bumps were not touched (instructed: correct as landed).