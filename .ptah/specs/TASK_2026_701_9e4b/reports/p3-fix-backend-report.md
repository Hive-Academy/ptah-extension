## Backend implementation — `TASK_2026_701_9e4b`, P3 review fix round (backend)

**Tasks completed**: logic L1 (Blocking), style S1 (Serious, A17), style S2. S3–S5 were not touched (deferred by D42). Nothing under libs/frontend was changed.

**Files** (all paths under `D:\projects\ptah-extension\.claude-worktrees\wizard-library-alignment\`):

- CREATED `libs\backend\rpc-handlers\src\lib\handlers\marketplace\plugin-local-items.service.ts` (298 lines): `@injectable() PluginLocalItemsService` with `planForInstall`, `applyPlanDecisions`, `keptForSave`, the private `applyLocalItems`, and the helpers `emptyApplyReport`, `newlyEnabledPluginIds` and `sourceRefFor`, all moved out of the handler.
- CREATED `libs\backend\rpc-handlers\src\lib\handlers\marketplace\plugin-local-items.service.spec.ts` (224 lines): 10 unit cases covering the kind→reason mapping, apply of plan ids only, a lapsed id becoming `changed-since-approval`, the fallback when apply throws, no root giving no plan, a save that turns nothing on giving no kept report, and the two helpers.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\plugin-rpc.handlers.ts`: the handler now only delegates. It also runs the final pass for L1. 1514 → **1294 lines**.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\marketplace\marketplace-local-items.service.ts`: `keptReasonFor` is now exported (:354) and is the only kind→reason map.
- MODIFIED `libs\backend\rpc-handlers\src\lib\register-shared-rpc-handlers.ts`: `container.registerSingleton(PluginLocalItemsService)` added (:47 import, :105), next to its marketplace siblings.
- MODIFIED `libs\backend\rpc-handlers\src\lib\handlers\plugin-rpc.handlers.spec.ts`: the harness builds the real `PluginLocalItemsService` over the existing mocks and passes it to the handler. Two new L1 cases were added, plus a single-pass assertion.

**How each fix is done**

1. **L1** (`plugin-rpc.handlers.ts:720-741`). After `this.localItems.applyPlanDecisions(...)`, the handler checks `localReport.replaced`. If it is not empty, it awaits `this.reconcileHarness(harnessRoot, 'plugins:install-external')`. That is the same full pass, with no `skipUserLayerRefresh`, that `plugins:replace-kept-items` runs at :1057. The returned `libraryPass` is the final pass's result. `reconcileHarness` never throws: a failed pass gives `libraryPass: 'failed'` and the response stays `status: 'installed'`. With no replacements the handler keeps the single activation pass (`activation.libraryPass`). The method doc comment was updated to match.
   - Spec `plugin-rpc.handlers.spec.ts:1932` checks the order `confirmInstall < pass[0] < apply < pass[1]`, using `invocationCallOrder`. It also checks that the last pass ran with `(HARNESS_ROOT, 'plugins:install-external', {})`. The activation pass is mocked as failed and the final pass as refreshed, so `libraryPass === 'updated'` shows the reported value comes from the final pass.
   - Spec `:1977` makes the final pass reject. The response is `installed` with `replaced` set and `libraryPass: 'failed'`.
   - Spec `:2026`, in the "every decision is keep" case, checks that `propagateWithReport` is called once.
2. **S1**. `planLocalItems`, `applyPlanDecisions`, `applyLocalItems`, `keptForEnabledPlugins`, `emptyApplyReport`, `keptReasonForKind`, `newlyEnabledPluginIds` and `sourceRefFor` were removed from the handler. The handler now calls:
   - `this.localItems.keptForSave({...})` at :487. `keptForSave` computes `newlyEnabledPluginIds` itself.
   - `this.localItems.applyPlanDecisions(...)` at :720.
   - `this.localItems.planForInstall(this.harnessRoot(), plan)` at :883.

   The constructor parameter that used to be `MarketplaceLocalItemsService` is now `@inject(PluginLocalItemsService)`. That follows the class-token pattern the sibling marketplace services use (`@inject(MarketplaceLocalItemsService)`, `@inject(InstallLocalItemsService)`); none of them use a Symbol token. The degradation-audit comments, the log messages and the Sentry `errorSource` were moved unchanged, so behavior is the same. No DI guard spec lists the sibling marketplace services (grep found none in the container.smoke, expected-resolvable, rpc-surface or surface-composition specs), so none were changed.
3. **S2**. The handler's `keptReasonForKind` was deleted. `applyPlanDecisions` now uses the exported `keptReasonFor` from `marketplace-local-items.service.ts`.

**Stack observed**:
- Wiring: tsyringe `@injectable` with an explicit `@inject` on every parameter, registered with `registerSingleton` in `register-shared-rpc-handlers.ts:91-105`, which all hosts share.
- Logging: the injected `Logger` and `SentryService`.
- Validation: Zod at the RPC boundary (`plugin-rpc.schema.ts`), unchanged.
- Sibling specs stub heavy modules with `jest.mock` (`install-local-items.service.spec.ts:14`).

**Verification**:
- First run: `npm run verify -- -p @ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli`, exit 1, `NX 58 tasks: 57 succeeded, 33 cached, 1 failed`.
  - The failed task was `@ptah-extension/rpc-handlers:test`. Only my new suite failed to load: "Must use import to load ES Module … workspace-intelligence/src/ast/wasm-bundle-dir.ts", reached through `install-local-items.service` → agent-generation.
  - Every other suite passed (186 passed, 4921 tests). That includes the full `plugin-rpc.handlers.spec.ts` with the new L1 cases.
  - Lint and typecheck passed for all four projects, and every host test target passed.
- Fix: the new spec now stubs `./install-local-items.service` with `jest.mock`, as the sibling specs do. The real service is never used there because a mock is passed in.
- Re-run, failing project only: `npm run verify -- -t lint,test -p @ptah-extension/rpc-handlers`, exit 0, `NX 2 tasks: 2 succeeded`.
- The accepted ipc-bridge.ts:324 audit flag did not show up in either run.

**Plan deviations**: none. There is no RPC contract change: `ExternalInstallResponse.result.libraryPass` keeps its shape and only now reports the final pass. D34 files were not touched.

**Decisions**:
- I named the new unit `PluginLocalItemsService` as a separate service instead of extending `MarketplaceLocalItemsService`. The other options were extending that class or exporting plain module functions. A separate service keeps `MarketplaceLocalItemsService` to its single job (finding and registering items) and needs collaborators the sibling does not have (installer, Sentry, plugin loader). Reversible.
- `keptForSave` takes the before and after config and computes the newly enabled ids itself, so the handler holds no local-item logic. Reversible.

**Out-of-scope observations / open issues**:
- The reviewer suggested a case showing that a later mirror or catalog read sees the replaced bytes. That needs the real Electron propagation stack. At this level, ordering is proved with the mocked propagation boundary (replace happens before the final awaited pass). An end-to-end byte check would belong in an Electron integration test.
- The replace-kept-items grouping loop (`plugin-rpc.handlers.ts:~1030-1060`) is still in the handler. The review did not list it, so it was not moved.
