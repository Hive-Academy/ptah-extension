# Batch 20 report: Task 20.1 (B12 routes, `plugins:replace-kept-items`, `plugins:resolve-config-home`)

**Verdict**: COMPLETE. Scoped verify passed: 71 of 71 tasks.

## What was already done (previous subagent, uncommitted, kept as-is)

The previous subagent implemented the whole task and was stopped while verifying. I audited
every requirement against source (evidence below) and found one gap in the tests.

## What I finished

- Added the missing **failed removal** case from plan :863 (8.10). If `uninstall()` throws,
  the RPC fails, and none of these run: the MCP uninstall, the config write, the reconcile,
  the replace step.
  - File: `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.spec.ts`, inside
    `plugins:install-external confirm`, after the 8.10a case at ~:1950.
- No production source changed in this session.

## Quality requirements → evidence

All paths are under `libs/backend/rpc-handlers/src/lib/handlers/` unless stated.

| Requirement | Evidence |
| --- | --- |
| Every plugin-config call uses `harnessRoot` (8.1) | `plugin-rpc.handlers.ts:1295-1302` `harnessRoot()` = `resolveHarnessWorkspaceRoot(getWorkspaceRoot())`; `configRoot()` :1321-1326. Uses: get-config :320-327, save-config :380-381, install :720-725 → `activateExternalPlugin` :1025, uninstall `deactivateExternalPlugin` :1073-1074, consent plan :900. skills.sh `propagate` and kept report: `skills-sh-rpc.handlers.ts` `getHarnessRoot()` (end of file), `propagate()` ~:474 |
| `get-config` returns `configHome` only when non-null | `plugin-rpc.handlers.ts:327` and the return just after it (`configHome === null ? config : {...config, configHome}`) |
| `resolve-config-home` accepts `folder` only from current candidates, else `RpcUserError`; the client value is never used as a path | `plugin-rpc.handlers.ts:1196-1212` (Zod `safeParse` → `RpcUserError`; candidate lookup → `RpcUserError('That folder has no saved plugin settings for this repository.')`); only `candidate.folder` is passed on (:1217-1219, :1233-1235) |
| adopt → reconcile + background refresh | `plugin-rpc.handlers.ts:1216-1231` |
| save-config → background refresh (A13) | `plugin-rpc.handlers.ts:486` (`refreshUserLayerInBackground(harnessRoot, 'plugins:save-config')`) |
| A primary failure returns failure, with no replace step and no kept report (8.10) | install: a `confirmInstall` throw propagates through `guard` before `applyPlanDecisions` (:690-731). save-config: the catch returns `{success:false, error}` (no `kept`). uninstall: a throw happens before the MCP/config/reconcile steps (:815). skills.sh: a failed install returns before `propagate` (spec "does not propagate when the install itself failed") |
| A refresh failure after a successful action → `libraryPass: 'failed'` (8.10a) | `plugin-rpc.handlers.ts:1338-1369` (`reconcileHarness`); save-config result; install result `libraryPass: activation.libraryPass` (:754); `skills-sh-rpc.handlers.ts` `propagate()` mapping |
| `buildConsentResponse` builds `localItems` from the scanner, edited clones and agent-source shadows | `plugin-rpc.handlers.ts:880-930` → `MarketplaceLocalItemsService.planLocalItems` (`marketplace/marketplace-local-items.service.ts`: `scan` for files, the clone pass by `sourceRef`, `agent-source` for `.claude/agents/<slug>.md`) |
| Confirm applies decisions through `InstallLocalItemsService` | `plugin-rpc.handlers.ts:727-731` → `applyPlanDecisions` :937-983 → `installLocalItems.apply` :996 |
| A-plan: `attachLocalItems` / `takePlan` | `plugin-rpc.handlers.ts:915`; `plugin-marketplace/src/lib/install/external-plugin-installer.service.ts` (`attachLocalItems`, `planItemSlugs`, `ConfirmedExternalInstall.planLocalItems` returned from `confirmInstall`); spec block "local items ride beside the token (TASK_2026_701 A-plan)" in `external-plugin-installer.service.spec.ts:302-360` |
| `replace-kept-items` is family-bound and rejects cross-family ids | `plugin-rpc.handlers.ts:119-123` (`KEPT_REPORT_FAMILIES`, which excludes `external`); :1126-1146 (`peek` per family and harness root → `RpcUserError`); :1151-1156 (apply per family) |
| Registration | `METHODS` :191-192; `register-shared-rpc-handlers.ts` registers `MarketplaceLocalItemsService` (`LocalItemApprovals`, `InstallLocalItemsService` and `CloneRebaseService` were already registered by commit 65499f2c1); `libs/shared/src/lib/types/rpc.types.ts` registry entries and `RPC_METHOD_ENTRIES` |
| A-cli-plugins | The CLI registers both methods: `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`, test "serves the plugin kept-item and config-home methods (TASK_2026_701 B12)" (asserts registered and not excluded) |
| Allowlist and surface guards | `rpc-allowlist.spec.ts` B12 describe block; explicit new-method assertions in `apps/ptah-electron/src/di/rpc-surface.spec.ts` and `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` |
| Repo standards | No `any` and no `as unknown as` in the changed source. Zod at the boundary (`plugin-rpc.schema.ts`: `ReplaceKeptItemsParamsSchema`, `ResolveConfigHomeParamsSchema`). Logging goes through the injected `Logger`. Every new catch has a `degradation-audit` or logged justification (the degradation-audit check passed under lint). Imports come from public aliases plus intra-lib relative paths |

