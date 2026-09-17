## Diagnosis

Classification: **(a) the stress harness was too timing-sensitive under load**, not a production recovery race.

The pre-fix degraded scenario waited for `isDegraded` to clear, wrote `after-recovery.txt` exactly once, then used `waitFor`'s fixed 15,000 ms default for that one notification (`workspace-watch-host.stress.harness.ts`, pre-fix lines 728-737; the fixed default remains visible at lines 91-104). That made one native filesystem notification the sole proof of resumed delivery. A lost or delayed probe could fail the test even though the recovered subscription remained live.

The production ordering rules out the suspected “degraded cleared before re-subscribe” race:

- `workspace-watch-host-core.ts:448-455` posts `subscribed` only when `root.active` exists, no native subscribe is pending, and no retry is armed.
- `workspace-watch-host-core.ts:703-747` installs the settled native subscription in `root.active` before acknowledging subscribers.
- `workspace-watch-supervisor.ts:406-408` removes an id from `awaitingAck` only on that `subscribed` message.
- `workspace-watch-supervisor.ts:620-635` ends recovery only after every live subscription acked; `isDegraded` includes the entire recovering interval at `workspace-watch-supervisor.ts:232-235`.
- A missing recovery ack is itself bounded by `heartbeatIntervalMs * missedHeartbeatsBeforeRestart` at `workspace-watch-supervisor.ts:604-617` and returns to degraded mode rather than falsely reporting recovery.

The shortened scenario uses a 700 ms degraded recovery delay, a 200 ms heartbeat, two missed heartbeats, a 50 ms restart delay, and a 300 ms degraded rescan cadence (`workspace-watch-host.stress.harness.ts:680-690`). Therefore the recovery-ack window is `200 * 2 = 400 ms`. The new delivery budget is `700 + 400 + (2 * 250) + 15,000 = 16,600 ms`: recovery delay + recovery-ack deadline + two real coalescer cadences + shared-runner load margin (`workspace-watch-host.stress.harness.ts:692-701`). The whole degraded test timeout is derived from those same values and is 34,950 ms (`workspace-watch-host.stress.harness.ts:703-711`).

The scenario is not platform-gated. `workspace-watch-host.stress.spec.ts:68-76` documents a platform-neutral contract, the failing CI run was Linux, and all local verification here ran on Windows.

## Fix

- `workspace-watch-host.stress.harness.ts:680-711` centralizes the shortened supervision values and derives the ack, delivery, and Jest time budgets from them plus `WORKSPACE_WATCH_LIMITS.minBatchIntervalMs` (the production 250 ms batching cadence).
- `workspace-watch-host.stress.harness.ts:713-730` adds `probeUntilDelivered`: it rewrites the same concrete probe path once per production coalescer cadence until the recorder observes an actual change, or fails with the derived 16,600 ms timeout and probe count.
- `workspace-watch-host.stress.harness.ts:773-792` derives the degraded cadence wait and recovery wait from the centralized timings, then uses the repeated delivery probe after ack-confirmed recovery.
- `workspace-watch-host.stress.spec.ts:79,155` uses the derived 34,950 ms whole-scenario timeout instead of the unrelated fixed 20,000 ms literal.

No production source was changed.

## Why it is not weaker

The scenario still performs three real `SIGKILL`s against the forked host, exhausts the two-restart budget, observes degraded mode, requires overflow growth across degraded rescan cadences, requires exactly one degradation report, requires ack-confirmed recovery, and finally requires a real filesystem change to reach the listener. Re-probing does not substitute an overflow or diagnostic for delivery; the test returns only after `BatchRecorder.hasPath(after-recovery.txt)` is true. It removes dependence on one notification while strengthening the timeout failure with the number of attempted probes.

## Verification

- Preparation: `npx nx run ptah-electron:build-workspace-watch-host` — passed in 9.2 s. The first attempted isolated run before this correctly failed because the required bundle was absent.
- Pre-fix reproduction after building: `npx nx run-many -t test -p @ptah-extension/platform-electron --testPathPatterns=workspace-watch-host.stress --coverage --maxWorkers=2` — all three stress tests passed on Windows (Jest 35.021 s; wall 42.53 s), while the filtered command exited 1 solely because filtered branch coverage was 68.18% versus the project-wide 75% threshold. This confirms the Linux CI failure is intermittent/load-sensitive rather than a deterministic recovery break.
- Post-fix stress run 1: `npx nx run-many -t test -p @ptah-extension/platform-electron --testPathPatterns=workspace-watch-host.stress --maxWorkers=2 --skip-nx-cache` — passed, 1 suite / 3 tests (2 perf tests skipped); Jest 36.458 s, wall 45.43 s.
- Post-fix stress run 2: same command — passed, 1 suite / 3 tests (2 skipped); Jest 33.742 s, wall 40.82 s.
- Post-fix stress run 3: same command — passed, 1 suite / 3 tests (2 skipped); Jest 34.224 s, wall 42.04 s.
- Required full coverage: `npx nx run-many -t test -p @ptah-extension/platform-electron --coverage --maxWorkers=2 --skip-nx-cache` — header reported “Running target test for project @ptah-extension/platform-electron” (one project). A first loaded run exposed unrelated existing Windows timing flakes (611 passed, 5 failed); immediate clean rerun passed: 36 suites passed, 2 skipped; 616 tests passed, 4 skipped, 3 todo; Jest 69.18 s, wall 78.49 s. Nx identified the target as flaky because the rerun succeeded.
- Static verification: `npx nx run-many -t typecheck lint -p @ptah-extension/platform-electron` — passed both targets. Lint reported 8 pre-existing warnings, all outside `src/workspace-watch`; 0 errors.
