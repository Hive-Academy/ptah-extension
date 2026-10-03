# Batch 36c report — Gate V 36 re-check notes (tasks a-j)

Author: the Orchestration owner, an in-process frontend-developer, track A worktree (head 8fb6dfe25). No commit and no
change to batches.md. Paths are under `libs/frontend/`; `CHAT` = `chat/src/lib/settings`.

## Per task

| Task | Change | File:line | Spec |
| --- | --- | --- | --- |
| a | `saveDraft` decides the revert from its own `save()` result. On `'saved'` it returns; on `'refused'`/`'failed'` the picker goes back to the read-back row. The blocked-context refresh runs only after `'failed'`. | `CHAT/providers/provider-consumer-assignments.component.ts:354-362` | `provider-consumer-assignments.component.spec.ts:505` (a throw after an earlier `saved` commit reverts the picker); `:494-503` now also asserts the revert on refusal |
| a | Main-agent popover: `saveModel` returns `SettingsSaveResult \| null`. `applyManual` closes the ID field only on `'saved'`, or when the typed id is already the current model, and never reads `commit()`. | `CHAT/providers/main-agent-reassign-popover.component.ts:374-399` | `main-agent-reassign-popover.component.spec.ts:247` (a throw after an earlier `saved` commit keeps the field open and shows a fixed toast with no host text) |
| b | `saveTimeout` uses the `save()` result (it replaces the inner `saved` flag). A `'refused'` save shows the fixed `TIMEOUT_REFUSED` sentence: "The enhancement time limit was not saved because another change was still saving. The limit shown is the saved one." `'failed'` keeps `TIMEOUT_NOT_SAVED`. | `provider-consumer-assignments.component.ts:25, 405-422` | `provider-consumer-assignments.component.spec.ts:645-660` (refused); failed and throw cases unchanged and green |
| c | The Add toast no longer says "Testing the connection." (`Created {name}. Key stored, not verified.`). If the refreshed list does not contain the new instance, `onCreated` runs no Test and raises a fixed alert toast: "Created {name}. Its connection test did not start. Use Test on its row once it shows." | `CHAT/providers/add-cli-instance-modal.component.ts:321-322`; `CHAT/ptah-ai/cli-orchestration-matrix.component.ts:47, 479-489` | `add-cli-instance-modal.component.spec.ts:170-172, 347`; `cli-orchestration-matrix.component.spec.ts:624` |
| d | `closeCredentials` focuses the row's Credentials trigger. If that trigger is gone (the row moved into the collapsed Uninstalled group), it focuses the group's disclosure button `cli-matrix-uninstalled-toggle`, never `body`. `focusAfterRender` now takes fallback selectors and focuses the first one present. | `cli-orchestration-matrix.component.ts:509-518, 647-656` | `cli-orchestration-matrix.component.spec.ts:481` (collapsed group: Credentials gone, focus on the toggle). The M3 case (`:468`) is still green. |
| e | `partialEditMessage` covers both directions. A rejected rename with a stored key gives "Key stored, not verified. The name was not saved."; an unconfirmed rename gives "Key stored, not verified. Could not confirm whether the name was saved; check it before retrying." Both are fixed sentences with no host text. | `add-cli-instance-modal.component.ts:33-34, 352-365` | `add-cli-instance-modal.component.spec.ts:410-427` (`it.each`: unsaved and unconfirmed; the modal stays open) |
| f | One shared capture helper, `capture()`. It calls `page.mouse.move(0, 0)` and then the screenshot, always with `animations: 'disabled'` (task i). All 16 settings capture sites use it. | `webview-e2e-harness/src/lib/scenarios/settings/settings-visual.e2e.spec.ts:34-43` | The visual spec itself |
| g | Playwright scene: the `judge` deep link twice in a row. Each pass: link → Orchestration with roles open and the Judge popover visible → Esc → focus on the Judge cell. | `settings-orchestration.e2e.spec.ts:344` | Itself (vscode and electron) |
| h | The "More actions" menu group is a column (`flex w-40 flex-col`; items keep `w-full`). The actions line above it is `whitespace-nowrap`, which put Edit and Delete on one line and pushed Delete outside the panel. | `cli-orchestration-matrix.component.ts:294-297` | Jest: `cli-orchestration-matrix.component.spec.ts:509-514` (classes). Playwright: `settings-orchestration.e2e.spec.ts:244`, both hosts at 1024×768. Each item is inside the panel box and the viewport, and Delete sits below Edit. |
| j | Providers model-search scene polls `aria-activedescendant` instead of one read; details below. | `settings-providers.e2e.spec.ts:151-158` | Itself, `--repeat-each=5`: 10 / 10 |
| i | The On box is 18 px with its tick centred; details below. | `cli-orchestration-matrix.component.ts:136` (class `cli-check checkbox checkbox-primary`), `:386-390` (component style); `settings-visual.e2e.spec.ts:34-43, 466-468` | `cli-orchestration-matrix.component.spec.ts:498` (classes: `cli-check`, `checkbox-primary`, no `checkbox-xs`); the fold gates and the 8x crops below |

