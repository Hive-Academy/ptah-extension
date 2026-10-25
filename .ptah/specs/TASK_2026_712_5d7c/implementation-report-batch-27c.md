# Backend implementation — `TASK_2026_712_5d7c`, batch 27c

**Tasks completed**: Turned on the provider account RPC in Electron, and updated the VS Code and CLI/TUI host guards (D29, D30).

## Files (6, all MODIFIED)

- `apps/ptah-electron/src/rpc-host-profile.ts` — adds `providerAccounts: true` after `lanePlanLimits: true`, with a comment.
- `apps/ptah-extension-vscode/src/di/expected-absent.ts` — imports `ProviderAccountRpcHandlers` and adds it to `EXPECTED_ABSENT_HANDLERS`. Adds `'providerAccounts'` to `EXPECTED_ABSENT_CAPABILITIES`. This follows the `lanePlanLimits` pattern. `container.smoke.spec.ts:491-503` iterates these lists automatically.
- `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` — adds the 10 `provider:*Account*` names to `EXPECTED_ABSENT_METHOD_NAMES`. They go between `memory:unpin` and `skillSynthesis:*` in `.sort()` order, because `deriveRpcSurface` sorts `excluded` (`register-rpc-surface.ts:68-69`).
- `libs/backend/cli-engine/src/lib/rpc/expected-absent.ts` — adds `'providerAccounts'` to the headless `EXPECTED_ABSENT_CAPABILITIES`, which covers both CLI and TUI.
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` — adds the same 10 names, sorted between `file:viewContent` and `update:check-now`.
- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts` — new `describe('provider account RPC manifest')` with three tests:
  - the `providerAccounts` entry has `requires: ['providerAccounts']`, its handler is `ProviderAccountRpcHandlers`, and its methods equal `PROVIDER_ACCOUNT_RPC_METHOD_NAMES`;
  - every account method is in `RPC_METHOD_NAMES`;
  - with the capability off, all 10 are excluded and none are registered; with it on, all are registered and none are excluded.

  The spec does not use `process.cwd()` or `jest.spyOn`.

Skipped: `libs/backend/rpc-handlers/src/lib/host-profile/resolve-handler-plan.spec.ts` was not changed. It tests generic plan behaviour against `host.fileOpen` and lists no entries or capabilities, so it still passes unchanged. The Electron-on / others-off check is now in `manifest.spec.ts` through `deriveRpcSurface`. I used its file slot for the CLI `rpc-surface.spec.ts` (see D-27c-1).

## Decisions

- **D-27c-1: Edit the CLI method list instead of `resolve-handler-plan.spec.ts`.**
  - Options: (a) edit only the CLI capability list and report the method list; (b) edit both CLI files and skip the resolve-plan spec, which needs no change.
  - Evidence: `cli-engine/src/lib/rpc/rpc-surface.spec.ts:80-82` asserts `surface.excluded` exactly. It filters by manifest methods (`:55-60`). 27b's manifest entry (`manifest.ts:516-519`) is already in the tree, so the CLI and TUI hosts would exclude 10 new methods and that test would fail. `resolve-handler-plan.spec.ts` does not depend on the new entry.
  - Chose (b). This stays within the 6-file cap and keeps CI green. Reversible.
- **D-27c-2: The headless hosts keep `providerAccounts` off.**
  - D30 says "true in Electron only". The capability list's own header says a renderer-less host turns a capability on only once a headless implementation exists.
  - Reversible: remove the entry from both CLI files.
- **D-27c-3: VS Code lists the class, the capability and the methods as absent.**
  - This is the `lanePlanLimits` precedent (TASK_2026_623 batch-12-report). Electron is first (CLAUDE.md).
- Named admission stays release-held (D7). No sign-in, credential or probe was touched.

## Remaining guard edits not done

- `apps/ptah-electron/src/di/rpc-surface.spec.ts:38-58`: **no edit needed.** It asserts `excluded` is empty and that `registered` equals the manifest methods. Both hold once `providerAccounts: true` is set.
- `apps/ptah-electron/src/di/surface-composition.spec.ts`: **no edit needed.** It only looks up the `'surface'` step (`:101`).
- `apps/ptah-electron/src/di/container.smoke.spec.ts`: **no required edit.** It does not iterate the plan.
  - Recommended follow-up, not done: a resolve test for `ProviderAccountRpcHandlers` next to the `LanePlanLimitsRpcHandlers` A2 test at `:999-1026`. It would register `ProviderAccountService`, `PLATFORM_TOKENS.WORKSPACE_PROVIDER` and `TOKENS.WEBVIEW_MANAGER`, then assert `registered` equals `[...ProviderAccountRpcHandlers.METHODS]`.
  - This would prove that the Electron DI graph can construct the class. Today only the 27a handler spec does that, with a fake service.
- `apps/ptah-electron/src/di/expected-resolvable.ts` and `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`: no change, because no new token was added (27a report).
- `apps/ptah-tui`: no separate expected-absent list exists. The TUI shares `cli-engine/src/lib/rpc/expected-absent.ts` (edited above).
- `libs/shared/src/lib/types/rpc/rpc-provider-accounts.spec.ts`: I did not re-check it against 27b's registry merge (27a flagged it). It is outside my ownership.

## Existing specs that mock changed members

None. No class member, token or signature changed. The guard specs read the edited constants directly:

- `apps/ptah-extension-vscode/src/di/container.smoke.spec.ts:80-81,491-503`
- `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts:140-148`

## Stack observed

- Capabilities are tsyringe/manifest gated (`host-profile/manifest.ts:98-109`, `host-profile.ts:67,95`).
- `capabilities()` sets every capability it is not given to false.
- `HostCapabilities` is exported from `./capabilities`, not from `host-profile.ts`. The spec imports it from there.

## Verification

- `ptah_get_diagnostics` on the 6 files returned "unavailable": the TypeScript check was still running after 45 s, so 0 files were checked. There is no evidence either way.
- 27b's symbols (`providerAccounts` capability, manifest entry, `ProviderAccountRpcHandlers` barrel export at `rpc-handlers/src/index.ts:72`) are present in the tree, so I expect no unresolved-symbol errors.
- As the batch rules required, I did not run nx, jest, tsc or lint. Suggested checks, one at a time:
  - `npx nx typecheck rpc-handlers --parallel=1`
  - `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/host-profile/manifest.spec.ts --coverage=false --maxWorkers=2`
  - `npx nx test cli-engine --parallel=1` (or Jest on `cli-engine/src/lib/rpc/rpc-surface.spec.ts`)
  - VS Code: Jest on `apps/ptah-extension-vscode/src/di/rpc-surface.spec.ts` and `container.smoke.spec.ts`
  - Electron: Jest on `apps/ptah-electron/src/di/rpc-surface.spec.ts`

## Plan deviations

- I used the CLI `rpc-surface.spec.ts` instead of `resolve-handler-plan.spec.ts` (D-27c-1). The total stays at 6 files.

## Out-of-scope observations

- The Electron smoke resolve test recommended above.
