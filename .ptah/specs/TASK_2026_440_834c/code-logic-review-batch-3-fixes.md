# Batch 3 Fixes Code Logic Review

## Per-finding status

### M1 — CLOSED

The integration test now keeps the default 7/14-day settings and advances the run clock to `NOW + 25h`. It asserts exact work counts of 50 processed purges and 40 stuck quarantines, zero ledger pruning, completed/no-backlog state, and removal of the exact P-new/U-grace IDs (`libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts:335-354`). It separately proves every P-old-captured-new-processed survivor is byte-for-byte unchanged and retains `processed_at === NOW - DAY` (`:355-360`).

Ledger assertions are exact: total 340 and four rows; each `u-0`/`u-1` tool-use key grows from 75 to 95 with the expected timestamp and unchanged prior payload/oldest values, while both user-prompt rows remain exactly unchanged (`:362-392`). State after run 3 records 50/40 and ten processed survivors (`:394-400`). A later due run at `NOW + 50h` uses the defaults, requires an exact all-zero report, and requires the ledger and queue snapshots to remain identical (`:402-420`).

These assertions would fail if the former 8/15-day widening returned, if the cutoff stopped sliding with the run clock, if R7 regressed, or if quarantine accumulation duplicated or rewrote an unaffected ledger key.

### M2 — CLOSED

The new real-SQLite cap test crosses the step boundary with 100 eligible processed rows and 200 stuck rows under a 250-row cap (`memory-retention.integration.spec.ts:423-457`). It requires exactly 100 + 150 deletions, a combined total of 250, and records that quarantine received the reduced limit `[150]`, so resetting the allowance between steps fails the test (`:482-500`).

The same row-budget run seeds an expired and a recent ledger row, requires `ledgerPruned === 1`, proves only the expired row disappeared, and checks exact remaining sessions and the new quarantine count (`:459-480`, `:502-506`). It also proves reclaim ran after the row-budget stop and that the persisted outcome is partial/backlogged with no completed timestamp (`:508-521`).

The stalled-reclaim unit test leaves 100 free pages, returns zero progress, and fails deterministically if a second reclaim call occurs. It requires exactly one call with 100 pages, `partial / reclaim-stalled`, zero reclaimed pages, backlog true, one checkpoint, and one matching run record (`libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts:537-570`). Reverting the zero-progress break would make the call-count assertion fail rather than hang.

### m1 — CLOSED

Production now treats freed bytes as measured only when both samples have finite positive matching page sizes and finite non-negative freelist counts; otherwise it returns an unmeasured result (`libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:101-122`). The run stores zero report bytes for an invalid pair while carrying a separate measurement flag (`:305-310`, `:342-375`). Average bytes are written only when that flag is true and processed rows were purged; otherwise `null` invokes the store's preserve-previous `COALESCE` behavior (`:579-622`; `observation-retention.store.spec.ts:488-508`).

The degraded-before/valid-after test contains a 500-page pre-existing freelist and ten purged rows, so the old implementation would report `510 * 4096`; it now requires `freedBytes: 0` and `avgProcessedRowBytes: null` (`memory-retention.service.spec.ts:573-610`). A second test rejects mismatched page sizes (`:613-628`). Reverting the production fix makes both tests fail, and the existing real-store test proves that the null average preserves the prior value.

## New findings

None. The fixes introduce no new behavioral defect in the reviewed retention files.

## Command output summary

Command run as requested:

`npx nx run-many -t typecheck test lint -p @ptah-extension/memory-curator`

- Header reported exactly one project: `@ptah-extension/memory-curator`.
- Successful run exit code: 0.
- Typecheck: passed.
- Tests: 35 suites passed, 2 older native-gated suites skipped; 546 tests passed, 59 skipped.
- Lint: 0 errors and the same 6 existing warnings; none points into the retention files.
- Nx reused the lint cache for one of three targets; typecheck and tests executed successfully.
- An initial invocation reached the 60-second shell timeout before Nx returned and produced no test result. The identical rerun completed successfully in 56.1 seconds.
- No failure pointed into `libs/backend/persistence-sqlite`, so there is no possibly in-flight Task 1.4 failure to report.
- No `nx reset` was run, and no real database or `~/.ptah` path was opened.

## Verdict

**APPROVED** — M1, M2, and m1 are genuinely closed with exact, regression-sensitive assertions, and no new finding was introduced.
