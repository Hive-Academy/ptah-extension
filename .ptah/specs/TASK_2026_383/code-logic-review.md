# Code Logic Review — `TASK_2026_383` (Batch 8: Track B — backup call sites)

## Summary

| Metric              | Value                                               |
| ------------------- | --------------------------------------------------- |
| Overall score       | 8/10                                                |
| Assessment          | APPROVED                                            |
| Blocking issues     | 0                                                   |
| Serious issues      | 0                                                   |
| Moderate issues     | 2                                                   |
| Failure modes found | 2 (both pre-existing, not introduced by this batch) |

Scope reviewed: the full working-tree diff for Batch 8 —
`libs/backend/persistence-sqlite/src/lib/migration-runner.ts` (+spec),
`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` (+spec),
`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`, and
`libs/backend/rpc-handlers/src/lib/handlers/persistence-rpc.handlers.ts`
(+spec) — plus `backup.service.ts` (Batch 7 contract, read-only), the CLI
`thoth-runtime.spec.ts` / `thoth-runtime-edge.spec.ts` /
`thoth-runtime.smoke.spec.ts` (unmodified, checked for staleness), and a
repo-wide grep for any remaining `backup(db, ...)` call site.

## Five logic questions

### 1. How does this fail silently?

None found that this batch introduces. The four call sites forward whatever
`SqliteBackupService.backup()` returns (`string | null`, never throws —
`backup.service.ts:148,237-244`) and every caller already treated `null` as
non-fatal before this batch; the batch only removed the redundant `db`
argument, so the null-handling shape is unchanged
(`migration-runner.ts:88-101`, `start-thoth-cron.ts:374-421`,
`thoth-runtime.ts:434-449`, `persistence-rpc.handlers.ts:430-439`). The one
place a silent-looking result survives from before this batch is the summary
string `'backup skipped (db.backup unavailable)'` at
`start-thoth-cron.ts:419` and `thoth-runtime.ts:448` — see Moderate-1.

### 2. What user action produces unexpected behaviour?

Triggering `db:reset` while the connection is open and the out-of-process
worker fails or times out: the backup is awaited (`persistence-rpc.handlers.ts:433`,
pinned by the new "awaits the backup before closing the connection" spec,
`persistence-rpc.handlers.spec.ts:376-421`), returns `null`, and the reset
proceeds anyway — `backupPath: null`, message `"Database reset. No backup was
taken."` (`:454-464`). Verified this is identical to the pre-batch behaviour
(`git show HEAD:...persistence-rpc.handlers.ts` — same `if (this.connection.isOpen)`
guard, same fall-through), so this is not a Batch 8 regression; it is Batch 8
correctly leaving alone the one caller the batch text says must never become
fire-and-forget.

### 3. What input data produces a wrong answer?

None specific to this batch's edits. The four sites do not interpret
`backupDest`/`backupPath` beyond a null check; no new parsing, no new
string-to-enum mapping, no new arithmetic was added.

### 4. What happens when a dependency fails?

- `IBackupService.backup()` itself never throws (documented contract,
  `backup.service.ts:46-48` and enforced by its own try/catch at
  `:249-346`), so none of the four callers need a catch around the resolved
  value — the ones that keep a `try` (`migration-runner.ts:90-97`,
  `persistence-rpc.handlers.ts:432-438`) are defense-in-depth against a
  future contract violation, not load-bearing today. Consistent with the
  service's own documentation.
- `container.resolve<IBackupService>(...)` can still throw if the token is
  unregistered. In `start-thoth-cron.ts:371` and `thoth-runtime.ts:431` this
  resolve happens inside the cron handler body, outside any of the
  surrounding `try` blocks that wrap only the _registration_ code
  (`start-thoth-cron.ts:322-491`, `thoth-runtime.ts:411-467`). A throw here
  rejects the handler's promise; per this lib's own documented contract
  (`thoth-runtime/CLAUDE.md`: "A thrown handler emits nothing and rethrows;
  the scheduler's run row is the failure channel") that is the intended
  behaviour, and it predates this batch — the resolve call itself is
  untouched by the diff, only its downstream argument changed.

### 5. What is missing that the requirements never mentioned?

The batch text asks only that the summary strings be "truthful for every
branch," but two branches — the connection-present-with-`null`-backup path in
`start-thoth-cron.ts:419` and the always-guardless CLI path in
`thoth-runtime.ts:448` — still return `'backup skipped (db.backup
unavailable)'`, wording left over from the pre-Batch-7 in-process
`db.backup()` API. Since Batch 7, a `null` result can mean "no worker
factory," "corrupt copy discarded," "worker produced no result," or
"unavailable verdict" (`backup.service.ts:268-330`) — none of which is "db.backup
is unavailable." Not introduced by this diff (the line is unchanged context,
confirmed against `git diff`), but it is exactly the kind of stale-truthfulness
gap the batch's own acceptance criterion asks about, so it is worth a line in
this review rather than silence. See Moderate-1/2.

