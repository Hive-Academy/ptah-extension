# Screenshot script repair, run 3

Script: `shoot-populated.cjs`. Prior run: `capture-results-2.json` reported 14/22 shots and 9 errors. The orchestrator must run the script to establish the new capture count.

## Defects and changes

1. **Session creation and UUID.** The current board's empty-state button emits a new-session request (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:177-179`, `:1085-1086`). Its host opens `data-testid="canvas-new-session-popover"` with a labeled input whose placeholder is `New session` and a `Create` button (`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:122-171`). Rail cards still carry `data-rail-card` and `data-tab-id` (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts:63-65`). The script now waits for that popover, fills its labeled textbox, clicks its Create button, then returns and validates the new card ID (`shoot-populated.cjs:153-173`). This preserves the live `permission:request` capture path.
2. **Panel shot.** The bell has `data-testid="notification-center-bell"` and toggles the conditional `notification-center-panel`; rows are `.notification-row` in its Needs you and Recent notices sections (`libs/frontend/notification-center/src/lib/notification-center.component.ts:25-41`, `:64-70`, `:98-103`, `:170-184`). Those selectors were already correct. The script's `closeThemeMenu()` sent Escape and clicked the page on *every* capture whenever a hidden theme menu element existed; the notification panel closes on outside clicks (`notification-center.component.ts:194-196`). The helper now acts only when the theme menu is visible (`shoot-populated.cjs:95-107`), and opening the panel now waits for the panel itself (`:223-227`).
3. **Clear all.** The current control has the exact accessible name `Clear all notices` and calls `store.clearAll()` (`notification-center.component.ts:50-54`). The name did not change. The script now scopes that existing button locator to the open panel (`shoot-populated.cjs:228`); keeping the panel open via change 2 addresses the missing-button timeout.
4. **Panel after clear.** The heading is exactly `Needs you`, with a separate count span and stable ID `ptah-needs-you-heading` (`notification-center.component.ts:64-68`). The script now waits for that heading by ID inside the panel (`shoot-populated.cjs:229-232`). Keeping the panel open via change 2 is also required for this shot.
5. **800 px.** `assertChatBoard()` now requires the Sessions heading only above 900 px. At 800 px it waits for the visible notification bell alongside the New session button (`shoot-populated.cjs:80-87`). This matches the observed narrow layout in the prior run, where the Sessions wait timed out.
6. **Snackbar opacity evidence.** A card uses `snackbar-card surface-3`, and the entrance animation fades opacity from 0 to 1 over 120 ms (`libs/frontend/notification-center/src/lib/notification-snackbar.component.ts:22-24`, `:28-32`). Before each snackbar shot, including the 800 px shot, the script waits 300 ms, records the first card's computed `backgroundColor` and `opacity` plus every ancestor opacity through `body` in `results.snackbarStyle`, and screenshots with `animations: 'disabled'` (`shoot-populated.cjs:117-129`). The computed values on the next run can distinguish an animation frame from a transparent surface style.

## Decisions

- Retained the current panel selectors and Clear all accessible name because source confirms both; corrected panel state handling and scoped the action. Reversible script-only change.
- Retained the rail card ID selector because the component host still declares both attributes. Reversible script-only change.

## Verification and remaining work

- `node --check .ptah/specs/TASK_2026_593_7c2e/visual-check/shoot-populated.cjs`: passed (exit 0, no output).
- Electron, Playwright, Nx, Jest, build, and serve were not run, as requested. The orchestrator must run the capture to confirm all 22 screenshots and inspect `snackbarStyle` for the transparency cause. No application code was edited.
