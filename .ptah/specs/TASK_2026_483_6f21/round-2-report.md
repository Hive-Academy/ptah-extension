# Round 2 report — TASK_2026_483_6f21 (offline observation_queue drain)

All six items from the judge's "To pass round 2" list are done. Everything the
judge passed in round 1 is untouched: the DELETE predicate, the millisecond
cutoff, `processedDays = 7`, the keyset batch loop, the absence of `VACUUM`,
the `incremental_vacuum` reporting, the Zod argument parsing, and `--force`
gating only `createBackup`.

Files changed:

- MODIFIED `scripts/drain-observation-queue.ts`
- CREATED `scripts/drain-observation-queue.spec.ts`

The script was never executed against `C:\Users\abdal\.ptah\state\ptah.sqlite`,
in any mode. Every run below is against a fixture under the OS temp directory.

---

## 1. `probeWriteLock` uses `db.exec`, and it is proved in both directions

**Change.** `probeWriteLock` now reads:

```ts
db.pragma('busy_timeout = 0');
db.exec('BEGIN IMMEDIATE');
db.exec('ROLLBACK');
return [];
```

`exec(sql: string): void` was added to the local `SqliteDatabase` structural
interface, with a comment naming three of the ten existing call sites
(`observation-queue.store.ts:627`, `memory-lifecycle.store.ts:292`,
`observation-retention.store.ts:641`). The `prepare('BEGIN IMMEDIATE').run({})`
construct is gone.

**Proof.** A throwaway script created a fixture database under
`%TEMP%\drain-probe-*`, opened a SECOND real `better-sqlite3` connection holding
`BEGIN IMMEDIATE`, and called `probeWriteLock` three times: lock free, lock held,
lock released again. The third call is the one that shows it is a probe rather
than a constant that always refuses.

Actual output (run twice, identical both times):

```
fixture: C:\Users\abdal\AppData\Local\Temp\drain-probe-0ycXyv\fixture.sqlite
A) lock free   -> findings = []
B) lock held   -> findings = [{"kind":"write-lock","detail":"SQLite refused the write lock immediately (database is locked)"}]
C) lock freed  -> findings = []
PROOF PASSED
```

The temp script has been deleted; the same three directions are now permanent
coverage in `drain-observation-queue.spec.ts` (`describe('probeWriteLock')`,
three tests), so the proof survives this session.

## 2. `fs.renameSync(file, file)` is gone; the repository's own probe replaces it

`probeExclusiveAccess` no longer opens the file `r+` and no longer renames
anything. On Windows it now shells to PowerShell and runs the probe copied from
`apps/ptah-electron/scripts/backup-local-production-data.js:87` — the file this
script's header already cited as its precedent:

```
[IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
```

It opens each of `ptah.sqlite`, `-wal` and `-shm`, disposes the handle, and
returns the JSON list of paths that could not be opened. Paths are passed
through `PTAH_DRAIN_PROBE_PATHS_JSON` in the child environment, never
interpolated into the script text.

Fail-closed behaviour is preserved and, where it changed, it got stricter:

- The probe failing for any reason (PowerShell missing, non-zero exit, unparsable
  output) returns a **blocking** `file-lock` finding. No catch clears a finding.
- `parseLockedPaths` throws on anything that is not an array of strings, and that
  throw lands in the same catch — malformed output reads as "locked", never as
  "clear". Five malformed shapes are covered by the spec.

On POSIX the function now returns `[]` and says why in its doc comment: SQLite's
POSIX locks are advisory and no `open` mode denies another process, so an open
probe there would always succeed and read as "clear". `probeWriteLock` is the
authority on those platforms — which is exactly what item 1 proved works.

## 3. The TOCTOU window is closed

New exported `recheckBeforeDelete(dbPath)` runs in `main` immediately after
`createBackup` returns and immediately before `drainBatches` is called. Blocking
findings print and return exit 1 with no row deleted, noting that the backup just
taken is intact.

It deliberately omits `probeExclusiveAccess`: by that point THIS process holds
the database open, so a `FileShare::None` open would be denied by our own handle
and every run would refuse. `probeWriteLock` has no such problem — our connection
holds no write lock between transactions — so it is the per-file authority in the
re-check, alongside the lockfile and process checks.

