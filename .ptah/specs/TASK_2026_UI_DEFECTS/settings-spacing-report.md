# Settings card spacing and form alignment

## Files changed

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\orchestration-settings.component.ts`
  - Changed the settings stack to a consistent `space-y-4` gap.
  - Moved Background Model Roles onto `ptah-surface-section` with the same subtle tone and medium padding as the budget and guards cards.
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\subagent-cache-ttl-setting.component.ts`
  - Replaced its local border/background/padding surface with `ptah-surface-section` (`tone="subtle"`, `padding="md"`).
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\session-budget-settings.component.ts`
  - Aligned every setting in an equal-row, three-column grid that collapses to one column on narrow widths.
  - Put labels above full-width controls; made toggles match select height; kept number units in non-wrapping input groups; retained readable values and help beneath controls.
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\lane-guards-settings.component.ts`
  - Applied the same equal-row grid and full-width labelled controls, with a non-wrapping `calls` suffix in each input group.
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\session-budget-settings.component.spec.ts`
  - Updated the control layout expectation for full-width joined inputs.
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\settings\ptah-ai\lane-guards-settings.component.spec.ts`
  - Updated the control layout expectation for full-width joined inputs.

Bindings, validation, RPC reads/writes, values, and existing test IDs are unchanged.

## Checks

- `ptah_get_diagnostics` scoped to the six changed source/spec files: no diagnostics in the requested files. The chat project reported pre-existing diagnostics in unrelated sibling files.
- `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.spec.ts libs/frontend/chat/src/lib/settings/ptah-ai/subagent-cache-ttl-setting.component.spec.ts libs/frontend/chat/src/lib/settings/ptah-ai/session-budget-settings.component.spec.ts libs/frontend/chat/src/lib/settings/ptah-ai/lane-guards-settings.component.spec.ts --coverage=false --maxWorkers=2`: 4 suites passed, 76 tests passed.

## Decisions

- Used the existing `ptah-surface-section` primitive with its subtle surface and medium padding for all four targeted cards. `ptah-field` was not used because its projection contract does not accommodate the existing joined suffix controls and their multi-part aria descriptions without changing form behaviour.
- Used `md:grid-cols-3`, which provides the requested three aligned columns while retaining a single-column layout below the medium breakpoint.
- Added the Lane guards `calls` suffix inside each joined input group to keep the unit tied to its numeric value and prevent wrapping.