## Failure modes

### FM-1 — Stale "db.backup unavailable" wording survives the Batch 7→8 rename (pre-existing, not introduced here)

- Trigger: worker resolves but `backup()` returns `null` while
  `refs.sqliteConnection` is still non-null (Electron/VS Code tier), or in the
  CLI tier unconditionally on any `null`.
- Symptom: the cron run's summary/log line says "backup skipped (db.backup
  unavailable)," which no longer matches any of the four real failure
  branches inside `SqliteBackupService.takeBackup` (no worker, corrupt,
  worker-unavailable-verdict, no-reply/budget-expiry) — an operator reading
  cron history gets a misleading cause.
- Evidence: `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:419`,
  `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:448`.
- Current handling: unchanged by this batch (confirmed: the line carries no
  `+`/`-` marker in `git diff`).
- Recommendation: fold in the `SqliteBackupService`'s own `warn`-level detail
  (already logged at `backup.service.ts:269-281` / `:356-364`) or at minimum
  reword to "backup not taken" to match the vocabulary the service itself now
  uses (`DEGRADE_NOT_TAKEN` / `reportNotTaken`). Not blocking for this batch —
  it is inherited text, not a regression — but it directly bears on the
  batch's own "summary strings are truthful for every branch" acceptance
  criterion and should not be waved through silently in a later pass either.

### FM-2 — CLI tier backup job can be permanently unregistered on a host with no live connection at boot (documented, out of scope, restated for completeness)

- Trigger: `refs.sqliteConnection === null` when `startCron` runs
  (`thoth-runtime.ts:362-367`).
- Symptom: `registerBackupJob` — and therefore the CLI's daily-backup safety
  net — is never called for the life of that process, even though the R-1 fix
  makes the _inner_ handler correctly connection-independent.
- Evidence: `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:362-369`.
- Current handling: explicitly named as a known, deliberate, out-of-scope
  limitation in `batch-8-report.md:52-57` ("That outer guard is correct — the
  cron scheduler is itself SQLite-backed... out of this batch's scope").
  Verified the reasoning holds: `CronScheduler`/`IJobStore`/`IHandlerRegistry`
  are themselves SQLite-backed in this lib's architecture, so with no
  connection there genuinely is no scheduler to register into. Not a defect
  in this batch; restated here because it is the one place "the backup no
  longer needs the connection" is _not_ fully true end-to-end, and a future
  reader of R-1 should not assume it is.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- **Moderate-1**: `start-thoth-cron.ts:419` stale "db.backup unavailable"
  summary text — see FM-1.
- **Moderate-2**: `thoth-runtime.ts:448` same stale text, CLI tier — see FM-1.
- No minor findings beyond FM-2's restatement (already moderate, not
  duplicated here).

## Data flow

1. **`migration-runner.ts` — pre-migration backup.** `applyAll` computes
   `pending` (`:87`), and only if `pending.length > 0 && this.backupService`
   does it `await this.backupService.backup('pre-migration')` (`:88-91`) —
   OK, unchanged contract, single-argument call confirmed against
   `backup.service.ts:148`. A thrown backup is caught and logged, `backupDest`
   stays `null` (`:92-97`) — OK. `backupDest !== null` gates only `rotate`
   (`:98-100`) — OK, never gates the migration loop itself
   (`:103-134` runs unconditionally after the backup block) — OK, matches
   "an unavailable backup still does not block a migration" acceptance
   criterion verbatim.
2. **`start-thoth-cron.ts` — daily backup + pragmas.** Handler resolves
   `IBackupService` (`:371-373`), awaits `backup('daily')` (`:374`) —
   attempted unconditionally, before any connection check — OK, this is
   exactly what R-1 asked for. `rotate('daily', 7)` runs next, its own
   try/catch (`:375-384`) — OK, unaffected by backup's outcome, matching
   `rotate()`'s own "not guarded on the caller's side" documentation in
   `backup.service.ts:438-441`. The connection check moved to gate only the
   two write pragmas (`:388-415`) and its early-return summary distinguishes
   backup-taken vs. backup-not-taken (`:391-394`) — OK, pinned by two new
   specs. Connection-present path retains the pre-existing (unchanged)
   backup-path/unavailable summary — see Moderate-1.
3. **`thoth-runtime.ts` (CLI) — daily backup, no pragmas.** Outer `startCron`
   still gates the whole job registration on `refs.sqliteConnection !== null`
   (`:362-367`, untouched) — see FM-2. Inside the registered handler, the
   connection guard is fully removed rather than moved, because nothing
   downstream of the backup needs the handle (`:422-449`) — OK, matches the
   report's stated rationale and the fact that this handler never touches
   `refs.sqliteConnection` at all. `refs` parameter dropped from
   `registerBackupJob`'s signature and its one call site
   (`:368`) updated together — OK, no dangling reference found by grep.
