# Visual re-review: sidebar preview dialog (Serious 1 of visual-review-p2)

Verdict: PASS (updated after the Focus return re-check at the end). Serious 1 is fixed. The Serious finding on focus return (originally filed below) is also fixed.

## Method

- Renderer rebuilt under the lock: `node scripts/verify.mjs --exec --task visual-dialog -- npx nx run-many -t build-dev copy-renderer-dev -p ptah-electron --parallel=1`. Exit 0, log `tmp/rebuild3.log`. `dist/apps/ptah-electron/renderer/chunk-56JPRX6T.js` contains `showModal` (2 hits) and `max-h-[calc(100dvh-1.5rem)]`.
- Isolated launch, same as the P2 review: temp user-data dir, temp PTAH_DB_PATH, mocked RPC, `sidebar` scenario. Driver: `tmp/visual/dialog.ts` (built to `tmp/dialog.cjs`). Each launch ran under the lock and was closed by the driver. The user's app was not touched.
- Themes `anubis` (dark) and `anubis-light` (light). Widths: 1280 and 400, 900 px tall.
- Screenshots and metrics are in `reviews/visual/dialog/` (D below): `sidebar-wide.json`, `sidebar-narrow.json`, `sidebar-focus.json`.

## Results

| # | Check | Width | Result |
|---|---|---|---|
| 1 | Title visible and hit-testable | 400 | PASS. The title is at y 29-57. `elementFromPoint` at the title returns the H2 (was the header). The dialog matches `:modal` (top layer). Dark and light give the same numbers. |
| 1 | Same | 1280 | PASS. Title at y 117-145, hit returns the H2. |
| 2 | Dialog inside the viewport, actions visible, body scrolls | 400 | PASS. The section spans y 12-888 of 900. Cancel is at y 799-831 and Confirm at y 839-871, both hit-testable without scrolling. The body is the only scroller (scrollHeight 779, clientHeight 662) and scrolls to 117. Document scrollWidth is 400, so there is no horizontal overflow. |
| 2 | Same | 1280 | PASS. The section spans y 100-801 and Confirm is at y 752-784. The content fits (551/551), so there is no scroll. |
| 3 | Backdrop covers the app, app behind not clickable | both | PASS. The `<dialog>` is full-viewport with a 60% neutral scrim (`oklch(0.27 ... / 0.6)`). A probe at the header position hits the dialog or section. A click at the top-right corner hits DIALOG and the dialog stays open. |
| 4a | Focus lands inside on open | both | PASS. The active element is `button.target-change`, inside the dialog. |
| 4b | Tab stays inside | both | PASS. 40 Tab presses cycled bulk-keep, bulk-replace, keep-segment, diff-toggle, keep-segment, Cancel, preview-confirm, target-change. No stop was outside the dialog. Shift+Tab also stays inside. |
| 4c | Escape closes | both | PASS. 0 dialogs remain. |
| 4d | Focus returns to the opener | both | FAIL. See the finding below. |
| 5 | No regression at 1280 | 1280 | PASS. Compared with `reviews/visual/p2/sidebar__dialog__{dark,light}__wide.png`, the layout, content, scrim, title/body/actions and theme colours are identical. The panel is about 3 px higher (title y 117 vs about 120) because it is now centred by the viewport cap. |

Screenshots (D/): `sidebar__dialog__dark__wide.png`, `sidebar__dialog__light__wide.png`, `sidebar__dialog__dark__narrow.png`, `sidebar__dialog__light__narrow.png`, `sidebar__dialog__tabfocus__{wide,narrow}.png`, `sidebar__dialog__afterescape__{wide,narrow}.png`.

I opened both screenshots of each kind for dark and light; the light narrow numbers are in the JSON, identical to dark except the Cancel width (58 vs 60 px).

## Finding

### Serious: focus is lost to BODY after Escape (check 4d)

- Viewports: 400 and 1280. Evidence: `sidebar-focus.json` and the `afterescape` notes in `sidebar-narrow.json`.
- Observed: after Escape the dialog is removed, but `document.activeElement` is BODY at 50 ms, 300 ms and 1200 ms. The "Generate 3 agents" opener ends up enabled but not focused.
- Cause: the opener is `[disabled]="... || previewOpen()"` (`agent-selection-list.component.ts:172-174`). It is still disabled when the dialog closes and restores focus, and it is re-enabled only afterwards, so `focus()` is a no-op. I did not run the previous bundle, so I cannot say whether this predates the change. The restore logic itself is old, and only `close()` was added in the fix, so it likely does too. The fix report claims the restore works.
- Impact: keyboard and screen-reader users land at the top of the document after closing the dialog and lose their place.
- Fix: restore focus after the opener is re-enabled (for example `afterNextRender` or a microtask after `open` goes false), or keep the opener `aria-disabled` instead of `disabled` while the preview is open.

## Moderate notes

- None for layout or contrast. The light and dark narrow panels showed no clipping, and the title wraps nowhere.
- The panel position at 1280 moved about 3 px up (see check 5). This is not a defect.

## Decisions

- The wide and narrow JSON files are kept separately because the driver writes `sidebar.json` per run. Reversible.
- Escape was pressed with focus inside the dialog (on a button), so the native `cancel` path (focus on the `<dialog>` itself) was not exercised separately.

## Focus return re-check

Fix under test: the Generate button no longer has `previewOpen()` in its `[disabled]` (`agent-selection-list.component.ts`, now `!selected().size || store.isBound() || loading()`).

- Renderer rebuilt under the lock (`tmp/rebuild4.log`, exit 0). `chunk-SXGN2PKB.js` now has `property("disabled", !ctx.selected().size || ctx.store.isBound() || ctx.loading())` with no `previewOpen`.
- Same isolated launch and driver (`tmp/visual/dialog.ts`). Runs: 400 px and 1280 px, each under the lock, instances closed. Metrics: `reviews/visual/dialog/sidebar-recheck-{narrow,wide}.json`. Dark and light screenshots were retaken for both widths. The keyboard sequence ran once per width, after the theme loop, so it was exercised in the light theme (anubis-light); the focus logic is theme independent.

| Check | 400 px | 1280 px |
|---|---|---|
| Focus lands inside on open | PASS (`button.target-change`, in dialog) | PASS |
| Tab stays inside (40 presses, Shift+Tab 12) | PASS, no stop outside | PASS |
| Click on the app behind the backdrop | PASS (hits DIALOG, still open) | PASS |
| Escape: activeElement | PASS: `BUTTON "Generate 3 agents"`, activeIsOpener true, opener enabled, :focus-visible true | PASS (same) |
| Reopen with Enter on the opener | PASS (dialog open, focus inside, title hit-testable) | PASS |
| Cancel click: activeElement | PASS: opener focused, activeIsOpener true (focus-visible false after a mouse click, as expected) | PASS |
| Title hit-test and Confirm in viewport (dark and light) | PASS (title y 29-57 returns H2; Confirm y 839-871) | PASS (title y 117-145; Confirm y 752-784) |

Screenshots (D/): `sidebar__dialog__afterescape-opener__{narrow,wide}.png`, `sidebar__dialog__aftercancel__{narrow,wide}.png`, plus refreshed `sidebar__dialog__{dark,light}__{narrow,wide}.png`.

Result: the Serious finding (focus lost to BODY) is resolved for both Escape and Cancel. Check 4 now passes in full. No new issues seen. Counts: visual breaking 0, serious 0, moderate 0. Verdict: PASS.
