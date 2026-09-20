# Judge Round 1 — TASK_2026_483_6f21 (offline observation_queue drain)

VERDICT: FAIL

Scope read in full: `scripts/drain-observation-queue.ts` (1008 lines), the
`db:drain-observations` line in `package.json`, `scripts/tsconfig.json`,
`.ptah/specs/TASK_2026_483_6f21/context.md`, plus the runtime sources needed to
check the unit and the defaults. The script was **not executed**, in any mode.

The delete predicate is correct and the unit is correct — the highest-risk item
passes. The script fails on verification, on the honesty of `--dry-run`, and on
a needless mutating syscall aimed at the unbacked-up production file.

---

## 1. The DELETE predicate and the epoch unit — PASS (highest-risk item)

**The SQL.** Two statements touch rows, and both carry the full predicate:

- `drain-observation-queue.ts:642-645` (`SELECT_BATCH_SQL`)
  `WHERE id > @cursor AND processed_at IS NOT NULL AND processed_at < @cutoff`
- `drain-observation-queue.ts:653-656` (`DELETE_BATCH_SQL`)
  `WHERE id IN (SELECT value FROM json_each(@ids)) AND processed_at IS NOT NULL AND processed_at < @cutoff`

The `IS NOT NULL` guard is present on both, as required. It is indeed redundant
against `processed_at < ?` (three-valued logic makes that NULL, not true, for a
NULL row), but redundancy in the safe direction is the right call and it mirrors
the runtime store at
`libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts:47`.
There is no `OR`, no `captured_at`, and no unguarded `DELETE FROM
observation_queue` anywhere in the file.

**The unit — traced to the writer, not to a comment.** The column is written in
exactly one place:

- `libs/backend/memory-curator/src/lib/observation-queue.store.ts:155`
  `const MARK_PROCESSED_SQL = 'UPDATE observation_queue SET processed_at = ? WHERE id = ?'`
- `libs/backend/memory-curator/src/lib/observation-queue.store.ts:573,577`
  `const now = Date.now(); ... stmt.run(now, id);`

`captured_at` likewise: `observation-queue.store.ts:355,380` — `const capturedAt
= Date.now()`. So both columns store **epoch milliseconds**.

The script computes
`drain-observation-queue.ts:818` → `Date.now() - options.processedDays * MILLISECONDS_PER_DAY`
with `MILLISECONDS_PER_DAY = 86_400_000` (line 112). Same unit. **No
seconds/milliseconds mismatch.** `Date.now()` is a safe integer, so
better-sqlite3 binds it as int64 and the comparison against the INTEGER-affinity
column is numeric, not textual.

A further guard worth crediting: `OptionsSchema` pins `processedDays` to
`.min(1)` (line 161), so `--processed-days 0` — the one argument value that
would sweep every processed row — is rejected before any SQL is built.

## 2. Cutoff default vs the runtime `processedDays` — PASS

- Script: `DEFAULT_PROCESSED_DAYS = 7` (`drain-observation-queue.ts:104`).
- Runtime: `MEMORY_RETENTION_DEFAULTS.processedDays: 7`
  (`libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts:31`),
  echoed at `libs/backend/platform-core/src/file-settings-keys.ts:590`.
- Runtime cutoff arithmetic:
  `memory-retention.service.ts:343` → `startedAt - settings.processedDays * DAY_MS`.
  Identical shape to line 818.

The script's `max(365)` (line 161) also matches
`MEMORY_RETENTION_SETTING_RANGES.processedDays: { min: 1, max: 365 }`
(`memory-retention-config.ts:38`). Match confirmed.

## 3. The batch loop — PASS

`drainBatches`, `drain-observation-queue.ts:664-722`.

- **No OFFSET.** It is a keyset scan: `id > @cursor ORDER BY id LIMIT @limit`
  (line 643-645), cursor advanced to the last selected id at line 708. Because
  the cursor moves on the *selected* id rather than the deleted id, a row that
  somehow survived the DELETE would be stepped over for the remainder of that
  run — that is the safe direction (not deleted), and a re-run restarts at
  `cursor = 0` (line 673) and picks it up.