### Task j: Providers model-search scene read `aria-activedescendant` once

**Cause: the spec, not the component.** I checked the component code:
- `NativeAutocompleteComponent.onKeyDown` handles Home by calling `keyboardNav.setActiveIndex(0)` synchronously.
  - When the suggestion list changes or the panel opens, `configure()` / `reset()` also make row 0 active.
  - So after `fill('k2.7')` + Home, the active row is always option 0, Kimi K2.7 Code.
- The input renders the attribute through the template binding `[attr.aria-activedescendant]="open() ? autocomplete.getActiveDescendantId() : null"`, as `{optionIdPrefix}-{index}`.
  - It reaches the DOM on the next change-detection pass, not synchronously with the key press.
  - Before that pass it is still `null`. This is likely when the panel has just reopened from the `fill` that follows the earlier Esc.
- `settings-providers.e2e.spec.ts:152` read the attribute once right after `keyboard.press('Home')`, so under folder load it got `null`. `:153` then looked for `[id="null"]`.

**Fix** (`settings-providers.e2e.spec.ts:151-158`):
- `expect.poll` re-reads the attribute and the text of the option it names until that text is `Kimi K2.7 Code [Tool: Yes]`. No retry and no skip.
- No other settings spec, and no other harness scenario, reads `aria-activedescendant`. `grep` finds only this site.

**Run:** `-g "popover model search filters the models" --repeat-each=5 --workers=2`: 10 passed (5 × vscode, 5 × electron). The team-leader's 5/6 failure was under full-folder load; I did not run the full folder, as instructed. No ui code changed, so no rebuild, and no capture was rewritten.

### Task i: cause and fix

**Cause.** When settled, daisyUI 4's tick is centred. I checked this with a checked `checkbox checkbox-xs checkbox-primary` injected into the built page, waited 800 ms, then took an element screenshot in both themes.
- The low tick in the evidence was daisyUI's `checkmark` animation (0.2 s; `background-position-y` 5px → -2px → 0) caught mid-flight:
  - The Orchestration tab capture ran without `animations: 'disabled'`.
  - The matrix is a deferred chunk that renders just before that capture, so its checkboxes start the animation then.
  - A computed-style probe showed this directly: at capture time `background-position` was `-1px 1.57px`, with `checkmark:running`; 1 s later it was `-1px 0px`.
- The same race could also capture an empty matrix: one `current-orchestration-vscode-anubis` run did.
- The roundness comes from the theme's own `--rounded-btn`. No app or shared stylesheet overrides `.checkbox`; `styles.css` and `tailwind.config.js` have no checkbox rule.
- So no shared style was at fault, and no other checkbox in the app changed.

