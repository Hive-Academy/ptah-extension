# Batch 6 — Revision 1

Answering `code-logic-review.md` (NEEDS_REVISION 6/10 — 1 serious, 3 moderate,
5 failure modes) and `code-style-review.md` (APPROVED 8/10, 3 minor). Same
worktree, same scope, no commit, no `nx reset`.

**Everything is addressed. Nothing is deferred as out of scope.**

## The serious finding: A-1 is now pinned by a test, not by prose

**New file**:
`libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-backup.integration.spec.ts`
— 8 cases against the real `better-sqlite3`, using the repository's
`nativeAvailable ? it : it.skip` idiom (`sqlite-connection.realbinary.spec.ts:12-34`,
`memory-curator/src/lib/code-symbol.store.spec.ts:170-184`).

**It required a refactor, and the refactor is the real fix.** The reviewer's
parenthetical — "`integrity-worker.ts` (no spec exists or can exist)" — was the
actual defect. The worker entry throws at module scope when there is no parent
port, so Jest cannot import it, which meant the entire executable body of the
`backup` command was in the one file in this repository that no test can reach.
Adding a spec beside it would not have helped; the code had to move. So
Revision 1 moved `runBackup` / `validateCopy` out of `integrity-worker.ts` and
into `integrity-worker-protocol.ts` as **`performBackup(env, request)`**, behind
an injected `BackupEnvironment` (`fs`, `openSource`, `openCopy`, `now`,
`inFlight`). `integrity-worker.ts` is now openers plus dispatch — 398 → **298
lines** — and it still imports only its protocol module.

The spec calls `performBackup` **directly, not through the worker transport**,
and builds its two openers with the same flags the worker binds
(`{ readonly: true, fileMustExist: true }` for the source, `{ fileMustExist: true }`
for the copy), so what is under test is the real pairing.

The 8 cases:

1. **A-1 itself** — a live writer connection is held open and inserting on a 1 ms
   interval for the whole test; the source is opened `{ readonly: true }`;
   `performBackup` runs; the response must be `verdict: 'ok'`, `detail: null`,
   `quickCheck: 'ok'`, `bytesWritten > 0`, and the destination is then reopened
   independently and must itself report `quick_check = ok` with all the rows.
2. **No `-wal`/`-shm` sidecar** survives beside the finished backup —
   `readdirSync` of the backups directory must equal exactly one filename. This
   is what forces `openCopy` to stay read-write.
3. **The source database is untouched** — the writer's handle still works and the
   row count has not gone backwards.
4. **A forced failure after a REAL copy lands leaves no artifact** — `backup()`
   really writes the file, then a wrapped `fs` throws on the lockdown `chmodSync`
   for that exact path. Asserts `verdict: 'unavailable'`, `bytesWritten: 0`, and
   that the file **and both sidecars** are gone.
5. **A destination directory that cannot be created leaves no artifact.**
6. **A genuinely corrupt copy is reported `'corrupt'` and removed** — the copy is
   damaged from page 2 onward with page 1 (header + schema) left intact, because
   corrupting the header makes the _open_ fail, which is `'unavailable'` and the
   wrong branch. This one caught itself: the first version of the test asserted
   `'corrupt'`, got `'unavailable'`, and was wrong about the mechanism.
7. **Single-flight** — two concurrent requests for the same `destPath`; exactly
   one wins, the other is refused, and the winner's artifact is intact and valid.
8. **A symlinked `backups/` pointing out of the tree is refused** — real
   directory junction on Windows, real symlink on POSIX.

**Did it run on this machine? Not under `nx test` — and that is the honest
answer, so I proved it another way.** This checkout's `better-sqlite3` is
compiled for the Electron ABI (143) while Jest runs on Node's (137), so the
native probe fails and the suite self-skips, exactly like the eight pre-existing
`realbinary` suites. A skipped suite proves nothing, so I ran the whole lib
suite under the matching ABI:

```
$ ELECTRON_RUN_AS_NODE=1 node node_modules/electron/cli.js \
    node_modules/jest/bin/jest.js --config libs/backend/persistence-sqlite/jest.config.ts
  Test Suites: 35 passed, 35 total
  Tests:       2 skipped, 394 passed, 396 total
```

