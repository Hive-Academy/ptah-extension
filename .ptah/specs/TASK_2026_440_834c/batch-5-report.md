# Batch 5 report — `@ptah/memory-retention` cron job in both hosts

Status: COMPLETE. No commit was made. `nx reset` was not run. `batches.md` was not edited.
Files touched are only in `libs\backend\thoth-runtime\**` and `libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime{,.spec}.ts`.

## Task 5.1 — Job spec + handler factory

Files:
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\lib\memory-retention-job.ts`
- CREATE `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\lib\memory-retention-job.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\index.ts` (export block ending at `:27`)

Evidence:
- `memory-retention-job.ts:39` — `MEMORY_RETENTION_JOB` = `{ jobId '@ptah/memory-retention', name 'Memory Retention', handlerName 'memory:retention', cronExpr '17 * * * *', timezone 'UTC' }`.
- `memory-retention-job.ts:62` — `createMemoryRetentionHandler(container): JobHandler`.
- `:66-76` — the service is resolved per run inside `try`. A resolve failure returns `{ outcome: 'skipped', reason: 'retention-service-unavailable' }` (`:74`).
- `:78-80` — `CRON_TOKENS.CRON_POWER_MONITOR` is resolved per run. `isOnBattery: () => monitor.isOnBattery()`.
- `:113-126` — `foregroundActivityReader`: when `FOREGROUND_ACTIVITY_TRACKER` is registered, it resolves the tracker, calls `start()` (`:124`) and returns `() => tracker.msSinceLastActivity()`. Otherwise it returns `() => Number.POSITIVE_INFINITY` (`:119`).
- `:83-87` — `service.run({ signal: ctx.signal, isOnBattery, msSinceForegroundActivity })`.
- `:89-104` — mapping. `skipped` → `{ outcome: 'skipped', reason }`. `failed` → `throw new Error('memory retention failed: <reason ?? unknown>')` (`:93`). The sanitized `error` text is not used. `completed` / `partial` → `summary: 'purged <n> processed, quarantined <m> stuck, reclaimed <p> pages'` plus ` (partial: <reason>)` for `partial`.

Spec tests (`memory-retention-job.spec.ts`, 9 tests, all passed):
- `MEMORY_RETENTION_JOB pins the job id, handler name and hourly minute-17 UTC schedule`
- `createMemoryRetentionHandler passes the cron signal and live gate readers to service.run`
- `createMemoryRetentionHandler maps a completed report to a summary`
- `createMemoryRetentionHandler maps a partial report to a summary carrying its stop reason`
- `createMemoryRetentionHandler maps a skipped report to a skipped OUTCOME with the gate reason`
- `createMemoryRetentionHandler throws on a failed report with the reason token and no error text`
- `createMemoryRetentionHandler resolves the service and the power monitor on every run`
- `createMemoryRetentionHandler reports Infinity foreground idle time when the host has no tracker`
- `createMemoryRetentionHandler returns a skipped outcome when the service cannot be resolved`

## Task 5.2 — Electron host registration + reachability spec

Files:
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\lib\start-thoth-cron.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\src\lib\start-thoth-cron.spec.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\thoth-runtime\CLAUDE.md`

Evidence:
- `start-thoth-cron.ts:11` — `MEMORY_TOKENS` imported from `@ptah-extension/memory-curator`. `:6` imports `KEEP_BY_KIND` from `@ptah-extension/persistence-sqlite`.
- `start-thoth-cron.ts:266-298` — `registerMemoryRetentionJob(container, jobStore, handlerRegistry, logPrefix, emit)`. It returns early when `!container.isRegistered(MEMORY_TOKENS.MEMORY_RETENTION_SERVICE)`. It registers behind `handlerRegistry.has(...)`, wrapped by `withActivityEmit(emit, 'memory:retention', createMemoryRetentionHandler(container))`. It upserts `{ id, name, cronExpr, timezone: 'UTC', prompt: 'handler:memory:retention', enabled: true }` unconditionally. It logs `Memory retention cron job registered (@ptah/memory-retention)` (`:296`).
- `start-thoth-cron.ts:472-488` — called after the integrity block, in its own `try` / `catch (retentionErr: unknown)`.
- `start-thoth-cron.ts:377` — `backupSvc.rotate('daily', KEEP_BY_KIND.daily)`.
- The `incremental_vacuum(100)` try block in the backup handler was deleted. `pragma('optimize')` stays (`:399`). The comment above the connection check was updated to match.
- `CLAUDE.md`: the Owns line names the retention job. Public API lists `SKILL_DRAIN_JOBS`, `MEMORY_RETENTION_JOB`, `MemoryRetentionJobSpec`, `createMemoryRetentionHandler`. The backup guideline now says `rotate('daily', KEEP_BY_KIND.daily)`, gates only `optimize`, and records that the vacuum was deleted. A new guideline describes the retention job, its guards, per-run resolves and failure channel.

