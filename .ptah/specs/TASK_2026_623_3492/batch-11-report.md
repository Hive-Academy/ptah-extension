## Backend implementation — `TASK_2026_623_3492`, batch 11

**Tasks completed**: 11.1 (root export and Electron capability flag), 11.2 (Electron container resolution test)

**Files**:

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\backend\rpc-handlers\src\index.ts — `LanePlanLimitsRpcHandlers` added to the root re-export block from `./lib/handlers` (already exported there at `lib/handlers/index.ts:12`).
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-electron\src\rpc-host-profile.ts — `lanePlanLimits: true` after `goVetDiagnostics: true`, with a two-line comment in the same style.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\apps\ptah-electron\src\di\container.smoke.spec.ts — imports `LanePlanLimitsRpcHandlers` from `@ptah-extension/rpc-handlers`. Moves the existing phase-3 composition (`registerVsCodeLmToolsServices` plus stub list) out of the PostToolUse test and into a `composePhase3(c, logger)` helper inside the same describe. The existing test now calls the helper and behaves the same. Adds one test (A2): `c.resolve(LanePlanLimitsRpcHandlers)` succeeds, its `apiBuilder` is the `TOKENS.PTAH_API_BUILDER` singleton, and `register()` calls `registerMethod` for exactly `['agent:getLanePlanLimits']` (equal to `METHODS`).

**Stack observed**: tsyringe DI (`@injectable`/`@inject` in `lane-plan-limits-rpc.handlers.ts:48-66`). Lib-owned handlers are resolved by `registerRpcSurface` through the manifest entry (`manifest.ts:472-477`, `requires: ['lanePlanLimits']`), so `phase-4-handlers.ts` gets no `registerSingleton`. The capability defaults to false through `ALL_DISABLED` (`host-profile.ts:85`, decision #41). Jest with ts-jest (`apps/ptah-electron/jest.config.ts`).

**Verification**:

- `npx jest -c apps/ptah-electron/jest.config.ts apps/ptah-electron/src/di/container.smoke.spec.ts apps/ptah-electron/src/di/rpc-surface.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper=<override>`: 2 suites passed, 23 tests passed.
  - Without the override, both suites failed with "Could not locate module marked". The worktree has no `node_modules`.
  - The override was passed on the command line only and no config file was edited. It sets `^marked$` to `D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js` and keeps the project's `^vscode$`, `^electron$` and `wasm-bundle-dir` mappers.
  - In the `wasm-bundle-dir` regex, `\.` was written as `[.]`, which matches the same thing, because shell JSON escaping rejected the backslash.
- `npx nx typecheck ptah-electron --parallel=1`: success. The declarative-dashboard failure did not appear for this target.
- `npx nx lint @ptah-extension/rpc-handlers --parallel=1`: 0 errors, 50 warnings. This is the same as the Batch 9 baseline of 50.

**Risks handled**:

- A2 (`TOKENS.PTAH_API_BUILDER` registered before `registerRpcSurface` in Electron): the new test resolves the handler against the phase-2 plus phase-3 composition, in production order, and asserts that the injected builder is the bound singleton. The existing source-order test already pins `registerVsCodeLmToolsServices` in `phase-3-storage.ts` after phase 2.
- Electron only (A5): `lanePlanLimits` appears only in `apps/ptah-electron/src/rpc-host-profile.ts` under `apps/`. There are no matches in `libs/backend/cli-engine`. VS Code and CLI fall back to false through `ALL_DISABLED`. Their expected-absent lists are Batch 12's job.
- No `registerSingleton` in `phase-4-handlers.ts`: that file was not touched.
- Cross-project red window (L3 gated entry before profiles list it): the Electron `rpc-surface.spec.ts` passes with the flag on. The VS Code and CLI specs stay red until Batch 12, as the plan's risk table expects.
- Decision #42 (plain `Error` on an unavailable lookup): unchanged. In Electron the builder is always bound, which the new test proves at the DI level.
- Privacy and side effects: resolving and registering do not call `build()`, `list()` or `limits()`. The handler builds lazily on the first read (A1).

**Plan deviations**: Task 11.2 adds a `composePhase3` helper so the PostToolUse test and the new test share the phase-3 stub list instead of copying it. It is a behaviour-preserving change limited to the assigned spec file. Otherwise none.

**Out-of-scope observations**: `nx typecheck ptah-electron` uses `tsconfig.app.json`, so the spec file is type-checked only by ts-jest during the Jest run, which passed.
