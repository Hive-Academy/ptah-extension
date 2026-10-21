# Batch 35 report

## Files changed

- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts`: Removed synthesis resolution, start, retry hook, and trigger dependency on synthesis. Starts the registered skill trigger directly and retains its shutdown callback.
- `libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.spec.ts`: Replaced synthesis boot cases with direct trigger start and failure coverage; kept abort, memory, indexing, and all-null refs coverage.
- `libs/backend/thoth-runtime/src/lib/types.ts`: Updated trigger lifecycle comments. Kept the `skillSynthesis` ref because consumers outside this batch still use it; no synthesis boot path writes it here.
- `libs/backend/thoth-runtime/src/lib/memory-retention-job.ts`: Kept the foreground tracker reader and retention handler; removed obsolete drain references in comments.
- `libs/backend/thoth-runtime/src/lib/memory-retention-job.spec.ts`: Verified live recent-activity and idle intervals from the tracker as well as the existing no-tracker Infinity path.
- `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts`: Removed drain and backlog cleanup imports, registration helpers, and scheduling calls. Kept backup, integrity, and memory retention jobs.
- `libs/backend/thoth-runtime/src/lib/start-thoth-cron.spec.ts`: Removed only drain and cleanup behavior suites and an obsolete comment; retained the other cron suites.

## What stays wired

- The skill trigger token is still resolved and started during Thoth boot, with its ref and `onSkillTriggerStarted` callback retained for shutdown.
- The spec harvester remains in the trigger path and its existing registration is untouched by this batch. These seven files contain no direct harvester registration.
- Memory retention still resolves and starts `FOREGROUND_ACTIVITY_TRACKER` when available, reads its live activity interval, and falls back to Infinity when absent. The hourly retention job remains scheduled.

## Decisions

- Kept `ThothRuntimeRefs.skillSynthesis` and its initializer because external lifecycle code still reads, writes, and stops that handle. It remains null in this Thoth boot path.
- Kept `BootThothRuntimeOptions.onSkillTriggerStarted` because Electron boot consumes the callback.
- Kept the pipeline job definition files and exports untouched for the later deletion batch.
- No tests, typecheck, lint, build, serve, or e2e were run, as instructed. Verification was limited to targeted reads and `rg` for stale scoped callers and external type consumers.

## Clarifications Needed

- `ThothRuntimeRefs.skillSynthesis` still has external consumers: `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:95,210,321,345`; `apps/ptah-electron/src/activation/shutdown.ts:230`, `apps/ptah-electron/src/activation/boot-heavy-services.ts:189`, `apps/ptah-electron/src/activation/boot-coordinator.ts:174`; `apps/ptah-tui/src/lib/thoth-lifecycle.ts:86` and `apps/ptah-tui/src/lib/thoth-lifecycle.spec.ts:19`. Later batches should remove or adapt these before removing the field.
- `BootThothRuntimeOptions.onSkillTriggerStarted` is used at `apps/ptah-electron/src/activation/boot-heavy-services.ts:173`; it is still required while trigger shutdown is wired through that callback.
