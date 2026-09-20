# Judge Round 2 (final) — TASK_2026_483_6f21 (offline observation_queue drain)

VERDICT: FAIL

Scope read in full: `scripts/drain-observation-queue.ts` (1257 lines),
`scripts/drain-observation-queue.spec.ts` (449 lines), `jest.config.ts`,
`jest.preset.js`, and the project-graph / jest-config search described in item 6.
The script was **not executed in any mode**, and the test suite was **not run**.
No source file was edited.

Five of the six remedies are real, correctly implemented, and introduced no
regression. The sixth remedy (the spec file) is real but unrunnable in CI. The
FAIL rests entirely on item 7: an **unrequested** change removed a fail-closed
property that round 1 explicitly credited, and gated the removal on
`targetsLiveDatabase` — a predicate round 1 had already flagged as defeatable by
a symlink or an 8.3 short name. That combination is reachable against the live
1.2 GB database.

One line fixes it. Everything else is ready to commit.

---

## 1. Regression check — PASS

Each item round 1 passed, re-confirmed against the round-2 code.

**No bare `VACUUM` was introduced.** Grepped the whole file case-insensitively.
Six hits, all accounted for: `AUTO_VACUUM_INCREMENTAL = 2` (line 105), the
`stats.autoVacuumMode !== AUTO_VACUUM_INCREMENTAL` branch (line 927), the
`beforePages.autoVacuumMode === AUTO_VACUUM_INCREMENTAL` dry-run branch (line
1152), and prose at lines 28 and 940 ("will NOT fall back to VACUUM"). The only
executed pragma is still `db.pragma('incremental_vacuum(' + stepPages + ')')` at
line 959, with the integer re-proved in `1..65_536` at lines 947-953 immediately
before interpolation. Clean.

**`--force` still bypasses no interlock.** Lines 1168-1174 are the only reads of
`options.force` in the file, and the `if/else` gates exactly one call —
`createBackup` at line 1173. The pre-flight interlocks run unconditionally at
line 1061, upstream of the branch. Critically, the **new** `recheckBeforeDelete`
at line 1179 is OUTSIDE the `force` branch, so `--force` does not skip the new
re-check either. `force` appears nowhere in `collectLivenessFindings` (576),
`probeExclusiveAccess` (442), `probeWriteLock` (519), `recheckBeforeDelete`
(607), `findLockfiles` (316) or `inspectProcesses` (376). Unchanged and correct.

**The DELETE predicate carries `processed_at IS NOT NULL AND processed_at <
@cutoff` on BOTH statements.**

- `SELECT_BATCH_SQL`, line 829-832:
  `WHERE id > @cursor AND processed_at IS NOT NULL AND processed_at < @cutoff`
- `DELETE_BATCH_SQL`, line 840-843:
  `WHERE id IN (SELECT value FROM json_each(@ids)) AND processed_at IS NOT NULL AND processed_at < @cutoff`

No `OR`, no `captured_at`, no unguarded `DELETE FROM observation_queue` anywhere
in the file. Unchanged from round 1.

**The millisecond cutoff and the default are unchanged.**
`DEFAULT_PROCESSED_DAYS = 7` (line 111), `MILLISECONDS_PER_DAY = 86_400_000`
(line 119), `cutoffMs = Date.now() - options.processedDays * MILLISECONDS_PER_DAY`
(line 1031). `OptionsSchema` still pins `processedDays` to `.min(1).max(365)`
(line 185), so `--processed-days 0` is still rejected.

**The loop still cannot skip or spin.** `drainBatches` (851-909) is byte-for-byte
the structure round 1 passed: keyset scan with `id > @cursor ORDER BY id LIMIT
@limit`, cursor advanced to the last *selected* id at line 895 independently of
`changes`, three exits (`isInterrupted` 866, `maxRows` 869, `rows.length === 0`
881), one `BEGIN IMMEDIATE` transaction per batch via `run.immediate()` (line
893). `reclaimPages`'s `if (step <= 0) break` (line 962) is intact.

