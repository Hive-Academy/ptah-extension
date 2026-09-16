# Rebase report — TASK_2026_440_834c (PR #513)

Branch `feat/task-440-memory-retention` rebased onto `origin/main`.

| | SHA |
|---|---|
| Pre-rebase head | `e1fe2e49e` (15 ahead, 38 behind main) |
| Onto (`origin/main`) | `e3e366e679ef341305caa2a7e632ab76ee59962d` |
| Post-rebase head | `fae072a28ef7f998aab46219550628ea06ef707c` |

Not pushed. Working tree clean. No stash used. Migration `0043_memory_retention` keeps its number.

## Conflicts (4, all resolved as "both intents survive")

### 1. `libs/backend/persistence-sqlite/src/lib/backup.service.spec.ts` — commit 2/15 `feat(persistence-sqlite): batch 1 - add retention tables and page reclaimer`

- main: imports `TOKENS, type BackgroundWorkAdmission` from vscode-core (governor specs, TASK_2026_437 C14 d).
- branch: imports `KEEP_BY_KIND` from `./backup.service` (keep-table specs).
- Resolved: both imports kept. No test removed. Auto-merged `backup.service.ts` keeps main's governor wait (`GOVERNED_KINDS`, `waitForBackgroundClear`) plus the branch's `KEEP_BY_KIND` `{pre-migration: 1, daily: 7, reset: 2}`.

### 2. `libs/backend/memory-curator/CLAUDE.md` — commit 4/15 `feat(memory-curator): batch 3 - add bounded observation retention service`

- Hunk A (Internal Structure):
  - main: rewrote the `memory-curator.service.ts` bullet to name its facade collaborators (`CuratorWindowRunner`, `CuratorActivityLog`, `CuratorPassAdmission`).
  - branch: rewrote the `memory-decay.job.ts` bullet ("Registered in DI only; no cron job runs it yet") and added the `src/lib/retention/` bullet.
  - Resolved: branch decay + retention bullets, then main's curator-service bullet. I checked that the decay statement is still true on main. `MemoryDecayJob` is registered in DI and injected only by `diagnostics.service.ts`. No cron job runs it.
- Hunk B (Guidelines):
  - main: added the governor-admission bullet (FU-16b-a) and the network back-off bullet (C14 f).
  - branch: added the retention bullet.
  - Resolved: all three kept.

### 3. `libs/backend/persistence-sqlite/CLAUDE.md` — commit 5/15 `fix(persistence-sqlite): batch 1 - publish backups atomically so failures keep old copies`

- main: added the "Only a `daily` backup waits for the background-work governor" bullet. It also kept the TASK_2026_383 bullet "Every `null`-returning path discards the destination AND its sidecars".
- branch: replaced that discard bullet with "Only validated copies are published at a final name; publish is an atomic no-overwrite hard link". Failure paths now remove staging only.
- Resolved: main's governor bullet, then the branch's atomic-publish bullet. The discard bullet is dropped because the branch intentionally superseded it (see `git show 28cd22902`).
- Code auto-merged. `SqliteBackupService.backup()` waits for the governor first (daily only), then queues `takeBackup`. `takeBackup` does the staging, hard-link publish and same-day-daily return.

### 4. `libs/backend/memory-curator/CLAUDE.md` — commit 10/15 `fix(memory-curator): batch 7 - start page reclaim at 256 pages per step`

- main's two new bullets sat next to the retention bullet from conflict 2. The branch edited the retention bullet: "reclaim step (starts at 256 pages, floor 64)".
- Resolved: main's governor bullet and network back-off bullet kept, followed by the branch's updated retention bullet.

All other commits applied cleanly. Hooks were not bypassed (`.husky/pre-commit`, `commit-msg` present), and no hook failure was reported.

## Commit list after rebase

`git log --oneline origin/main..HEAD` shows 15 commits. `Compare-Object` of subjects (`merge-base..e1fe2e49e` against `origin/main..HEAD`) showed no differences.