- **Cannot loop forever.** Three independent exits: `rows.length === 0` (line
  694), `maxRows` reached (line 682), interrupt (line 679). Critically, the
  cursor advances on every iteration that selected anything, *independently of
  `changes`* — so a batch that deletes zero rows still makes progress. There is
  no state in which the same batch is re-selected.
- **Bounded transaction.** `DEFAULT_BATCH_SIZE = 2_000` (line 107), one
  `BEGIN IMMEDIATE` transaction per batch (line 700-706). Meets the context's
  "do not build one 171k-row DELETE".
- **Interrupt is batch-atomic.** better-sqlite3 is synchronous, so a SIGINT
  handler cannot fire mid-transaction; the flag is read at line 679 only.

Minor: after the first SIGINT, `onSignal` returns early (line 883) and no
default handler remains, so a second Ctrl-C is swallowed. The operator's only
escape during the post-drain `readQueueStats` passes over a 1.2 GB file is
SIGKILL.

## 4. Interlocks — PARTIAL, with one gap that is the basis of the FAIL

**Fails closed, correctly:**

- `inspectProcesses` (line 340-374): any failure of the PowerShell probe is
  re-thrown as `Could not verify that Ptah is closed` (line 363); a non-array
  payload throws (line 366); a malformed record throws (`findPtahProcesses`,
  line 317-320); a `node` process with an unreadable `CommandLine` throws rather
  than being cleared (line 329-332). "I could not check" never becomes "safe to
  proceed". This half is copied faithfully from the repo precedent at
  `apps/ptah-electron/scripts/backup-local-production-data.js:97-119`.
- `probeExclusiveAccess` (line 382-412): every `catch` branch *adds* a blocking
  finding (line 405-409). An unexpected errno is treated as "locked".
- `probeWriteLock` (line 445-470): every error path returns a blocking
  `write-lock` finding (line 453-460).
- `main` (line 847-860): on a destructive run, any blocking finding returns exit
  1 before the database is opened.
- The lockfile path is real and correct for the shipping app. `app.setName('Ptah')`
  at `apps/ptah-electron/src/main.ts:43`, `productName: Ptah` in
  `apps/ptah-electron/electron-builder.yml:2`, and `%APPDATA%\Ptah\lockfile`
  exists on this machine. `USER_DATA_DIR_NAME = 'Ptah'` (line 118) matches.
- The dev instance (`Ptah Dev`, `main.ts:43-45`) is *not* checked — but it
  resolves to `ptah-dev.sqlite`, a different file
  (`libs/backend/persistence-sqlite/src/lib/db-path.ts:13`), so this is not a
  live-file gap. Noted, not charged.

**The gap — the only real interlock on the destructive path has never run.**

`collectLivenessFindings` (line 480-482) skips `probeWriteLock` on a dry run.
The rename probe is the other per-file check, and on POSIX it is a documented
no-op (the script says so itself, line 440-443). So for the destructive path the
whole weight rests on `probeWriteLock` — and `probeWriteLock` is the one function
a dry run cannot exercise. The only verification claimed for this task is a dry
run. See item 10.

Worse, `probeWriteLock:450` is written as:

```ts
db.prepare('BEGIN IMMEDIATE').run({});
```

This construct appears **nowhere else in the repository**. Every one of the ten
existing transaction-control call sites uses `exec`, not a prepared statement —
`observation-queue.store.ts:627`, `memory-lifecycle.store.ts:292`,
`observation-retention.store.ts:641`, `retention-sqlite.test-support.ts:138,390,434`,
and the spec files at `observation-retention.store.spec.ts:708` and
`memory-lifecycle.store.spec.ts:314`. better-sqlite3 treats transaction-control
statements specially in `prepare()`, and `.run({})` passes a named-parameter
object to a zero-parameter statement. If either throws, the `catch` at line 453
turns it into a permanent blocking finding: the destructive path would refuse on
every invocation and print `SQLite refused the write lock immediately` whether
or not anything holds the lock. The interlock would then be a constant, not a
probe — and nobody would find out, because it fails in the safe direction and
looks exactly like a correctly-refused run.

