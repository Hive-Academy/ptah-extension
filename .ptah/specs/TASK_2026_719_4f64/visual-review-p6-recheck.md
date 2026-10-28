# Visual re-check - P6 fixes (TASK_2026_719_4f64)

Verdict: REVISE (4 of 5 items pass; Moderate 1 and the chip half of Moderate 2 still fail).

## Environment

- Own Electron instance launched through the harness copy `screenshots/p6r-capture.mjs` (derived from `p6-capture.mjs`, adds computed-style measurements). Faked RPC, scenario `two`. No user instance touched, no sign-in.
- Build: `dist/apps/ptah-electron/main.mjs`; renderer `index.html` dated 22:49, newer than the last source edit (22:44), so the bundle is current.
- Widths: 520, 320, 245 at zoom 1; 520 and 245 at REAL zoom factor 2 (`setZoomFactor(2)`, content size 245 CSS px). Dark and light.
- Measurements: `screenshots/p6r-results-all.json`. Screenshots: `screenshots/p6r-two-*`.

## Per item

| # | Item | Result | Evidence |
|---|---|---|---|
| S1 | Lane Account trigger >= 24 px | PASS | Trigger height 24 at 520, 320 (width 208) and 245 (zoom 1 and 2); no smallTargets in the lane audit. `p6r-two-520-lane-dark.png`, `p6r-two-245-lane-light.png` |
| S2 | Popover header at 245 px | PASS | No overflowing elements; popover 17..231 in a 246 px viewport; Close at 199..223 (24 px tall), fully inside. Title truncates ("Reassi...", h2 clientWidth 52 of 122), Check connection stays whole. Same at zoom 2 (Close 198..222 inside popover right 230). `p6r-two-245-popover-dark.png`, `p6r-two-245-popover-light.png`. Note: `p6r-two-245z2-popover-*.png` are clipped by the zoomed window capture, so the zoom result rests on the measurements in `p6r-results-all.json` (key `two-245z2`, `popHdr`). |
| M1 | "Used by" chips 12 px | FAIL | Computed `font-size` of `[data-testid=accounts-tab-row-chip]` is 10px at every width and zoom (both rows). Source has `text-xs` (`accounts-tab.component.ts:216`), but daisyUI `badge-sm` wins. `p6r-two-245-accounts-dark.png`, `p6r-two-320-accounts-light.png` |
| M2 | Light theme borders | PARTIAL | PASS: account row cards, existing-login row (`ambient-account-row.component.ts:53`) and add form (`add-account-form.component.ts:41`) all compute to `oklch(0.2357 ... / 0.15)` in light; the borders are visible. FAIL: chip outline computes to `rgba(255,255,255,0.06)` in light and dark, so it is invisible on the light base. `p6r-two-245-accounts-light.png`, `p6r-two-two-addform` files: `p6r-two-245-addform-light.png`, `p6r-two-320-accounts-light.png` |
| M3 | Row actions right-aligned when wrapped | PASS | At 245 the Sign in + manage group sits on its own line with its right edge at 213 inside the 230 row edge (same offset as the unwrapped case); 320 and 520 the same (manage right edge 16 px inside the row at all widths). `p6r-two-245-accounts-light.png` |

## New or remaining defect

- Moderate (M1/M2 not fixed): `libs/frontend/chat/src/lib/settings/providers/accounts/accounts-tab.component.ts:216`. The chip class `badge badge-ghost badge-sm border-base-content/15 text-xs` still renders 10 px text and a 6 % white border, so the utilities do not override the daisyUI `badge-sm`/`badge-ghost` rules. Fix: drop `badge-sm`/`badge-ghost` for a plain chip (`inline-flex rounded-full border border-base-content/15 px-2 text-xs`), or use important variants (`!text-xs !border-base-content/15`). `ambient-account-row.component.ts:94` has the same `badge badge-sm` pattern and will have the same 10 px text and weak border when chips render (none rendered in this scenario; not measured).
- The fix report's out-of-scope note is stale: the ambient row and the add form now use `border-base-content/15`.

## Regression check

No regressions on the same screens. No horizontal overflow (docSW equals docCW at 520, 320, 245, and 245 at zoom 2). No small targets in the popover, lane cell or drawer audits. Detail view, keyboard-focus and menu captures were retaken (`p6r-two-*-detail-*`, `*-kbd-*`, `*-lane-menu-*`) and show the same layout as the earlier review.

## Verdict

REVISE. Fix the chip font size and outline, then re-measure `accounts-tab-row-chip` computed styles (the 245 and 320 px light captures are enough).
