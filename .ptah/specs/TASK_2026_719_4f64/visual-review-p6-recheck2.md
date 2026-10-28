# Visual Review - TASK_2026_719_4f64 - P6 chip re-check 2

Verdict: APPROVED (chip items only). Confidence HIGH.

## Environment
- Own Electron instance launched via harness `screenshots/p6r2-capture.mjs` (derived from `p6-capture.mjs`; adds chip measurement). Build: `dist/apps/ptah-electron/main.mjs` in the worktree. RPC faked, no sign-in. The user's running instance was not touched.
- Scenario `two` (Work signed-in, long-label Client account not-signed-in). Widths 520 and 320, dark (ptah-glass) and light (ptah-glass-light). Audit selection, not a support contract.
- Measurement: colours resolved to sRGB through canvas, because the theme uses oklch. An earlier run of the script parsed oklch as RGB and its numbers were discarded.

## Chip measurements (identical at 520 and 320 px)

| Theme | font-size | border | border vs row bg | text vs chip bg | chip size |
| --- | --- | --- | --- | --- | --- |
| dark | 12px | 0.67px, base-content/25 | 2.17:1 | 15.71:1 | Chat 44x20, Lanes 51x20 |
| light | 12px | 0.67px, base-content/25 | 1.69:1 | 15.39:1 | Chat 44x20, Lanes 51x20 |

- Moderate 1 (10 px text) is fixed. The computed font-size is 12px, and the chip text contrast is above 4.5:1 in both themes.
- The chip part of Moderate 2 (outline invisible in light) is fixed. The outline measures 1.69:1 in light, up from effectively 1.0:1, and is visibly drawn in `p6r2-accounts-320-light-tab.png`.
- Note, not a defect: the outline is below 3:1. It is a decorative edge on a non-interactive label whose text carries the meaning, so WCAG 1.4.11 does not apply. A stronger border (`/40` or higher) would be optional polish.

## Row layout
- No horizontal overflow: row scrollWidth equals clientWidth (478 at 520 px, 286 at 320 px).
- Manage button is 32x32 at both widths. Rows are 93 px high, except the long-label Client row at 320 px, which is 133 px because the Sign in button wraps below the label. The label is ellipsised ("Client Acme Corp production...") and the chip stays on one line.
- No regression against the earlier P6 recheck behaviour.

## Screenshots (`.ptah/specs/TASK_2026_719_4f64/screenshots/`)
- `p6r2-accounts-520-dark.png`, `p6r2-accounts-520-light.png`, `p6r2-accounts-320-dark.png`, `p6r2-accounts-320-light.png`
- Tab-only crops: `p6r2-accounts-{520,320}-{dark,light}-tab.png`
- Data: `p6r2-measure.json`
- Harness: `p6r2-capture.mjs`

I looked only at `p6r2-accounts-320-light-tab.png`. The other seven screenshots were captured but not viewed. Their findings rest on the measurements in `p6r2-measure.json`.

## Verdict
- Recommendation: APPROVE for the chip items.
- Counts: visual breaking 0, serious 0, moderate 0 (chip scope).