4. **`persistence-rpc.handlers.ts` — `db:reset`.** Ordering
   backup → close → rename → reopen is untouched: `await
this.backup.backup('reset')` still sits inside `if (this.connection.isOpen)`
   before `this.connection.close()` (`:430-440`) — OK, and the new
   "awaits the backup before closing the connection" spec proves the ordering
   with a controlled-release promise rather than asserting call order alone
   — OK, this is the strongest evidence in the whole batch. Compared against
   `git show HEAD` for the pre-batch file: the only diff is the dropped
   `this.connection.db` argument; the `null`-tolerant fall-through to close/
   rename/reopen is byte-identical — OK, confirmed the batch did not
   accidentally strengthen or weaken this branch.
5. **Repo-wide sweep.** `git grep -n "\.backup(" -- '*.ts' | grep -v spec.ts`
   returns exactly the four call sites plus `backup.service.ts:6` (a doc
   comment), `integrity-worker.ts:45` (a doc comment),
   `integrity-worker-protocol.ts:614,619` (the worker's own
   `source.backup(request.destPath)` against the raw better-sqlite3 driver,
   a different method on a different object, not `IBackupService`), and
   `sqlite-connection.service.ts:43` (a doc comment referencing the method by
   name). No fifth `IBackupService.backup(db, ...)` call site exists — OK,
   matches the report's claim.

## Requirements fulfilment

| Requirement                                                                                             | Status   | Gap                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 8.1 — `migration-runner.ts` drops `db` arg, backup/rotate/null-tolerance unchanged                      | COMPLETE | none                                                                                                                                                                               |
| 8.2 — R-1: guard moved below `backup('daily')`, gates only the two pragmas, spec pins the regression    | COMPLETE | Summary text for the connection-present-and-null-backup branch is stale (Moderate-1), inherited from Batch 7, not newly introduced                                                 |
| 8.3 — CLI guard removed (not moved), `refs` param dropped, no pragmas left ungated                      | COMPLETE | Outer `startCron` connection gate can still prevent registration entirely on a connection-less host (FM-2), explicitly out of scope per report and confirmed architecturally sound |
| 8.4 — `db:reset` backup stays awaited inside the 5-step flow, `null` behaviour unchanged from pre-batch | COMPLETE | none                                                                                                                                                                               |
| "Zero remaining `backup(db, ...)` call sites repo-wide"                                                 | COMPLETE | Verified independently via `git grep`, matches report                                                                                                                              |
| "No second degradation report or in-process fallback added at any call site"                            | COMPLETE | Verified — none of the four sites imports or calls `DegradationReporter`; `SqliteBackupService` remains the sole reporter                                                          |

Implicit requirements not addressed: none identified beyond the stale-summary
wording already noted, which is a documentation/observability gap rather than
a behavioural one.

## Edge cases

| Case                                                                          | Handled | How                                                                                                                                                       | Concern                                                                                         |
| ----------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Migration runner with no `backupService` injected                             | YES     | `pending.length > 0 && this.backupService` short-circuits (`migration-runner.ts:88`)                                                                      | none — pre-existing guard, untouched                                                            |
| Daily backup with connection torn down mid-boot before the cron fires         | YES     | Backup attempted unconditionally, pragmas skipped, truthful two-branch summary                                                                            | Wording quality only (Moderate-1)                                                               |
| Daily backup on CLI host with connection present the whole time               | YES     | Handler unchanged behaviourally, no pragmas ever run in this tier                                                                                         | none                                                                                            |
| `db:reset` backup rejects mid-flight                                          | YES     | Caught, logged, `rawBackupPath` stays `null`, flow proceeds to close/rename/reopen                                                                        | none — verified identical to pre-batch                                                          |
| `db:reset` backup resolves after `close()` would have started (ordering race) | YES     | New spec holds the backup promise open and asserts nothing has run before release, then asserts `['backup','close']` order                                | Strong coverage; no gap found                                                                   |
| A host with no worker factory + `db:reset`                                    | YES     | `backup()` itself returns `null` and reports its own `'critical'` degradation event (`backup.service.ts:273-281`); reset proceeds with `backupPath: null` | none — this batch does not touch this path, and duplicate reporting was checked and not present |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the residual risk is purely cosmetic/observability
  — an operator reading a cron run's summary line after a failed daily backup
  on a host with a live connection still sees wording ("db.backup
  unavailable") that no longer matches any real failure branch in the
  Batch 7 worker-based service.
- What a robust implementation would add: reword the two stale
  connection-present summary branches (`start-thoth-cron.ts:419`,
  `thoth-runtime.ts:448`) to match the vocabulary `SqliteBackupService` itself
  uses ("backup not taken"), and consider whether the CLI's outer
  `sqliteConnection === null` early return in `startCron` (`thoth-runtime.ts:362-367`)
  should eventually be revisited now that the daily backup itself no longer
  needs the connection — even though today's block (`cron-scheduler`'s own
  SQLite dependency) is a real and correctly-identified constraint, not an
  oversight.
