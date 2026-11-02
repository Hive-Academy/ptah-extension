# Code Logic Review — `TASK_2026_glass_scenes`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Minor issues | 1 |
| Failure modes found | 0 |

The migration and scene data paths are consistent. The score exceeds 7 because the pre-paint and service paths have direct parity tests. It stays below 9 because the new image scenes lack an automated contrast measurement over their actual pixels.

## Five logic questions

### 1. How does this fail silently?

No new silent failure was found. A current `dark` value becomes `dracula` before validation in both boot paths. The service then requests the deferred sheet when necessary (`libs/frontend/core/src/lib/services/theme.service.ts:317`, `libs/frontend/core/src/lib/services/theme.service.ts:327`, `apps/ptah-extension-webview/src/index.html:117`).

An unavailable localStorage hint falls back to authoritative state or the default. This is an existing best-effort path, not a false persistence success (`libs/frontend/core/src/lib/services/theme.service.ts:428`).

### 2. What user action produces unexpected behaviour?

No unexpected action was found. The picker obtains its entries from `DAISYUI_THEMES`, which excludes `dark` and retains `dracula` (`libs/frontend/core/src/lib/services/theme.service.ts:99`, `libs/frontend/core/src/lib/services/theme.service.ts:123`). The six scene entries call `setScene`, and the CSS selectors apply the selected image and tint (`libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:334`, `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:400`, `apps/ptah-extension-webview/src/styles.css:2890`).

### 3. What input data produces a wrong answer?

No wrong migration answer was found. The nested legacy ternary is right-associative. It maps `dark` to `dracula`, other known legacy values to the glass pair, and unknown values to no selection (`apps/ptah-extension-webview/src/index.html:122`). A present but unknown v2 value does not revive a legacy choice in either path (`libs/frontend/core/src/lib/services/theme.service.ts:334`, `apps/ptah-extension-webview/src/index.html:117`).

### 4. What happens when a dependency fails?

A deferred stylesheet error resolves the existing load promise and applies the selected theme with root fallback variables. This behavior predates the change and is equivalent for the retired deferred `dark` theme and deferred `dracula` (`libs/frontend/core/src/lib/services/theme.service.ts:461`, `libs/frontend/core/src/lib/services/theme.service.ts:472`). A failed image decode still leaves the tint over the root base color (`apps/ptah-extension-webview/src/styles.css:2850`).

### 5. What is missing that the requirements never mentioned?

The new image scenes have no automated text-contrast measurement over their actual pixels. The new test checks URLs and numeric tint floors only (`apps/ptah-extension-webview/src/app/glass-scrim.spec.ts:259`). The batch report records a temporary composition preview, not a full application render. This is a Minor coverage gap, not a confirmed contrast failure.

## Failure modes

No task-related failure mode was confirmed. The review covered current and legacy state, current and legacy hints, unknown values, deferred stylesheet loading, scene selection, asset URL resolution, and image decode failure. The remaining uncertainty is real-host rendering and pixel-level contrast for the two new scenes.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

### Minor — Image-scene contrast is not measured by the tests

- File: `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts:259`
- Scenario: A future image or tint change can reduce contrast while all current assertions pass.
- Impact: Bright image regions can reduce text readability without a test failure.
- Fix: Add a rendered worst-pixel contrast check for both scenes in both glass modes. Record equivalent manual measurements if automation is not practical.

## Data flow

