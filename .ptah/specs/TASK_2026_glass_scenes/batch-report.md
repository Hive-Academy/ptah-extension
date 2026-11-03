# Glass theme scenes batch report

## Files changed

- `libs/frontend/core/src/lib/services/theme.service.ts` — remove the selectable DaisyUI `dark` theme, migrate stored `dark` values to `dracula`, and register Pyramid and Temple scenes.
- `libs/frontend/core/src/lib/services/theme.service.spec.ts` — cover theme migration and scene persistence.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts` — add the two labeled scene swatches and fit six swatches in the picker.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts` — update theme and scene picker expectations.
- `apps/ptah-extension-webview/src/index.html` — keep prepaint theme and scene validation aligned with the service, including old `dark` values.
- `apps/ptah-extension-webview/src/styles.css` — add image backgrounds and distinct dark and light glass tint strengths for both scenes; remove unused `dark` theme overrides.
- `apps/ptah-extension-webview/public/images/pyramid_energy_apex.webp` — copy the Pyramid image into webview public assets.
- `apps/ptah-extension-webview/public/images/temple-bg.webp` — copy the Temple image into webview public assets.
- `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts` — check image scene variables, tints, and selectors.
- `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts` — update the stock theme count after removing `dark`.
- `apps/ptah-extension-webview/src/app/theme-boot-lists.spec.ts` — update the prepaint scene list expectation.
- `apps/ptah-extension-webview/src/app/theme-pre-paint-parity.spec.ts` — cover old `dark` values and new scenes across prepaint and service startup.
- `apps/ptah-extension-webview/src/app/elevation-tokens.spec.ts` — use retained `dracula` in theme metadata checks.
- `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts` — update the enumerated theme picker count; e2e was not run.

## Migration and asset resolution

At startup, the service and prepaint script normalize `dark` from either the `theme-v2` state key or its localStorage hint to `dracula`. They also map the legacy `theme` state or hint from `dark` to `dracula`. Dracula is a deferred theme, so the deferred stylesheet loads for migrated selections. The `dark` and `light` strings that describe color scheme and glass mode remain intact.

The webview project's public asset glob copies `public/images/*.webp` into the browser output beside `styles.css`. The scene CSS uses relative `images/...` URLs, just as this webview uses relative image assets. Electron copies the browser output as a unit and changes the document base to `./`, so stylesheet-relative image URLs stay in the renderer's `images/` folder. The VS Code host rewrites the stylesheet link with `webview.asWebviewUri` and grants the browser directory as a local resource root; stylesheet-relative URLs resolve through that webview resource URI. Its CSP allows images from `webview.cspSource`.

## Decisions

- Retire the selectable DaisyUI `dark` name and map existing persisted choices to `dracula`. Alternatives were dropping the old choice or mapping it to Ptah Glass. The requested visual equivalence to Dracula and the existing deferred theme list support this choice. Reversible.
- Keep the image URLs relative to the emitted stylesheet. The existing public asset copying and host URL rewriting support this location in Electron and VS Code. Reversible.
- Use the existing glass background layer and tint variables for the new scenes. The existing picker swatches use those same variables, so one set of scene values drives the page and preview. Reversible.

## Verification

Command: `npm run verify -- -p @ptah-extension/core,@ptah-extension/chat-ui,ptah-extension-webview,ptah-electron,ptah-extension-vscode,ptah-electron-e2e`

Result: failed; Nx reported 53 of 55 tasks succeeded. The two failures were `ptah-extension-webview:test`, due to one stale assertion for the retired `dark` caption override, and `ptah-electron-e2e:lint`, due to four existing `no-restricted-syntax` errors on recursive `fs.watch` in `apps/ptah-electron-e2e/src/specs/git-watcher.spec.ts` (lines 111, 169, 220, 273). The webview assertion was corrected after that run. The unrelated watcher spec was left untouched.

Follow-up command: `npm run verify -- -p ptah-extension-webview`

Follow-up result: pass; all 3 webview tasks succeeded, including the updated tests. The overall scoped gate remains failed because of the Electron e2e lint errors above.

Visual check: opened a temporary in-workspace HTML preview with Ptah browser tools and inspected a screenshot of Pyramid in dark glass and Temple in light glass. The image and tint layers rendered, and sample text was legible. The temporary preview was removed. This was a scene composition preview, not a full application rendering.

Limitations: the optional `angular-frontend-patterns` skill was not available through this lane's skill discovery. Scoped `ptah_get_diagnostics` initially timed out twice; a later check found no diagnostics in the requested changed specs, but reported 16 errors in untouched sibling files under its own compiler configuration. The scoped Nx verify passed all three webview targets. Build and e2e targets were not run, as requested.