```
fae072a28 test(memory-curator): bind every parameter in the retention query-plan helper
aaea619f6 fix(memory-curator): annotate the three deliberate catch sites for the degradation audit
a6471476d docs: record TASK_2026_440 Gate 3 branch review and fix
ac1fba50d fix(memory-curator-ui): gate 3 - show a backlog run as due at the next hourly check
b5c1d726f docs: record TASK_2026_440 plan, batches, reviews and test report
f7ebccb68 fix(memory-curator): batch 7 - start page reclaim at 256 pages per step
5e0b28dde docs(persistence-sqlite): batch 7 - name the hard-link limit of atomic backup publish
f73a8b921 feat(memory-curator-ui): batch 6 - show storage and retention in diagnostics
3433d7a7e feat(memory-curator): batch 4 - report storage health in memory diagnostics
41da9ed3d feat(thoth-runtime): batch 5 - schedule memory retention in both hosts
63ea0b042 fix(persistence-sqlite): batch 1 - publish backups atomically so failures keep old copies
ba684b018 feat(memory-curator): batch 3 - add bounded observation retention service
50a927d87 feat(shared): batch 2 - add storage health DTOs and retention settings
8c8de0a80 feat(persistence-sqlite): batch 1 - add retention tables and page reclaimer
7d474eab7 docs: file TASK_2026_440 to stop Thoth database growth
```

## Post-merge consistency checks

- Every `rotate(` call site reads `KEEP_BY_KIND`, including the ones main touched:
  - `cli-engine/.../thoth-runtime.ts:397`
  - `thoth-runtime/.../start-thoth-cron.ts:377`
  - `rpc-handlers/.../persistence-rpc.handlers.ts:439`
  - `persistence-sqlite/.../migration-runner.ts:99`
- `git diff --stat origin/main...HEAD -- apps` is empty. Phase 1 does not touch `apps/`, so the `ptah-electron` test run was not applicable.
- `apps/ptah-cli/project.json`, `apps/ptah-electron/project.json` and `apps/ptah-tui/project.json` differ between `e1fe2e49e` and the new HEAD. The changes come from main's commits, not from the branch. So I ran `npx nx reset` before verification. It printed `Failed to clean up the workspace data directory. Error: EPERM ... .nx\workspace-data`. The daemon still recomputed the graph ("Calculating the project graph on the Nx Daemon"), and every target resolved.

## Verification

### Typecheck

`npx nx run-many -t typecheck -p <8 projects> --skip-nx-cache`

```
 NX   Running target typecheck for 8 projects:
> nx run @ptah-extension/platform-core:typecheck
> nx run @ptah-extension/shared:typecheck
> nx run @ptah-extension/persistence-sqlite:typecheck
> nx run @ptah-extension/memory-curator:typecheck
> nx run @ptah-extension/memory-curator-ui:typecheck
> nx run @ptah-extension/rpc-handlers:typecheck
> nx run @ptah-extension/thoth-runtime:typecheck
> nx run @ptah-extension/cli-engine:typecheck
 NX   Successfully ran target typecheck for 8 projects
```

### Test (parallel default)

`npx nx run-many -t test -p <8 projects> --skip-nx-cache`

Header: `NX   Running target test for 8 projects:`. Exit 1, with 2 timeout failures:

| Project | Suites | Tests |
|---|---|---|
| shared | 58 passed | 1520 passed |
| platform-core | 1 failed, 40 passed | 1 failed, 4 todo, 776 passed |
| persistence-sqlite | 9 skipped, 30 passed | 80 skipped, 424 passed. Native better-sqlite3 probe fails under local Node (expected). |
| memory-curator-ui | 17 passed | 184 passed |
| memory-curator | 2 skipped, 37 passed | 59 skipped, 576 passed |
| rpc-handlers | 1 failed, 100 passed | 1 failed, 33 skipped, 3001 passed |
| cli-engine | 19 passed | 187 passed |
| thoth-runtime | 5 passed | 87 passed |

The two failures, verbatim:

```
● Performance smoke — PtahFileSettingsManager (Gap E) › keeps per-write cost flat across 1000 sequential set() calls (no O(n²) growth)
    thrown: "Exceeded timeout of 30000 ms for a test."
    at src/file-settings-manager.bench.spec.ts:86:3

● VoiceRpcHandlers › voice:transcribe › leaves no input temp file behind after a successful transcription
    thrown: "Exceeded timeout of 5000 ms for a test."
    at src/lib/handlers/voice-rpc.handlers.spec.ts:284:5
```

Neither file is touched by the branch. Both are timeouts under parallel load.

### Test rerun, serial (the two failing projects)

`npx nx run-many -t test -p @ptah-extension/platform-core @ptah-extension/rpc-handlers --parallel=1 --skip-nx-cache`

```
 NX   Running target test for 2 projects:
> nx run @ptah-extension/platform-core:test
Test Suites: 41 passed, 41 total
Tests:       4 todo, 777 passed, 781 total
> nx run @ptah-extension/rpc-handlers:test
Test Suites: 101 passed, 101 total
Tests:       33 skipped, 3002 passed, 3035 total
 NX   Successfully ran target test for 2 projects
```

Exit 0. All 8 projects now have a green test run.

### Lint

`npx nx run-many -t lint -p <8 projects> --skip-nx-cache`

```
 NX   Running target lint for 8 projects:
platform-core 9 warnings · shared 2 warnings · persistence-sqlite clean · memory-curator-ui 27 warnings
memory-curator 6 warnings · thoth-runtime clean · cli-engine 2 warnings · rpc-handlers 19 warnings
 NX   Successfully ran target lint for 8 projects
```

0 errors.

### Retention specs under Electron's Node (real better-sqlite3)

The prescribed command was `ELECTRON_RUN_AS_NODE=1 electron.cmd jest.js --config libs/backend/memory-curator/jest.config.ts --testPathPatterns retention --runInBand`.

The worktree path itself contains `retention` (`task-440-memory-retention`), so that pattern matched every memory-curator suite:

```
Test Suites: 39 passed, 39 total
Tests:       635 passed, 635 total
```

Exit 0, 0 skipped. The 59 tests that were skipped under plain Node ran and passed here.

Narrowed to the retention folder with `--testPathPatterns 'lib[\\/]retention[\\/]'`:

```
Test Suites: 3 passed, 3 total
Tests:       59 passed, 59 total
```

Exit 0.

No `C:\Users\abdal\.ptah\state\ptah.sqlite*` or `ptah.pre-migration-*.sqlite` file was opened.

## Decisions for the user

1. **Should `@ptah/memory-retention` also wait on main's background-work governor?**
   - Phase 1 gates the job on `boot-deferred`, `on-battery` and `foreground-active` (the `FOREGROUND_ACTIVITY_TRACKER`, 5 min).
   - `libs/backend/memory-curator/src/lib/retention/` has no reference to `BackgroundWorkAdmission` or `TOKENS.BACKGROUND_WORK_GOVERNOR`.
   - Main's governor (C14) holds background work while a turn is generating or the main loop lags. The daily backup and background curator passes both wait on it.
   - The retention job writes in `BEGIN IMMEDIATE` batches and runs `incremental_vacuum` on the main-thread connection, so the governor is relevant to it. But its foreground gate partly overlaps with the governor.
   - Phase 1 behavior is unchanged. Choose one: add a governor wait before the first batch (it skips as a new reason, or waits), or keep the foreground gate only.
2. **A same-day daily re-run now waits on the governor before it sees that today's final already exists.** This happens because `backup()` waits first and `takeBackup()` checks `existsSync(dest)` afterwards. The result is correct, but a no-op re-run can sit up to the governor's 10-min ceiling. Decide whether the existence check should come before the wait.
3. **The daily cron rotates unconditionally** (a phase 1 rule, so the stale-staging sweep can run). Under main's governor, a daily backup that returns `null` because of `AbortError` at shutdown still calls `rotate('daily', 7)` during quit. The rotate is synchronous filesystem work only, and it never removes the newest 7. Confirm that this is acceptable, or skip rotation on the shutdown path.
