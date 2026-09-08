# Batch 7 — Revision 1

Answers `code-logic-review.md` (NEEDS_REVISION 6/10: 2 serious, 2 moderate,
4 failure modes) and `code-style-review.md` (APPROVED 8/10, 2 minor). Same
worktree, same file scope plus the lib `CLAUDE.md` the coordinator added. Not
committed. The original report follows unchanged below.

## Serious 1 — host-side cleanup now removes the WAL sidecars

`discardArtifact` (`backup.service.ts`) no longer unlinks only the primary file.
It calls **`removeBackupArtifact` from `integrity-worker-protocol.ts`**, which
already owns the `WAL_SIDECAR_SUFFIXES` list (`-wal`, `-shm`) and already never
throws. **Reused, not reimplemented** — the coordinator's first branch applies,
so no new shared function was added and `integrity-worker-protocol.ts` stays at
666 lines, untouched (`git diff --stat` confirms).

Why the reuse is legitimate against this lib's own rule. `CLAUDE.md` says
`SqliteBackupService` "talks to the worker over the protocol, not by calling
[its internals]". That rule is about `performBackup` — the backup _mechanism_.
`removeBackupArtifact` is a pure `fs` helper over an injected `BackupArtifactFs`
(`node:fs` satisfies it structurally, which is how the worker itself passes it).
The import is module-to-module inside one lib, not through the barrel, and the
alternative is precisely what the coordinator forbade: a second copy of "which
files belong to a backup", one of which goes stale. `CLAUDE.md` now records this
as the one named exception.

`discardArtifact` still logs. `removeBackupArtifact` swallows its own failures,
so the wrapper re-checks the PRIMARY file afterwards and warns if it survived —
that is the one whose survival could cost a rotation slot. Net effect: strictly
more cleanup than before, and strictly no less reporting.

The reviewer's exact scenario — an externally-killed worker, where
`performBackup`'s own cleanup branch never executes — is now pinned:

- `SqliteBackupService.backup — sidecar cleanup` ›
  `removes the copy AND both sidecars when the budget expires` (fake timers; the
  worker is scripted to seed all three files and then say nothing, so the
  `DbWorkerRunner` kill is the only way out — the exact path the worker cannot
  clean up for itself)
- the same describe block, table-driven over the other three discard paths:
  `removes the copy AND both sidecars after a worker that exits before replying`,
  `… after an 'unavailable' verdict`, `… after a 'corrupt' verdict`

Each seeds `<dest>`, `<dest>-wal` and `<dest>-shm` and asserts all three are
gone. Removing the `removeBackupArtifact` call fails all four.

## Serious 2 — `backup()` is single-flight by SERIALIZATION

Per the ruling: overlapping calls queue, they are never rejected. A boolean flag
was the wrong tool — it can only turn the second caller away, and "the
pre-migration backup was skipped because the daily cron was running" is the
safety net missing at the one moment it mattered.

```ts
private queue: Promise<void> = Promise.resolve();

async backup(kind: BackupKind): Promise<string | null> {
  const run = this.queue.then(() => this.takeBackup(kind));
  // a rejected tail would wedge every later backup for the life of the process
  this.queue = run.then(() => undefined, () => undefined);
  return run;
}
```

The chain tail is advanced **synchronously**, before `backup()`'s first `await`,
which is what makes two calls in the same tick queue rather than race — the same
property `SqliteIntegrityService.dispatching` gets from being set before its own
first `await`, expressed the way this contract needs. The old body is now
`private takeBackup(kind)`, unchanged apart from the name.

`destPath` is computed inside `takeBackup`, i.e. when the call actually runs, not
when it is enqueued. Computing it at enqueue time would give two queued
`pre-migration` backups the same whole-second `compactIso()` stamp and therefore
the same filename.

