# Task 1.4 Revision 1 — Atomic Backup Publication

## Status

PASS. Backup attempts now write and validate an exclusively-created randomized staging file, then atomically publish it with a no-overwrite hard link. Failed attempts clean only their owned staging artifacts. The required typecheck, test, and lint gate passed for exactly one Nx project.

## Review Findings Closed

### B1 — Daily reuse can no longer trust a new crash-leftover partial

- `backup.service.ts:23-27` documents that only validated staging copies are published at final names and records the single upgrade-day compatibility residual for a partial written by old code.
- `integrity-worker-protocol.ts:675-719` writes and validates staging, removes its sidecars, publishes only an `ok` copy via `linkSync`, and then removes staging.
- `backup.service.ts:293-303` retains daily pre-dispatch reuse; this is now sound because current code never writes an unvalidated final.
- `CLAUDE.md:56-61` states the validated-publication invariant and the old-version upgrade-day residual precisely.
- Regression specs: `publishes one validated final and removes staging plus sidecars`; `returns today's daily backup without a factory or degradation`.

### S1 — The daily-name race is atomic across processes

- `integrity-worker-protocol.ts:604-605` documents hard-link `EEXIST` as the cross-process guard.
- `integrity-worker-protocol.ts:709-715` uses `linkSync(stagingPath, destPath)` with no overwrite fallback; `EEXIST` returns `BACKUP_DESTINATION_EXISTS` after removing only loser staging.
- `backup.service.ts:361-370` treats a lost daily race as success by returning the winner at `destPath` without degradation.
- Regression specs: `returns BACKUP_DESTINATION_EXISTS without changing the winner`; `returns the daily winner without degradation when atomic publish loses the race`; `real fs hard-link publish is no-overwrite and reports EEXIST on a second link`.

### M1 — Null/early-exit cleanup never removes a final path

- `backup.service.ts:329-343` sends a distinct randomized `stagingPath`; a null response discards staging only.
- `backup.service.ts:343-396` routes corrupt, unavailable, and thrown-error cleanup exclusively through the attempt's staging path.
- `backup.service.ts:443-466` defines `discardArtifact` as staging-only cleanup, including staging sidecars.
- `integrity-worker-protocol.ts:659-662,680-721,735-736` tracks exclusive staging ownership and cleans only staging on validation, publish, and thrown failures.
- Regression specs: `an early exit removes staging only and preserves a final won by another host`; `still removes staging when source.backup fails after writing`; `does not clean a staging path when exclusive creation reports EEXIST`.

### M2 — Documentation matches implemented validation and publication

- `backup.service.ts:21-27,166-180,476-491` describes exclusive staging, validation, atomic no-overwrite publication, cleanup ownership, rotation ordering, and the compatibility residual.
- `integrity-worker-protocol.ts:53-84,583-605` distinguishes staging from final publication and describes the actual hard-link behavior.
- `CLAUDE.md:56-61,102-113` states that validation precedes final publication and that both destination paths receive string and realpath containment checks.
- Regression specs: `publishes one validated final and removes staging plus sidecars`; `corrupt validation never publishes and removes staging`; `unavailable validation never publishes and removes staging`.

## Revision Requirements

### R1 — Exclusive staging request and validation

- `backup.service.ts:329-331` computes `<destPath>.<8 lowercase hex>.tmp` from `crypto.randomBytes(4)` and sends it in `BackupRequest`.
- `integrity-worker-protocol.ts:84,215-216` adds `stagingPath` to the protocol and request narrowing.
- `integrity-worker-protocol.ts:293-303` extends `BackupArtifactFs` with exclusive-open, close, and hard-link operations.
- `integrity-worker-protocol.ts:615-644` applies `validateBackupDestination` and `resolveRealBackupDestination` to both final and staging paths, then enforces their exact same-directory relationship.
- `integrity-worker-protocol.ts:656-678` creates staging with `openSync(..., 'wx')`, closes the handle, backs up to staging, restricts it, and validates it.
- Regression specs: request narrowing cases at `integrity-worker-protocol.spec.ts:114-142`; `does not clean a staging path when exclusive creation reports EEXIST`; `publishes one validated final and removes staging plus sidecars`.

### R2 — Publish only an `ok` verdict

- `integrity-worker-protocol.ts:680-697` removes staging and returns directly for corrupt or unavailable validation verdicts.
- `integrity-worker-protocol.ts:698-705` closes validation before publication, removes staging sidecars, and refuses publication if they remain.
- `integrity-worker-protocol.ts:709-721` hard-links staging to final only after validation, handles `EEXIST` without touching the winner, reports other atomic-publish errors without fallback, and removes staging.
- Regression specs: `corrupt validation never publishes and removes staging`; `unavailable validation never publishes and removes staging`; `reports an atomic-publish failure without a rename or copy fallback`; `real fs hard-link publish is no-overwrite and reports EEXIST on a second link`.

### R3 — Cleanup owns staging only

- `backup.service.ts:343,356,376,396` passes only `stagingPath` into host cleanup for null, corrupt, unavailable, and thrown failures.
- `integrity-worker-protocol.ts:659-662` does not clean an `EEXIST` staging file because this attempt did not create it.
- `integrity-worker-protocol.ts:671,680,694,704,711,721,736` removes only owned staging artifacts on every worker failure path.
- Regression specs: `an early exit removes staging only and preserves a final won by another host`; `does not clean a staging path when exclusive creation reports EEXIST`; `still removes staging when source.backup fails after writing`.

### R4 — Daily and non-daily collision semantics

