# Code Logic Review — `TASK_2026_440_834c` (Batch 1: persistence)

Scope: Task 1.1 (migration `0043_memory_retention`), Task 1.2 (`SqlitePageReclaimer` + DI),
Task 1.3 (`KEEP_BY_KIND` keep table + `db:reset` rotation), and their specs. Batch 2's files
(`libs/shared`, `libs/backend/platform-core`) were read only where Batch 1 imports from them
(it does not) and are otherwise out of scope per the assignment.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------- |
| Overall score        | 8/10                                  |
| Assessment           | APPROVED                              |
| Blocking issues      | 0                                     |
| Serious issues       | 0                                     |
| Moderate issues      | 0                                     |
| Failure modes found  | 1 (Minor, documented below)           |

`npx nx run-many -t typecheck test -p @ptah-extension/persistence-sqlite @ptah-extension/rpc-handlers`
was re-run in this review (not taken on the executor's word): header reports 2 projects,
both typecheck clean, persistence-sqlite 376/456 tests passed (80 pre-existing skips —
native `better-sqlite3` ABI mismatch on this machine, `NODE_MODULE_VERSION 143` vs `137`,
confirmed by the printed native-probe errors), rpc-handlers 2993/3026 passed (33 pre-existing
skips), exit 0. The new specs (`0043_memory_retention.spec.ts`, `sqlite-page-reclaimer.spec.ts`)
are inside the 29 executed suites, not the 9 skipped ones, and both specs assert their opener is
non-null before running — so this run proves they executed against real SQLite (`node:sqlite`
fallback on this machine, matching A3), not that they were silently skipped.

## Five logic questions

### 1. How does this fail silently?

- Every degrade path in `SqlitePageReclaimer` (closed connection, busy pragma, `auto_vacuum != 2`,
  open transaction) returns zeros rather than throwing, by design
  (`sqlite-page-reclaimer.ts:13-16`). This is the documented contract, not a hidden failure —
  the caller (Batch 3's `MemoryRetentionService`, not in this batch) is expected to treat a
  zero-reclaim result as "nothing happened this step," and the class logs `warn`/`debug` on every
  such path (`:92-96`, `:110-114`, `:148-152`, `:166-171`, `:181-185`). Nothing here fabricates a
  non-zero result.
- `rotate()` (pre-existing, unchanged logic in this batch — only the `KEEP_BY_KIND` values and
  call sites changed) swallows both a scan failure and an individual `unlinkSync` failure into a
  `warn` log (`backup.service.ts:473-492`). A backup that fails to delete during rotation is not
  surfaced to `db:reset`'s caller — acceptable per the plan's rule that rotation must never fail
  the operation it follows, but worth naming: an operator watching only `db:reset`'s RPC response
  would not see a rotation failure; it only appears in logs.

### 2. What user action produces unexpected behaviour?

- None found for this batch's surface. `db:reset` still returns `success: true` even when the
  backup step failed entirely (`rawBackupPath === null`) or when `rotate` silently failed after a
  successful backup — this is the pre-existing "backup problems never block a reset" contract
  (`persistence-rpc.handlers.ts:441-445`), extended consistently to rotation by Task 1.3, and it
  is asserted by the new spec (`persistence-rpc.handlers.spec.ts` "does not rotate when the backup
  resolves null").

### 3. What input data produces a wrong answer?

- `reclaimStep`'s `maxPages` guard (`isValidMaxPages`, `sqlite-page-reclaimer.ts:66-68`) is
  checked BEFORE `openDb()` is even called (`:109-115`), so no SQL — not even a pragma read — runs
  for an invalid value. Confirmed by the `it.each([0, 1.5, NaN, Infinity, 1e9, -5, 65_537])` test
  asserting `issued` stays `[]` (`sqlite-page-reclaimer.spec.ts:240-252`). This is the injection
  guard the plan requires, and it is complete for the values enumerated in the review brief.
- `pagesReclaimed = before.freelistCount - freelistAfter`, clamped at 0 with `Math.max`
  (`:144-147`). Honest: it is not derived from `maxPages` or from the request, only from two
  measured `freelist_count` reads taken immediately before and after the one `incremental_vacuum`
  call. The "never asks for more pages than the freelist holds" test
  (`sqlite-page-reclaimer.spec.ts:216-227`) independently confirms `pages = min(freelistCount,
  maxPages)` by asserting the exact issued pragma text.
- `KEEP_BY_KIND['pre-migration'] = 1` combined with `rotate`'s "sort filenames descending, keep
  the first `keep`" selection (`backup.service.ts:460-465`) means the just-taken backup — always
  the lexicographically newest ISO-compact timestamp — is always in the kept set, never deleted,
  as long as `compactIso()` produces a strictly increasing string across calls (true for
  `Date.now()`-driven timestamps under normal clock behaviour). Verified directly by the new
  `backup.service.spec.ts` test that seeds 4 reset files plus an unrelated `pre-migration` file in
  the same directory and asserts the newest 2 reset files survive and the pre-migration file is
  never touched (prefix-scoped, `:695-712`).
- Migration `0043`'s ledger UNIQUE `(session_id, kind, reason)` and the `id = 1` CHECK are each
  tested from both the accepting and rejecting side (`0043_memory_retention.spec.ts:189-243`), not
  just the happy path — a table that silently dropped the CHECK or the UNIQUE constraint would
  fail these specs.

### 4. What happens when a dependency fails?

- `better-sqlite3`'s pragma call throwing `SQLITE_BUSY` mid-`reclaimStep`: caught, logged at
  `warn`, returns `{ pagesReclaimed: 0 }` (`:148-153`), pinned by the "busy pragma" test in both
  the reclaimer's own spec and the degraded-connection describe block
  (`sqlite-page-reclaimer.spec.ts:324-347`).
- `SqliteConnectionService.db` throwing (closed connection): caught at `openDb()`
  (`:174-187`), every public method returns its zero value. Pinned by
  "returns zeros for every method when the connection is closed" (`:306-322`) and independently by
  the DI-reach test, which resolves a real, never-opened connection and asserts
  `readPageStats().pageCount === 0` with `fs.readdirSync(dir)` staying empty — i.e., resolving the
  reclaimer through the real container touches no file (`:350-383`).
- `backup()` resolving `null` (worker unavailable, validation failed, etc.): both the runner
  (pre-existing D2 rule, now reading `KEEP_BY_KIND['pre-migration']` instead of a literal `3`) and
  the new reset path skip `rotate` entirely (`persistence-rpc.handlers.ts:438-440`), so a failed
  backup cannot shrink the kept-backup set. This is the exact "cannot delete the backup just
  taken" property the review brief asked to confirm, and it holds for both call sites this batch
  touches.

### 5. What is missing that the requirements never mentioned?

- The `rotate()` docstring `backup.service.ts:431` and `di/register.ts` comment describe rotation
  as depending on `backup()`'s invariant that "a file only exists under these prefixes if it was
  written completely, locked down, and passed `quick_check`" — that invariant is enforced entirely
  outside this batch (in `performBackup`/`discardArtifact`, untouched here) and this batch does not
  re-verify it; it is out of scope for Batch 1 but worth naming as a dependency the reviewer traced
  and did not re-test.
- No test in this batch exercises `rotate('daily', ...)` with the new `KEEP_BY_KIND.daily` — that
  call site (`start-thoth-cron.ts:324`, `cli-engine thoth-runtime.ts:391`) is explicitly deferred
  to Batch 5 per the plan and `batches.md` validation notes ("do NOT touch `start-thoth-cron.ts`
  ... here"), so this is scoped correctly, not a gap in this batch.

## Failure modes

### CLAUDE.md overstates the "rotate only after non-null backup" rule (Minor)

- Trigger: reading `libs/backend/persistence-sqlite/CLAUDE.md`'s new line, "Call sites pass
  `KEEP_BY_KIND[kind]`, never a literal, and rotate only after a non-null `backup()`."
- Symptom: a reader trusting this line would believe every `rotate` call site is gated on a
  non-null backup. It is true for the two call sites this batch controls (`migration-runner.ts:99`
  — pre-existing D2 gate — and the new `persistence-rpc.handlers.ts:438-440`), but the `rotate()`
  method's own docstring (`backup.service.ts:449-452`, unchanged by this batch) says the daily-cron
  call sites in `cli-engine`/`thoth-runtime` call `rotate('daily', 7)` **unconditionally**, without
  checking `backup()`'s return value — and that literal-`7` daily call site is still live on disk
  today (`start-thoth-cron.ts:324`, confirmed by `batches.md`'s own plan-validation section) and is
  explicitly left for Batch 5.
- Evidence: `libs/backend/persistence-sqlite/CLAUDE.md` (new line, git diff shown above) vs.
  `libs/backend/persistence-sqlite/src/lib/backup.service.ts:449-452`.
- Current handling: no contradiction in behaviour — `rotate()` is safe to call unconditionally
  because of the filename-prefix invariant, so nothing breaks — but the two nearby doc sentences
  now disagree about when call sites are gated.
- Recommendation: either scope the new CLAUDE.md sentence to "the migration-runner and reset call
  sites" explicitly, or defer the sentence to Batch 5 once the daily call site is updated
  (it is not being changed to conditional gating by that batch either, per `batches.md` Task 5.2 —
  only the keep-count literal changes). This is documentation precision, not a code defect, and
  does not block the batch.

No other failure mode is supported by the evidence read for this scope.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Minor: CLAUDE.md wording imprecision on the "rotate only after non-null backup" rule, detailed
  above (`libs/backend/persistence-sqlite/CLAUDE.md`).
- Minor: `reclaimStep` reads all four page-stat pragmas via `statsOf(db)` even when
  `db.inTransaction` is checked first and would already have returned early if true — but when
  `autoVacuumMode !== 2`, the class still pays for 4 pragma reads before discovering it will do
  nothing (`sqlite-page-reclaimer.ts:127-130`). This is a handful of cheap `PRAGMA ... simple`
  reads, not a correctness issue, and matches the existing `logConnectionHealth` pattern the plan
  cites as precedent.

## Data flow

1. `reclaimStep(maxPages)` called → `isValidMaxPages` gate (no SQL yet) → OK.
2. `openDb()` → connection closed? → returns `NO_STEP`, zero SQL. OK.
3. `db.inTransaction` checked → true → returns `NO_STEP` before any pragma read. OK.
4. `statsOf(db)` (4 pragma reads) → `autoVacuumMode !== 2` → returns `NO_STEP`. OK — matches
   "reclaimer never issues VACUUM... returns zeros for auto_vacuum≠2."
5. `freelistCount <= 0` → returns `{0, durationMs}` without issuing `incremental_vacuum`. OK.
6. `pages = min(freelistCount, maxPages)` → `db.pragma('incremental_vacuum(${pages})')` (the one
   interpolation site, validated upstream at step 1) → re-read `freelist_count` → honest delta.
   OK, pinned by the "reduces page_count by exactly the pages it reports" test.
7. Any pragma in steps 4 or 6 throwing → caught, `warn` logged, zero result returned. OK.
8. Migration 0043 applied by the runner → pre-migration backup attempted (existing runner logic,
   unchanged control flow) → `backupDest !== null` → `rotate('pre-migration',
   KEEP_BY_KIND['pre-migration'])` = `rotate('pre-migration', 1)`. OK — the just-written backup is
   always the newest by filename and is kept.
9. `db:reset` → `backup('reset')` → `rawBackupPath !== null` → `rotate('reset', KEEP_BY_KIND.reset)`
   = `rotate('reset', 2)`, inside the same try/catch that already tolerates a backup failure. OK —
   a rotation error cannot fail the reset (rotate never throws internally, and even if it did, it
   is inside the try/catch).

No gap found in this ordered trace within this batch's scope.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Integer validation is the only injection guard for `incremental_vacuum(N)`, complete (non-integer, ≤0, >65536, NaN, Infinity), runs before any SQL | COMPLETE | none |
| Reclaimer never issues VACUUM, never throws, returns zeros for auto_vacuum≠2 / open transaction / closed connection / pragma error; `pagesReclaimed` honest | COMPLETE | none |
| Pre-migration rotation to 1 runs only after non-null backup, cannot delete the backup just taken (filename ordering incl. sidecars) | COMPLETE | sidecar exclusion is pre-existing `rotate()` logic (unchanged), verified by reading it, not newly written by this batch |
| Migration 0043 static, idempotent, touches nothing in `observation_queue`, version ratchet consistent | COMPLETE | none |
| Specs would fail on regression, not skipped/tautological | COMPLETE | re-ran the suite in this review; specs assert non-null opener and fail loudly rather than skip |

Implicit requirements not addressed: none identified beyond the CLAUDE.md wording note above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| `maxPages` = 0, 1.5, NaN, Infinity, 1e9, -5, 65537 | YES | `isValidMaxPages` refuses before any SQL | none |
| `auto_vacuum != 2` | YES | stats read, then early return, no `incremental_vacuum` issued | none |
| Open transaction on shared connection | YES | `inTransaction` checked before stats read | none |
| Closed connection | YES | `openDb()` catches `RpcUserError`, returns null → zeros everywhere | none |
| Pragma throws (`SQLITE_BUSY`) | YES | caught, `warn` logged, zero result | none |
| Empty freelist | YES | short-circuits before issuing `incremental_vacuum`, returns 0 | none |
| `backup('reset')` resolves `null` | YES | `rotate` not called | none |
| Rotation deleting the just-taken backup | YES (does not happen) | newest-first sort, keep=1/2 always retains newest | relies on monotonic timestamp strings, acceptable |
| `-wal`/`-shm` sidecars taking a rotation slot | YES (pre-existing, unchanged) | `.sqlite` suffix filter excludes them from candidacy | documentation now slightly overstates scope, see Minor finding |
| Migration 0043 applied twice | YES | `IF NOT EXISTS` DDL only, asserted idempotent | none |
| `id = 2` insert into `memory_retention_state` | YES | CHECK constraint rejects it | none |
| Duplicate `(session_id, kind, reason)` in `observation_quarantine` | YES | UNIQUE constraint rejects it | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none material to this batch; the one Minor finding is a documentation precision gap
  that does not affect behaviour and is scoped to be resolved (or made moot) by Batch 5.
- What a robust implementation would add: nothing required for this batch's scope. A future
  hardening (not required here) would be a spec asserting that `rotate('daily', ...)`'s
  unconditional-call behaviour and the CLAUDE.md "rotate only after non-null backup" line are kept
  in sync once Batch 5 lands.