One related asymmetry was fixed while doing this. `inspectProcesses` throws when
it cannot answer (correct, and credited in round 1), but its result was already
ADVISORY for a non-live `--db` target. An advisory check that *failed* was
nevertheless aborting the whole run. `inspectProcessesOrReport(live)` now
re-throws when the target IS the live database — unchanged, fail-closed — and
for any other target downgrades the failure to an advisory finding. This is not
cosmetic: it surfaced as a real, intermittent failure of the fixture test on this
machine, where a Node process with an unreadable `CommandLine` exists
("Cannot verify whether Node process 18788 is a Ptah writer"). The blocking
per-file probes are unaffected.

## 4. The backup is verified, not assumed

`size === 0` is replaced by `verifyBackup(dbPath, destination)`, called inside
`createBackup` and therefore before the first DELETE. Three gates, all throwing:

1. Empty copy.
2. **Byte size against the source.** `db.backup()` copies page-for-page and folds
   in WAL content, so the copy is never smaller than the source main file. A
   shorter copy means a truncated or failed write. A 4 KB header now fails here.
3. **`PRAGMA quick_check` on the copy**, read back through a fresh read-only
   SQLite connection; anything other than `ok` throws. This matches
   `persistence-sqlite`'s `performBackup`, which validates the staging file
   before publishing it.

The copy's `-wal` / `-shm` sidecars — created by reading the copy back — are
removed afterwards, so the published backup is one file, as `performBackup` also
does.

Four spec tests cover this: a valid backup passes; an empty copy, a copy
truncated to 4 KB, and a long-enough non-database copy each throw.

## 5. `scripts/drain-observation-queue.spec.ts` — the destructive path

23 tests over temporary fixture databases. Fixtures are created with
`fs.mkdtempSync` under `os.tmpdir()`, with `auto_vacuum = INCREMENTAL` set before
the first table so `main`'s reclaim path is exercised rather than reported
unavailable, and the schema mirrors migration `0016_observation_queue.ts`. A
runtime `assertIsFixture` refuses any path that is not under the temp directory
or that looks like a real `.ptah` state file. Fixtures are removed in `afterAll`.

The standard fixture is nine rows: seven processed and older than the cutoff, one
processed inside the cutoff, one with `processed_at IS NULL`.

Coverage against the judge's minimum:

- **A `processed_at IS NULL` row survives a full drain** — `drainBatches` deletes
  exactly 7, the NULL row remains.
- **A processed row inside the cutoff survives** — 2 rows left, one of them the
  inside-cutoff row.
- **The NULL row survives even an absurd cutoff** (`Date.now() + 365 days`):
  8 deleted, the NULL row is the only survivor. This is the predicate's real
  guarantee, isolated from the cutoff arithmetic.
- **Interrupt and resume** — an injected interrupt at the top of the third
  iteration stops after two committed batches (4 deleted, 5 rows left,
  `interrupted: true`); a second run with the same options deletes exactly the
  3 eligible rows left behind and leaves the same 2 survivors.
- **The invariant check fires when violated** — the check was extracted into the
  exported `assertUnprocessedUnchanged(before, after)` that `main` now calls, and
  is asserted to throw `INVARIANT VIOLATED: unprocessed row count changed from
  6395 to 6394` and to pass on equality.
- Plus `--max-rows` as a hard ceiling, `probeWriteLock` in three states,
  `parseLockedPaths` on five malformed shapes, the four `verifyBackup` cases,
  and two end-to-end `main` runs on a fixture: a destructive run (exit 0, one
  backup file written, the backup still holds all 9 rows because it was taken
  before the delete, the live fixture is down to 2 with the NULL row intact) and
  a dry run (exit 0, no `backups/` directory created, all 9 rows still present).

**There is no jest project configured for `scripts/`.** I checked: the root
`jest.config.ts` is `getJestProjectsAsync()` over Nx projects, `scripts/` is not
an Nx project, there is no `project.json` at the repo root, no existing spec file
under `scripts/`, and nothing in `nx.json` references the directory. I did not
invent one — adding an Nx project for `scripts/` is a build-surface decision that
belongs to devops, not to this fix.

