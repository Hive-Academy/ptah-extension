# Backend implementation — `TASK_2026_623_3492`, batch 12

**Tasks completed**: Task 12.1 (`lanePlanLimits` in both expected-absent lists, R10.9)

## Files

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\src\di\expected-absent.ts
  - `'lanePlanLimits'` appended to `EXPECTED_ABSENT_CAPABILITIES`, with a comment.
  - `LanePlanLimitsRpcHandlers` imported from `@ptah-extension/rpc-handlers` and appended to `EXPECTED_ABSENT_HANDLERS`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\cli-engine\src\lib\rpc\expected-absent.ts
  - `'lanePlanLimits'` appended to `EXPECTED_ABSENT_CAPABILITIES`. This list is shared by the CLI and TUI hosts.
- MODIFIED (outside the batch file list, see deviations) D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-extension-vscode\src\di\rpc-surface.spec.ts
  - `'agent:getLanePlanLimits'` added at the head of `VSCODE_EXPECTED_ABSENT_METHODS`, in sorted position.
- MODIFIED (outside the batch file list, see deviations) D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\cli-engine\src\lib\rpc\rpc-surface.spec.ts
  - `'agent:getLanePlanLimits'` added at the head of `CLI_EXPECTED_ABSENT_METHODS`, in sorted position.

Neither host profile was touched. `lanePlanLimits` stays at its default of `false` (`libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts:85`). Only `apps/ptah-electron/src/rpc-host-profile.ts:48` enables it.

## Stack observed

- Capability gating is data-driven. The manifest entry `lanePlanLimits` has `requires: ['lanePlanLimits']` (`manifest.ts:473-476`). `deriveRpcSurface(profile)` splits the registry into registered and excluded methods.
- The expected-absent lists are plain `as const` arrays. Their consumers are:
  - `container.smoke.spec.ts:230-242`: per-item checks for "handler never planned" and "capability false".
  - `cli-engine rpc-surface.spec.ts:119-127`: per-item "capability false", run for both cli and tui.

## Plan validation (A5) and risks

- **A5: are the lists asserted exhaustive?** No. Both specs check each item in the list. They do not check that the list is complete. The plan says to add the entry anyway, which this batch does. Each addition now creates a real test case. The VS Code smoke spec went from 38 to 40 tests (one capability case, one handler case).
- **Risk: the "expected red" specs would not turn green from the capability lists alone.** I ran the VS Code specs before any edit and they failed in exactly one place: `VS Code RPC surface › excludes exactly the pre-refactor Electron-only method list` (`+ "agent:getLanePlanLimits"`). The method was already being excluded correctly. The failure came from the frozen `*_EXPECTED_ABSENT_METHODS` baseline inside each `rpc-surface.spec.ts`, which `expected-absent.ts` does not feed. The spec header (lines 12-14 in VS Code, 17-19 in CLI) tells you what to do for a new method: "add it here if this host cannot serve it". I followed that and added it to both baselines. This is the R10.9 assertion that the method is absent on VS Code, CLI and TUI.
- **Risk: TUI diverging from CLI.** The CLI list is shared by both hosts. The parity test "differs from the stdio CLI by exactly file:pick" passes, so the TUI also excludes `agent:getLanePlanLimits`. I did not add it to `CLI_ONLY_ABSENT_CAPABILITIES` because both hosts lack it.
- **Risk: enabling the capability by accident.** Neither host profile was edited. The new tests fail if either host ever turns `lanePlanLimits` on without a decision.
- **Risk: VS Code constructing the handler.** `LanePlanLimitsRpcHandlers` is now in `EXPECTED_ABSENT_HANDLERS`, so the smoke spec checks that `resolveRpcHandlerPlan` never plans it. This follows the `FileViewRpcHandlers` / `FileEditRpcHandlers` precedent in the same file.
- **Known red (decision #21, declarative-dashboard typecheck):** not touched, not run.

## Verification

The plain commands fail in this worktree with `Could not locate module marked` (no `node_modules`). Per the brief, I re-ran them with a command-line `--moduleNameMapper` that repeats each project's own mappers and points `^marked$` at `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js`. No config file was edited. In the `wasm-bundle-dir` pattern I wrote `[.]` instead of `\\.` because the JSON escaping broke on Windows. The regex is equivalent.

- `npx jest -c apps/ptah-extension-vscode/jest.config.ts apps/ptah-extension-vscode/src/di/container.smoke.spec.ts apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{...}'`
  - Before: 1 failed, 37 passed (the baseline diff above).
  - After: **Test Suites: 2 passed, 2 total; Tests: 40 passed, 40 total**.
- `npx jest -c libs/backend/cli-engine/jest.config.cjs libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{...}'`
  - After: **Test Suites: 1 passed, 1 total; Tests: 14 passed, 14 total**.
- `ptah_get_diagnostics`, scoped to both `expected-absent.ts` files: no diagnostics in the requested files. It also listed 9 sibling errors in cli-agent-runtime / tool-output-reducers. These are TS1541/TS1479 ESM-resolution errors, unrelated to this change and outside this batch.
- Not run: nx typecheck and lint (the brief did not list them), and any build, serve or e2e target.

## Plan deviations

- I edited the two `rpc-surface.spec.ts` files, which are not in the Task 12.1 file list. Without this edit the brief's goal (both rpc-surface specs green) cannot be met. The repository's own spec header requires this update for a new host-absent method. Revert both edits if the team-leader wants them handled in a separate batch, but the specs will stay red until that batch lands.
- I also added `LanePlanLimitsRpcHandlers` to `EXPECTED_ABSENT_HANDLERS`. This is an extra guard inside an owned file, following the existing pattern there.

## Out-of-scope observations

- The worktree has no `node_modules`, so every Jest run needs the `marked` mapper override (same as Batch 8).