**35 of 35 suites pass with every native guard open**, including this new one —
8/8 — and the only 2 skips left are the POSIX-guarded `chmod` mode assertions,
correctly skipped on Windows. In CI on Linux the probe succeeds and the suite
runs under `nx test` normally.

## Every moderate finding and failure mode

| Review finding                                                                    | Status                            | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Serious**: A-1 unpinned by any automated test                                   | **FIXED**                         | `integrity-worker-backup.integration.spec.ts`, 8 cases; `performBackup` extracted so it is reachable                                                                                                                                                                                                                                                                                                                                                         |
| **Moderate**: cross-drive / UNC branch of `validateBackupDestination` unexercised | **FIXED**                         | Two `itWindows`-guarded cases: `C:` → `D:` and `C:` → `\\attacker\share`. Guarded because on POSIX those inputs are refused one rule earlier by `isAbsolute`, so the branch only exists on win32 — it is now pinned where it exists, and it runs on this machine                                                                                                                                                                                             |
| **Moderate**: symlinked directory segment defeats containment                     | **FIXED**                         | New `resolveRealBackupDestination(fs, dbPath, destPath)` re-runs containment against `realpathSync`-resolved ancestors, walking up to the nearest EXISTING ancestor (the destination does not exist yet) and re-attaching the tail. `performBackup` calls it after the pure check. 5 unit cases + 1 real-junction integration case. `validateBackupDestination` stays pure                                                                                   |
| **Moderate**: failed `chmodSync` leaves a created, unlocked directory             | **FIXED**                         | `ensureBackupDirectory` now removes the directory **it created** if the chmod throws, then rethrows the original error. Two cases: the rollback happens; the original error survives a rollback that also fails. This mattered more than the review credited — a surviving unlocked directory is found _pre-existing_ by the next backup and therefore never locked down, so one transient failure permanently downgrades the backup directory's permissions |
| **Moderate**: no in-worker serialization of concurrent same-`destPath` requests   | **FIXED**                         | `BackupEnvironment.inFlight: Set<string>` — a duplicate destination is answered `'unavailable'` with `already in flight` rather than allowed to interleave. Owned by the caller, so it is process-scoped in the worker and per-test in a spec, rather than hidden module state. Pinned by integration case 7                                                                                                                                                 |
| **Minor**: `asResponse` would accept a `BackupResponse` as a check response       | **FIXED**                         | Explicit `type === 'backup'` rejection in `integrity-check.service.ts:asResponse`, with the reason. Cannot affect the check path today (real check responses carry no `type`); it is the narrowing site that would be wrong the day one worker serves both commands                                                                                                                                                                                          |
| **Minor**: `validateCopy` sets a misleading `detail` on the `'ok'` branch         | **FIXED**                         | `detail` is now `null` unless the verdict is `'unavailable'`                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Style minor 1**: no cross-reference from `openReadOnly` to `openForValidation`  | **FIXED**                         | `@see` block on `openReadOnly` saying the two differ by one flag and MUST NOT be deduplicated, with the consequence named                                                                                                                                                                                                                                                                                                                                    |
| **Style Q5**: no trailing-separator case for `validateBackupDestination`          | **FIXED**                         | `<dbDir>` + `path.sep` must be rejected exactly as `<dbDir>` is                                                                                                                                                                                                                                                                                                                                                                                              |
| **Style minor 3**: `itOnPosix` vs `itPosix` naming variance                       | **FIXED**                         | Renamed to `itPosix`, with a comment naming `apps/ptah-cli/src/smoke.spec.ts:153` so a grep finds both                                                                                                                                                                                                                                                                                                                                                       |
| **Style minor 2**: mirroring check                                                | No action needed (review said so) | Both guard directions were already asserted                                                                                                                                                                                                                                                                                                                                                                                                                  |

Also updated, unprompted: **`libs/backend/persistence-sqlite/CLAUDE.md`**, which
both reviews read and which still described a worker that only ran
`quick_check`. It now records the two commands, the A-1 pin, the
"anything testable lives in the protocol module" rule, the read-write
validation open and the two-stage containment check. The previous revision
deferred this; deferring it twice would have left the reviewers' own reference
document wrong.

