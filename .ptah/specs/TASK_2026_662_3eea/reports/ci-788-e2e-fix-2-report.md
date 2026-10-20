## Root cause

The Electron test assumed that one click after the Enhancement summary appeared would leave the editor open. That check did not establish a stable interaction state: `ui.goto('settings')` starts an asynchronous workspace change and returns when the Settings host attaches (`apps/ptah-electron-e2e/src/support/ui-driver.ts:361-399, 401-429, 560-562`). The Orchestration tab then starts its settings refresh without awaiting it (`libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:328-330`). A workspace change can invalidate an in-flight section read (`libs/frontend/core/src/lib/services/providers-settings-sections.ts:91-103`). The failing test checked the row summary at `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts:86-89`, but did not check whether its click actually opened the editor before moving on.

The summary is rendered only in the loaded-row branch (`libs/frontend/chat/src/lib/settings/providers/provider-consumer-assignments.component.ts:150-179, 189-215`), and `loaded` comes from non-null Enhancement data (`libs/frontend/chat/src/lib/settings/providers/provider-consumer-rows.ts:202, 244-256`). The test's three `settings:get` values match the Enhancement read contract (`libs/frontend/core/src/lib/services/providers-settings-state.service.ts:660-678`), so a missing Enhancement mock is not the cause. `toggleEdit` can refuse a click while data is unavailable or a save is busy, and the trigger exposes its state through `aria-disabled` and `aria-expanded` (`provider-consumer-assignments.component.ts:193-200, 686-697`). No save is initiated by this test. The observed missed click is consistent with the asynchronous workspace/refresh transition; the CI run must confirm that timing inference.

## Fix

- `apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts`: Retry the Enhancement click only while the trigger reports `aria-expanded=false`, wait until it is not `aria-disabled`, and require the editor to become visible. This preserves an already opened popover and fails if the editor never opens.
- `.ptah/specs/TASK_2026_662_3eea/reports/ci-788-e2e-fix-2-report.md`: Record the evidence, checks, and CI risk.

## Checks

- `git diff --check -- apps/ptah-electron-e2e/src/specs/thoth/skills.spec.ts` — passed.
- `NX_NO_CLOUD=true npx nx run-many -t typecheck lint -p ptah-electron-e2e --parallel=1 2>&1 | tail -n 30` — the Nx pipeline did not run because PowerShell has no `tail` command.
- PowerShell equivalent: `$env:NX_NO_CLOUD='true'; npx nx run-many -t typecheck lint -p ptah-electron-e2e --parallel=1 2>&1 | Select-Object -Last 30` — `NX Successfully ran targets typecheck, lint for project ptah-electron-e2e`.
- No Playwright test was run locally, as required.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Change only the Electron test | Expand mocks, change product code, or retry against the trigger/editor state | Enhancement read values are mocked and the summary proves the row is loaded; the test had no post-click state check, while workspace sync and settings refresh are asynchronous | Yes; remove the small retry block if CI shows a different cause |
| Keep the retry conditional | Blind second click or check `aria-expanded` first | `toggleEdit` closes an already open editor (`provider-consumer-assignments.component.ts:686-690`) | Yes |

## Risks

CI must confirm the Electron Playwright test opens the Enhancement editor and that the picker retains `moonshot` and `kimi-k2`. If it still fails, the trace should show the trigger's `aria-expanded` and `aria-disabled` values around the click to distinguish an ongoing page transition from a product popover defect.