To run the suite I used a throwaway jest config outside the repository tree
(`rootDir` = worktree, `ts-jest` with `scripts/tsconfig.json`, `testEnvironment:
node`), then deleted it. Command and actual result:

```
npx jest --config <throwaway>/jest.scripts.config.js
Test Suites: 1 passed, 1 total
Tests:       23 passed, 23 total
Time:        22.479 s
```

Run three more times consecutively after the item-3 asymmetry fix, to check the
process-inspection flake was really gone:

```
Test Suites: 1 passed, 1 total   Tests: 23 passed, 23 total
Test Suites: 1 passed, 1 total   Tests: 23 passed, 23 total
Test Suites: 1 passed, 1 total   Tests: 23 passed, 23 total
```

Until an executable target exists, the file is run the same way. Suggested
follow-up for devops, not done here: a `scripts` Nx project with a `test` target,
or folding `scripts/*.spec.ts` into an existing node-environment project.

## 6. The dry-run banner now describes the run

The old banner said `DRY RUN (read-only)` and `nothing was changed` while the
run was opening the file `r+` and renaming it. Two changes:

- `collectLivenessFindings` now runs **neither** per-file probe on a dry run, not
  just `probeWriteLock`. Both are intrusive: `probeWriteLock` opens read-write,
  and `probeExclusiveAccess` momentarily denies every other process access to a
  database a running app may be mid-read on. A dry run needs no interlock — its
  only handle is read-only — so it runs the lockfile and process checks alone,
  and both of those only read.
- The banner says exactly that:

```
[drain] mode        : DRY RUN — the only handle opened on the database is
[drain]               read-only. No DELETE, no backup, no pragma that writes,
[drain]               and the two per-file lock probes are SKIPPED, because
[drain]               both open the file in a way a read-only run must not.
[drain]               Only the lockfile and process checks run, and they only
[drain]               read.
```

and the closing line is now "no write reached the database; the connection above
was opened read-only" rather than "nothing was changed".

---

## Verification commands and results

| Command | Result |
| --- | --- |
| `npx tsc --noEmit --project scripts/tsconfig.json` | No error in either changed file. One pre-existing, unrelated error remains: `scripts/build-eval-harness.ts(25,22): TS7016` (missing `@types/better-sqlite3`) — present before this task and in a file I did not touch. |
| `npx eslint scripts/drain-observation-queue.ts scripts/drain-observation-queue.spec.ts` | 0 errors, 1 warning: `max-lines` (880 > 700) on the script. Warn-level by design per the repository's soft ceiling; the file was already over it in round 1. |
| `npx prettier --write` on both files | Applied; suite re-run green afterwards. |
| Jest, throwaway config, 4 runs | 23/23 passing each time. |
| `probeWriteLock` two-connection fixture proof | PASSED, output quoted above. |

The full test suite was **not** run, per the constraint. CI owns it.

## Not done