**Fix.**
1. Harness: `capture()` always passes `animations: 'disabled'`. Before the Orchestration tab capture, the spec waits for `cli-matrix-toggle-codex` to be visible.
2. Matrix: the On box is `input.cli-check { 1.125rem }` (18 px, the prototype's size) instead of `checkbox-xs` (16 px), with `:checked { background-position: -1px 0 }`.
   - At 18 px, daisyUI's gradients draw the tick 1 px right of centre; the shift centres it.
   - The uncovered strip is the same primary background colour.
   - daisyUI's bounce still runs; it animates only the y position.
   - The colour is the theme primary, unchanged.

**Check at 8x, settled captures.** The box spans 18 rows and the tick about 9 rows, in every capture:

| Capture | Box rows | Tick rows |
| --- | --- | --- |
| vscode, anubis-light | 215-232 | 220-228 |
| vscode, anubis | 215-232 | 220-228 |
| electron, anubis-light | 276-293 | 281-289 |
| electron, anubis | 276-293 | 281-289 |

- That puts the tick 0.5 px below centre vertically and centred horizontally, with a clear gap to the bottom edge.
- I viewed two crops myself: `%TEMP%\zoom-cb-36ci-light.png` (vscode light) and `%TEMP%\zoom-cb-36ci-dark.png` (electron dark).

**Fold, unchanged:**
- Roles summary bottom: 550 px in VS Code and 600 px in Electron (budget 660), in both themes.
- Row heights: codex 41/43, glm-instance-1 95/77 (VS Code/Electron). Over: none.
- Providers fold (B28) unchanged.

**Other checkboxes.** Every other `checkbox-xs` in the app has the same mid-animation look only if it is captured within 0.2 s of rendering. At rest they are centred, so none was changed. None of them is in a settings capture.

### Disclosure for task g

No control on the Orchestration tab raises a role deep link. I checked every caller of `requestSettingsTab` / `openSettingsTab`:
- The only role deep link is the connection drawer's "Follows main agent →" on Providers.
- Settings is a router route, so the Skills panel and the Tribunal links remount it.
- The production build has no test hook that can reach `AppStateManager`.

The scene therefore repeats the deep link through its only real route (Providers drawer, twice). The strict in-tab repeat (same target raised while the tab stays mounted) stays pinned by Jest:
- `settings.component.spec.ts:362-363`
- `orchestration-settings.component.spec.ts:154`

## Verification (final, after task i)

- `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/webview-e2e-harness`: success. `ui` succeeded in the a-h run and was not touched by task i.
- `npx nx run-many -t test -p @ptah-extension/chat -- --maxWorkers=2`: success (chat and ui both succeeded in the a-h run). Matrix suite: 47 / 47.
- `npx nx build ptah-extension-webview`: exit 0.
- Playwright, `--reporter=list --workers=2`, cwd `libs/frontend/webview-e2e-harness`:
  - `settings-orchestration.e2e.spec.ts` + `settings-visual.e2e.spec.ts`: 40 passed. That is 36 orchestration scenes (including the menu-bounds and repeated-`judge` scenes in both hosts) and 4 visual runs with the fold gates.
  - `settings-providers` was not run: no shared style changed.
- Temporary probe specs (`zz-probe-36ci.e2e.spec.ts`) were deleted after use.
- Non-spec file sizes: matrix 662, consumer assignments 432, main-agent popover 441, add modal 365 (all ≤ 700).

## Captures (against HEAD)

No `baseline-*` file changed.

**Kept (40, all `current-orchestration-*`; the On box is now 18 px with a settled, centred tick):**
- `current-orchestration-{electron,vscode}-{anubis,anubis-light}`
- `current-orchestration-modal-{add,tiers}-vscode-{anubis,anubis-light}`
- `current-orchestration-order-popover-{electron,vscode}-{anubis,anubis-light}`
- `current-orchestration-popover-{copilot,cursor,effort,model,permission}-{electron,vscode}-{anubis,anubis-light}`
- `current-orchestration-role-popover-{electron,vscode}-{anubis,anubis-light}`
- `current-orchestration-roles-open-{electron,vscode}-{anubis,anubis-light}`

**Restored with `git restore -- <path>` (17):** each was modified on disk but has 0 pixels above the diff threshold (sum of channel differences > 24) against HEAD, so it has no visible 36c change.
- `current-drawer-claude-cli-credentials-electron-anubis-light`
- `current-drawer-moonshot-{credentials,models}-electron-anubis-light`, `current-drawer-moonshot-electron-anubis-light`
- `current-drawer-sovereigneg-advanced-electron-anubis-light`, `current-drawer-sovereigneg-electron-anubis-light`
- `current-main-agent-model-search-vscode-anubis`, `current-main-agent-popover-vscode-anubis`
- `current-main-agent-save-to-{electron,vscode}-{anubis,anubis-light}`
- `current-provider-catalog-vscode-{anubis,anubis-light}`
- `current-providers-electron-{anubis,anubis-light}`
- `current-scope-popover-vscode-anubis`

**Correction to the a-h run.** Against HEAD, the `current-providers-*` captures show no Retry-hover change: HEAD's captures already have no hover. The hover I saw earlier was in the working-tree images left by the interrupted 36b run. Task f still guards every capture, but this batch kept no `current-providers-*` change.

## Out of scope, not touched

- The visual reviewer's untracked `zz-probe-v36r1.e2e.spec.ts` was present during the a-h run. It is no longer on disk; I did not remove it (my only deletion was my own `zz-probe-36ci.e2e.spec.ts`).