**Serialization spec name**:
`SqliteBackupService.backup — overlapping calls` ›
`SERIALIZES two overlapping backups — one worker at a time, both results delivered`.
It starts a `pre-migration` and a `daily` backup without awaiting either, holds
each worker's reply until released, and asserts: after the first flush exactly
**1 spawn** and 1 pending reply; after releasing it, **2 spawns**; a
`maxLive === 1` counter incremented inside the worker script (so the two runs
provably never overlapped); and **two non-null, distinct paths**, in call order.
A second case, `a failed backup does not wedge the queue for the next one`, pins
the rejection-normalising tail.

## Moderates

1. **`backup.service.ts:21-26` overstated the cleanup guarantee** — fixed at the
   source rather than by weakening the claim. The header now says what is true
   and why the host has to be the one to do it: "The worker removes its own
   partial copy whenever it runs to completion, but it CANNOT clean up after a
   run the host killed … So this class removes the destination AND its WAL
   sidecars on every path that returns `null`." A new paragraph states the
   concurrency contract in the same place.
2. **The verification numbers in the original report** — the reviewer re-ran
   every command independently and found no discrepancy (same 8 suites, same
   `TS2554`/`TS2345`, same `persistence-sqlite: 5 ok (baseline 6)`). Nothing to
   fix; recorded.

## The four failure modes

| Failure mode                                                      | Disposition                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sidecar leak on budget-expiry / exit kill                         | **FIXED** — sidecar-aware `discardArtifact`, four pinning specs (above).                                                                                                                                                                    |
| Unspecified concurrent-backup behaviour                           | **FIXED** — serialized, documented in the class header and in `CLAUDE.md`, two pinning specs.                                                                                                                                               |
| (Handled) Budget too tight silently means "no backup"             | **RECORDED, no change.** The reviewer checked the 20-min justification and it holds; every occurrence is loud (`critical` degradation + `warn`), never silent.                                                                              |
| (Handled) Never-throws under a rejecting factory / throwing spawn | **RECORDED, no change.** Already pinned by the `never throws` describe block; the new `queue` tail cannot reintroduce a rejection, and `a failed backup does not wedge the queue for the next one` now proves the queue survives a failure. |

## Style minors

1. **`libs/backend/persistence-sqlite/CLAUDE.md` updated** (the reviewer's point
   that two consecutive batches named the same doc gap and neither fixed it):
   - Public API now lists `BACKUP_WORKER_BUDGET_MS`, `DbWorkerRunner` and its
     three types, and corrects `SqliteIntegrityService`'s surface to include
     `dispose()`.
   - The "worker's own internals are not in the barrel" paragraph gains the one
     named exception, `removeBackupArtifact`, with the reason.
   - `src/lib/backup.service.ts — SqliteBackupService (uses VACUUM INTO / online
backup API)` is replaced by a five-point entry: worker-driven and opens no
     database; **no in-process fallback, by design**; overlapping calls
     serialized; every `null` path discards the copy and its sidecars; and the
     20-minute budget with its reason.
   - The `src/lib/integrity/` bullet now names `db-worker-runner.ts` as the ONE
     run loop shared by both services.
2. **`dest` hoisted outside the `try`** — **RECORDED, unchanged.** The reviewer
   graded it cosmetic and named the alternative (a duplicated `discardArtifact`
   call in the `catch` with its own path computation) as worse. It is, so the
   comment at that line stays the answer.

## Revision 1 verification

```
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite
  ✔ All files pass linting

npx nx run-many -t test -p @ptah-extension/persistence-sqlite
  Test Suites: 8 failed, 8 skipped, 20 passed, 28 of 36 total
  Tests:       55 skipped, 266 passed, 321 total       (was 260 passed / 315 — +6, all new)

  the three owned specs alone:
  Test Suites: 3 passed, 3 total
  Tests:       1 skipped, 81 passed, 82 total          (was 75 passed / 76)
  backup.service.spec.ts alone: 29 passed, 1 skipped (the POSIX chmod case, win32)

npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite
  libs/backend/persistence-sqlite/src/lib/migration-runner.ts(91,63):
    error TS2554: Expected 1 arguments, but got 2.
  NX   Running target typecheck ... failed

npx nx run degradation-audit:lint
  libs/backend/persistence-sqlite: 5 ok (baseline 6)
  degradation-audit: TOTAL 421 unsuppressed site(s)
  NX   Successfully ran target lint for project degradation-audit
```

