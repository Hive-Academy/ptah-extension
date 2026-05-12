# @ptah-extension/cron-scheduler

[Back to Main](../../../CLAUDE.md)

## Purpose

Generic cron job scheduler backed by SQLite. Runs scheduled `JobHandler`s with single-claim slot semantics, missed-run catchup, and pluggable power-monitor awareness.

## Boundaries

**Belongs here**:

- Cron loop (`CronScheduler`), executor (`JobRunner`), catchup logic (`CatchupCoordinator`)
- Stores: `JobStore`, `RunStore` (slot claim via unique constraint)
- Handler registry, power monitor port, errors, DI registration

**Does NOT belong**:

- Concrete job logic (handlers register externally)
- DB connection management (use `persistence-sqlite`)
- Platform power APIs (consumer supplies an `IPowerMonitor`)

## Public API

`CronScheduler`, `JobRunner`, `CatchupCoordinator`, `JobStore`/`IJobStore`, `RunStore`/`IRunStore`, `HandlerRegistry`, `NoopPowerMonitor`/`IPowerMonitor`, `CronScheduler/JobNotFound/CronConfig Error`s, `CRON_TOKENS`, `registerCronSchedulerServices`. Types: `ScheduledJob`, `JobRun`, `JobRunStatus`, `CreateJobInput`, `UpsertJobInput`, `CronSchedulerOptions`, `CatchupPolicy`, `IHandlerRegistry`, `JobHandler`, `JobHandlerContext`, `JobHandlerResult`, `CATCHUP_WINDOW_MAX_MS`. Helper: `SlotAlreadyClaimedError`, `isUniqueConstraintError`.

## Internal Structure

- `src/lib/cron-scheduler.ts` — main loop
- `src/lib/job-runner.ts` — executes a single run
- `src/lib/catchup-coordinator.ts` — replays missed runs within `CATCHUP_WINDOW_MAX_MS`
- `src/lib/job.store.ts`, `run.store.ts` — SQLite-backed persistence
- `src/lib/handler-registry.ts` — name → handler
- `src/lib/power-monitor.interface.ts` — `IPowerMonitor` port (NoopPowerMonitor default)
- `src/lib/di/{tokens,register}.ts`

## Dependencies

**Internal**: `@ptah-extension/persistence-sqlite` (shared DB connection)
**External**: cron parser libs, `tsyringe`

## Guidelines

- Slot claim collisions are expected — handle `SlotAlreadyClaimedError` / `isUniqueConstraintError` as success-by-other-worker, not failure.
- Long-running handlers must respect cancellation in `JobHandlerContext`.
- No file IO outside the store layer.
- `catch (error: unknown)`.

## Cross-Lib Rules

Used by `rpc-handlers` (`CronRpcHandlers`) and app layers. Depends only on `persistence-sqlite`.
