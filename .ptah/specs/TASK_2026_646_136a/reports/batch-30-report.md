# Batch 30 (AB14) backend implementation report

## Implemented

| Host     | Registration and aliases                                                                                                                                    | Start and disposer                                                                                                                                                                 | Shutdown hook                                                                                                                                                                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code  | `apps/ptah-extension-vscode/src/di/phase-2-libraries.ts:132-138`; after the existing routing registration at `:131`, before CLI runtime at `:235`           | `phase-2-libraries.ts:237-240`; returned disposer stored under `Symbol.for('PtahLaneOutcomesDisposer')`                                                                            | `apps/ptah-extension-vscode/src/main.ts:202-210` (`deactivate`) awaits it before container clear; failure logged through `logger.warn`                                        |
| Electron | `apps/ptah-electron/src/di/phase-2-libraries.ts:317-323`; after routing at `:316`, before CLI runtime at `:324`                                             | `phase-2-libraries.ts:425-428`; returned disposer stored under the same symbol after SQLite registration at `:405`                                                                 | `apps/ptah-electron/src/activation/shutdown.ts:259-269` awaits it before SQLite close; `:425` defers quit while registered; `withBudget` logs failures                        |
| CLI      | `libs/backend/cli-engine/src/lib/container.ts:737-739` calls `wireLaneOutcomes`; helper `lane-outcomes-wiring.ts:16-22` registers outcomes and both aliases | `container.ts:768` calls `startCliLaneOutcomes` after `registerThothLibraries`; helper `lane-outcomes-wiring.ts:30-33` stores the returned disposer under `LANE_OUTCOMES_DISPOSER` | `libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.ts:154-169` awaits it between proxy and watcher disposal; failures go to the established shutdown stderr log |

All starts are after `registerSdkServices`; start failures log through each injected host logger and remain nonfatal. Routing remains before VS Code LM tools in all three roots. Electron and CLI starts intentionally follow SQLite registration: starting earlier would instantiate the KeyValue store and cache the wrong backend.

## Smoke guards

- VS Code `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:371-422`: source order and one registration; both alias resolutions; `KeyValueLaneOutcomeStore` resolves over `PLATFORM_TOKENS.STATE_STORAGE`.
- Electron `apps/ptah-electron/src/di/container.smoke.spec.ts:400-453`: source order and one registration; both alias resolutions.
- CLI `apps/ptah-cli/src/di/container.smoke.spec.ts:340-405`: host/helper source order and one registration; both alias resolutions.
- P1-L7: Electron dedicated same-instance budget-stop registry case at `apps/ptah-electron/src/di/container.smoke.spec.ts:549`; CLI dedicated case at `apps/ptah-cli/src/di/container.smoke.spec.ts:327`. Assertions removed from the unrelated process spawner and builder helper cases.
- Adjacent shutdown guards: VS Code `apps/ptah-extension-vscode/src/deactivate-order.spec.ts:62`; Electron `apps/ptah-electron/src/activation/shutdown.spec.ts:150`; CLI `libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.spec.ts:306`. The CLI existing all-registered failure test now expects four resolver attempts, including lane outcomes.

## Write-path trace inputs

- Capability matrix user file: `{ptahHomeDir}/routing/capability-matrix.json`; generated view: `{ptahHomeDir}/routing/capability-matrix.view.json` (`libs/backend/lane-routing/src/lib/matrix/capability-matrix.store.ts:64-69`).
- Decision-model unsupported mark: `ptah.decisionModel.unsupported.v1` on global `PLATFORM_TOKENS.STATE_STORAGE` (`libs/backend/lane-routing/src/lib/decision-model/decision-model.types.ts:91`).
- Outcome journal: `ptah.laneOutcomes.journal.v1` (`libs/backend/lane-outcomes/src/lib/write/key-value-outcome-journal.ts:4`). VS Code record snapshot: `ptah.laneOutcomes.records.v1` (`store/key-value-lane-outcome.store.ts:13`).

## Checks

- ESLint seven changed source/spec files: exit 0; 0 errors, 4 pre-existing warnings (three unused `SetupRpcHandlers` imports, CLI container `max-lines` 701/700). CLI container remains at its pre-batch counted-line size, 701.
- Prettier `--write` then `--check`: exit 0; `All matched files use Prettier code style!`.
- Degradation audit: exit 0; `TOTAL 296 unsuppressed site(s)`, no `FAIL` line.
- DI lint: exit 0; `di-lint OK: 1846 @inject sites all resolve to a registered token (818 tokens)`.
- `ptah_get_diagnostics` after edits: TypeScript compiler unavailable; three scoped attempts each timed out at 45 seconds with unchecked coverage. No Nx, Jest, build, or test run, per decision #53.
- After lifecycle edits, ESLint on six lifecycle files/specs: exit 0, 0 errors, 2 pre-existing `no-useless-assignment` warnings in VS Code `main.ts`. Prettier `--write` and `--check` passed. Degradation audit remained `TOTAL 296`, no `FAIL`; DI lint remained OK at 1846 sites/818 tokens. A further scoped diagnostics attempt timed out at 45 seconds with 3 files unchecked.

## Decisions

1. **Start timing** — Options: start adjacent to outcomes registration, or after SQLite/Thoth registration. Chose later start for Electron/CLI because `registerLaneOutcomeServices` uses an instance-caching store factory selected by `PERSISTENCE_TOKENS.SQLITE_CONNECTION`; early resolution would permanently choose KeyValue. Evidence: `libs/backend/lane-outcomes/src/lib/di/register.ts:33-46`, Electron phase 2 `:405`, CLI `container.ts:767-768`. Reversible: yes.
2. **CLI file size** — Options: grow the 701-line root, or move outcomes wiring to a helper. Chose `lane-outcomes-wiring.ts` and consolidated existing imports to leave the root at 701 counted lines. Evidence: ESLint output. Reversible: yes.
3. **Shutdown integration, orchestrator decision #97** — Options: defer lifecycle integration or edit the three named hooks. Authorization chose the hooks. VS Code resolves the registered `useValue` disposer before DI clear; Electron uses the deferred quit path and drains before SQLite close; CLI uses its existing best-effort stderr shutdown logging. Evidence: host phase-2 registrations and shutdown sequences above. Reversible: yes.

## Clarifications Needed

None.

## Not done

No Nx, Jest, or build run, as required by decision #53. Compiler diagnostics remained unavailable after scoped calls.
