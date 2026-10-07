# Manage in Providers replacement report

## Buttons found

| Original location                                                                                              | Result                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.ts:143` | Replaced with the curator model in `ptah-surface-card` and a small `Change` link. The link retains the existing targeted Providers route.                                                       |
| `libs/frontend/setup-wizard/src/lib/components/welcome.component.ts:153`                                       | Replaced with inline connected-provider and model selects. Provider selection uses `ProvidersSettingsStateService.activateConnection`; model selection retains `ModelStateService.switchModel`. |
| `libs/frontend/skill-synthesis-ui/src/lib/components/skill-settings-panel.component.ts:154,215`                | Removed the navigation-only judging and lane buttons and their navigation method.                                                                                                               |

Excluded, untouched: no matching button was found in `libs/frontend/dashboard/src/lib/components/provider-account-card/**` or `libs/frontend/chat-ui/src/lib/molecules/session/plan-limits/**`.

## Files changed

- `D:\projects\ptah-extension\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.ts`
- `D:\projects\ptah-extension\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.spec.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.spec.ts`
- `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\components\skill-settings-panel.component.ts`
- `D:\projects\ptah-extension\libs\frontend\skill-synthesis-ui\src\lib\components\skill-settings-panel.component.spec.ts`
- `D:\projects\ptah-extension\libs\frontend\webview-e2e-harness\src\lib\scenarios\thoth\skills-lane-pickers.e2e.spec.ts`

## Checks

- Setup Wizard focused Jest: passed (2 tests).
- Memory Curator focused Jest: passed (21 tests).
- Skills Settings focused Jest: passed (25 tests).
- `npx nx typecheck setup-wizard --parallel=1`: passed; one pre-existing warning in `peer-session-send-dialog.component.ts`.
- Scoped diagnostics: no diagnostics in changed files; sibling pre-existing diagnostics remain.

## Decisions

- The wizard lists configured connections only; it uses existing provider activation then refreshes the existing model catalogue.
- Model changes retain `config:model-switch` through `ModelStateService.switchModel`; provider changes retain the existing provider-settings activation flow. No persisted keys were introduced.

## Proposed Removals

- Removed the redundant Skills-background navigation buttons and their `AppStateManager` dependency.

## Change link follow-up

- Route used: `requestSettingsTab({ tab: 'orchestration', section: 'background-models' })`, followed by the existing Settings view switch. The Settings container maps this to the Orchestration tab; its existing focus handler opens the Background Model Roles `<details>` section and focuses it.
- Files changed: `D:\projects\ptah-extension\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.ts`; `D:\projects\ptah-extension\libs\frontend\memory-curator-ui\src\lib\components\diagnostics\memory-diagnostics-accordion.component.spec.ts`; this report.
- Check: `npx jest -c libs/frontend/memory-curator-ui/jest.config.ts libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.spec.ts --coverage=false --maxWorkers=2` (passed).