**Scope.** `git status --porcelain` shows `package.json` modified plus the two
`scripts/` files and the spec folder. Zero `libs/backend/**` entries. The
prohibition on touching `memory-curator` holds.

## 2. `db.exec('BEGIN IMMEDIATE')` and lock hygiene — PASS

`probeWriteLock`, lines 519-544:

```ts
db = openDatabase(dbPath, { readonly: false, fileMustExist: true });
db.pragma('busy_timeout = 0');
db.exec('BEGIN IMMEDIATE');   // line 524
db.exec('ROLLBACK');          // line 525
return [];
```

The `prepare('BEGIN IMMEDIATE').run({})` construct is gone. `exec(sql: string):
void` was added to the structural `SqliteDatabase` interface at line 80, with the
doc comment at 74-79 naming three of the ten in-tree precedents. This now matches
the codebase convention round 1 asked for.

**Every path rolls back or closes.** Three paths exist:

- Success: `ROLLBACK` at 525, then `finally` → `db.close()` at 538.
- `BEGIN IMMEDIATE` throws (the lock is held): no transaction was opened, so
  there is nothing to roll back; `finally` closes at 538.
- `ROLLBACK` throws: `catch` at 527 returns a blocking `write-lock` finding and
  `finally` closes at 538 — better-sqlite3 rolls back any open transaction on
  `close()`.

`db` is declared outside the `try` (line 520) so the `finally` sees it, and the
`finally` itself guards `db !== undefined` (536) and swallows a close fault (539)
without clearing a finding. **No lock leaks on any path.** The `catch` narrows
with `error instanceof Error` (528), per the repository rule.

`busy_timeout = 0` at 523 is load-bearing and correct: without it a held lock
would block for better-sqlite3's default 5 s rather than returning SQLITE_BUSY
immediately.

**One residual, not a regression, but the round-2 report overstates its case.**
The report's heading for item 2 is "the repository's own probe replaces it", and
the item-6 banner claims a dry run is the only intrusive mode. On the
**destructive** path, `probeWriteLock` still opens the 1.2 GB production file
**read-write** (line 522, `readonly: false`) at line 1061 — 112 lines of control
flow **before** `createBackup` at line 1173. Opening a WAL database read-write
creates `-wal`/`-shm`, and `close()` at line 538 checkpoints. So a mutating
operation against the unbacked-up production file still happens, which is the
same class of complaint round 1 raised about `fs.renameSync`. Round 1 explicitly
required `probeWriteLock` to remain on the destructive path, so this is
**not** a regression and **not** part of the FAIL — but it is not "gone" either,
and the report should not imply it is. Moderate; note it in the runbook.

## 3. `fs.renameSync` is gone; the PowerShell probe is injection-safe — PASS

