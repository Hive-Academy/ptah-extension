# Batch 1 — Task 1.4: Collision-safe SQLite backups

## Outcome

Implemented collision-resistant pre-migration/reset names and collision-safe
host/worker behavior. Existing backup artifacts are never overwritten or
discarded by a colliding attempt. Daily same-day re-runs reuse the validated
daily artifact without spawning a worker or reporting degradation.

## Modified Files

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\CLAUDE.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\integrity\integrity-worker-protocol.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\integrity\integrity-worker-protocol.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\.ptah\specs\TASK_2026_440_834c\batch-1-task-1.4-report.md`

No file outside `libs/backend/persistence-sqlite` was changed except this
required report. `batches.md` was not edited.

## Invariants

### I1 — Collision-resistant non-daily destinations

- `backup.service.ts:101` keeps the existing `compactIso()` naming function.
- `backup.service.ts:102-103` removes ISO punctuation while retaining
  milliseconds and appends eight lowercase hex characters from
  `crypto.randomBytes(4)`.
- `backup.service.ts:235-239` preserves daily `YYYY-MM-DD` naming and uses the
  new compact value only for pre-migration/reset destinations.
- Resulting non-daily shape:
  `<prefix><YYYYMMDDTHHMMSSmmmZ>-<8 lowercase hex>.sqlite`.

### I2 — Host pre-dispatch collision checks

- `backup.service.ts:283-295` checks the computed destination before reading or
  invoking the worker factory.
- `backup.service.ts:285-291` returns an existing daily path and logs
  `daily backup for today already exists`, with no degradation.
- `backup.service.ts:293-294` reports a non-daily collision as not-taken and
  returns `null` without dispatch or discard.
- `backup.service.ts:296-319` reaches factory selection/worker dispatch only
  after the destination is confirmed absent.

### I3 — Worker refuses existing destinations and owns cleanup narrowly

- `integrity-worker-protocol.ts:152` exports the stable
  `BACKUP_DESTINATION_EXISTS` detail.
- `integrity-worker-protocol.ts:619-621` checks `fs.existsSync(destPath)` before
  opening the source or writing, returning an unavailable response on collision.
- `integrity-worker-protocol.ts:616,629` records ownership only after the
  pre-existing-destination refusal and immediately before `source.backup()`.
- `integrity-worker-protocol.ts:637-639,668-670` gates corrupt/catch cleanup on
  that attempt ownership, while still cleaning a partial fresh destination.

### I4 — Host preserves worker-reported collision artifacts

- `backup.service.ts:350-356` skips `discardArtifact()` only when the worker's
  unavailable detail equals `BACKUP_DESTINATION_EXISTS`; all other unavailable
  artifacts retain prior cleanup behavior.
- `src/index.ts:63-69` exposes the new constant through the public API.

### I5 — Rotation behavior remains filename-based

- `backup.service.ts:478-489` remains newest-first lexicographic filename
  rotation.
- `backup.service.ts:486` retains the exact `.sqlite` suffix filter, excluding
  `-wal` and `-shm` sidecars.
- `backup.service.ts:465-472` documents that mixed old/new names remain ordered
  across different seconds and that an old `...SSZ.sqlite` name sorts newer
  than a new name from the same second.

### I6 — Old prose guarantees replaced

- `backup.service.ts:21-44` now documents attempt-owned cleanup, cross-host
  collisions, suffix filtering, mixed-format ordering, and the same-second
  compatibility quirk.
- `backup.service.ts:397-420` narrows `discardArtifact()` documentation to paths
  the attempt was allowed to create.
- `backup.service.ts:455-477` documents rotation's unchanged filename/suffix
  behavior and the old/new same-second quirk.
- `integrity-worker-protocol.ts:75-79,225-233` documents non-overwrite behavior
  and the exact host destination forms.
- `CLAUDE.md:44-58` replaces the stale unconditional-discard and no-factory
  prose with the collision/daily exceptions.

## Regression Specs

All cases below are ordinary `it(...)` tests and executed; none uses `it.skip`,
`itPosix`, or a conditional native-suite wrapper.

### `backup.service.spec.ts`

- `gives same-millisecond pre-migration and reset calls distinct random destinations`
  (`backup.service.spec.ts:260`)
- `does not discard an artifact when the worker reports a destination collision`
  (`backup.service.spec.ts:397`)
- `leaves a colliding pre-migration file byte-identical and dispatches no worker`
  (`backup.service.spec.ts:431`)
- `returns today's daily backup without a factory or degradation`
  (`backup.service.spec.ts:461`)
- `keeps the newest N across mixed old/new seconds and excludes sidecars`
  (`backup.service.spec.ts:812`)
- Existing clean-name assertion updated to the millisecond/random regex
  (`backup.service.spec.ts:208-210`).

### `integrity-worker-protocol.spec.ts`

- `returns BACKUP_DESTINATION_EXISTS without touching a pre-existing file`
  (`integrity-worker-protocol.spec.ts:394`), asserting unchanged bytes, unchanged
  mtime, no source open/backup call, and no unlink.
- `still removes a fresh destination when source.backup fails after writing`
  (`integrity-worker-protocol.spec.ts:429`), pinning the existing cleanup rule.

`integrity-worker-backup.integration.spec.ts` required no fixture changes and
was not modified.

## Verification

Command executed exactly:

```text
npx nx run-many -t typecheck test lint -p @ptah-extension/persistence-sqlite
```

Result: PASS (exit code 0).

- Nx header listed exactly one project:
  `@ptah-extension/persistence-sqlite`.
- Typecheck: PASS (`tsc --noEmit`).
- Lint: PASS (`All files pass linting`; Nx reused its valid existing output for
  this one target).
- Tests: 29 suites passed; 383 tests passed; 0 failures; 0 snapshots.
- Existing skips: 9 suites / 80 tests. These are the repository's existing
  POSIX/native-binary conditional cases. The native `better-sqlite3` probes
  reported a Node ABI mismatch (module 143 versus runtime 137); no new regression
  test is inside those skipped suites.
- Required regression files were also run directly before the full gate:
  2 suites passed, 75 tests passed, 0 failures. The 3 skips in that focused run
  are pre-existing POSIX permission assertions; every new regression above ran.
- `git diff --check -- libs/backend/persistence-sqlite`: PASS.
