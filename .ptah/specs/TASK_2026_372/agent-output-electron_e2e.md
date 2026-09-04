# Electron E2E Settings Spec Migration — TASK_2026_372

## Headline

Fixed Finding 3 in `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts`: migrated the web search settings tests from the legacy single-provider `<select>` control and `{ provider: string }` RPC contract to the multi-provider checkbox UI and `{ providers: string[] }` RPC contract. Added a test case verifying multiple providers can be selected simultaneously. Both lint, typecheck, and live Playwright Electron test execution passed cleanly.

## Exact Test IDs Used

Read directly from `libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts` (line 114: `'settings-toggle-web-search-provider-' + opt.value`):

- `settings-toggle-web-search-provider-tavily`
- `settings-toggle-web-search-provider-serper`
- `settings-toggle-web-search-provider-exa`

## Changes Made

Only modified `apps/ptah-electron-e2e/src/specs/settings/settings.spec.ts`:

1. **`webSearch:getConfig` Mock**:
   - Replaced `{ provider: 'tavily', maxResults: 5 }` with `{ providers: ['tavily'], maxResults: 5 }`.
2. **Checkbox Locators & Assertions**:
   - Replaced locator for removed `[data-testid="settings-toggle-web-search-provider"]` select.
   - Added locators for `tavilyCheckbox` (`settings-toggle-web-search-provider-tavily`) and `serperCheckbox` (`settings-toggle-web-search-provider-serper`).
   - Asserted `tavilyCheckbox` is visible and checked, and `serperCheckbox` is visible and not checked.
3. **Driving Checkboxes & `webSearch:setConfig` RPC Assertion**:
   - Replaced `select.selectOption('serper')` with `await serperCheckbox.check()`.
   - Updated `observed.params` expectation from `params.provider === 'serper'` to `params.providers` equal to `['tavily', 'serper']`.
   - Updated subsequent `ui.mockRpc` for `webSearch:getConfig` to `{ providers: ['tavily', 'serper'], maxResults: 5 }`.
   - Verified that both `serperCheckbox` and `tavilyCheckbox` are checked.
4. **Added Multi-Provider Test Case**:
   - Added `test('two providers can be selected at once', ...)` verifying that when `webSearch:getConfig` supplies `providers: ['tavily', 'serper']`, both `tavilyCheckbox` and `serperCheckbox` render checked while `exaCheckbox` renders unchecked.

## Verification

1. **Lint**:
   - Command: `npx nx run-many -t lint -p ptah-electron-e2e`
   - Result: PASS (0 errors, 11 pre-existing warnings in untouched files).
2. **Typecheck**:
   - Command: `npx nx run-many -t typecheck -p ptah-electron-e2e`
   - Result: PASS (0 errors).
3. **Playwright Electron E2E**:
   - Command: `npx playwright test src/specs/settings/settings.spec.ts --config=playwright.config.ts` (executed from `apps/ptah-electron-e2e`)
   - Result: PASS (3/3 tests passed in 32.3s):
     - `Settings › settings renders` (11.6s)
     - `Settings › toggle persists (round-trip)` (10.2s)
     - `Settings › two providers can be selected at once` (9.5s)
