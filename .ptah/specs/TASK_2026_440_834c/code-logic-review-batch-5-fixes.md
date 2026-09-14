# Code logic review — Batch 5 fixes

## Finding status

| Prior finding | Status |
|---|---|
| MODERATE — CLI reachability specs do not prove repeated-start registration idempotency | **CLOSED** |

The new CLI test exercises the missing behaviour directly. It calls `activateThoth(..., 'runtime', ...)` twice with the same container and a stateful registry (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:512-533`), then asserts one `memory:retention` registration and two exact retention upserts (`:535-552`). It also retrieves and invokes the retained handler and proves `service.run` receives the same cron signal (`:558-572`).

The fake matches the real registry's relevant semantics:

- The test's `has()` reads a `Map`, duplicate `register()` throws, and successful registration stores the function (`thoth-runtime.spec.ts:517-527`).
- The real `HandlerRegistry` also owns a `Map`, rejects duplicate names, stores the handler, and implements `has()` from that map (`libs/backend/cron-scheduler/src/lib/handler-registry.ts:17-29,36-41`).

The test is mutation-sensitive:

- Removing the production `has()` guard at `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:544-549` makes the second registration throw. The register-call count becomes two, the second upsert is not reached, and the non-fatal warning is emitted, contradicting the assertions at `thoth-runtime.spec.ts:535-556`.
- Removing registration leaves no handler in the stateful map and fails `expect(handler).toBeDefined()` at `thoth-runtime.spec.ts:558-561`.
- Registering a handler that does not reach the retention service fails the call-count and signal assertions at `thoth-runtime.spec.ts:569-572`.

## Team-leader extra checks

### 2a. Power-monitor resolution outside the service-resolution try

**No defect; no severity.**

`createMemoryRetentionHandler` deliberately catches only failure to resolve `MEMORY_RETENTION_SERVICE`, mapping that condition to `retention-service-unavailable` (`libs/backend/thoth-runtime/src/lib/memory-retention-job.ts:65-76`). It resolves `CRON_POWER_MONITOR` afterward and outside that catch (`:78-80`). Therefore, if the retention service remains resolvable but the power monitor is missing or disposed, the handler rejects.

That behaviour is consistent with both precedent and the scheduler contract:

- Electron skill-drain handlers resolve the drain service and power monitor per invocation without a local catch (`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:68-80`).
- CLI skill-drain handlers follow the same pattern (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:468-481`).
- `JobRunner` catches a handler rejection, writes `markFailed`, updates `lastRunAt`, logs the failure, and releases the concurrency slot (`libs/backend/cron-scheduler/src/lib/job-runner.ts:212-239`).

A missing required power-monitor dependency is host/runtime breakage, not a retention gate closing. Recording `failed` is more truthful than converting it to `skipped`, and the exception remains contained by `JobRunner`; no scheduler-loop failure escapes.

### 2b. Foreground tracker `start()` when skill drain is disabled

**No defect; no severity.**

The retention job's foreground gate is independent of the skill-drain enable setting, so it is correct for retention to activate the shared tracker when the tracker token exists. `foregroundActivityReader` resolves the tracker per run and calls `start()` before taking the live age reader (`libs/backend/thoth-runtime/src/lib/memory-retention-job.ts:113-125`). Skill drain uses the same lazy-start design at the foreground gate (`libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts:709-729`).

Repeated hourly calls are side-effect-safe:

- The tracker is registered as a singleton and its public token aliases that singleton (`libs/backend/skill-synthesis/src/lib/di/register.ts:88,166-168`).
- `start()` returns immediately when its disposer already exists or no activity source is available; the only first-start side effect is one event subscription (`libs/backend/skill-synthesis/src/lib/queue/foreground-activity.tracker.ts:42-62`). It creates no timer, interval, worker, or asynchronous loop.
- The real `SessionActivityRegistry.register()` attaches one listener and returns a disposer that removes exactly that listener (`libs/backend/agent-sdk/src/lib/helpers/session-activity-registry.ts:21-48`).
- The tracker spec calls `start()` three times and proves the source has exactly one callback (`libs/backend/skill-synthesis/src/lib/queue/foreground-activity.tracker.spec.ts:91-100`). It also proves `stop()` disposes the subscription and permits a later restart (`:102-112`), and that a host without the SDK registry safely remains a no-op returning `Infinity` (`:114-122`).

Thus disabling skill drain does not create an hourly subscription leak: retention establishes at most the one process-lifetime subscription it needs for its own foreground gate. The CLI Jest worker-exit warning is not evidence of a tracker leak; this tracker owns no event-loop handle.

## New findings

None.

## Command output summary

Command run exactly as requested:

```text
npx nx run-many -t typecheck test lint -p @ptah-extension/cli-engine @ptah-extension/thoth-runtime --parallel=1
```

- Exit code: **0**.
- Header: `NX Running targets typecheck, test, lint for 2 projects`, listing `@ptah-extension/cli-engine` and `@ptah-extension/thoth-runtime`.
- Final result: `NX Successfully ran targets typecheck, test, lint for 2 projects`.
- `@ptah-extension/thoth-runtime`: typecheck passed; 5 suites / 87 tests passed; lint passed.
- `@ptah-extension/cli-engine`: typecheck passed; 17 suites / 179 tests passed; lint completed with 0 errors and 2 pre-existing warnings.
- The warnings are the unrelated empty `dispose` at `libs/backend/cli-engine/src/lib/adapters/cli-adapters.ts:249` and the pre-existing unused `ThothRefs` import at `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:14`.
- Nx used cached output for 3 of 6 targets. The changed CLI suite result contains 179 passing tests, including the new repeated-start test.
- CLI Jest printed its existing worker-process graceful-exit warning and non-fatal `withEngine` fixture messages. All suites passed; neither points to the Batch 5 fix or to the foreground tracker.

## Verdict

**APPROVED** — the prior moderate finding is closed, both requested edge cases conform to established lifecycle and failure-channel behaviour, and no new Batch 5 defect was found.