1. **Current boot state — OK.** `theme-v2` state takes priority over `ptah-theme-v2`. Both paths convert `dark` to `dracula` and validate the result (`libs/frontend/core/src/lib/services/theme.service.ts:317`, `apps/ptah-extension-webview/src/index.html:117`).
2. **Deferred Dracula — OK.** The pre-paint script inserts the render-blocking sheet. The service also requests the sheet when the document does not already contain it (`apps/ptah-extension-webview/src/index.html:156`, `libs/frontend/core/src/lib/services/theme.service.ts:327`).
3. **Legacy boot state — OK.** The legacy state and hint map `dark` to `dracula`. Other known values retain their prior light or dark migration (`libs/frontend/core/src/lib/services/theme.service.ts:412`, `apps/ptah-extension-webview/src/index.html:122`).
4. **Scene selection — OK.** `SCENES` contains `pyramid` and `temple`. The picker exposes the same names. The root effect applies the selected scene only to the glass pair (`libs/frontend/core/src/lib/services/theme.service.ts:68`, `libs/frontend/core/src/lib/services/theme.service.ts:276`, `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts:334`).
5. **Scene rendering — OK.** Both glass modes define both WebP URLs and separate tint values. Their selectors reuse those values (`apps/ptah-extension-webview/src/styles.css:2864`, `apps/ptah-extension-webview/src/styles.css:2880`, `apps/ptah-extension-webview/src/styles.css:2890`).
6. **Asset delivery — OK by static trace.** Angular copies the public directory beside the emitted stylesheet (`apps/ptah-extension-webview/project.json:21`). Electron copies the renderer recursively and permits local images (`apps/ptah-electron/scripts/copy-renderer.js:234`, `apps/ptah-electron/scripts/copy-renderer.js:163`). VS Code rewrites resource URIs, permits webview images, and includes the browser directory in `localResourceRoots` (`apps/ptah-extension-vscode/src/services/webview-html-generator.ts:205`, `apps/ptah-extension-vscode/src/services/webview-html-generator.ts:298`, `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts:96`). Both copied WebP files also matched their landing-page sources byte for byte.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Remove DaisyUI `dark` from the picker | COMPLETE | None. Color-mode values named `dark` remain intentionally. |
| Migrate current state and hint values to `dracula` | COMPLETE | None. |
| Migrate legacy state and hint values to `dracula` | COMPLETE | None. |
| Keep pre-paint and service migration in parity | COMPLETE | None found. |
| Load the deferred sheet for migrated Dracula | COMPLETE | None found. |
| Add Pyramid and Temple to both glass themes | COMPLETE | None. |
| Use the supplied WebP assets in CSS, picker, and `SCENES` | COMPLETE | None. |
| Preserve Electron and VS Code asset loading | COMPLETE | Static paths and policies support the URLs. No build or host e2e run was performed. |

Implicit requirements not addressed: automated contrast evidence for the real WebP pixels remains absent.

The remaining `dark` references found were migration fixtures, color-mode identifiers, unrelated test data, or the separate documentation theme. The Electron e2e picker now expects 35 unique themes and retains Dracula (`apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts:176`). No Electron main-window background map keyed by the retired picker name was found.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Current state is `dark` | YES | Normalize to `dracula` before validation. | None. |
| Current hint is `dark` | YES | Use the same normalization after state fallback. | None. |
| Legacy state or hint is `dark` | YES | Return `dracula` before the glass lightness mapping. | None. |
| Current value is unknown | YES | Use the default and do not revive legacy state. | None. |
| localStorage is unavailable | YES | Continue with state or the default. | A pre-paint optimization can be lost. |
| Deferred sheet fails | YES | Apply the existing root fallback. | Existing behavior can show fallback colors. |
| Image fails to decode | YES | Paint the tint over the root base color. | The selected scene is absent. |
| Text over bright image pixels | PARTIAL | High tint values and a composition preview were used. | No automated pixel-contrast result exists. |

## Verification

Command:

```sh
npm run verify -- -p @ptah-extension/core,@ptah-extension/chat-ui,ptah-extension-webview,ptah-electron,ptah-extension-vscode,ptah-electron-e2e
```

Result: 54 of 55 tasks succeeded. The only failure was `ptah-electron-e2e:lint`. It reported four existing `no-restricted-syntax` errors in the unchanged `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts:111`, `:169`, `:220`, and `:273`. This failure is outside the task diff. Build and e2e targets were not run.

`ptah_get_diagnostics` did not complete within 45 seconds. The scoped Nx typecheck tasks supplied the compiler evidence instead.

## Decisions

- Treat contrast as a Minor coverage gap. The alternatives were approval without a finding or a revision request. The code has explicit tint layers and the batch preview found legible sample text, so the evidence does not confirm a user-visible defect. This decision is reversible with rendered contrast evidence.
- Treat remaining `dark` mode identifiers and documentation selectors as out of scope. The request removes the Ptah picker theme, not every light or dark mode marker. This decision is reversible if the scope expands.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Text contrast over the brightest WebP regions lacks automated evidence in the real hosts.
- What a robust implementation would add: Add rendered contrast checks and run the existing Electron theme e2e target when explicitly authorized.