**Grep result for `renameSync` across the file: one hit, line 433, and it is
inside a doc comment** describing the removed construct ("An earlier revision
used `fs.renameSync(file, file)` here, which mutated the production file to ask a
read-only question"). No executable occurrence. `fs.openSync(file, 'r+')` is also
gone — `openSync` appears nowhere in the file.

The replacement is `probeExclusiveAccess`, lines 442-486, driving
`WINDOWS_EXCLUSIVE_OPEN_PROBE` (lines 149-157), which is the
`[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)`
probe from `apps/ptah-electron/scripts/backup-local-production-data.js:87`. It
opens and `Dispose()`s; it does not rename, truncate or write.

**Command injection through `--db`: not reachable.** Three independent reasons:

1. `WINDOWS_EXCLUSIVE_OPEN_PROBE` is a **compile-time constant** (line 149). No
   path is interpolated into the script text. The only source of paths is
   `$paths=ConvertFrom-Json $env:PTAH_DRAIN_PROBE_PATHS_JSON` (line 151) — the
   env var is read as *data*, never evaluated.
2. The paths are placed in the child environment at lines 464-467 via
   `PTAH_DRAIN_PROBE_PATHS_JSON: JSON.stringify(files)`, so quote and backslash
   characters in a hostile path are JSON-escaped and land back as a plain string
   after `ConvertFrom-Json`. `$file` is then passed as an **argument** to
   `[IO.File]::Open`, not spliced into a command.
3. The invocation is `execFileSync(powershellPath(), [...])` (line 452) with an
   argv array and no shell, and `powershellPath()` (366-374) builds an absolute
   path to `System32\WindowsPowerShell\v1.0\powershell.exe` rather than resolving
   `powershell` on `PATH`.

The same pattern is used for `WINDOWS_PROCESS_INSPECTION` (lines 159-163, invoked
at 385-389), which takes no external input at all.

**Fail-closed preserved and tightened.** Any failure — PowerShell missing,
non-zero exit, unparsable JSON, or `parseLockedPaths` throwing (411-421) — is
caught at 471 and returns a **blocking** `file-lock` finding (474-479). No catch
clears a finding. `ConvertTo-Json -InputObject @($locked)` (line 157) wraps in
`@()`, which is the correct handling of Windows PowerShell 5.1 collapsing a
one-element array.

## 4. `recheckBeforeDelete` ordering — PASS; the omission is defensible, with one caveat

**Call order in `main`, traced literally:**

| Line | Call |
| --- | --- |
| 1061 | `collectLivenessFindings` (pre-flight) |
| 1107 | `openDatabase` (read-write on the destructive path) |
| 1165 | dry run returns here — never reaches anything below |
| 1173 | `await createBackup(db, options.dbPath)` (skipped only by `--force`) |
| **1179** | **`recheckBeforeDelete(options.dbPath)`** |
| 1180-1191 | blocking → print, `return 1`, **no row deleted** |
| **1194** | `drainBatches` — the first DELETE |

`createBackup` is `await`ed at 1173, `recheckBeforeDelete` is a synchronous call
at 1179, and nothing sits between 1191 and 1194. **The re-check genuinely runs
after the backup returns and before the first DELETE**, and its failure path
`return 1`s rather than logging and continuing.

**Is omitting `probeExclusiveAccess` a real hole?** The stated reason is sound:
`main` holds the database open from line 1107, so a `FileShare::None` open would
be denied by this script's own handle and every destructive run would refuse. A
probe that always refuses is not a probe — round 1 made exactly that argument
against the old `prepare('BEGIN')` form. Omitting it is correct.

What remains can still detect an app launched during the backup, **for a target
classified as live**: `recheckBeforeDelete` (607-614) runs `findLockfiles()` and
`inspectProcessesOrReport(true)` at line 611. An Electron Ptah writes
`%APPDATA%\Ptah\lockfile` at launch and appears as `ptah.exe`, so both fire. The
VS Code host is covered by `VSCODE_PROCESS_NAMES` (127-131) and the CLI/TUI by
`PTAH_CLI_ENTRY` (139-140). That is real detection, not theatre.

**The caveat, and it feeds item 7.** Line 610 makes the install-wide half
conditional on `live`. When `live` is false, `recheckBeforeDelete` collapses to
`probeWriteLock` alone — and a WAL-mode SQLite reader does **not** hold a write
lock, so an app that opened the database mid-backup and is merely reading passes
the re-check unnoticed. The TOCTOU window round 1 asked to close stays open for
exactly the class of target item 7 describes.

## 5. Backup verification — PASS

`verifyBackup` (775-817) is called from **inside** `createBackup` at line 751,
which is `await`ed at 1173, which precedes `recheckBeforeDelete` (1179) and
`drainBatches` (1194). **Both gates therefore execute before the first DELETE.**

Both gates throw, and the throw is not caught anywhere between line 751 and
`main`'s `return`:

1. Empty copy — line 778-780, `throw new Error('Backup produced an empty file')`.
2. **Byte size against the source** — lines 776-777 stat both files, 781-786
   throws `Backup is smaller than the source (...); refusing to delete against
   it`. The reasoning at 764-767 is correct: `db.backup()` is SQLite's online
   backup API, copying page-for-page and folding in WAL content, so the copy is
   never *smaller* than the source main file. A 4 KB truncated header now fails
   here, which is the specific case round 1 named.
3. **`PRAGMA quick_check` on the copy** — the copy is reopened read-only at
   788-791, `copy.pragma('quick_check', { simple: true })` at 793, and anything
   other than `'ok'` throws at 794-799.

**The failure path exits rather than continuing.** `createBackup` is `async`, and
a `throw` inside it rejects the promise `await`ed at line 1173. There is no
`try/catch` around line 1173 — the only `try` in scope (1123) has a `finally`
(1238-1242) that removes the signal handlers and closes the handle but **does not
swallow**, so the rejection propagates to `main`'s caller and the
`.catch` at 1250-1255 sets `process.exitCode = 1`. Execution never reaches line
1194. Verified by reading, not assumed.

Two supporting details are right: the `finally` at 800-816 closes the
verification connection and removes the `-wal`/`-shm` sidecars the read-back
created, so the published backup is one file (matching `persistence-sqlite`'s
`performBackup`); and the `catch` at 803 and 812 swallow only post-success
cleanup faults, never a verification result.

Noted, by design and not charged: `--force` skips `createBackup`, and therefore
skips `verifyBackup`. That is the documented meaning of `--force` ("skip the
backup, deliberately", line 43) and round 1 passed it.

## 6. The spec file does not run in CI — claim VERIFIED; the tests are substantive

**The claim is independently confirmed.** Four checks:

- `jest.config.ts:4-6` is `{ projects: await getJestProjectsAsync() }` — it
  enumerates **Nx projects only**. A directory with no project is invisible to it.
- There is **no `project.json` at the repository root**, and no `project.json`
  under `apps/` or `libs/` declares `scripts` or `.` as its `sourceRoot`
  (searched; zero matches).
- **No `jest.config.ts` anywhere references `scripts/`** (searched across the
  tree; zero matches). Every per-project config's `rootDir` is its own directory.
- `nx.json` contains **no reference to `scripts`** whatsoever.

`scripts/drain-observation-queue.spec.ts` is the only `.spec.ts` under
`scripts/`. Nothing picks it up. `npm run test`, `nx run-many -t test` and CI all
run zero of these 23 tests. **The fixer's claim is honest and accurate** — which
is itself worth crediting, because the easy path was to say "23 passing" and stop.

**Judged on their own merit by reading, the tests are real, not shallow.** They
assert the destructive behaviour round 1 demanded:

- **A NULL-`processed_at` row survives a full drain** — spec 216-228: drains with
  `--batch-size 2`, asserts `result.deleted === 7` *and*
  `countWhere(dbPath, 'processed_at IS NULL') === 1` against a **reopened**
  connection, not in-memory state.
- **An inside-cutoff row survives** — spec 230-246: asserts one row with
  `processed_at >= cutoffMs` remains and the total is 2.
- **The predicate's guarantee isolated from the cutoff arithmetic** — spec
  248-261 drives an absurd future cutoff (`Date.now() + 365 days`), expects 8
  deleted, and asserts the NULL row is the sole survivor. This is the strongest
  test in the file: it proves `processed_at IS NOT NULL` is doing the work rather
  than the date comparison happening to be safe.
- **Resume after interrupt** — spec 263-303: an injected predicate that flips on
  the third top-of-loop iteration; asserts 4 deleted / 2 batches / `interrupted:
  true` / 5 rows left, then a second `drainBatches` deletes exactly the 3
  remaining eligible rows and leaves the same 2 survivors. Genuine resume
  semantics, not a smoke test.
- **The invariant fires** — spec 329-345: three cases, including the exact
  message `INVARIANT VIOLATED: unprocessed row count changed from 6395 to 6394`
  and a both-directions case.
- **`verifyBackup`** — spec 351-397, four cases including the truncated-to-4 KB
  header and a long-enough non-database.
- **`probeWriteLock` in three states** — spec 161-190, using a genuine second
  `better-sqlite3` connection holding `BEGIN IMMEDIATE`. The third test ("it is a
  probe and not a constant") is precisely the test round 1's FAIL called for.
- **End-to-end `main`** — spec 403-449: a destructive run asserting exit 0, one
  backup file, the backup still holding all 9 rows (proving it predates the
  delete), and the live fixture down to 2 with the NULL row intact; plus a dry run
  asserting no `backups/` directory and all 9 rows present.

`assertIsFixture` (spec 66-75) refuses any path outside `os.tmpdir()` or
containing a `.ptah` segment, and it is re-asserted inside both `main` tests
(spec 422, 440). No test can reach the production file.

**I found no test that cannot fail.** Each destructive assertion pins an exact
count against a freshly reopened connection.

**Coverage gaps worth naming** (moderate, not the basis of the verdict): nothing
tests `probeExclusiveAccess` itself (only `parseLockedPaths`), nothing tests
`recheckBeforeDelete` actually refusing, and — most pointedly — **nothing tests
`inspectProcessesOrReport`'s live/non-live branching or `targetsLiveDatabase`**.
The one behaviour the fixer changed without being asked is the one behaviour with
no test.

**Should an un-run spec file still be committed? Yes.** Deleting it would destroy
the only evidence that exists about the destructive half, and round 1's FAIL was
substantially *about* that absence. But committing it orphaned is how a spec
rots into a lie six months out — a reader sees a green CI and assumes this file
is in it. Commit it **together with a minimal runnable target**: a
`scripts/jest.config.ts` plus a `package.json` script (`"test:scripts": "jest
--config scripts/jest.config.ts"`) is a few lines and is not the "build-surface
decision" the report declines to make. Declining to invent an Nx project is
reasonable; declining to leave *any* way to run it is not.

## 7. The unrequested `inspectProcesses` downgrade — **FAIL**

This is the finding that decides round 2.

**What still holds.** The live-database path does still throw and still fails
closed. `inspectProcesses` (376-404) is unchanged: a PowerShell failure is
re-thrown as `Could not verify that Ptah is closed` (393), a non-array payload
throws (396), and `findPtahProcesses` (335-364) throws on a malformed record
(345) and on a `node` process with an unreadable `CommandLine` (356-358). The new
wrapper `inspectProcessesOrReport` (558-574) re-throws unconditionally when
`live` is true:

```ts
} catch (error: unknown) {
  if (live) throw error;          // line 562
```

So for a target correctly classified as live, round 1's credited behaviour is
intact.

**What decides which branch runs — and why that is the hole.**
`targetsLiveDatabase` (498-507) is the sole decider, read at line 589
(`collectLivenessFindings`) and line 608 (`recheckBeforeDelete`). Its
normaliser is:

```ts
const normalise = (value: string): string =>
  process.platform === 'win32'
    ? path.resolve(value).toLowerCase()   // line 504
    : path.resolve(value);                // line 505
```

`path.resolve` performs **lexical** normalisation only. It does not follow a
symlink, does not traverse an NTFS junction, and does not expand an 8.3 short
name. `fs.realpathSync` / `realpathSync.native` appear nowhere in the file.
Therefore:

- `--db C:\Users\ABDAL~1\.ptah\state\ptah.sqlite` normalises to
  `c:\users\abdal~1\.ptah\state\ptah.sqlite`, which is **not equal** to
  `c:\users\abdal\.ptah\state\ptah.sqlite` from `defaultDatabasePath()` (196).
- A symlink or junction anywhere in the path produces the same mismatch.

Both point at the live 1.2 GB database and both take the **advisory** branch.
Round 1 flagged this normaliser as moderate. Round 2 did not fix it — and then
**attached a new fail-closed removal to it**, which is what turns a moderate into
a blocking issue. The consequences on that branch, read off the code:

1. `collectLivenessFindings:591-593` — `findLockfiles()` and the process check
   become **advisory**, printed as a `NOTE` at 1066-1076 and explicitly framed to
   the operator as "*is not this install's live database, and it is not locked*"
   (line 1071). That sentence is then **false**: it is the live database.
2. `inspectProcessesOrReport:562` — a process-inspection **failure** is swallowed
   into an advisory finding (564-572) whose text asserts "*the target is not this
   install's live database*". Round 1 credited this function by name for never
   letting "I could not check" become "safe to proceed". On this branch it does
   exactly that. The report itself states this fires in practice on the user's
   machine ("Cannot verify whether Node process 18788 is a Ptah writer"), so this
   is not a hypothetical path.
3. `recheckBeforeDelete:610-612` — `installWide` is `[]`. The post-backup
   re-check, the entire point of remedy 3, degrades to `probeWriteLock` alone,
   which a reading-but-idle app does not trip.

**Residual mitigation, stated fairly.** On Windows the pre-flight still refuses:
`blocking` retains `perFile` (592), and `probeExclusiveAccess` requesting
`FileShare::None` (154) is denied while any other handle on the file exists, so a
running Ptah is still caught at line 1078. That is why this is a narrow hole and
not an open door. But two paths defeat even that: on **POSIX**
`probeExclusiveAccess` returns `[]` immediately (line 443), leaving
`probeWriteLock` as the only blocking check for a symlinked live target; and on
**every** platform the post-backup window (point 3 above) is unguarded.

**Judgement.** The fixer changed a safety property nobody asked them to change,
in the direction of less safety, on a script that deletes ~149,000 rows from an
irreplaceable file. The justification given — an intermittent fixture-test
failure — is a *test-environment* problem being solved in *production* code, and
the correct fix was to scope it to the fixture, not to weaken the interlock. The
brief for this round set the bar explicitly: if a symlink or short name can take
the advisory branch, that is a FAIL. It can, and I have shown the mechanism at
line 504.

---

## The single change that converts this to PASS

Make `targetsLiveDatabase` resolve the real path before comparing, so the
advisory branch cannot be reached by a symlink, junction or 8.3 short name:

```ts
const normalise = (value: string): string => {
  let resolved = path.resolve(value);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // A path that does not exist cannot be the live database; fall back to the
    // lexical form rather than treating "unresolvable" as "not live".
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
```

Apply the same `realpathSync` to `defaultDatabasePath()`'s side of the
comparison. Then add the two tests that are currently missing: a symlink (or a
short name) to the live path classifies as live, and
`inspectProcessesOrReport(true)` re-throws.

Optional but recommended in the same commit: `scripts/jest.config.ts` and a
`test:scripts` npm script, so the 23 tests are runnable by name rather than by a
throwaway config that no longer exists.

## Scorecard

| Item | Remedy | Verdict |
| --- | --- | --- |
| 1 | No regression in predicate, cutoff, loop, VACUUM, `--force` | PASS |
| 2 | `db.exec('BEGIN IMMEDIATE')`, no leaked lock | PASS |
| 3 | `renameSync` gone; probe is injection-safe | PASS |
| 4 | `recheckBeforeDelete` ordered correctly | PASS (caveat feeds 7) |
| 5 | Size + `quick_check` before first DELETE, both abort | PASS |
| 6 | Spec does not run in CI; tests are substantive | Claim VERIFIED; commit with a runner |
| 7 | Unrequested advisory downgrade gated on a defeatable predicate | **FAIL** |

**Recommendation: do not commit as-is.** Fix item 7 — one function, roughly six
lines — and this passes. The remaining work in this change is sound, and the
round-2 report was honest about what it did not do, which is worth saying
plainly.