I could not settle this by reading better-sqlite3 (no `@types` and no
`prepare('BEGIN')` precedent in-tree), and I did not run it. **Unverified is the
finding**: the only gate standing between 149,000 rows and a live database uses
a construct the codebase deliberately does not use, and has never been
executed.

## 5. Backup ordering, verification, and `--force` — PARTIAL

**Ordering: PASS.** `createBackup` is awaited at `drain-observation-queue.ts:942`;
`drainBatches` is called at line 946. Sequential `await`, same function, no
concurrency. No DELETE can execute before the backup resolves. `db.backup()`
(line 623) is SQLite's online backup API, so WAL content is folded in — the
comment at 603-607 is correct, and a plain `copyFile` would indeed have lost the
tail.

**Verification: WEAK.** The entire check is `fs.statSync(destination).size` and
`if (size === 0)` (line 624-627). That is a size check in the most literal sense
and nothing more: it does not compare against the 1.2 GB source, and it runs no
`PRAGMA quick_check` / `integrity_check`. The repository's own standard for a
backup taken before a destructive operation is higher — per
`libs/backend/persistence-sqlite/CLAUDE.md`, `performBackup` creates a randomized
staging file, **validates it read-write**, strips sidecars, and only then
atomically publishes it to the final name. A 4 KB truncated header would sail
through line 626.

**`--force`: PASS.** Line 937-943 shows `options.force` gating exactly one
thing — the `createBackup` call. The interlocks run unconditionally at line
830-874, upstream of and independent from the `force` branch, and `force` is
read nowhere in `collectLivenessFindings`, `probeExclusiveAccess`,
`probeWriteLock`, `findLockfiles` or `inspectProcesses`. **`--force` does not
bypass the safety probes.** This is correct and is the single most important
thing `--force` could have got wrong.

## 6. `incremental_vacuum` only, and an honest `auto_vacuum` report — PASS

Grepped the whole file case-insensitively for `vacuum`. Seventeen hits, every
one of them either `auto_vacuum` (a read), `incremental_vacuum`, or prose. The
only executed pragma is
`drain-observation-queue.ts:772` → `db.pragma('incremental_vacuum(' + stepPages + ')')`.
**There is no bare `VACUUM` statement in the file.**

`reclaimPages` (line 734-790) reads `PRAGMA auto_vacuum` **first** (line 739 via
`readPageStats:525`) and returns `available: false` with a named mode —
`NONE` / `FULL` / the raw number — plus the explicit sentence "This script will
NOT fall back to VACUUM" (line 747-754). `main:954-955` surfaces that as a
warning. The dry run reports the same fact both ways at line 921-933. This is
the honest reporting the context asked for.

Injection guard: `stepPages` is re-proved as an integer in `1..65_536`
immediately before interpolation (line 761-766), on top of the Zod bound at line
164. Both bounds mirror `SqlitePageReclaimer`. Correct — a pragma argument
cannot be bound, so a re-assertion at the call site is the right pattern.

Loop termination in `reclaimPages`: `if (step <= 0) break` (line 775) covers the
no-progress case. Cannot spin.

## 7. `--dry-run` writes nothing — FAIL as stated

**What is true.** The SQLite handle is opened read-only:
`drain-observation-queue.ts:876-879` → `openDatabase(options.dbPath, { readonly: options.dryRun, ... })`.
The function returns 0 at line 934, before `createBackup`, `drainBatches`,
`reclaimPages`, `wal_checkpoint(TRUNCATE)` and the invariant check. The
`db.close()` in the `finally` (line 993) is on a read-only connection, which
cannot checkpoint. And the implementer's specific claim **is** true as far as it
goes: `collectLivenessFindings:480-482` does skip `probeWriteLock` on a dry run,
with the stated reason at line 476-479.

**What is false.** `probeExclusiveAccess` still runs on a dry run (line 481),
and it does this to `ptah.sqlite`, `ptah.sqlite-wal` and `ptah.sqlite-shm`
(line 384):

```ts
handle = fs.openSync(file, 'r+');   // line 392
fs.closeSync(handle);               // line 393
fs.renameSync(file, file);          // line 395
```

