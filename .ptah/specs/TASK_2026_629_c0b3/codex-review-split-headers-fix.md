# Fix H re-review: Rail split headers

**Score: 9/10. Verdict: APPROVE.**

**Numbered findings:** None in the scoped fix.

The two Serious findings are resolved. Independently converting the theme values in `apps/ptah-extension-webview/tailwind.config.js` to sRGB and applying WCAG relative luminance gives approximately 3.59:1 for the anubis bar against `base-100`, 9.5:1 for the inverted anubis-light bar, 4.82:1 and 6.8:1 for their marker numerals, and at least 5.0:1 for the new `base-content-muted` divider against `base-100`, `base-200`, and `base-300`. Small differences from the writer's decimals are due to gamut conversion and 8-bit rounding; all results clear the relevant 3:1 UI and 4.5:1 text thresholds.

The theme override at `canvas-focus-header.component.ts:24` applies in both hosts: `apps/ptah-extension-webview/src/index.html:2,64` sets `data-theme` on `<html>`, `ThemeService` updates that same element, and Electron loads the webview renderer. The installed Angular compiler handles `:host-context` under its default emulated encapsulation, and the override follows the default `:host` declaration. Other themes retain the prior primary/primary-content pair and the same active class, marker, and accessible pane label; their indicators are not removed by this fix.

The board change at `canvas-rail-board.component.ts:143` only replaces the divider color. Its position-2, horizontal/vertical, gap, activation, visual-order, and marker bindings remain as reviewed. The edited spec assertions at `canvas-focus-header.component.spec.ts:162,176` and `canvas-rail-board.component.spec.ts:1517,1576` would fail if the previous class bindings remained, so those edits are not vacuous. The existing class-only contrast-test limitation remains recorded under decision row 118 and is assigned to the rendered contrast re-check. The writer reports 18/18 header and 74/74 board tests passing; I did not rerun them or run a renderer.