## Revision 1 verification

```
$ npx nx run-many -t test lint typecheck -p @ptah-extension/persistence-sqlite --skip-nx-cache
  ✔ All files pass linting
  Test Suites: 9 skipped, 26 passed, 26 of 35 total
  Tests:       79 skipped, 317 passed, 396 total
  NX  Successfully ran targets test, lint, typecheck for project @ptah-extension/persistence-sqlite

$ ELECTRON_RUN_AS_NODE=1 node node_modules/electron/cli.js node_modules/jest/bin/jest.js \
    --config libs/backend/persistence-sqlite/jest.config.ts          # native guards OPEN
  Test Suites: 35 passed, 35 total
  Tests:       2 skipped, 394 passed, 396 total

$ npx nx build-integrity-worker ptah-electron --skip-nx-cache
  NX  Successfully ran target build-integrity-worker for project ptah-electron
$ npx nx build-integrity-worker ptah-cli --skip-nx-cache
  NX  Successfully ran target build-integrity-worker for project ptah-cli and 28 tasks it depends on

$ npx nx run-many -t test -p ptah-electron ptah-cli
  Test Suites: 1 skipped, 66 passed, 66 of 67 total
  Tests:       3 skipped, 985 passed, 988 total
  NX  Successfully ran target test for 2 projects and 34 tasks they depend on

$ npx nx run degradation-audit:lint --skip-nx-cache
  libs/backend/persistence-sqlite: 6 ok (baseline 6)
  degradation-audit: TOTAL 422 unsuppressed site(s)
  NX  Successfully ran target lint for project degradation-audit
```

- Lib tests 307 → **317** under `nx test` (+10 unit cases), and **394** with the
  native guards open (+77, the eight `realbinary` suites plus the new one).
- **`persistence-sqlite` still at baseline 6 of 6** — Revision 1 adds no degrade
  site and needs no suppression comment.
- The rebuilt bundle still imports three Node builtins and one external, and the
  worker still imports only its protocol module:
  `node:module` (createRequire banner), `node:fs`, `node:worker_threads`,
  `node:path`, `__require("better-sqlite3")`. 10 290 bytes.
- Re-drove the **rebuilt** `integrity-worker.mjs` over `worker_threads` under the
  Electron ABI with a live writer running: happy path
  `{"verdict":"ok","bytesWritten":49152,"quickCheck":"ok","detail":null}` with the
  backups directory holding exactly one file; a junction-based escape refused
  with `destPath resolves outside the database directory tree` and the outside
  directory left empty; the `check` command unchanged.
- `nx run-many -t test -p ptah-electron ptah-cli` failed twice on a **dependency
  build**, once `@ptah-extension/messaging-gateway:build` and once
  `@ptah-extension/agent-generation:build`, each time flagged by Nx itself as
  `Nx detected a flaky task`. Both are Batch 5's libs being rebuilt concurrently
  in this shared worktree; neither is in this batch's graph. Re-running gave the
  clean result above both times.

## Revision 1 deviations

1. **`performBackup` moved into `integrity-worker-protocol.ts`.** A "protocol"
   module now carries executable orchestration, which stretches the name. The
   alternative was a new file — but `integrity-worker.ts` must import exactly one
   monorepo module (a stated Batch 6 acceptance criterion), so the only two
   options were "in the protocol module" or "untestable". The file's header
   already declared that it carries the worker's testable half; this is that rule
   followed to its conclusion, and it is stated there explicitly.
2. **`integrity-worker-protocol.ts` is now 666 lines**, against the repo's
   700-line soft ceiling. Under it, but Batch 7 should know it has little room
   left. If a third command arrives, the split to make is per-command
   (`check` / `backup`), not a `helpers` file.