`fs.openSync(file, 'r+')` **is opening the database read-write** — at the OS
level rather than through SQLite. The specific hazard named in the review brief
(a read-write SQLite handle checkpointing the WAL on close) is avoided, because
this is not a SQLite handle. But the run advertised at line 824 as
`DRY RUN (read-only)` and at line 914 as "nothing was changed" issues a
write-mode open and a **`rename(2)` syscall against the user's 1.2 GB production
database and both its sidecars**. A dry run that renames the file it is
describing is not a dry run, and the banner is wrong.

## 8. Repository constraints — PASS

- **`catch (error: unknown)`**: lines 361, 396, 453, 1002, each narrowed with
  `error instanceof Error ? error.message : String(error)` before touching
  `.message` (lines 362, 404, 454, 1004). The three bare `catch {` blocks (399,
  407-ish, 465) bind nothing and so cannot violate the rule; each carries a
  comment explaining why swallowing is correct there.
- **No `@ts-ignore` / `@ts-expect-error`**: grepped, zero hits. No `any`.
- **Zod at the external boundary**: `OptionsSchema` (line 159-167) with
  `safeParse` and a readable aggregated error (line 234-249). Additionally,
  unknown tokens are rejected outright (line 197-199) rather than ignored, and
  `parseIntegerOption` enforces `/^\d+$/` before `parseInt` (line 179-181), so
  `--batch-size 10abc` cannot silently become 10. Good.
- **No modification under `libs/backend/memory-curator`**: `git status --porcelain`
  in this worktree shows only `libs/frontend/chat*` changes (unrelated,
  pre-existing), `package.json`, `scripts/drain-observation-queue.ts` and two
  `.ptah/specs` folders. Zero `libs/backend/**` entries. Confirmed clean.
- **No index added on `observation_queue`**, and no `processed_at =` write:
  grepped the file, absent. The context's two other prohibitions hold.
- `scripts/tsconfig.json` is `"module": "commonjs"` with `strict` and
  `noUncheckedIndexedAccess`, so the `require('better-sqlite3')` at line 89 and
  the `require.main === module` guard at line 997 are valid, and the
  `argv[index]`/`ids[ids.length - 1]` undefined checks at lines 196 and 698 are
  required rather than defensive noise.

## 9. npm script wiring and `--` pass-through — PASS

`package.json:70`:

```json
"db:drain-observations": "npx ts-node --project scripts/tsconfig.json scripts/drain-observation-queue.ts"
```

Consistent with the neighbouring `sanitize:sessions` at `package.json:69`, same
tsconfig, which exists. `npm run db:drain-observations -- --dry-run` appends
`--dry-run` after the script path; `ts-node` forwards everything after the entry
file to the script, so `process.argv.slice(2)` (line 998) yields `['--dry-run']`.
`parseArgs` handles it at line 200-202. Pass-through reaches the script.

## 10. The finding that decides it — the destructive path has no verification

The context asks for a dry run as the meaningful test (context.md:82-86). A dry
run returns at `drain-observation-queue.ts:934`. Everything downstream of that
line is the destructive path, and **none of it can be reached by the only test
that was performed**:

| Line | Code | Exercised by a dry run? |
| --- | --- | --- |
| 450 | `probeWriteLock` / `BEGIN IMMEDIATE` | No — skipped at 480 |
| 942 | `createBackup` on a 1.2 GB file | No |
| 946 | `drainBatches` — every DELETE | No |
| 953 | `reclaimPages` / `incremental_vacuum` | No |
| 964 | `wal_checkpoint(TRUNCATE)` | No |
| 984 | the unprocessed-count invariant check | No |

There is no `scripts/drain-observation-queue.spec.ts` and no test of any kind for
this file anywhere in the tree. `parseArgs`, `lockfileCandidates`,
`findPtahProcesses`, `probeExclusiveAccess`, `targetsLiveDatabase` and
`probeWriteLock` are all `export`ed — clearly with tests in mind — and none was
written. The task folder holds only `context.md` and `task.md`: no
`test-report.md`, no recorded dry-run figures.

