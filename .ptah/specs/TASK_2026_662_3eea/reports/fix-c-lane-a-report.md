# Phase C fix round — lane A

## Files changed

- `libs/backend/thoth-runtime/src/lib/retired-skill-jobs.ts` — add the four retired job IDs and a per-job, nonfatal disable helper.
- `libs/backend/thoth-runtime/src/lib/retired-skill-jobs.spec.ts` — cover enabled, disabled, missing, failed, and preserved jobs.
- `libs/backend/thoth-runtime/src/index.ts` — export the helper and IDs.
- `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` — disable retired jobs before scheduler start and report outcomes.
- `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts` — complete job-store fakes and assert disable precedes start.
- `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` — perform the same guarded, logged cleanup before CLI cron start.
- `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts` — return the count of deleted stale grades.
- `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.spec.ts` — assert the prune counts.
- `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts` — log positive prune counts with task and keep count.
- `libs/backend/skill-synthesis/src/lib/spec-harvester.service.spec.ts` — return zero from fakes and assert the positive-count log.

## Fixes

- **Retired cron jobs:** `retired-skill-jobs.ts:4-35` gets and conditionally disables each of the four rows, continues after an individual failure, and never deletes rows. `start-thoth-cron.ts:386-408` and `cli-engine/src/lib/bootstrap/thoth-runtime.ts:358-379` run it before starting cron, report disabled counts and failures, and keep startup nonfatal. Tests: `retired-skill-jobs.spec.ts:8-42`, `start-thoth-cron.spec.ts:117-137`.
- **Silent grade prune:** `skill-task-grade.store.ts:172-185` sums SQLite `changes` and returns the count. `spec-harvester.service.ts:200-205` logs when it is positive, including an empty keep list. Tests: `skill-task-grade.store.spec.ts:135-150`, `spec-harvester.service.spec.ts:204-211`.

## Decisions

- Disable job rows instead of deleting them: `IJobStore.delete` cascades to `job_runs`; OP-1 must archive them before migration 0057 removes the rows. This is reversible by re-enabling a row.
- Return failed IDs alongside the disabled count so one corrupt or locked row does not prevent the remaining jobs or the cron scheduler from proceeding. This is reversible by retrying on next startup.
- No separate `removeAbsent` interface exists under `libs/backend/skill-synthesis/src`; only `spec-harvester.service.spec.ts` fakes it. Those fakes now return zero.

## Could not do

- Tests, typecheck, lint, build, Nx, Jest, and diagnostics were not run because the lane instructions explicitly reserve all verification commands for the orchestrator.