**The only typecheck failure is still `migration-runner.ts:91`** — confirmed as
required. Grouping every compiler error across the whole suite yields exactly the
same three messages as Revision 0, all in Batch 8-owned files:
`migration-runner.ts:91` (×14) and `migration-runner.spec.ts:186` / `:208`
(`TS2345`, the two stale `IBackupService` doubles). The same 8 suites are red,
all at compile, none at an assertion. The degradation count is unchanged at 5
(baseline 6): the sidecar and serialization work added no new degrade site and
needed no `reported - <CODE>` suppression.

## Revision 1 file deltas

- MODIFIED `libs/backend/persistence-sqlite/src/lib/backup.service.ts` —
  `queue` + the `backup`/`takeBackup` split; `discardArtifact` delegates to
  `removeBackupArtifact`; header rewritten on both points.
- MODIFIED `libs/backend/persistence-sqlite/src/lib/backup.service.spec.ts` —
  +6 cases (4 sidecar, 2 concurrency), plus the `flush()` and
  `seedArtifactWithSidecars()` helpers.
- MODIFIED `libs/backend/persistence-sqlite/CLAUDE.md` — the style minor.
- Unchanged in this revision: `db-worker-runner.ts` (+ spec),
  `integrity-check.service.ts` (+ spec), `di/register.ts`, `src/index.ts`, and
  `integrity-worker-protocol.ts` (never touched by this batch).

---

# Batch 7 — Track B: `SqliteBackupService` becomes worker-driven

Component 9. Executor: `backend-developer`. Worktree
`D:/projects/ptah-extension/.claude-worktrees/task-383`, on top of `a5f4f945`.
Not committed.

## Files

- CREATED
  `libs/backend/persistence-sqlite/src/lib/integrity/db-worker-runner.ts` —
  the run loop lifted out of `SqliteIntegrityService.runWorker`, shared by both
  drivers.
- CREATED
  `libs/backend/persistence-sqlite/src/lib/integrity/db-worker-runner.spec.ts` —
  20 cases over the settle-exactly-once contract.
- REWRITTEN `libs/backend/persistence-sqlite/src/lib/backup.service.ts` —
  worker-driven, `backup(kind)`, no database handle, no in-process fallback.
- REWRITTEN `libs/backend/persistence-sqlite/src/lib/backup.service.spec.ts` —
  rebuilt against a stub worker factory; 25 cases (1 POSIX-skipped on Windows).
- MODIFIED
  `libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts` —
  `runWorker` deleted, `DbWorkerRunner` injected, `runCheck` is the thin adapter.
- MODIFIED `…/integrity/integrity-check.service.spec.ts` — three construction
  sites take the runner; **no assertion changed**, which is the evidence the
  extraction was behaviour-preserving.
- MODIFIED `libs/backend/persistence-sqlite/src/lib/di/register.ts` —
  `DbWorkerRunner` registered as a singleton.
- MODIFIED `libs/backend/persistence-sqlite/src/index.ts` — exports
  `BACKUP_WORKER_BUDGET_MS`, `DbWorkerRunner` and its three types.

## Task 7.1 — the `DbWorkerRunner` API

```ts
export interface DbWorkerOutcome<TResponse> {
  readonly aborted: boolean;
  readonly response: TResponse | null;
}

export interface DbWorkerRun<TResponse> {
  /** Settles once, never rejects. */
  readonly settled: Promise<DbWorkerOutcome<TResponse>>;
  /** Kill the worker and settle as aborted. Synchronous, idempotent, never throws. */
  abort(): void;
}

export interface DbWorkerRunOptions<TResponse> {
  readonly label: string; // 'integrity' | 'backup' — literal, never interpolated
  readonly request: IntegrityWorkerInbound;
  readonly budgetMs: number; // the CALLER's budget
  readonly narrow: (msg: unknown) => TResponse | null;
  readonly signal?: AbortSignal;
}

@injectable()
export class DbWorkerRunner {
  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  run<TResponse>(factory: IIntegrityWorkerProcessFactory, options: DbWorkerRunOptions<TResponse>): DbWorkerRun<TResponse>;
}
```