For a script whose purpose is to delete ~149,000 rows from an irreplaceable
1.2 GB file, "the read-only half ran once" is not evidence about the half that
deletes.

## 11. Other findings (not load-bearing for the verdict)

- **Moderate — the rename probe runs before the backup exists.**
  `collectLivenessFindings` is called at line 830; `createBackup` at line 942.
  So `fs.renameSync(ptah.sqlite, ptah.sqlite)` touches the production file
  ~100 lines of control flow before any copy of it exists. The repository
  already owns a *non-mutating* exclusive-access probe for precisely this
  question — `[IO.File]::Open($file, Open, ReadWrite, FileShare::None)` at
  `apps/ptah-electron/scripts/backup-local-production-data.js:87` — and the
  script's own header cites that file as its precedent, but copies only the
  process-inspection half and invents a rename for the lock half.
- **Moderate — `targetsLiveDatabase` (line 424-433) normalises with
  `path.resolve` + `toLowerCase`, never `fs.realpathSync`.** A symlink, a
  junction, a UNC path or an 8.3 short name pointing at the live database
  returns `false`, which silently demotes the lockfile and process checks from
  blocking to advisory (line 484-486). The per-file probes still apply, so this
  is a downgrade rather than a hole — but it is a downgrade of the checks that
  actually name the running app.
- **Moderate — TOCTOU.** The interlocks run at line 830; the drain starts at
  line 946, after a backup that takes minutes on a 1.2 GB file. Nothing holds
  the exclusion across that window, and the main connection (line 876) never
  sets `busy_timeout`, so an app launched mid-drain meets the better-sqlite3
  default 5 s wait and then `SQLITE_BUSY`.
- **Minor — the "freed" figure can mislead.** `fileSizeBytes` (line 501-507)
  sums db + wal + shm, and it is sampled after `wal_checkpoint(TRUNCATE)` (line
  964). When `auto_vacuum != 2`, line 978-982 will report a healthy "freed N MB"
  that is almost entirely WAL truncation, not reclaimed pages, directly under a
  warning saying the file will not shrink.
- **Minor — `reportStats` (line 796) exceeds the formatting the rest of the file
  keeps.** Routed to style review, not scored here.

---

## Verdict

**FAIL.** The dangerous arithmetic is right: the predicate cannot reach a
`processed_at IS NULL` row, the cutoff is in milliseconds exactly as the writer
stores it, the default matches the runtime's 7, the loop cannot skip or spin,
`VACUUM` is genuinely absent, and `--force` does not weaken a single interlock.
Three things stop it shipping: the sole interlock guarding the destructive path
(`probeWriteLock`) uses a `prepare('BEGIN IMMEDIATE').run({})` construct the
codebase avoids in all ten comparable call sites and has never been executed;
`--dry-run` opens the live database read-write with `fs.openSync(..., 'r+')` and
renames it, before any backup exists, while printing "read-only" and "nothing
was changed"; and the backup's only verification is `size === 0`, well below the
validated-copy bar this repository sets for itself.

**To pass round 2**, in priority order:

1. Prove `probeWriteLock` against real `better-sqlite3` — with a second
   connection actually holding `BEGIN IMMEDIATE` — and switch line 450 to
   `db.exec('BEGIN IMMEDIATE')` to match the ten existing call sites.
2. Drop the `fs.renameSync(file, file)` mutation. Use the repository's own
   `FileShare::None` open probe (`backup-local-production-data.js:87`), which
   answers the same question without writing.
3. Re-check the interlocks immediately before the first DELETE, after the
   backup, closing the TOCTOU window.
4. Verify the backup against the source: compare byte size and run
   `PRAGMA quick_check` on the copy before the first DELETE.
5. Add `scripts/drain-observation-queue.spec.ts` over a temporary fixture
   database that exercises the *destructive* path: a NULL-`processed_at` row and
   an inside-cutoff row both survive a full drain, the loop resumes correctly
   after an injected interrupt, and the invariant check fires when it should.
6. Then record real dry-run figures from the 1.2 GB file in a `test-report.md`.
