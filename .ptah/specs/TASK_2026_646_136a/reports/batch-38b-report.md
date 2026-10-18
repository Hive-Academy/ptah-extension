# Batch 38b report

## Changed files

- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\di\tokens.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\di\start.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\lib\di\start.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\lane-outcomes\src\index.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-extension-vscode\src\di\phase-2-libraries.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-extension-vscode\src\main.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-electron\src\di\phase-2-libraries.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-electron\src\activation\boot-coordinator.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-electron\src\activation\wire-runtime.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-electron\src\activation\shutdown.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\apps\ptah-electron\src\activation\shutdown.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-engine\src\lib\lane-outcomes-wiring.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-engine\src\lib\bootstrap\shutdown-host-runtime.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-engine\src\lib\bootstrap\shutdown-host-runtime.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-engine\src\lib\bootstrap\with-engine.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\libs\backend\cli-engine\src\lib\bootstrap\with-engine.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\decision-model-routing\.ptah\specs\TASK_2026_646_136a\reports\batch-38b-report.md

## Shutdown order and implementation evidence

- **VS Code:** Before and after, agent reap precedes outcome drain (`apps/ptah-extension-vscode/src/main.ts:168-183,203-225`); DI clear follows at :251. The drain has a two-second timeout (`main.ts:47,211-215`).
- **Electron:** Before, outcome drain preceded SQLite close and agent reap (reviewed original `apps/ptah-electron/src/activation/shutdown.ts:258-285`). After, agent reap at `shutdown.ts:261-264`, bounded drain at :266-273, and SQLite close at :275. `withBudget` absorbs a rejected or timed-out drain. The SQLite close invariant is explicit at :239-243. `BootRefs` declares and initializes the disposer at `boot-coordinator.ts:127-128,183`; `wire-runtime.ts:529,544-561` captures it while DI is healthy; `shutdown.ts:266-269,413` reads the ref without a teardown-time DI resolve.
- **CLI:** Before, `disposeThoth` preceded `shutdownHostRuntime` in the outer finally (`libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts`, original lines 431-451), so SQLite closed first. After, `with-engine.ts:433` runs `shutdownHostRuntime` before `disposeThoth` at :434-437. Within shutdown, `shutdown-host-runtime.ts:177-185` reaps agents, closes proxies, and drains outcomes; `disposeThoth` closes SQLite at `thoth-runtime.ts:221-222`. The workspace index, SDK adapter, and final container disposal retain their relative order (`with-engine.ts:418-453`). The drain uses `disposeSubsystem` with a two-second timeout and catches failures (`shutdown-host-runtime.ts:77-116`); its header describes four subsystems (:4-18).
- **Shared start and token:** `LANE_OUTCOME_TOKENS.DISPOSER` retains the same `Symbol.for` identity (`libs/backend/lane-outcomes/src/lib/di/tokens.ts:1-16`). A partial start unsubscribes successful registrations, logs a real Error, and returns a disposer (`di/start.ts:27-81`); the helper registers a disposer even on partial failure (`di/start.ts:84-97`), exported at `src/index.ts:63-66`. VS Code, Electron, and CLI call the helper at `phase-2-libraries.ts:236`, Electron `phase-2-libraries.ts:424`, and `lane-outcomes-wiring.ts:27` respectively.
- **DI guards:** No DI guard spec required a change: the token identity and host registration function remain the same; only the shared helper performs the existing registration.

## Spec cases

- `startAndRegisterLaneOutcomes > cleans up a partial callback start and registers a drain` in `libs/backend/lane-outcomes/src/lib/di/start.spec.ts:8-9`.
- `will-quit — the run-check kill > awaits agent reap, lane outcomes, then SQLite close before re-issuing quit` in `apps/ptah-electron/src/activation/shutdown.spec.ts:64,138` (updated).
- `shutdownHostRuntime > drains after agent reap and before watcher disposal` in `libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.spec.ts:95,327`.
- `withEngine > Thoth activation tier matrix > reaps agents and drains outcomes before Thoth closes SQLite` in `libs/backend/cli-engine/src/lib/bootstrap/with-engine.spec.ts:181,1157,1298` (updated).

## Decisions

1. **Partial start:** Options were to propagate failure with live subscriptions or clean up and preserve a shutdown drain. Chose cleanup and registration. Evidence: `di/start.ts:27-97`. Reversible: yes.
2. **CLI drain budget:** Options were an unbounded await or a bounded drain. Chose two seconds, matching the Electron lane-outcome budget (`shutdown-host-runtime.ts:35,92-103`; `apps/ptah-electron/src/activation/shutdown.ts:88`). Reversible: yes.
3. **Outer CLI order and Electron capture:** Decision #101 authorized minimal edits to `with-engine.ts` and `wire-runtime.ts`. Chose to move the existing CLI shutdown call and capture the disposer into `BootRefs`, leaving all other call order intact. Evidence: `with-engine.ts:418-453`; `wire-runtime.ts:529,544-561`; `boot-coordinator.ts:127-128,183`. Reversible: yes.

## Verification and remaining work

- Ran `npx prettier --write` on changed source/spec files. Per the serialized verification rule, ran no Nx, Jest, tsc, eslint, build, serve, e2e, package command, or `ptah_get_diagnostics`.
- No required code work remains in this batch. Tests and type checks are deferred to the orchestrator; their result is unknown here.
