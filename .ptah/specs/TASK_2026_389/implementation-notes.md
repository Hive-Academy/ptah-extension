# TASK_2026_389 — implementation notes

## Files changed

- `apps/ptah-electron/src/activation/boot-coordinator.ts`: new `BootCoordinatorOptions { skipWarmup?: boolean }` constructor option. When it is set, `armWarmup()` marks the barrier settled, logs once and returns. It creates no poll timer and no 30 s deadline, and `notifyWindowLoaded()` does nothing.
- `apps/ptah-electron/src/main.ts`: this is where the coordinator is created. It now passes `new BootCoordinator({ skipWarmup: process.env['PTAH_E2E'] === '1' })`.
- `apps/ptah-electron/src/activation/start-messaging-gateway.ts`: new `skipStart?: boolean` option. When set, the function logs and returns before it waits on the persistence gate, so neither the gateway nor the bridge starts.
- `apps/ptah-electron/src/activation/post-window.ts`: passes `skipStart: process.env['PTAH_E2E'] === '1'`. The gateway is still resolved and stored in `refs`, and `gateway:status` RPC still answers from settings.
- `apps/ptah-electron/src/activation/bootstrap.ts`: `startMembershipVerification(container, { skip?: boolean } = {})`. The call site passes `skip: process.env['PTAH_E2E'] === '1'`. Nothing else in `bootstrap.ts` changed.
- `apps/ptah-electron-e2e/playwright.config.ts`: `timeout` goes from 60_000 to 120_000, and `trace` is now `'retain-on-failure'` in every environment. `isCI` is kept for `forbidOnly`.
- `apps/ptah-electron-e2e/README.md`: new "Never run two `e2e` invocations at once" section, plus a table of the `PTAH_E2E` gates and how to opt back in to each.
- Specs:
  - `boot-coordinator.spec.ts`: the warmup-barrier block gains a nested `skipWarmup` describe with 4 tests. They cover: no timers and no run even when a curator appears, a single log line, the default path is unchanged, and a pin that `main.ts` wires the flag.
  - `start-messaging-gateway.spec.ts`: new `skipStart` describe with 2 tests. They check that nothing starts and the gate is not awaited, and that `false` gives the normal start.
  - `bootstrap.network.spec.ts`: 2 tests. One checks that `skip` never resolves the licence service; the other pins the call-site wiring.
  - `wire-runtime.boot-order.spec.ts`: 1 test pinning the `skipStart` wiring in `post-window.ts`.

## Gates and env vars

| Subsystem | Gate | Opt back in |
| --- | --- | --- |
| Embedder warmup barrier | `PTAH_E2E=1` → `skipWarmup` | none |
| Messaging gateway + chat bridge start | `PTAH_E2E=1` → `skipStart` | none |
| Membership/licence priming | `PTAH_E2E=1` → `skip` | none |
| (existing) update check | `PTAH_E2E=1` | `PTAH_E2E_ALLOW_UPDATE_CHECK=1` |

I added no opt-back-in variables because no spec needs one. I checked this by grepping `apps/ptah-electron-e2e/src/specs` for gateway, license, membership, warmup, embedder and curator:

- `thoth/gateway.spec.ts` mocks every `gateway:*` RPC.
- `rpc-new-features.spec.ts` `gateway:status` only checks the response shape. `GatewayService.status()` reads settings, not whether adapters are running.
- `license:getStatus`, used by `rpc.spec.ts` and `license-watcher.spec.ts`, calls `verifyLicense()` itself.
- `license-watcher.spec.ts` "defaults to unlicensed" expects a null cached status, which is the same result with or without priming.
- No spec asserts that warmup completed.

The showcase launcher does not set `PTAH_E2E`, so it is unaffected. The docs-screenshots harness uses `launchPtah`, so it does get the gates. It does not start the gateway and does not wait for warmup.

## Deviation

The brief asked for the guideline to go into `apps/ptah-electron-e2e/CLAUDE.md`. That file does not exist: commit `7917b193a` ("docs: remove all CLAUDE.md and AGENTS.md files") removed every CLAUDE.md and AGENTS.md on purpose. I put the guideline in the harness's existing `README.md` instead of recreating the file.

## Verification

- `npx nx run-many -t test -p ptah-electron -- --maxWorkers=2` passed. The header read "Running target test for project ptah-electron and 6 tasks it depends on", and the 6 are the ptah-electron build-* prerequisites. Nx hid the Jest summary, so I also ran the touched specs on their own:
  - `boot-coordinator.spec` + `start-messaging-gateway.spec`: 2 suites, 58/58 passed.
  - `bootstrap.network.spec` + `wire-runtime.boot-order.spec`: 2 suites, 31/31 passed.
- `npx nx run-many -t lint -p ptah-electron ptah-electron-e2e` passed: "Successfully ran target lint for 2 projects". The first try failed with "Failed to process project graph" because it ran at the same time as the test run; the rerun passed.
- `npx tsc --noEmit -p apps/ptah-electron/tsconfig.app.json` finished with exit 0 and no errors.

## Measurement (one run, not looped)

`npx nx run ptah-electron-e2e:e2e -- src/specs/smoke.spec.ts` took 570 s wall time, including the build-dev and copy-renderer-dev prerequisites. Playwright itself reported 3.8 min for 4 tests. The gate log lines appeared as expected.

Result: **1 passed, 3 failed.** All 3 failures were `page.waitForURL` timeouts (30 s) in `electron-launcher.ts:44` `waitForPtahRenderer`. In the 3 failing boots, the main process logs stop after "IPC bridge, WebviewManager, and RPC methods initialized", "Agent adapters initialized successfully" and "Saving window bounds". None of them logged the warmup or gateway skip lines, so none reached the post-window phase. The boot is stalling before the renderer loads, which is upstream of the warmup and gateway gates. The only gate that runs before that point skips a network call that was never awaited, and nothing on the pre-window path reads licence state. The 4th boot passed in 39.1 s with all three gates active.

This matches the boot stall that the separate task instrumenting `ipc-bridge.ts` / `wire-runtime.ts` / `bootstrap.ts` is meant to diagnose. I did not measure a before-change baseline.

## Open concerns

- The warmup barrier's 30 s deadline and 200 ms poll are both `unref`'d timers, and `abort()` clears them at `will-quit`. They never blocked a test or app close. The gate removes the polling and the timeout warning from each harness boot, but the wall-time saving per test is probably much smaller than the "single biggest per-test cost" estimate in `context.md`. A before/after comparison is still needed, and it has to wait until the pre-window stall above is fixed.

## Orchestrator deviations (after judge round 1)

- **Spec audit moved out of scope.** The fourth "Scope for this task" bullet (audit the mocked git,
  `harness/*` and `tasks/*` specs for fixture mismatch) was removed from the implementer brief by the
  orchestrator. It moves to TASK_2026_550_9a28, whose worker-scoped `electronApp` needs a per-spec
  isolation review anyway; doing the audit twice is waste.
- **Headline result not yet proven.** The single `smoke.spec.ts` run after this change passed 1 of 4
  tests. The 3 failures are the pre-window start-up hang tracked in TASK_2026_556_d12d; they stall
  before any gate in this task runs. The before/after timing measurement is deferred until 556 lands.
- **Expected saving is smaller than context.md estimated.** The 30 s warmup barrier runs on
  background timers that no test awaited, so gating it removes polling and a warning, not 30 s per test.
