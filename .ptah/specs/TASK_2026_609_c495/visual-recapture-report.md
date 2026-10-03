# Visual Recapture Report - after B-FIX-3 (warning contrast)

## Method

- Worktree HEAD `dc5bc09f3` (includes 7dca3b7cc). Rebuilt with `npx nx build ptah-extension-webview --configuration=development` (ok), served by the harness fixture server (`useAppBuild: true`).
- Spec: `b0-capture/recapture.spec.ts` (new; copies the B-7 helpers, mocks and theme handling unchanged: 1280x800 Chromium, `data-theme` set after load, dark `anubis` / light `anubis-light`, mocked RPC only, real `~/.ptah` untouched). `package.json.disabled` renamed to `package.json` for each run and restored afterwards (verified: only `package.json.disabled` present).
- Contrast is from COMPUTED styles, not pixels: for each text node matching the warning copy, `getComputedStyle(el).color` (and opacity) is resolved through a 1x1 canvas (handles oklch), the background is the alpha-composited stack of ancestor `background-color` values up to the first opaque one. Raw data: `b0-capture/recapture-measure.jsonl`.
- No repo source edited, no history/tree git commands.

## Files re-taken (overwritten in `screenshots/`)

`after-reconcile-guard-light.png`, `after-reconcile-guard-dark.png`, `after-wizard-preview-modal-light.png`, `after-wizard-preview-modal-dark.png`, `after-wizard-preview-warning-light.png`, `after-wizard-preview-warning-dark.png`.

Additional new files (focus evidence, not part of the six): `recapture-focus-guard-{light,dark}-{0,1,2}.png`, `recapture-focus-preview-{light,dark}-{0,1,2}.png`.

## Computed contrast (WCAG AA needs 4.5:1 for these sizes)

| Message | Element classes | Size | Theme | fg (computed) | bg (computed) | Ratio | AA |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Guard: "These hand edits will be overwritten." | `bg-warning text-warning-content` | 14px | light | rgb(65,30,3) `oklch(0.28 0.066 53.813)` | rgb(247,127,0) | 5.66 | PASS |
| Guard: same | same | 14px | dark | rgb(19,19,23) `oklch(0.1886 0.008 285.6)` | rgb(249,115,22) | 6.61 | PASS |
| Preview: "will overwrite" | `badge badge-warning` | 10px | light | rgb(65,30,3) | rgb(247,127,0) | 5.66 | PASS |
| Preview: "will overwrite if written" | `badge badge-warning` | 10px | light | rgb(65,30,3) | rgb(247,127,0) | 5.66 | PASS |
| Preview: "will overwrite" and "...if written" | `badge badge-warning` | 10px | dark | rgb(19,19,23) | rgb(249,115,22) | 6.61 | PASS |
| Preview warning banner: "Other CLI paths could not be worked out..." | `bg-warning text-xs text-warning-content` | 12px | light | rgb(65,30,3) | rgb(247,127,0) | 5.66 | PASS |
| Same banner | same | 12px | dark | rgb(19,19,23) | rgb(249,115,22) | 6.61 | PASS |

Previously 2.46:1 (light, `text-warning` on surface); all seven message/theme combinations now pass. Visually confirmed in the screenshots (solid orange fill, dark brown text in light; dark text on orange in dark).

## Focus visibility (modal buttons, keyboard Tab, both themes)

Guard modal (Cancel, Sync) and preview modal (Cancel, Confirm Generate): every button reports `:focus-visible` true with a 2px solid outline, 2px offset. Dark outline `oklch(0.7665 0.1387 91.06)` (amber), light outline `oklch(0.48 0.12 70)` (dark amber). Focus is trapped in the modal (Tab cycles Cancel, Sync/Confirm, Cancel). Screenshot check: `recapture-focus-guard-light-1.png` shows a clear ring around Sync. PASS in both themes. Note: the light ring on the orange Sync button is visible against the cream surface (offset gap), not measured as a numeric non-text contrast ratio.

## Verdict

PASS. B-7 serious defect 1 (light-theme warning contrast) is resolved: all warning messages computed 5.66:1 (light) and 6.61:1 (dark), above the 4.5:1 AA minimum; modal buttons show visible focus rings in both themes. Scope: 1280x800 only, three modal states, two themes.