Reachability tests (`start-thoth-cron.spec.ts`, `describe('memory retention job')` at `:787`, all passed):
- `startThothCron memory retention job upserts the exact @ptah/memory-retention job and registers memory:retention`
- `startThothCron memory retention job the registered handler reaches service.run with the cron signal`
- `startThothCron memory retention job registers once and upserts twice across two startThothCron calls`
- `startThothCron memory retention job registers no retention job without the service and leaves other jobs alone`
- Updated old assertion: `startThothCron registers the daily backup handler and upserts the @ptah/daily-backup job` now asserts no `incremental_vacuum` pragma (`:161-163`), `pragma('optimize')` once, and still `rotate('daily', 7)` (`:157`, also `:208`).

The token is imported from `@ptah-extension/memory-curator` at `start-thoth-cron.spec.ts:8`. It is not re-declared.

## Task 5.3 — CLI host registration + reachability spec

Files:
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts`
- MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-440-memory-retention\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.spec.ts`

Evidence:
- `thoth-runtime.ts:24-28` — `MEMORY_RETENTION_JOB`, `SKILL_DRAIN_JOBS`, `createMemoryRetentionHandler` imported from `@ptah-extension/thoth-runtime`.
- `thoth-runtime.ts:330` — `registerMemoryRetentionJob(container, logger)` called directly after `registerSkillDrainJobs`.
- `thoth-runtime.ts:528-566` — guards: `CRON_JOB_STORE`, `CRON_HANDLER_REGISTRY`, `MEMORY_RETENTION_SERVICE` registered. `has()` guard on registration, no activity emitter, unconditional upsert, `logger.warn('[CLI Thoth] Memory retention cron registration failed (non-fatal)', ...)` (`:560`).
- `thoth-runtime.ts:397` — `backupService.rotate('daily', KEEP_BY_KIND.daily)`.

Reachability tests (`thoth-runtime.spec.ts`, all passed):
- `activateThoth — runtime tier memory retention job (TASK_2026_440 reachability) upserts @ptah/memory-retention and registers memory:retention once`
- `activateThoth — runtime tier memory retention job (TASK_2026_440 reachability) the registered handler reaches service.run with the cron signal`
- `activateThoth — runtime tier memory retention job (TASK_2026_440 reachability) registers no retention job when the host has no retention service`
- `activateThoth — runtime tier memory retention job (TASK_2026_440 reachability) the oneshot tier registers and upserts nothing`
- `activateThoth — runtime tier the daily backup handler rotates with the daily keep count` — asserts `rotate('daily', 7)` (`:453`). The CLI spec had no rotate assertion before, so this test adds it.

The retention tests use a separate token set (`ALL_RUNTIME_TOKENS` plus `MEMORY_RETENTION_SERVICE`). The existing upsert-count assertions (4 and 1) therefore stay unchanged.

## Verification

### `npx nx run-many -t typecheck test lint -p @ptah-extension/thoth-runtime @ptah-extension/cli-engine`

- Result: `NX Successfully ran targets typecheck, test, lint for 2 projects`. A separate lint run printed the header `NX Running target lint for 2 projects:`.
- typecheck: both projects passed (`tsc --noEmit`).
- test: `cli-engine` 17 suites / 178 tests passed. `thoth-runtime` 5 suites / 87 tests passed.
- lint: 0 errors, 2 warnings. Both warnings existed before this batch:
  - `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:14:8` — `'ThothRefs' is defined but never used` (the import was already there).
  - `249:19 Unexpected empty method 'dispose'` — in a cli-engine file this batch did not touch. `npx eslint` on the touched files shows only the `ThothRefs` warning.
- The cli-engine Jest run printed "A worker process has failed to exit gracefully". This is from the existing `withEngine` suites, not from the files in this batch.
- No failure pointed into `persistence-sqlite`, `memory-curator` or `shared`.

### Jest `--json` per-file results (run with each project's own jest config, output written to `%TEMP%`)

| Spec file | Tests | Passed | Failed | Pending | Todo |
|---|---|---|---|---|---|
| `thoth-runtime/src/lib/memory-retention-job.spec.ts` | 9 | 9 | 0 | 0 | 0 |
| `thoth-runtime/src/lib/start-thoth-cron.spec.ts` | 30 | 30 | 0 | 0 | 0 |
| `cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts` | 19 | 19 | 0 | 0 | 0 |

Every reachability test named above has status `passed`. 0 skipped.

### Grep

- `incremental_vacuum\(100\)` in `libs\`: **0 matches** (source, specs and docs). The thoth-runtime `CLAUDE.md` describes the removed step without the literal.
- `rotate\('(daily', 7|pre-migration', 3)\)` in `libs\`: 4 matches, all in `libs\backend\persistence-sqlite\src\lib\backup.service.spec.ts` (`:221`, `:838`, `:969`, `:978`). That file is a spec owned by the Task 1.4 lane. **0 matches in production (non-spec) code.**
- In the two host specs, `rotate` is asserted as `toHaveBeenCalledWith('daily', 7)`. That form does not match the literal pattern, and it still pins the keep count to 7.

## Notes for the reviewer

- The resolve-failure branch in the handler uses `catch {` with no binding. It returns a reason token and does not log, because the factory is shared by the Electron host (`console`) and the CLI host (`Logger`). The skipped run row is the record.
- A power monitor resolve failure is not caught. It throws, and `JobRunner` records the run as `failed`. This is the same behaviour as the skill drain handlers.
- The Electron backup summary text `pragmas skipped: no sqlite connection` did not change, because existing specs pin it. Only one pragma remains behind that guard.