Four design points, each load-bearing:

1. **The factory is a parameter, not an injected field.** Both services keep
   their own `{ isOptional: true }` injection of
   `INTEGRITY_WORKER_PROCESS_FACTORY`, because "there is no worker in this host"
   means two different things to them — an `info` line said once for the check,
   a `'critical'` degradation event for the backup. A runner that owned the
   factory would have to hand back one answer for both.
2. **The runner holds no per-run state.** Every mutable thing (`isSettled`,
   `worker`, `budgetTimer`) lives in the closure `run()` opens. That is what
   makes one singleton safe for two drivers; `SqliteIntegrityService.dispatching`
   stays a field on that service and is not shared with backup, as required.
3. **The budget is the caller's.** A `quick_check` and a gigabyte copy are not
   the same work, so a shared constant would have to be wrong for one of them.
4. **`abort()` replaces the stored `abortInFlight` closure.** The caller holds
   the `DbWorkerRun` handle; `SqliteIntegrityService.inFlight` is set when `run`
   returns and cleared in a `finally` when it settles, so `dispose()` after a
   completed check is still a no-op and still does not double-kill (both pinned
   by the untouched existing cases).

`SqliteIntegrityService` keeps its name, its token
(`PERSISTENCE_TOKENS.SQLITE_INTEGRITY_SERVICE`) and a public surface of exactly
`isDue` / `dispatchIfDue` / `dispose`. `runWorker` is deleted; `asResponse` and
`record` stay where they were.

## Task 7.2 — the final `backup` contract

```ts
export interface IBackupService {
  /**
   * Take one backup of the configured database through the integrity worker.
   * Returns the destination path on success, `null` on failure. Never throws.
   */
  backup(kind: BackupKind): Promise<string | null>;
  rotate(kind: BackupKind, keep: number): void;
}
```

