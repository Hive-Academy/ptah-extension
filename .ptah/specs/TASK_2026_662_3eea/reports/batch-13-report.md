# Batch 13 report

## Files changed

- `libs/backend/skill-synthesis/src/lib/queue/foreground-activity.tracker.ts:4-22,29-30,53-56,87-88` — removed queue/drain-specific explanation. The tracker behavior remains unchanged.
- `libs/backend/skill-synthesis/src/lib/queue/foreground-activity.tracker.spec.ts:7-19,36-49` — removed the queue database test-support import and added a DI resolution case using only the logger host binding. Existing standalone activity, idempotence, disposal, and missing-registry cases remain.
- `libs/backend/skill-synthesis/src/lib/di/register.ts:73-78,109,204-206` — moved singleton and token registration together to the start of unconditional service registration, away from the queue group; no new registration or behavior change.
- `libs/backend/skill-synthesis/src/index.ts:263-267` — inspected, unchanged; tracker and its public types remain exported.

## Remaining tracker imports

`foreground-activity.tracker.ts:23-25` imports `inject` and `injectable` from `tsyringe`, `TOKENS` and the `Logger` type from `@ptah-extension/vscode-core`, and `SESSION_ACTIVITY_REGISTRY_TOKEN` from `../di/tokens`. It imports no drain, queue store, synthesis queue type, or lane runner.

## Consumers

`rg -n "FOREGROUND_ACTIVITY_TRACKER|ForegroundActivityTracker" libs apps` found these runtime references:

- `libs/backend/thoth-runtime/src/lib/memory-retention-job.ts:14,116,120-121` imports the public type and resolves the token; its spec supplies a tracker at line 83.
- `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts:209,671-672,997` injects the tracker; queue test support and boot-deferral spec also refer to it.
- `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts:10,119-120` injects the tracker; its specs refer to it.
- `libs/backend/skill-synthesis/src/lib/di/register.ts:54,74-76`, `di/tokens.ts:129-130`, and `src/index.ts:264` retain registration, token, and public export. `di/register.spec.ts:200-201` checks the token description.
- Comments in `skill-trigger.service.ts:144`, `memory-curator/src/lib/triggers/memory-trigger.service.ts:146`, and `memory-curator/src/lib/triggers/boot-scan-scheduler.ts:24` reference the tracker behavior.

## Verification

Inspected imports, registration and public export; all edited source/spec files have LF line endings. Tests, typecheck, lint, Nx, build and e2e were not run, per batch instructions. The orchestrator owns the skill-synthesis test/typecheck gate.

## Decisions

- Keep the tracker in `queue/foreground-activity.tracker.ts`, as the plan explicitly requires. Moving it would create unnecessary import churn; this is reversible.
- Move the two existing DI registrations as one block instead of changing registration semantics. The previous block was already unconditional, but placing it before pipeline registrations makes its independent ownership clear; this is reversible.
- Leave `src/index.ts` unchanged because it already exports the tracker and both public types; no alternative export is needed.