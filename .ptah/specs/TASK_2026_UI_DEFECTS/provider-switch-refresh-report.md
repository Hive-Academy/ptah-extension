# Provider switch refresh report

## Root cause

The Providers Settings page used a newer commit pipeline that writes `auth:saveSettings` without updating `AuthStateService`. The composer’s bottom-right label reads `AuthStateService.authMethodLabel`, so its signal retained the startup value (`Claude CLI`) after a successful main-agent provider change.

- Save control: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\providers\main-agent-reassign-popover.component.ts:352`
- Main-agent activation: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\providers-connection-setup.service.ts:270`
- Stale shared source: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\auth-state.service.ts:417`
- Visible composer indicator: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts:415`

## Fix

After a confirmed main-agent activation, `ProvidersConnectionSetupService` now invokes a page-supplied `refreshAuthStatus` hook. `ProvidersSettingsStateService` binds that hook to the shared `AuthStateService.refreshAuthStatus()` (`providers-settings-state.service.ts:985`). The refreshed signals drive the composer label and every other `AuthStateService` consumer immediately, with no window reload and no new persisted key.

The refresh runs only when the commit reports `saved`, so merely connecting a provider or a rejected/unconfirmed activation cannot advertise an unpersisted route.

## Write-path trace

| Write                                                              | Runtime reader                                                                                                                                                          | Persisted key / scope / format                                                                                              | Side effects                                                                                                                               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Main-agent provider popover `activate()` -> `activateConnection()` | `AuthStateService` -> `authMethodLabel`; composer footer consumes it; `MessageDispatchService` consumes `persistedAuthMethod` for provider-specific slash-command rules | `authMethod`: string enum `apiKey`, `claudeCli`, or `thirdParty`; written at selected `global`, `app`, or `workspace` scope | `auth:saveSettings` clears more-specific overrides, resets the SDK adapter, and invalidates the host auth-status cache.                    |
| Third-party selection (for example Codex)                          | Same shared auth store; `authMethodLabel` resolves the configured provider display name from `availableProviders` and `anthropicProviderId`                             | `anthropicProviderId`: provider-id string, written at the same selected scope; native Anthropic modes intentionally omit it | Host auto-maps only unset provider tiers. The new webview refresh rereads `auth:getAuthStatus` into signals after the commit is confirmed. |
| Legacy `llm:setDefaultProvider`                                    | `LlmProviderStateService.defaultProvider` consumers only                                                                                                                | `llm.defaultProvider`: provider-id string                                                                                   | This is separate from the main-agent route (`authMethod`/`anthropicProviderId`) and was not changed.                                       |

## Readers audited

- Composer/provider footer: `chat-input.component.ts:415,480` reads the centralized `authMethodLabel` signal.
- Dispatch route guard: `message-dispatch.service.ts:349` reads `persistedAuthMethod`; it receives the same refresh.
- Settings route/model state rereads through the existing commit refresh hooks. No other webview reader of the main-agent auth route was found.
- Backend: `connection-settings-methods.ts:121-179` persists the scoped values, resets the adapter, and calls `invalidateAuthStatusCache`; there is no additional startup-only provider copy to update.

## Files changed

- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\providers-connection-setup.service.ts`
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\providers-settings-state.service.ts`
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\providers-connection-setup.service.spec.ts`
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\providers-settings-state.service.spec.ts`
- `D:\projects\ptah-extension\.ptah\specs\TASK_2026_UI_DEFECTS\provider-switch-refresh-report.md`

## Checks run

- `npx jest -c libs/frontend/core/jest.config.ts libs/frontend/core/src/lib/services/providers-connection-setup.service.spec.ts libs/frontend/core/src/lib/services/providers-settings-state.service.spec.ts --coverage=false --maxWorkers=2` — passed: 2 suites, 167 tests.
- `npx nx typecheck @ptah-extension/core --parallel=1` — passed. Nx Cloud emitted its existing disabled-organization notice after the successful target.
- Targeted TypeScript diagnostics — no diagnostics in the four changed source/spec files. The diagnostic tool also reported existing errors in unrelated core sibling specs.

## Decisions

- Used the existing shared `AuthStateService` as the single webview source of truth instead of adding a host-to-webview push event: this save originates in the same webview and the targeted post-save RPC refresh updates all known readers without widening the typed message contract.
- Kept the persisted keys and value formats unchanged: main-agent routing remains `authMethod` plus optional `anthropicProviderId`, at the user-selected scope.
- Did not edit excluded paths or introduce a full-window refresh.