Constructor (order matters for the four Batch 8 call sites' spec doubles):

```ts
constructor(
  @inject(PERSISTENCE_TOKENS.SQLITE_DB_PATH) dbPath: string,
  @inject(TOKENS.LOGGER) logger: Logger,
  @inject(DbWorkerRunner) runner: DbWorkerRunner,
  @inject(PERSISTENCE_TOKENS.INTEGRITY_WORKER_PROCESS_FACTORY, { isOptional: true })
  factory: IIntegrityWorkerProcessFactory | null = null,
  @inject(TOKENS.DEGRADATION_REPORTER, { isOptional: true })
  degradation: DegradationReporter | null = null,
)
```

Verdict mapping — every non-`'ok'` path returns `null` and leaves no file:

| worker answer            | returned   | artifact                                   | degradation                                     |
| ------------------------ | ---------- | ------------------------------------------ | ----------------------------------------------- |
| no factory (never asked) | `null`     | never created                              | `database.backup.no-worker-factory`, `critical` |
| no reply / exit / budget | `null`     | discarded                                  | `database.backup.not-taken`, `critical`         |
| `verdict: 'unavailable'` | `null`     | discarded **even when `bytesWritten > 0`** | `database.backup.not-taken`, `critical`         |
| `verdict: 'corrupt'`     | `null`     | discarded                                  | none — a definite answer, `logger.warn` only    |
| `verdict: 'ok'`          | `destPath` | kept                                       | none, `logger.info`                             |

Two judgement calls worth flagging to the reviewer:

- **`'unavailable'` discards the artifact even though the worker deliberately
  kept it.** Batch 7 and plan component 9 both say "artifact absent", and they
  are right: the worker reports, this class decides. A file `backup()` does not
  return is a file `rotate()` must never see, because rotation selects by
  filename and the newest name always wins a keep slot. The worker's "keep and
  report `bytesWritten`" is still the correct worker behaviour — it is what lets
  this class tell "the copy completed but could not be checked" apart from
  "nothing was written" in the log line.
- **`'corrupt'` emits no degradation event.** The question was asked and
  answered; that is a warning about the data, not a lost capability. Conflating
  them would make the tally mean two things at once.

Both degradation codes are `source: 'database'`, `severity: 'critical'`, and the
severity doc in `libs/shared/src/lib/types/rpc/rpc-degradation.types.ts:78-82`
names this exact case ("No worker factory, so no database backup was taken" is
`critical`). Codes are module-level string literals, never interpolated.

## The budget

**`BACKUP_WORKER_BUDGET_MS = 20 * 60 * 1000` (20 minutes) — 4×
`INTEGRITY_WORKER_BUDGET_MS` (5 min, `integrity-check.service.ts:70`).**

Justification, in the terms the check's own constant uses: a `quick_check` reads
the source once (measured 20-26 s cold on a 1 GB file). A backup reads the same
file, **writes** a second copy of it, checkpoints and locks the copy down, and
then runs a full `quick_check` over the copy — strictly more work, on a disk now
doing both halves. At a pessimistic 10 MB/s (slow spinning disk, or a
network-mounted home directory) the copy alone is ~100 s before validation, so
the realistic worst case is minutes; 20 min leaves roughly an order of magnitude
of headroom.

The asymmetry of the two errors is what settles it. A budget set too long costs
a boot that waits. A budget set too short does not report slowness — it returns
`null`, and for the pre-migration caller that means **the migration proceeds
with no backup**, the single worst outcome this file can produce. The timer is
`unref`'d in the runner, so a long budget still cannot hold the process open at
quit.

**One residual, called out rather than hidden**: `backup(kind)` takes no
`AbortSignal` (the signature is fixed by the batch), so a host quitting mid-copy
does not kill the child the way `dispatchIfDue({ signal })` does — the worker
runs to completion or to its budget. The runner already supports a signal; if
that matters, the smallest fix later is an options bag on `backup`, and it
belongs to whoever owns the call sites, not here.

## Deletion list, with line evidence (all against the pre-batch file)

| deleted                                               | old lines  | why it is gone                                                                                       |
| ----------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `type BackupIntegrity`                                | `:43-53`   | `IntegrityVerdict` says the same three things in the same order; one verdict vocabulary in this lib. |
| `loadBetterSqlite3ValidationFactory()`                | `:55-70`   | the service opens no database at all now.                                                            |
| `validationFactory` field                             | `:113-126` | ditto; the seam it existed for is the worker factory.                                                |
| `setValidationFactory()`                              | `:128-131` | replaced by stubbing the worker factory, a truer seam.                                               |
| **PC-7**: the `typeof db.backup !== 'function'` guard | `:177-183` | existed only because the service received a foreign handle; there is no handle.                      |
| `await db.backup(dest)` + `fs.chmodSync(dest, 0o600)` | `:191-193` | copy and lockdown are the worker's (`restrictBackupFile`).                                           |
| `checkIntegrity()`                                    | `:224-284` | validation is the worker's (`validateCopy`).                                                         |

Nothing is commented out; `git diff` shows no `// legacy`, no `_unused`, no
second implementation. `import type { SqliteDatabase, SqliteDatabaseFactory }`
is gone from the file. **Unchanged verbatim**: `rotate` (`:312-369`),
`KEEP_BY_KIND`, `dirFor`, `prefixFor`, `destPath`, `compactIso`,
`discardArtifact`. `rotate`'s doc comment gained one paragraph (the sidecar
note); its body has no behavioural edit.

Batch 6's three handoffs, all honoured: the existing `IntegrityCheckOutbound`
alias is reused (not re-derived); the `db` parameter was dropped rather than
branched on; and the sidecar hazard is pinned by a spec.

## Spec names

**The four load-bearing cases** (`backup.service.spec.ts`):

