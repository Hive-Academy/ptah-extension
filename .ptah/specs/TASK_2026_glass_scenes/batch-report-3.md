# Batch 3: Pyramid as the default Glass scene

## Design chosen

Both the pre-paint script and `ThemeService` now set `data-scene` for every Ptah Glass scene, including the default. The per-scene CSS selectors are the single source for the selected backdrop and tint. Their specificity matches the generic dark Glass rule and they appear later, so default Pyramid receives its measured tint: `0.68` dark and `0.55` light. Aurora has explicit selectors in both modes and remains selectable. Pyramid is first in the picker and scene lists.

## Files changed

- `libs/frontend/core/src/lib/services/theme.service.ts` and `theme.service.spec.ts`
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts` and `theme-toggle.component.spec.ts` (the existing picker-order spec named in the request)
- `apps/ptah-extension-webview/src/index.html` and `src/styles.css`
- `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts`, `theme-pre-paint-parity.spec.ts`, and `theme-boot-lists.spec.ts`

## Stored versus default scenes

No stored scene, or invalid values in both stores, resolves to Pyramid. A valid webview state value wins over the localStorage hint; a valid hint is used when state is absent or invalid. Stored `aurora` therefore still renders Aurora, including when the hint contains a different scene. Boot reads these stores without writing either one. Scene attributes are applied only for the Ptah Glass dark and light themes.

## Decisions

- **Always write the Glass scene attribute:** chosen over a CSS base fallback because the latter loses to the generic dark tint rule. Evidence: both `data-scene` scene selectors have specificity `(0,4,0)` and follow that rule. Reversible: yes.
- **Keep stored Aurora:** chosen over migrating it because the stored value may represent an explicit choice. Evidence: the existing state/hint precedence and the request to preserve user choices. Reversible: yes.
- **Update the existing theme-toggle spec:** chosen because it explicitly pins Aurora-first order and the request calls for that spec if present. Reversible: yes.

## Verification

Command: `npm run verify -- -p ptah-extension-webview,@ptah-extension/core,@ptah-extension/chat-ui -- --output-style=static`

Result: **passed** (exit 0). Nx header: `Running targets lint, test, typecheck for 3 projects`; completion: `Successfully ran targets lint, test, typecheck for 3 projects` (9 tasks). The first run without the static output option failed only on the old theme-toggle scene-order assertion; that spec was updated before the passing rerun. Lint emitted warnings in existing unrelated files, with zero errors.

`ptah_get_diagnostics` reported no errors in the edited theme-toggle spec; it also reported existing errors in sibling test and shared files. A rendered screenshot was not available under the task's restriction against build and serve targets. The session exposed no skill-loading tool, so `angular-frontend-patterns` could not be loaded.