- Item 6 of the round-1 list ("record real dry-run figures from the 1.2 GB file
  in a `test-report.md`") is **not** done, and is not one of the six items I was
  given. It is explicitly forbidden by this round's constraints: the user's app
  is open and the script must never be pointed at
  `C:\Users\abdal\.ptah\state\ptah.sqlite`, including in `--dry-run`. The
  destructive path now has the fixture coverage that the judge said a dry run
  could not substitute for; a real dry run remains an operator step for when the
  app is closed.

## Out-of-scope observations (reported, not touched)

- `scripts/build-eval-harness.ts:25` fails `tsc` with TS7016 on `better-sqlite3`.
  Pre-existing and unrelated.
- A second Ctrl-C during the post-drain `readQueueStats` pass is still swallowed
  (`onSignal` returns early and no default handler remains). Judge round 1 noted
  it as minor; it is not in the six-item list, so it is unchanged.
- `targetsLiveDatabase` still normalises with `path.resolve` + `toLowerCase`
  rather than `fs.realpathSync`, so a symlink, junction or 8.3 short name
  demotes the install-wide checks to advisory. Also flagged as moderate in round
  1 and also not in the list; the per-file probes remain blocking in that case.
- There is no Nx target that runs `scripts/*.spec.ts`. Named under item 5.

---

## Round 3

Scope: judge round 2's item 7 and its CI gap. One source file changed, one spec
extended, one config created, two configuration files touched. Nothing else in
the script was edited — the six passing points are byte-for-byte as round 2 left
them apart from the `inspectProcesses` call sites named below.

### 1. `targetsLiveDatabase` now resolves the real path on BOTH sides

`scripts/drain-observation-queue.ts`. The lexical normaliser is replaced by a
`normaliseRealPath` helper that runs `fs.realpathSync.native(path.resolve(value))`
before the Windows case-fold, and `targetsLiveDatabase` calls it for the target
AND for the live path:

```ts
function normaliseRealPath(value: string): string | undefined {
  let resolved: string;
  try {
    resolved = fs.realpathSync.native(path.resolve(value));
  } catch {
    return undefined;
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function targetsLiveDatabase(dbPath, livePath = defaultDatabasePath()) {
  const target = normaliseRealPath(dbPath);
  const live = normaliseRealPath(livePath);
  if (target === undefined || live === undefined) return true;
  return target === live;
}
```

An 8.3 short name, an NTFS junction and a POSIX symlink now all compare equal to
the file they name.

**It FAILS CLOSED, and deliberately not the way the judge's snippet suggested.**
The snippet fell back to the lexical form on ENOENT; this round's brief overrides
that and requires an unresolvable path to be treated as live. It is. Either side
failing to resolve returns `true`, so an unresolvable path can never reach the
advisory branch. That is the stricter of the two classifications: "live" means
every install-wide finding is blocking.

Consequence worth naming: on a host with no `~/.ptah/state/ptah.sqlite` (a fresh
CI runner), the live side is unresolvable, so EVERY target classifies as live.
That is the intended reading — with no install to compare against, refuse to
grant anything the weaker treatment. On Linux CI the install-wide checks return
empty (`findLockfiles` finds no `~/.config/Ptah/lockfile`, `inspectProcesses`
returns `[]` off win32), so nothing is blocked spuriously.

### 2. The unrequested advisory downgrade is DELETED, not justified

`inspectProcessesOrReport` is gone. Both call sites now call `inspectProcesses()`
directly, so a process-inspection failure throws out of `main` on every target,
live or not — exactly as round 1 credited it.

I did not keep the advisory branch, so no justifying paragraph is owed. The
reasoning for deleting it: the only thing it bought was tolerance of an
intermittent host condition (a `node.exe` whose `CommandLine` CIM cannot read,
which makes `findPtahProcesses` throw). I measured that condition on this host
during this round — `Get-CimInstance Win32_Process` returned 344 processes and
**zero** `node.exe` with a null `CommandLine`. It is transient environmental
noise, not a standing property, and the judge is right that a test-environment
problem does not get solved in production code that deletes ~149,000 rows. With
item 1 fixed the live path is identified correctly, so the branch also no longer
has the one target class that made it look defensible.

What is preserved: the live/non-live CLASSIFICATION of findings (blocking vs
advisory) is untouched — that is what judge item 4 passed. Only the swallowing of
a failure-to-check is removed.

### 3. `scripts/` now runs in CI

- **CREATED** `scripts/jest.config.ts` — `displayName: 'scripts'`, the repo
  `../jest.preset.js`, `ts-jest` against `scripts/tsconfig.json`,
  `testTimeout: 120_000` and **`maxWorkers: 1`**. Serial is the right setting for
  a suite where every spec creates a real WAL-mode SQLite file, takes an online
  backup of it and holds a second connection on `BEGIN IMMEDIATE`; it also
  matches the `maxWorkers: 1` the two `apps/ptah-cli` harness configs already pin
  for the same class of reason.
- **MODIFIED** `package.json` — added
  `"test:scripts": "jest --config=scripts/jest.config.ts"`, next to the existing
  `test:native` / `test:e2e` standalone-runner scripts.
- **MODIFIED** `.github/workflows/ci.yml` — a `Run scripts/ tests` step running
  `npm run test:scripts`, immediately after the affected-tests step. Without it
  the npm script exists but CI still runs none of these specs.

**No Nx project was created, and that is the point.** A plain config plus an npm
script needs no `project.json`, therefore no `npx nx reset`, therefore no risk to
another agent working in this worktree.

Two Windows-specific config details, both discovered by the config failing rather
than by guessing:

- `rootDir` is NOT set. Jest 30 loads a TypeScript config as an ES module, where
  `__dirname` is undefined (`ReferenceError: __dirname is not defined in ES
  module scope`). Jest defaults `rootDir` to the config's own directory, which is
  what was wanted.
- `testMatch` is `['**/*.spec.ts']`, not `['<rootDir>/**/*.spec.ts']`. The
  expanded `<rootDir>` came back with mixed forward and back separators
  (`D:/projects/ptah-extension\.claude-worktrees/...`) and the glob then matched
  zero of 25 files while exiting through the "No tests found" path.

### 4. Three tests added for the branch that had none

`scripts/drain-observation-queue.spec.ts`, new `describe('targetsLiveDatabase')`:

1. **`sees through a junction/symlink: an alias of the live path IS the live
   database`** — creates a real directory alias (`fs.symlinkSync(..., 'junction')`
   on Windows, `'dir'` elsewhere) over a fixture directory. A junction needs no
   elevation and no Developer Mode, so nothing is skipped and nothing is
   conditional. It first asserts the two spellings are LEXICALLY distinct — the
   comparison the old code made — so the test genuinely can fail, then asserts
   `targetsLiveDatabase(alias, real) === true`.
2. **`is not constant: a different real file is not the live database`** — the
   control. Two distinct real fixtures compare `false`, which is what stops test 1
   passing against a function that returns `true` unconditionally.
3. **`fails closed: an unresolvable path on either side counts as live`** —
   asserts `true` with the target missing AND `true` with the live side missing.

Both fixture paths go through the existing `assertIsFixture` guard, so neither
new test can address anything outside the OS temp directory.

### Verification

Only the scripts suite was run, per the constraints. The full repository suite was
NOT run.

```
> npm run test:scripts
> jest --config=scripts/jest.config.ts

Test Suites: 1 passed, 1 total
Tests:       26 passed, 26 total
Snapshots:   0 total
Time:        11.303 s, estimated 45 s
Ran all test suites.
```

26 = the 23 round-2 tests, all still passing, plus the 3 added above. A second
run after `prettier --write` reported the same 26 passed in 9.7 s.

```
> npx tsc -p scripts/tsconfig.json --noEmit
scripts/build-eval-harness.ts(25,22): error TS7016: Could not find a declaration
  file for module 'better-sqlite3'.
```

One error, in an unrelated file, pre-existing and already recorded as an
out-of-scope observation in the round-2 report. Zero errors in
`drain-observation-queue.ts`, `drain-observation-queue.spec.ts` or
`jest.config.ts`.

```
> npx eslint scripts/drain-observation-queue.ts scripts/drain-observation-queue.spec.ts scripts/jest.config.ts
  1036:1  warning  File has too many lines (895). Maximum allowed is 700  max-lines
1 problem (0 errors, 1 warning)
```

Warn-level `max-lines`, pre-existing, and the file is shorter than round 2 left
it because the advisory branch was deleted.

`npx prettier --write` was run over all five touched files.

The production database at `C:\Users\abdal\.ptah\state\ptah.sqlite` was not
opened in any mode, in any step of this round.

### Preserved, re-confirmed by reading after the edit

No bare `VACUUM`; `--force` still gates only `createBackup`; both SQL statements
still carry `processed_at IS NOT NULL AND processed_at < @cutoff`; the keyset
loop, the `BEGIN IMMEDIATE` / `ROLLBACK` probe, the `FileShare::None` probe with
paths passed via the child environment, and the backup byte-size plus
`PRAGMA quick_check` gates before the first DELETE are all untouched. The only
edits to `drain-observation-queue.ts` were `targetsLiveDatabase` /
`normaliseRealPath` and the removal of `inspectProcessesOrReport` with its two
call sites rewritten.

### Out-of-scope observations

- Judge item 2's residual stands unchanged: on the destructive path
  `probeWriteLock` opens the production file read-write before `createBackup`.
  Round 1 required that probe to stay there; it is a runbook note, not a defect
  this round was asked to change.
- `probeExclusiveAccess`, and `recheckBeforeDelete` actually refusing, still have
  no direct tests. Named by the judge as a moderate coverage gap; outside this
  round's three items.