1. no factory → `SqliteBackupService.backup — no worker factory` ›
   `returns null, spawns nothing, and emits exactly one critical report`
   (plus `writes no file anywhere`, and
   `does not throw when no degradation reporter is registered either`).
2. `'unavailable'` → `SqliteBackupService.backup — an 'unavailable' verdict` ›
   `returns null and removes the artifact the worker kept` (the stub writes
   `bytesWritten: 4096` first, so this fails if the discard is dropped) and
   `emits one critical report carrying the worker detail`.
3. `'corrupt'` → `SqliteBackupService.backup — a 'corrupt' verdict` ›
   `returns null and deletes the artifact` and
   `does NOT report a degradation — a corrupt copy is a definite answer`.
4. `'ok'` → `SqliteBackupService.backup — a clean verdict` ›
   `returns the destination path and leaves the file in place` and
   `rotation is callable straight after, and keeps the returned file`.

**POSIX chmod**:
`itPosix("leaves the worker's 0600 lockdown untouched — the service never chmods")`.
Guarded with the same `process.platform === 'win32' ? it.skip : it` idiom and
the same explanatory comment as `integrity-worker-protocol.spec.ts:374`. The
lockdown's own proof is unchanged and still lives where the code does —
`integrity-worker-protocol.spec.ts:383` (dir 0700) and `:446` (file 0600); this
case pins the half that moved, namely that the service does not relax it.

**Rotate / sidecar** (the Batch 6 carry-over):
`SqliteBackupService.rotate` › `never counts a -wal or -shm sidecar as a backup`.
It seeds two real backups plus `…sqlite-wal` and `…sqlite-shm` carrying the same
prefix and a later sort position, rotates with `keep: 2`, and asserts both real
backups survive. The `.endsWith('.sqlite')` filter is what makes it pass;
deleting that filter fails this case.

Also added: `rotate() does not evict a valid backup after a failed attempt`
(now driven by a worker that exits without replying rather than by a throwing
`chmod`), the request-shape case
(`sends exactly one backup request carrying the injected dbPath`), and a DI case
that resolves the service with **neither** optional token registered.

`db-worker-runner.spec.ts` covers the extracted loop directly: reply / exit /
budget / abort as four settle paths, "a second reply cannot settle the run again
or kill a second time", `abort()` idempotence and post-settle no-op, an
`AbortSignal` firing mid-flight, spawn-throws, postMessage-throws, kill-throws,
`unref`, "uses the budget the CALLER passed, not a shared constant", and the
label appearing in the log line.

## Verification

```
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite
  ✔ All files pass linting
  NX   Successfully ran target lint

npx jest --config jest.config.ts \
  --testPathPatterns "(backup\.service|db-worker-runner|integrity-check\.service)\.spec"
  Test Suites: 3 passed, 3 total
  Tests:       1 skipped, 75 passed, 76 total
  (the 1 skip is the POSIX chmod case; this machine is win32)

npx nx run degradation-audit:lint
  libs/backend/persistence-sqlite: 5 ok (baseline 6)
  degradation-audit: TOTAL 421 unsuppressed site(s)
  NX   Successfully ran target lint for project degradation-audit
```

**Degradation audit: 6 → 5.** The two `'unavailable'` catches inside
`checkIntegrity` and the PC-7 guard went with the deletions; one site moved
intact from `integrity-check.service.ts` into `db-worker-runner.ts:142` (the
spawn-failure catch, which warns and settles). No suppression comment was added
anywhere — no new site was created, so no `reported - <CODE>` marker was needed.
The baseline is **not** re-cut; 5 ≤ 6 passes, and lowering it is a ratchet
decision for the team-leader, not for this batch.

```
npx nx run-many -t test -p @ptah-extension/persistence-sqlite
  Test Suites: 8 failed, 8 skipped, 20 passed, 28 of 36 total
  Tests:       55 skipped, 260 passed, 315 total

npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite
  libs/backend/persistence-sqlite/src/lib/migration-runner.ts(91,63):
    error TS2554: Expected 1 arguments, but got 2.
  NX   Running target typecheck ... failed
```