3. **A second edit to `integrity-check.service.ts`**, still outside the batch's
   declared file list: the `type === 'backup'` rejection in `asResponse` (the
   review's Q5 minor). Batch 7 owns this file next and runs after this one.
4. **`BackupArtifactFs` gained `rmdirSync` and `realpathSync`.** Any existing
   test double of that port needs both; the three doubles in this batch were
   updated.

---

# Batch 6 report — Track B: worker protocol widening

> Original submission, unchanged below except where Revision 1 supersedes it.
> Where the two disagree, Revision 1 is current — in particular, `runBackup` and
> `validateCopy` no longer live in `integrity-worker.ts`, and the A-1 evidence is
> now a checked-in spec rather than the manual probes recorded here.

**Task**: TASK_2026_383, Batch 6 (Component 8)
**Worktree**: `D:/projects/ptah-extension/.claude-worktrees/task-383`, branch
`task/383-degradation-audit`, base HEAD `56d70891`
**Status**: complete, not committed. Working tree left dirty as instructed.

---

## Task 6.1 — assumption A-1: RESOLVED, branch A (no flag needed)

**A `{ readonly: true, fileMustExist: true }` connection CAN call `backup()`, and
the destination passes `quick_check`.** The worker keeps opening the source
read-only, exactly as the `check` command does, and issues no write statement
against the live database. No read-write fallback flag was added.

### Evidence

Two probes, both run under `ELECTRON_RUN_AS_NODE=1 node_modules/electron/cli.js`
— i.e. Node 24.15.0 at **NODE_MODULE_VERSION 143**, the Electron ABI the repo's
own `node_modules/better-sqlite3` (12.10.0) is rebuilt for, and the ABI the
`utilityProcess` worker actually runs on. (A first pass under plain `node` v24
resolved a stray ABI-137 copy of the module from outside the repo; the repo's own
binary refuses to load there. Both probes were re-run under Electron and the
result is unchanged. Worth stating because "it worked under plain node" would
have been evidence about the wrong binary.)

Probe 1 — WAL source, no other connection open:

```
OPEN readonly: ok; typeof backup = function
BACKUP ok: {"totalPages":22,"remainingPages":0}
DEST quick_check: "ok"
DEST rows: 5000            (5000 inserted)
DEST page_count: 22
DEST size: 90112
```

Probe 2 — the case that actually matters: a second connection in the same
process holds the WAL source open and keeps inserting for the whole duration of
the copy.

```
CONCURRENT BACKUP ok: {"totalPages":9,"remainingPages":0}
DEST quick_check: "ok"
DEST rows: 2003
```

This lines up with the plan's "Codebase evidence" row: TASK_2026_380 already
proved a second process can READ the live WAL database read-only while the host
writes. A-1 extends that to `backup()` and it holds.

---

## Task 6.2 — the protocol widening

### Final protocol types

```ts
export interface BackupRequest {
  readonly id: number;
  readonly type: 'backup';
  /** Absolute path to the source database. Opened read-only, never written. */
  readonly dbPath: string;
  /**
   * Absolute path to write the copy to. Host-computed, worker-validated: it
   * must sit inside `dirname(dbPath)`'s tree and must not be `dbPath` itself.
   */
  readonly destPath: string;
}

export type IntegrityWorkerInbound = IntegrityCheckRequest | BackupRequest;

export interface BackupResponse {
  readonly id: number;
  readonly type: 'backup';
  readonly ok: true;
  readonly verdict: IntegrityVerdict;
  /** Size of the surviving artifact in bytes; `0` when nothing was left. */
  readonly bytesWritten: number;
  /** Wall-clock cost of copy + lockdown + validation, in ms. */
  readonly durationMs: number;
  /** Raw `PRAGMA quick_check` text from the COPY; `''` when it never ran. */
  readonly quickCheck: string;
  /** Why the verdict is not `'ok'`; `null` on a clean backup. */
  readonly detail: string | null;
}

/** Everything a `check` command can answer with. */
export type IntegrityCheckOutbound = IntegrityCheckResponse | IntegrityErrorResponse;

/** Every message the worker can post, across both commands. */
export type IntegrityWorkerOutbound = IntegrityCheckOutbound | BackupResponse;
```

`BackupResponse` reuses `IntegrityVerdict`. `BackupIntegrity`
(`backup.service.ts:53`) was left in place for Batch 7 to delete, as instructed.

Two contract decisions worth the reviewer's attention, both noted in the source:

- **`type: 'backup'` is a discriminant on the response**, which the plan's field
  list did not name. Both success responses carry `ok: true`, so without it the
  union can only be narrowed by probing for a field. `IntegrityCheckResponse`
  keeps its exact shipped shape — it is the absence of `type` — so nothing on
  the check path changed.
- **`bytesWritten` is the artifact signal**: non-zero if and only if a file
  survives at `destPath`. Every removal path reports `0`. This is what lets a
  `'unavailable'` verdict distinguish "nothing was written" from "the copy landed
  but could not be validated, and was kept" — which is the pre-existing
  `backup.service.ts` policy (an unvalidatable backup is kept, not destroyed).

### Where the code went, and why

`integrity-worker.ts` cannot be imported in Jest — it subscribes to a parent port
at module scope and throws when there is none. Anything left in that file is,
by construction, unassertable. So the backup destination guard and the artifact
filesystem helpers live in `integrity-worker-protocol.ts` and take an injected
`BackupArtifactFs` port rather than importing `node:fs` directly. That is what
makes the POSIX permission lockdown pinnable by a spec. The worker keeps the
SQLite work and the dispatch.

The worker still imports **only** its protocol module from the monorepo. Verified
against the built bundle:

```
$ grep -n "^import\|require(" dist/apps/ptah-electron/integrity-worker.mjs
1:import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
10:import * as fs from "node:fs";
11:import { parentPort as workerThreadsParentPort } from "node:worker_threads";
14:import * as path from "node:path";
86:  const Database = __require("better-sqlite3");
```

Three node builtins, one external. `node:path` is new (the containment check) and
`node:fs` is new (the artifact work); neither costs the isolated bundle anything.
Bundle size 8102 bytes.

### Validation: the Zod divergence, stated

`destPath` arrives over IPC and the worker then creates a file at it. That is an
external boundary in the fullest sense, and the repository rule is Zod at every
external boundary (`CLAUDE.md`, Coding Standards). **This file diverges
deliberately**: it is the one import path that must bundle in isolation with a
single external, and pulling Zod in would put a second dependency inside
`integrity-worker.mjs` for two object shapes. The narrowings are hand-written to
match `isIntegrityCheckRequest`'s existing style, and every one is unit-tested.
The divergence is documented in the protocol module's header comment, not just
here.

`validateBackupDestination(dbPath, destPath)` returns `null` or the reason, and
enforces four rules: both paths absolute; `destPath !== dbPath` (a `backup()`
onto its own source would destroy the live database); `destPath` strictly inside
`dirname(dbPath)`; and `destPath` is not the database directory itself. The
`..`-traversal check also tests `path.isAbsolute` on the `path.relative` result,
because on Windows `relative` returns an absolute path across drives.

### Specs added — `integrity-worker-protocol.spec.ts`

Lib total went **270 → 307 passing** (+37; 0 skipped added).

`isIntegrityCheckRequest`

- `does not accept a 'backup' request` — the two guards must not overlap, since
  dispatch tries `check` first.

`isBackupRequest` (the **malformed-request guard**)

- `accepts a well-formed backup request`
- `rejects a malformed backup request` — 10 assertions: missing `destPath`, empty
  `destPath`, empty `dbPath`, missing `id`, non-numeric `id`, unknown command
  (`'restore'`), a `check` request, `null`, a string, a number.

`validateBackupDestination`

- `accepts a sibling of the database` (the `pre-migration` / `reset` kinds)
- `accepts a file in a subdirectory of the database directory` (the `daily` kind)
- `rejects a relative destination`
- `rejects a relative source`
- `rejects the source database itself`
- `rejects a traversal that climbs out of the database directory`
- `rejects the database directory itself`
- `rejects an unrelated absolute path`
- `rejects a sibling directory with a shared name prefix` — `<root>/ptah-evil` vs
  `<root>/ptah`, the case a naive `startsWith(dbDir)` would have accepted.

`ensureBackupDirectory`

- `creates the destination directory when it is missing`
- **`locks a directory it created to owner-only 0700` — POSIX-guarded**
- `leaves an existing directory alone`

`restrictBackupFile`

- `returns the size of the finished artifact`
- **`locks the finished artifact to owner-only 0600` — POSIX-guarded**
- `throws when the artifact is missing, so the caller can clean up`

`removeBackupArtifact`

- `removes a partial artifact so it cannot take a rotation slot`
- `removes the WAL sidecars too, so they cannot take a rotation slot`
- `still removes the main file when a sidecar resists removal`
- `does nothing when there is no artifact`
- `never throws when the unlink itself fails`

**The POSIX guard** is `const itOnPosix = process.platform === 'win32' ? it.skip : it`.
Windows has no POSIX mode bits — Node's `chmodSync` there only touches the
read-only bit, so `statSync().mode` never reports `0o700`/`0o600` and asserting it
would fail for a reason unrelated to the lockdown. The two guarded cases are
therefore **skipped on this Windows machine and will run in CI on Linux**; the
surrounding non-mode cases (directory created, size returned, throw-on-missing)
run everywhere. The chmod calls themselves are NOT platform-guarded, carrying
`backup.service.ts:189,193`'s original unconditional behaviour unchanged.

### Partial-file cleanup — evidence

Unit level: the five `removeBackupArtifact` cases above.

Runtime level: the **built** `integrity-worker.mjs` was driven over
`worker_threads` under the Electron ABI with a real 3 000-row WAL database. Full
transcript:

```
1 happy path      -> {"id":1,"type":"backup","ok":true,"verdict":"ok","bytesWritten":49152,"durationMs":156,"quickCheck":"ok","detail":null}
   file exists: true size: 49152
   copy quick_check: ok rows: 3000
2 escaping dest   -> {...,"verdict":"unavailable","bytesWritten":0,"detail":"destPath is outside the database directory tree: C:\\...\\Temp\\escaped.sqlite"}
   artifact created: false
3 dest == source  -> {...,"verdict":"unavailable","bytesWritten":0,"detail":"destPath is the source database itself: ...\\ptah.sqlite"}
   source intact rows: 3000
4 relative dest   -> {...,"verdict":"unavailable","bytesWritten":0,"detail":"destPath is not absolute: copy.sqlite"}
5 missing source  -> {...,"verdict":"unavailable","bytesWritten":0,"detail":"unable to open database file"}
   artifact created: false
6 dest is a dir   -> {...,"verdict":"unavailable","bytesWritten":0,"detail":"unable to open database file"}
   pre-existing dir survived: true
7 malformed       -> "NO REPLY (dropped)"
8 unknown command -> "NO REPLY (dropped)"
9 check still ok  -> {"id":9,"ok":true,"verdict":"ok","quickCheck":"ok","foreignKeyViolations":0,"durationMs":36,"pageCount":12,"detail":null}
```

Cases 2-6 all leave **no artifact**; case 6 exercises the cleanup arm after it is
armed and the pre-existing directory is not destroyed by it. Cases 7-8 confirm
the unrecognised-payload drop is unchanged. Case 9 confirms the `check` command
is untouched. Every escape is `'unavailable'` with a `detail`; none is
`'corrupt'`.

### A real bug this run caught: WAL sidecars taking rotation slots

Run 1 of that transcript ended with:

```
backups dir contents: [ 'ptah-2026-09-06.sqlite',
                        'ptah-2026-09-06.sqlite-shm',
                        'ptah-2026-09-06.sqlite-wal' ]
```

The batch says to validate the copy with `openReadOnly`. Doing so plants
`-wal` and `-shm` beside the backup, because **a read-only connection cannot
checkpoint on close**. Measured directly:

```
READONLY  open+close leaves: [ 'ro.sqlite', 'ro.sqlite-shm', 'ro.sqlite-wal' ]
READWRITE open+close leaves: [ 'rw.sqlite' ]
```

Rotation selects by filename PREFIX (`backup.service.ts`'s `prefixFor`), and
`ptah-2026-09-06.sqlite-wal` carries the backup's own prefix while sorting after
it. Two stray sidecars per backup would take rotation slots and evict a real
backup — precisely the failure the partial-file unlink exists to prevent, arriving
through a different door. It is also a behavioural regression against the
shipped code: `backup.service.ts`'s validation factory opened the copy
**read-write** (`loadBetterSqlite3ValidationFactory`, `:64-70`), which is why the
bug does not exist today.

Two changes closed it (both are deviations, listed below):

1. `openForValidation(destPath)` — a sibling of `openReadOnly` that opens the
   **copy** read-write with `fileMustExist: true`. The SOURCE stays read-only.
   Writing here is safe in a way writing to `dbPath` never is: this file is a
   private copy the worker created moments ago.
2. `removeBackupArtifact` now removes `<dest>`, `<dest>-wal` and `<dest>-shm`,
   each in its own try, so a sidecar that resists removal cannot stop the main
   file being tried.

After the fix, the same end-to-end run on the rebuilt bundle:

```
happy path -> {"id":1,"type":"backup","ok":true,"verdict":"ok","bytesWritten":49152,"durationMs":58,"quickCheck":"ok","detail":null}
backups dir now: [ 'ptah-2026-09-06.sqlite' ]
copy rows: 3000
```

---

## Files changed

- MODIFIED `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.ts`
  — `BackupRequest`, `BackupResponse`, `IntegrityCheckOutbound`, widened
  `IntegrityWorkerInbound` / `IntegrityWorkerOutbound`, `isBackupRequest`,
  `validateBackupDestination`, `BackupArtifactFs` + `ensureBackupDirectory` /
  `restrictBackupFile` / `removeBackupArtifact`, `BACKUP_DIR_MODE` /
  `BACKUP_FILE_MODE`.
- MODIFIED `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker-protocol.spec.ts`
  — 37 new cases (2 POSIX-guarded).
- MODIFIED `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`
  — `runBackup`, `validateCopy`, `openForValidation`, `backupUnavailable`, the
  second `subscribe` branch, `backup?()` on `ReadOnlyDatabase`.
- MODIFIED `libs/backend/persistence-sqlite/src/index.ts` — exports
  `BackupRequest`, `BackupResponse`, `IntegrityCheckOutbound`, `isBackupRequest`,
  `validateBackupDestination`. The `BackupArtifactFs` helpers are deliberately
  **not** exported from the public barrel; they are worker-internal.
- MODIFIED (deviation, see below)
  `libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts`
  — type-only, 8 occurrences of `IntegrityWorkerOutbound` → `IntegrityCheckOutbound`.

`tools/degradation-audit/baseline.json` untouched. No commit, no `nx reset`.

---

## Verification

```
$ npx nx run-many -t test lint typecheck -p @ptah-extension/persistence-sqlite --skip-nx-cache
  ✔ All files pass linting
  Test Suites: 8 skipped, 26 passed, 26 of 34 total
  Tests:       71 skipped, 307 passed, 378 total
  NX  Successfully ran targets test, lint, typecheck for project @ptah-extension/persistence-sqlite

$ npx nx build-integrity-worker ptah-electron --skip-nx-cache
  NX  Successfully ran target build-integrity-worker for project ptah-electron

$ npx nx build-integrity-worker ptah-cli --skip-nx-cache
  NX  Successfully ran target build-integrity-worker for project ptah-cli and 28 tasks it depends on

$ npx nx run-many -t test -p ptah-electron ptah-cli
  Test Suites: 1 skipped, 66 passed, 66 of 67 total
  Tests:       3 skipped, 985 passed, 988 total
  NX  Successfully ran target test for 2 projects and 34 tasks they depend on

$ npx nx run degradation-audit:lint --skip-nx-cache
  libs/backend/persistence-sqlite: 6 ok (baseline 6)
  degradation-audit: TOTAL 422 unsuppressed site(s)
  NX  Successfully ran target lint for project degradation-audit
```

Notes on the tail:

- The **8 skipped lib suites / 71 skipped tests are pre-existing**, not caused by
  this batch: they are the `realbinary` suites, which self-skip on this machine
  because `node_modules/better-sqlite3` is compiled for Electron ABI 143 and Jest
  runs on Node ABI 137. Same skip count before and after the change.
- The Batch 4 gates in `ptah-electron` and `ptah-cli` pass on the **rebuilt**
  bundles, including the bare-spawn executable self-test. The entry-guard string
  asserted verbatim in `esm-bundle-gate.spec.ts:300-301` was not touched.
- One `nx run-many -t test -p ptah-electron ptah-cli` invocation failed on a
  dependency build (`@ptah-extension/messaging-gateway:build`); Nx itself flagged
  it (`NX detected a flaky task`). Re-running gave the clean result above. Not
  related to this batch — no file in it is in that lib's graph.
- **`degradation-audit`: `libs/backend/persistence-sqlite` is at baseline, 6 of 6.**
  The new code adds **no** degrade site and needed **no** suppression comment. The
  six reported are all pre-existing (`backup.service.ts:211,263`,
  `integrity-check-state.store.ts:105`, `integrity-check.service.ts:159,271`,
  `sqlite-connection.service.ts:747`). The worker's new catches are not flagged
  because none of them swallows: each carries `describe(error)` into the response
  `detail`, which is the whole point of the `'unavailable'` verdict.
- `TOTAL` moved 423 → 422 between two runs of the audit. That is **Batch 5**,
  which is running in this same worktree (`git status` shows ~79 modified files
  across `agent-generation`, `cli-agent-runtime`, `harness-sync`,
  `skill-synthesis`, `vscode-lm-tools`, `workspace-intelligence`). No overlap with
  my five files.

---

## Plan deviations

1. **`integrity-check.service.ts` was edited (out of my named file list).**
   Widening `IntegrityWorkerOutbound` broke that file's compile in five places —
   it reads `response.foreignKeyViolations` / `response.pageCount` off the union
   and `BackupResponse` has neither. The fix is type-only: I added
   `IntegrityCheckOutbound = IntegrityCheckResponse | IntegrityErrorResponse` to
   the protocol and swapped the service's 8 references to it. No behaviour
   changed; the service only ever SENDS `type: 'check'` (`:298-302`, `id: 1`), so
   the narrower type states what was already true. The alternative was leaving
   the lib not compiling. Batch 7 owns this file next and runs strictly after this
   one, so there is no concurrency hazard — but Batch 7 should know the alias
   exists rather than re-deriving it.

2. **The COPY is validated read-write, not with `openReadOnly`.** The batch says
   to reuse `openReadOnly` for post-copy validation. Doing that plants `-wal` and
   `-shm` sidecars that take rotation slots — measured, evidence above. The source
   is still opened by `openReadOnly`; only the private copy is opened read-write,
   which is exactly what `backup.service.ts:64-70` did before the move. Flagging
   because it is a literal instruction I did not follow literally.

3. **`removeBackupArtifact` also removes the WAL sidecars**, which the batch did
   not ask for. Same root cause as (2); belt and braces for the rotation
   invariant.

4. **`type: 'backup'` added to `BackupResponse`**, which the plan's field list
   (`{ id; ok: true; verdict; bytesWritten; durationMs; quickCheck; detail }`) did
   not include. Additive; makes the outbound union narrowable without field
   probing.

5. **`node:path` and `node:fs` are now in the worker's bundle.** The protocol
   module previously imported nothing at all. Both are Node builtins, both are
   needed for containment checking and artifact handling, and neither changes the
   "one external" property. The header comment states the new rule explicitly so
   the next reader does not treat the file as import-free.

---

## Out-of-scope observations (not touched)

- **`libs/backend/persistence-sqlite/CLAUDE.md` needs an update** — its "Public
  API" paragraph lists the protocol exports and does not mention the backup
  command; its `src/lib/integrity/` description still says the worker only runs
  `quick_check`/`foreign_key_check`. Left alone because my scope named exactly
  three files and Batch 7 rewrites `backup.service.ts` anyway, so one doc pass
  after Batch 7 is cheaper and less likely to go stale.
- **For Batch 7**: `SqliteBackupService.backup(db, kind)`'s `db` parameter is now
  fully redundant — the worker opens by path. Drop the parameter rather than
  adding a branch that ignores it (the plan's evidence row already says this).
  The rotation prefix hazard documented above is worth a spec in the rewritten
  `backup.service.spec.ts`: `rotate` must not be able to count a `-wal`/`-shm`
  file as a backup, whoever created it.
- **Pre-existing, unrelated**: `node_modules/better-sqlite3` in this worktree is
  built for the Electron ABI, so eight `realbinary` suites self-skip under Jest.
  It is handled gracefully (probe + skip, with a printed reason), but it does mean
  the lib's native-path coverage never runs locally on a machine set up this way.
- An untracked `npm-ci.log` sits at the worktree root. Not mine; left in place.