### Per-family spec cases (plan :853-889)

- **external**
  - consent plan: items listed, registered with the consent TTL, attached (`plugin-rpc.handlers.spec.ts:1743`); omitted when none (:1778); discovery failure (:1792).
  - confirm: applies only ids this plan issued, after the install (:1822); all keep (:1902); failed write gives no replace step (:1931); refresh failure gives `libraryPass` failed (:1950); **failed removal (new)**; malformed id (:1972).
- **plugin enable / plugin-agent**
  - background refresh (:1625); kept report for newly enabled plugins only (:1636); a plugin taken off the denylist (:1690).
  - failed config save (:1711); failed reconcile gives `libraryPass` failed (:1729).
- **skills.sh**
  - kept report at the harness root (`skills-sh-rpc.handlers.spec.ts:406`); kept items plus `libraryPass` (:420); refresh failed (:437); report failure (:452).
- **Sub-folder workspace (8.1)**
  - enable and disable write the harness-root home and reconcile it (`plugin-rpc.handlers.spec.ts:1560`).
  - install writes the harness-root home and plans local items there (:1584).
  - get-config uses the harness root, with a fallback (:1500-1532).
- **Config home (D14)**
  - adopt (:2171); dismiss (:2203); unknown folder, outside path, or traversal → `INVALID_PARAMS` with nothing written (:2224-2242).
  - no status (:2244); adopt persistence failure runs no reconcile (:2257); unknown action (:2275).
- **replace-kept-items**
  - own-family routing (:2005); cross-family id rejected with nothing written (:2056); unknown id or another repository (:2076); all keep (:2098); lapsed id (:2116); malformed request (:2143); no folder open (:2155).
- **Route-level matrix**
  - Lives in `marketplace/install-local-items.service.spec.ts` (from 65499f2c1). Cases:
    - unowned and owned-edited kept;
    - repair with the digest;
    - rebase only after success;
    - agent-source writer;
    - edited A then B, deleted then recreated, unreadable, edited while in flight → kept.
  - And in `marketplace/marketplace-local-items.service.spec.ts`: scanner states, clone `sourceRef` match, kept report per target.

## Container smoke specs (outside the batch file list)

- `apps/ptah-cli/src/di/container.smoke.spec.ts`, `apps/ptah-electron/src/di/container.smoke.spec.ts` and `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts` are kept, for two reasons:
  - `PluginRpcHandlers` and `SkillsShRpcHandlers` now inject `MarketplaceLocalItemsService`. Its dependencies (`DESTINATION_SCANNER`, `BLOCKED_REPAIR`, `AGENT_FILE_WRITER_SERVICE`, `FILE_SYSTEM_PROVIDER`) must be stubbed in the minimal smoke containers, or the existing plugin-handler resolution assertions fail.
  - Plan B12 (implementation-plan.md, "MODIFY ... container.smoke.spec.ts (per A-smoke)") lists these files explicitly.

## Verification

- Command (run once, in the background):
  `npm run verify -- -p @ptah-extension/shared,@ptah-extension/plugin-marketplace,@ptah-extension/rpc-handlers,@ptah-extension/cli-engine,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui`
- Result: `NX   71 tasks: 71 succeeded, 55 cached`, exit code 0, run duration 5m 45s (lock released after 349.5 s).
- The run took its lock slot at 18:51:02Z, after the spec edit, so the rpc-handlers test run includes the new case.
- The dynamic output style prints no "Running target ... for N projects" header. The task total covers lint, test and typecheck for the 8 requested projects plus dependency typechecks.
- No accepted pre-existing failure appeared in this scope.
- No frontend project was added: the `libs/shared` change is additive registry entries, and the shared typecheck passed.

## Plan deviations

- **New service**: `marketplace/marketplace-local-items.service.ts` (+ spec). The plan puts local-item discovery inside the handlers. The previous subagent extracted it so that `plugin-rpc.handlers.ts` and `skills-sh-rpc.handlers.ts` share one scanner/clone/agent-source discovery and kept-report path. It is registered in `register-shared-rpc-handlers.ts`. I kept it, because a single shared implementation for two real consumers fits the repository's size rules.
- **Formatting churn**: `rpc.types.ts` and `cli-engine/.../rpc-surface.spec.ts` contain a few prettier-only line reflows next to the registry additions. These are formatting, not behaviour; lint-staged would produce the same result on commit.

## Final changed files (Batch 20)

- M `apps/ptah-cli/src/di/container.smoke.spec.ts`
- M `apps/ptah-electron/src/di/container.smoke.spec.ts`
- M `apps/ptah-electron/src/di/rpc-surface.spec.ts`
- M `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts`
- M `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts`
- M `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts`
- M `libs/backend/plugin-marketplace/src/index.ts`
- M `libs/backend/plugin-marketplace/src/lib/install/external-plugin-installer.service.ts` (+ `.spec.ts`)
- M `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts` (+ `.spec.ts`)
- M `libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.schema.ts`
- M `libs/backend/rpc-handlers/src/lib/handlers/skills-sh-rpc.handlers.ts` (+ `.spec.ts`)
- M `libs/backend/rpc-handlers/src/lib/register-shared-rpc-handlers.ts`
- M `libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts`
- M `libs/shared/src/lib/types/rpc.types.ts`
- A `libs/backend/rpc-handlers/src/lib/handlers/marketplace/marketplace-local-items.service.ts` (+ `.spec.ts`)
- Not part of this batch, do not commit with it: `T/HANDOFF.md` (orchestrator-owned) and `T/reviews/*.patch`.
