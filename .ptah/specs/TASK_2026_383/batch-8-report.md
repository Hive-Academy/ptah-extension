# Batch 8 report — TASK_2026_383, Track B: backup call sites

Worktree `D:/projects/ptah-extension/.claude-worktrees/task-383`, branch
`task/383-degradation-audit`, on top of Batch 7's `52e8d9f39`. Nothing committed —
the working tree is left dirty for the orchestrator.

## Files changed (7)

- MODIFIED `libs/backend/persistence-sqlite/src/lib/migration-runner.ts` — Task 8.1:
  `backup(this.db, 'pre-migration')` → `backup('pre-migration')`. One line. The
  surrounding try/catch, the `backupDest !== null` guard and
  `rotate('pre-migration', 3)` are byte-identical.
- MODIFIED `libs/backend/persistence-sqlite/src/lib/migration-runner.spec.ts` — the two
  fake backup services still carried the `(db, kind)` shape and would not compile
  (`async (_db: unknown, kind: string)` → `async (kind: string)`, at the two sites the
  batch named). No assertion changed.
- MODIFIED `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` — Task 8.2, R-1 guard
  moved (below).
- MODIFIED `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts` — argument
  expectation updated; the old skip test replaced by two R-1 pins.
- MODIFIED `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` — Task 8.3, guard
  removed; `registerBackupJob`'s now-unused `refs` parameter dropped along with it, and
  its one call site updated.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/persistence-rpc.handlers.ts` —
  Task 8.4: `await this.backup.backup('reset')`. Still awaited, still inside the ordered
  5-step flow.
- MODIFIED `libs/backend/rpc-handlers/src/lib/handlers/persistence-rpc.handlers.spec.ts` —
  argument expectation updated; one new test pinning that the backup is awaited before
  `connection.close()`.

No file outside the four sites and their specs was touched. `backup.service.ts`,
`db-worker-runner.ts` and `integrity-check.service.ts` are untouched. No degradation
report was added at any call site — `SqliteBackupService` already reports its own.

## The R-1 guard decision, per site

**Site 8.2, `start-thoth-cron.ts` — MOVED.** The `if (!refs.sqliteConnection) return
{ summary: 'skipped: no sqlite connection' }` guard sat above the backup and now sits
below `backup('daily')` and its `rotate('daily', 7)`, gating only
`pragma('incremental_vacuum(100)')` and `pragma('optimize')` — the two statements that
genuinely still need the live handle. The summary in that branch now reports what
actually happened rather than a blanket skip: `backup written to <path>; pragmas
skipped: no sqlite connection`, or `backup not taken; pragmas skipped: no sqlite
connection` when the worker returned `null`. `withActivityEmit` and the
`@ptah/daily-backup` job entry are unchanged.

**Site 8.3, `cli-engine/bootstrap/thoth-runtime.ts` — REMOVED, not moved.** Same guard,
but the CLI tier's handler runs no post-backup pragmas at all, so after the backup there
is nothing left for a connection check to gate. `refs` therefore became unused in
`registerBackupJob` and the parameter was deleted rather than left dangling.

One thing this does NOT change, deliberately and worth recording: `startCron` in the
same file returns early when `refs.sqliteConnection === null`, so on that host the backup
job is never registered in the first place. That outer guard is correct — the cron
scheduler is itself SQLite-backed, so with no connection there is no scheduler to run any
job — and it is out of this batch's scope. The inner guard was still worth removing: it
was the one that would have skipped a backup on a host where the job _did_ run.

**Site 8.1 (`migration-runner.ts`) and site 8.4 (`persistence-rpc.handlers.ts`)** carry no
connection guard in front of the backup, so R-1 does not apply to either. 8.4's
`if (this.connection.isOpen)` wrapper was left in place: it is not an R-1-shaped guard,
it is the reset flow's own precondition, and the batch text explicitly protects that
5-step ordering.

## Specs added

- `start-thoth-cron.spec.ts` — `still takes the backup when the connection was torn down
before the run, and skips only the pragmas`: asserts `backup` called with `'daily'`,
  `rotate` called with `('daily', 7)`, and `pragma` **not** called. This is the direct
  R-1 regression pin; it fails against the pre-batch code, which returned
  `'skipped: no sqlite connection'` and never reached the backup service.
- `start-thoth-cron.spec.ts` — `reports the backup as not taken when the worker produced
nothing and there is no connection`: covers the `null` half of the new summary.
- `persistence-rpc.handlers.spec.ts` — `db:reset awaits the backup before closing the
connection`: holds the backup promise open, asserts nothing has run, then releases it
  and asserts the order is exactly `['backup', 'close']`. This is the guard against a
  later "never block" refactor turning 8.4 fire-and-forget.

## Grep sweep for leftover `backup(db, ...)` calls

`\.backup\(\s*[^')\s]` across the whole worktree, `*.ts` including specs — **two hits,
neither a call site**:

- `persistence-sqlite/src/lib/backup.service.ts:6` — prose in the file header describing
  the old behaviour.
- `persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts:619` —
  `await source.backup(request.destPath)`, the **better-sqlite3 driver's own** backup
  method inside the worker. Not `IBackupService`.

The narrower patterns from the brief (`backup\(\s*(this\.)?db`,
`backup\(\s*(conn|connection|database)`, plus `sqliteConn|mockDb|fakeDb`, case-insensitive)
return **zero** hits in the worktree. The only remaining matches repo-wide are in
`.ptah/specs/TASK_2026_383/implementation-plan.md`, which is the plan describing the
change. Zero call sites remain.

## Verification

All commands run from the worktree root with `--skip-nx-cache`.

### `npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/thoth-runtime @ptah-extension/cli-engine @ptah-extension/rpc-handlers`

Header read back: **`Running target test for 4 projects`**.

| Project            | Suites                         | Tests                               |
| ------------------ | ------------------------------ | ----------------------------------- |
| persistence-sqlite | 27 passed, 9 skipped, 27 of 36 | 345 passed, 80 skipped, 425 total   |
| thoth-runtime      | 4 passed, 4 total              | 70 passed                           |
| cli-engine         | 17 passed, 17 total            | 169 passed                          |
| rpc-handlers       | 94 passed, 94 total            | 2715 passed, 31 skipped, 2746 total |

**persistence-sqlite is fully green again** — zero failing suites. The 8 compile failures
Batch 7 left are gone; the 9 remaining skips are the native-ABI guards
(`better-sqlite3` fails to load in this worktree: `The module ...better_sqlite3.node`),
which both the `integration-spec` and `realbinary-spec` probes print by name and skip.
That is the expected local condition, unrelated to Batch 8.

**One flake, investigated and excluded.** On the first `run-many` the whole set was
reported failed; on the second, `rpc-handlers` reported `1 failed, 93 passed` with the
failure in `voice-rpc.handlers.spec.ts` at **34.994 s** — a Jest timeout under parallel
load, in a suite with no backup involvement. Run in isolation immediately afterwards,
`npx nx test @ptah-extension/rpc-handlers` reported **94 passed, 94 total / 2715 passed**
with no failures. `thoth-runtime` behaved the same way and Nx itself printed
`Nx detected a flaky task: @ptah-extension/thoth-runtime:test`; in isolation it is
4 suites / 70 tests green. Both are load-induced, both predate this batch's files, and
the isolated runs are the evidence. The table above is the per-project isolated result.

### `npx nx run-many -t lint -p ...` (same 4)

`Successfully ran target lint for 4 projects`. **0 errors.** 3 warnings on cli-engine and
19 on rpc-handlers, and every one is pre-existing: verified by `git stash`, re-running
lint, and confirming the same warnings appear against the unmodified tree — including
`thoth-runtime.spec.ts:14 'ThothRefs' is defined but never used`, which is in a file this
batch did not touch and was present before it. persistence-sqlite and thoth-runtime are
clean.

### `npx nx run-many -t typecheck -p ...` (same 4)

`Running target typecheck for 4 projects` → `Successfully ran target typecheck for 4
projects`. Zero errors. (`nx affected -t typecheck` is again not used as the gate, for
the `libs/api` ungenerated-Prisma reason recorded under Batch 1.)

### `npx nx run degradation-audit:lint`

`Successfully ran target lint for project degradation-audit`, exit 0.
**`TOTAL 421`**, down from Batch 5/7's 422. Every directory at or under baseline; the
four owned by this batch:

```
libs/backend/cli-engine:          12 ok (baseline 12)
libs/backend/persistence-sqlite:   5 ok (baseline 6)
libs/backend/rpc-handlers:        40 ok (baseline 40)
libs/backend/thoth-runtime:       (no row — zero sites)
```

`persistence-sqlite` **drops one below its baseline** (6 → 5). No new site was introduced
anywhere, so nothing needed fixing or suppressing. The baseline file was **not** updated —
lowering a ratchet is a deliberate act and `--update-baseline` was not part of this batch.
The audit passes under-baseline, so this costs nothing; flag it for whichever later batch
re-baselines.

## Plan deviations

- **8.3 removes the guard rather than moving it.** The batch said "same guard question,
  same answer" as 8.2. The answer is the same in effect — the backup is no longer gated —
  but the CLI handler has no pragmas, so there was nothing below the backup to move the
  guard in front of. Moving it there would have left a check that gates nothing.
- **`registerBackupJob` lost its `refs` parameter.** A consequence of the above, not a
  separate change: `refs` was read only by the removed guard, and leaving it would have
  been an unused parameter.
- **The `start-thoth-cron` skip summary text changed shape.** `'skipped: no sqlite
connection'` no longer describes what happens, since the backup now runs. The two
  replacement strings distinguish "backup taken, pragmas skipped" from "backup not taken,
  pragmas skipped", and both are asserted.

## Out-of-scope observations (reported, not touched)

1. **`voice-rpc.handlers.spec.ts` is slow enough to time out under parallel load** (34.99 s
   against Jest's default 5 s per-test budget being exceeded somewhere in it). It passes
   in isolation, but it will intermittently red the `rpc-handlers` test target on a loaded
   CI machine. Worth a look independently of this task.
2. **`cli-engine` prints `withEngine: file-settings migration failed (non-fatal):
migrationRunner.runMigrations is not a function` ~35 times per test run.** A test double
   is missing a method the production path calls. Non-fatal by design, but it is exactly
   the shape of swallowed degradation this task exists to surface, and no spec asserts it.
3. **`persistence-sqlite`'s 9 skipped suites are invisible without reading the log.** They
   skip on a native-ABI probe. Batch 4's `PTAH_ALLOW_SKIP_UNBUILT` policy deliberately
   excluded the `nativeAvailable` guards; recording here that they are still the largest
   silent-skip population in this lib.
4. **`persistence-sqlite`'s degradation baseline is now one above its actual count**
   (6 vs 5), as noted above.

---

# Revision 1 — the stale `db.backup unavailable` summary

Both reviewers approved Batch 8 with one shared finding: the two daily-backup cron
handlers still reported `'backup skipped (db.backup unavailable)'` on a `null` return.
That text names the pre-Batch-7 in-process driver call, which no longer exists. Since
Batch 7 a `null` means one of three things — no worker factory registered, the worker
produced no result (no reply, early exit, or budget expiry), or the copy failed
validation — and `SqliteBackupService` has already emitted a `'critical'` degradation
event naming which. The summary was pointing at a mechanism that is gone, and away from
the report that holds the answer.

## The change (2 files, 1 line each)

| File                                                         | Line | Was                                        | Now                                                              |
| ------------------------------------------------------------ | ---- | ------------------------------------------ | ---------------------------------------------------------------- |
| `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`     | 419  | `'backup skipped (db.backup unavailable)'` | `'backup not taken; see the database.backup degradation report'` |
| `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` | 448  | `'backup skipped (db.backup unavailable)'` | `'backup not taken; see the database.backup degradation report'` |

The two sites are byte-identical to each other, as they were before.

`database.backup` is the literal shared prefix of the two codes `SqliteBackupService`
reports — `database.backup.no-worker-factory` and `database.backup.not-taken`
(`backup.service.ts:94-95`) — so the string points at a name a reader can actually grep
for, rather than at a driver method. The wording also matches the `backup not taken; <why>`
shape this batch already introduced one branch above it in `start-thoth-cron.ts`
(`'backup not taken; pragmas skipped: no sqlite connection'`), so the file now has one
vocabulary for the null case instead of two.

**No spec asserted the old text** — verified by grepping the worktree for
`backup skipped` and `db.backup unavailable`. The only two survivors are comments, both
in files this batch may not touch: `backup.service.ts:36` (unrelated prose about
serialized calls) and `migration-runner.spec.ts:245`, whose comment still parenthesises
`db.backup unavailable` as the reason `backup()` returns null. That comment is now stale
in the same way the summary was. It is one line, in a file I own, but it is outside the
"do not change anything else" instruction for this revision, so it is **reported, not
fixed** — worth folding into whichever batch next touches that spec.

Nothing else changed. The `IBackupService` fakes were left untyped as instructed.

## Verification

### `npx nx run-many -t test -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine --skip-nx-cache`

Header read back: **`Running target test for 2 projects`** → `Successfully ran target
test for 2 projects`.

```
> nx run @ptah-extension/thoth-runtime:test
Test Suites: 4 passed, 4 total
Tests:       70 passed, 70 total
Time:        26.149 s

> nx run @ptah-extension/cli-engine:test
Test Suites: 17 passed, 17 total
Tests:       169 passed, 169 total
Time:        26.665 s
```

Both green in one pass, uncached, with no flake this time — including the three R-1 specs
added in the original batch, which assert the _other_ two summary strings and so would
have caught a copy-paste error in this edit.

### `npx nx run-many -t lint -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine --skip-nx-cache`

`Successfully ran target lint for 2 projects`. **0 errors.** `thoth-runtime` clean;
`cli-engine` reports the same 3 pre-existing warnings recorded in the original batch
(`cli-adapters.ts:249` empty `dispose`, `thoth-runtime.spec.ts:14` unused `ThothRefs`,
`with-engine.ts:922` max-lines 717), all in files this revision did not touch.

The degradation audit was not re-run: this revision changes two string literals inside
existing return statements and adds no catch, no `.catch()` and no sentinel return, so it
cannot move a count. The original batch's `TOTAL 421` stands.
