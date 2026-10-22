# e2e-fixes-r2 (final)

CI logs are in `ci-artifacts/r2-logs/webview.log`. The webview job uploaded no artifacts, so there are no traces to read.

## Files changed
- `libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.ts`: the page toast region is a `popover="manual"` (template ~L36). A constructor effect (~L90) hides and re-shows it on every new toast, so it stacks above popovers opened since. The inline toast is unchanged.
- `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts`: panel and backdrop wrapped in a `popover="manual"` top-layer shell (template ~L74, styles ~L100, `showLayer`/`hideLayer` ~L260). Spec: new "top-layer shell" block in `native-dropdown.component.spec.ts`.
- `libs/frontend/ui/src/lib/native/drawer/native-drawer.component.ts`: root is `popover="manual"` (template ~L67, `.ptah-drawer-layer` styles, `showLayer()` called before `focusPanel()`). Approved by main. Inputs, outputs, focus trap and Escape are unchanged. Spec: one new case in `native-drawer.component.spec.ts`.
- `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace-visual.e2e.spec.ts`: a `WeakMap` remembers the last chrome gap (`measuredChromeGap`, before `fitShellWidth`), and the six-views test has `test.setTimeout(120_000)` with the measured reason in a comment.
- No `styles.css` patch is needed.

## Runs
1. `npx nx build ptah-extension-webview --parallel=1`: success (run three times).
2. First settings-reachability + marketplace run, before the toast re-stack: 3 failed, 1 passed. Failures: marketplace timeout, #63/#70 (both hosts), ADV-17 (vscode only).
3. After the re-stack fix: electron reachability passed, vscode failed at ADV-17. The drawer's Cancel button was intercepted by `ptah-mcp-port-config`, because the drawer sat inside an isolated glass surface.
4. After the drawer change plus rebuild, settings-reachability: **2 passed** (both hosts).
5. Marketplace six views, `--timeout=180000`: 2 passed. Electron took 29.5s, vscode 10.6s. A debug log showed the width fit converges in 2 resizes, 0.15-0.65s per fit, while each element screenshot costs 0.8-1.6s (18 shots, ~17-27s). The slowness is glass blur repaint during screenshots, not the width gap. After the fix at the default 30s timeout, six views passed (electron 26.7s before the explicit timeout). The final run with `setTimeout(120_000)` also passed.
6. Jest: `native-dropdown`, `native-drawer` and `native-popover`: 69 passed. `settings-toast`: 9 passed.

## Not run / still unproven
- B (`compaction-duplicate-session`): the Electron build and spec were not run because of the wrap-up request. The dropdown top-layer fix is unproven end to end. If it fails, the next suspect is `copy-renderer-dev` not being run.
- The ADV-14/15 cascade is cleared by run 4.
- Known limitation: an already-visible toast is covered by a drawer or popover opened after it, until the next toast.

## Other fixed overlays in `libs/frontend/ui/src/lib/native/**` (read-only)
- `autocomplete/native-autocomplete.component.ts`: `suggestions-panel z-50` positioned through `FloatingUIService` (fixed), still in-DOM. The same isolation defect can remain.
- `modal/native-modal.component.ts` uses `<dialog>`. `popover/` and `dropdown/` are top-layer now. `drawer/` is top-layer now.
- No other `fixed` or `z-40/50` overlays were found. Matches in aurora, brand-mark and provider-model-picker are comments or text.

## Processes
No Playwright, Electron or Chrome processes are left running.

## Revision 1

Response to `code-logic-review-e2e-fixes-r2.md` (REVISE, 6/10). Pattern mirrored from
`native-popover.component.ts` (bounded `positionPanel`, `keepLayerInPlace`, open generation).

1. **blocking: unbounded initial dropdown positioning.**
   `libs/frontend/ui/src/lib/native/dropdown/native-dropdown.component.ts`: new
   `DROPDOWN_POSITION_TIMEOUT_MS = 1000` (L54); `positionPanel` (L282) races
   `floatingUI.position` against the timeout and catches rejection, returning `false`;
   `positionDropdown` (L254) then calls `revealUnderTrigger` (L312), which pins the panel
   `position: fixed` at the trigger's bottom-left and sets `visibility: visible`. So the
   backdrop never sits over a hidden panel. A late success still goes through the service
   while open; after a close the service drops it.
2. **minor: promotion failure left `display:none`.** Dropdown `showLayer` (L323) calls
   `keepLayerInPlace` (L343, `style.display = 'block'`) when `showPopover` is missing or
   throws; `hideLayer` (L348) resets the inline display and only calls `hidePopover` when
   promotion succeeded (`layerShowing`). `libs/frontend/chat/src/lib/settings/feedback/settings-toast.component.ts`:
   the effect (L91) calls `keepRegionInPlace` (L112) on missing/throwing API and clears the
   override after a successful `showPopover`. No retry was added: the in-page display
   fallback keeps the toast visible, and the effect re-runs on every new message.
3. **minor: stale `opened`.** `openGeneration` is bumped on open (L256), close (L243) and
   destroy (L399, with `destroyed = true` at L398); `opened.emit()` (L274) runs only when the
   generation is current, `isOpen()` is true and the component is not destroyed.
4. **minor: tests.**
   - `native-dropdown.component.spec.ts`: call order `show` before `compute`; missing API
     (prototype method removed explicitly) and throwing `showPopover` both assert
     `display: block` on the shell and a visible panel; rejected compute reveals the panel
     under the trigger and emits once; never-settling compute stays hidden until
     `DROPDOWN_POSITION_TIMEOUT_MS`, then reveals and emits; close, reopen and destroy while
     pending emit no stale `opened`. `flushAll` covers the race's extra promise hops.
   - `native-drawer.component.spec.ts`: new case installs a recording `showPopover`, asserts
     it was called once on the root and before focus moved into the panel.
   - `settings-toast.component.spec.ts`: new `top-layer promotion` block covers success
     (`showPopover` called, no display override), missing API and throwing API (both
     `display: block`).
   - Browser-level `:popover-open` / hit-testing assertions remain an Electron e2e gap.

Verification: `ptah_get_diagnostics` on the five changed files reports no errors (sibling
spec errors in `libs/frontend/chat` are unrelated). No nx/jest/tsc/lint run, per brief.