- `backup.service.ts:293-310` returns an already-published daily final before worker construction and emits no degradation; pre-migration/reset collisions are reported not-taken and return `null`.
- `backup.service.ts:361-375` returns the final path after a daily lost race, returns `null` for non-daily collision, and does not discard either final.
- `backup.service.ts:23-27` and `CLAUDE.md:56-61` document the one old-code upgrade-day partial that can still be trusted once.
- Regression specs: `returns today's daily backup without a factory or degradation`; `returns the daily winner without degradation when atomic publish loses the race`; `does not discard an artifact when the worker reports a destination collision`; `leaves a colliding pre-migration file byte-identical and dispatches no worker`.

### R5 — Stale staging sweep without retention changes

- `backup.service.ts:100` recognizes only `.<8 lowercase hex>.tmp` staging names and their `-wal`/`-shm` sidecars.
- `backup.service.ts:494-522` groups staging artifacts and sweeps them only when all present members are older than `2 * BACKUP_WORKER_BUDGET_MS`.
- `backup.service.ts:526-535` retains the strict `.sqlite` final filter and reverse filename order, so staging and sidecars never consume keep slots.
- Regression specs: `ignores a young staging file without sweeping or counting it`; `sweeps an old staging file and its sidecars`; `keeps the newest N across mixed old/new seconds and excludes sidecars`.

### R6 — Correct prose and no obsolete final-path cleanup claims

- `backup.service.ts:21-43` gives the module-level atomic-publication, staging cleanup, filename ordering, and same-second old-format sorting quirk.
- `backup.service.ts:428-466,476-491` documents staging-only discard and rotation/stale-sweep behavior.
- `integrity-worker-protocol.ts:53-84,583-605` documents the request destinations and publish sequence.
- `CLAUDE.md:56-61,102-113` documents validated-only final names, atomic no-overwrite hard links, staging sidecars, and two-layer containment validation.

### R6b — Retention call-site prose is correctly scoped

- `CLAUDE.md:74-78` keeps the shared `KEEP_BY_KIND` rule, but scopes conditional rotation to the migration-runner and `db:reset` call sites. It now states separately that daily cron call sites rotate unconditionally so stale staging cleanup can run.

## Preserved Task 1.4 Invariants

- I1 naming: `backup.service.ts:103-105,245-251`; daily remains `YYYY-MM-DD`, while pre-migration/reset use millisecond compact ISO plus eight lowercase random hex digits. Specs: `gives same-millisecond pre-migration and reset calls distinct random destinations` and the filename assertions at `backup.service.spec.ts:226-240`.
- I5 rotation ordering: `backup.service.ts:476-488,526-535`; newest-first filename sorting and strict `.sqlite` filtering remain unchanged. The documented quirk is that an old-format file sorts newer than a new-format file from the same second. Spec: `keeps the newest N across mixed old/new seconds and excludes sidecars`.

## Regression Specifications Executed

### `backup.service.spec.ts`

- `gives same-millisecond pre-migration and reset calls distinct random destinations`
- `does not discard an artifact when the worker reports a destination collision`
- `returns the daily winner without degradation when atomic publish loses the race`
- `leaves a colliding pre-migration file byte-identical and dispatches no worker`
- `returns today's daily backup without a factory or degradation`
- `an early exit removes staging only and preserves a final won by another host`
- `keeps the newest N across mixed old/new seconds and excludes sidecars`
- `ignores a young staging file without sweeping or counting it`
- `sweeps an old staging file and its sidecars`

Focused result: **1 suite passed; 40 tests passed; 1 existing POSIX-only test skipped. All new Revision 1 tests ran; 0 new tests skipped.**

### `integrity-worker-protocol.spec.ts`

- `publishes one validated final and removes staging plus sidecars`
- `returns BACKUP_DESTINATION_EXISTS without changing the winner`
- `does not clean a staging path when exclusive creation reports EEXIST`
- `corrupt validation never publishes and removes staging`
- `unavailable validation never publishes and removes staging`
- `still removes staging when source.backup fails after writing`
- `reports an atomic-publish failure without a rename or copy fallback`
- `real fs hard-link publish is no-overwrite and reports EEXIST on a second link`

Focused result: **1 suite passed; 45 tests passed; 2 existing POSIX-only tests skipped. All new Revision 1 tests, including the real Windows `node:fs` hard-link test, ran; 0 new tests skipped.**

`integrity-worker-backup.integration.spec.ts` fixtures were updated to carry `stagingPath`. Its native suite remains subject to the repository's existing `better-sqlite3` ABI skip (installed module ABI 143 versus current runtime ABI 137); none of the required Revision 1 regressions relies on that skipped suite.

## Verification

Command:

```text
npx nx run-many -t typecheck test lint -p @ptah-extension/persistence-sqlite
```

Nx header confirmed exactly one project:

```text
NX Running targets typecheck, test, lint for project @ptah-extension/persistence-sqlite:
```

Results:

- Typecheck: PASS (`tsc --noEmit`).
- Test: PASS — 29 suites passed, 393 tests passed, 9 suites/80 tests skipped by existing native/POSIX gates, 473 tests total, 88.387 s.
- Lint: PASS — all files pass linting.
- Nx: successfully ran all three targets for the one requested project.
- `git diff --check -- libs/backend/persistence-sqlite`: PASS, no output.

## Modified Files

- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\CLAUDE.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\index.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\backup.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\integrity\integrity-worker-protocol.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\integrity\integrity-worker-protocol.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\persistence-sqlite\src\lib\integrity\integrity-worker-backup.integration.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\.ptah\specs\TASK_2026_440_834c\batch-1-task-1.4-r1-report.md`