**Both failures are one Batch 8 line, and nothing else.** Grouping every
compiler error emitted across the whole suite gives exactly three distinct
messages, all in Batch 8-owned files:

- `migration-runner.ts:91:63` `TS2554: Expected 1 arguments, but got 2` (×14,
  one per suite that transitively imports the runner)
- `migration-runner.spec.ts:186` and `:208` `TS2345` — the two in-file
  `IBackupService` doubles still declare `backup(_db, kind)`

The 8 red suites are `migration-runner.spec.ts`,
`sqlite-connection.service.spec.ts`, `sqlite-connection.realbinary.spec.ts` and
the five migration specs `0024`, `0028`, `0031`, `0038`, `0039` — every one of
them fails at **compile**, none at an assertion. Task 8.1 is a one-token edit
(`backup(this.db, 'pre-migration')` → `backup('pre-migration')`) plus the two
spec doubles, after which this target goes green; I did not make it, because
`migration-runner.ts` is Batch 8's exclusive file and the batch brief says so
explicitly.

**Expected downstream compile breaks until Batch 8** (all four verified to be
the only `.backup(` call sites in the repo; no fifth exists):

| file                                                                     | line | current call                                                                                                    |
| ------------------------------------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------- |
| `libs/backend/persistence-sqlite/src/lib/migration-runner.ts`            | 91   | `backup(this.db, 'pre-migration')` — **in-lib, and the reason this batch's own test/typecheck targets are red** |
| `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`                 | 372  | `backup(<handle>, 'daily')`                                                                                     |
| `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts`             | 432  | `backup(connection.db, 'daily')`                                                                                |
| `libs/backend/rpc-handlers/src/lib/handlers/persistence-rpc.handlers.ts` | 433  | `backup(this.connection.db, 'reset')`                                                                           |

`nx affected -t typecheck` (the batch's written command) was therefore not run to
green; it cannot be until Batch 8 lands. It was replaced by the scoped typecheck
above, per the batch brief.

Nothing outside the lib constructs `SqliteIntegrityService` or
`SqliteBackupService` directly (`grep` across `libs` and `apps`), so the new
constructor parameters break no host — every one resolves through tsyringe.

## Plan deviations

1. **`DbWorkerRunner` takes the factory as a call parameter** rather than
   injecting it. The plan says only "extract it into a small collaborator both
   services inject". Injecting the factory into the runner would have collapsed
   the two services' different "no factory" behaviours into one; keeping it a
   parameter is what preserves the batch's own requirement that the backup
   service inject it `{ isOptional: true }` itself.
2. **`run()` returns a handle rather than a bare promise.** `dispose()` needs a
   synchronous way to reach the run in flight, which the old code did with a
   stored closure. A handle carries that without the runner keeping state.
3. **The `abort()`/`AbortSignal` seam is unused by the backup path**, since
   `backup(kind)` takes no signal. Recorded above under the budget rather than
   silently.
4. **`register.ts` registers `DbWorkerRunner` as a singleton**, even though
   `IntegrityCheckStateStore` is resolved unregistered. It is stateless, so
   either works; the explicit registration is where the "one shared mechanism"
   intent is documented.

## Out-of-scope observations (not touched)

- `libs/backend/persistence-sqlite/CLAUDE.md` "Public API" and "Internal
  Structure" now understate the lib: `DbWorkerRunner` and
  `BACKUP_WORKER_BUDGET_MS` are new exports, and the backup-service bullet still
  says "uses VACUUM INTO / online backup API", which is now the worker's job. It
  is not in Batch 7's owned files — worth folding into Batch 8 or the completion
  pass.
- `migration-runner.spec.ts:186,208` hold two hand-written `IBackupService`
  doubles that Batch 8 must update alongside the call, or the suite stays red on
  `TS2345` even after line 91 is fixed.
- `sqlite-connection.service.ts:43` has a doc comment referring to "the
  non-fatal guard in `SqliteBackupService.backup()`" — that guard is PC-7 and is
  now deleted. A stale comment only; the code path is unaffected.
