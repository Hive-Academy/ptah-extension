# Lane A: Ptah glass theme layer

Implemented the C4 Ptah glass dark/light default, the shared glass layer, accent persistence and picker control. Lane B owns component surface attributes.

## Files changed

- `apps/ptah-extension-webview/tailwind.config.js` — added both C4 DaisyUI themes and selected the dark glass root.
- `apps/ptah-extension-webview/src/index.html` — boots the default, glass mode and valid stored accent before paint.
- `apps/ptah-extension-webview/src/styles.css` — appended the C4 component layer with only six opted-in scenes and solid fallback plates.
- `libs/frontend/core/src/lib/services/theme.service.ts` — registered glass themes, accent state and DOM attributes, and shared accent values.
- `libs/frontend/core/src/lib/services/theme.service.spec.ts` — updated defaults and added accent persistence and glass DOM cases.
- `libs/frontend/core/src/lib/services/accent-contrast.spec.ts` — guards six accent token combinations for text, button, link and focus contrast.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts` — added accessible native-radio accent swatches to the existing picker.
- `apps/ptah-extension-webview/src/app/theme-boot-lists.spec.ts` — guards eager, dark, glass and accent boot lists.
- `apps/ptah-extension-webview/src/app/state-ink-contrast.spec.ts` — includes both Ptah glass themes in status ink checks.
- `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts` — includes the two new eager theme colour sources.
- `apps/ptah-extension-webview/src/app/status-badge-contrast.spec.ts` — resolves all custom theme objects for badge checks.
- `apps/ptah-extension-webview/src/app/accent-css.spec.ts` — checks scoped OKLCH overrides and gradient tokens.
- `apps/ptah-extension-webview/src/app/glass-scrim.spec.ts` — checks local scrim floors and solid fallback plates.
- `apps/ptah-extension-webview/src/app/glass-roles.spec.ts` — checks the closed role set in CSS and templates.

## Decisions

- The existing picker owns accent selection. Its existing `ThemeService` interaction and the C4 handoff make a new settings component unnecessary. Reversible.
- VS Code light-theme first launch maps to `ptah-glass-light`; dark defaults to `ptah-glass`. This keeps the new theme pair as the default in both modes. Reversible.
- The generated CSS stays in `styles.css` inside a single appended `@layer components` block so Tailwind processes it with the existing semantic surface rules. Only the six opted-in scene lines ship. Reversible.
- The C4 generated no-backdrop-filter escape hatch omitted a solid `--glass-plate`, while NOTES section 10 requires it. Added that declaration to meet the accessibility guard. Reversible.
- Accent values live in `ACCENT_COLORS` in the service and the adjacent contrast spec reads that same constant. The boot list spec reads the service accent names from source because the current public barrel does not export the new constants and the batch does not own that barrel. Reversible.

## Verification and remaining work

- Loaded `tailwind.config.js` with Node: it exposes Anubis and both Ptah glass themes, with `darkTheme=ptah-glass` and the matching theme root.
- Inspected `styles.css`: exactly `ptah-glass`, `ptah-glass-light`, `dark`, `nord`, `cupcake`, and `dracula` retain scene URLs.
- Scoped Ptah diagnostics reported no errors in `theme.service.ts` or `glass-roles.spec.ts`; the compiler reported 108 errors in unrelated sibling files. The larger changed-file request timed out, so the other changed TypeScript files remain unchecked by diagnostics.
- No Nx, Jest, TypeScript CLI, lint, build or visual run was performed, as instructed. The contrast guard uses token and panel colours; real rendered-pixel contrast still needs the approved Electron visual check.
- Lane B must add surface attributes to component templates. No Lane B-owned template was edited here.
