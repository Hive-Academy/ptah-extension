# Theme picker: bounded correction

Scope: `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts` (C) and
`theme-toggle.component.spec.ts` (S). No other file was changed. ThemeService still owns every
theme and accent write.

## Root causes

1. **Stale parent ink.** Before this change, `selectTheme` handled a same-category pick by focusing
   the tile, with no follow-up (old C:334-345). `captureParentInk` only ran on open and on a
   cross-category follow-up. `ThemeService.setTheme`
   (`libs/frontend/core/src/lib/services/theme.service.ts:425-440`) can also apply the theme later,
   after the deferred sheet loads, so a capture tied to the click would also read stale colors.
2. **Stale height cap.** `place` ran only on open, on a cross-category follow-up and on resize.
   `selectCategory` (old C:351-358) and the appearance or removal of the accent footer never
   placed the panel again.
3. **Popup semantics.** The trigger used `aria-haspopup="true"`, which means a menu (old C:184).
   The panel is `role="dialog"` with a tablist, not a menu.
4. **The two failing specs were test defects. The component was correct.**
   - "caps a narrow viewport…": `jest.spyOn(window, 'innerWidth', 'get')` threw at old S:343.
     jsdom defines `innerWidth` and `innerHeight` as data properties, so a getter spy cannot
     replace them. The placement math matches the expected values: width 184 and left 8, then
     top 104 and max-height 68; after the resize, top 44 and max-height 68.
   - "copies parent ink…": the ink assertions passed. Only the CSS assertion failed, with
     `Received string: ""`. jest-preset-angular removes the inline `styles` literal
     (`node_modules/jest-preset-angular/build/transformers/replace-resources.js:118-122`), so no
     `<style>` element reaches jsdom.

## Changes

- C:187: `aria-haspopup="dialog"`.
- C:301: `pendingFocus` holds the focus target of the queued follow-up.
- C:333-338: a constructor `effect` on `currentTheme()`, with `menuOpen` read through `untracked`.
  While the panel is open, each theme change schedules a follow-up that copies the ink again and
  places the panel again, but does not move focus. This covers same-category picks, theme changes
  that apply late, and the accent footer appearing or disappearing.
- C:373: `selectCategory` schedules a follow-up that places the panel again and clears the focus
  target (`null`). Focus stays on the tab.
- C:403: on open, the follow-up focuses the selected tile (`'selected'`), as it did before.
- C:461-485: `scheduleFollowup(focus?)`. A call without an argument keeps the queued target. The
  callback reads the target, clears it, and then focuses only `'selected'` or a named tile.
  Placement is unchanged, so above-anchor positioning uses the new content height.
- C:489: `cancelFollowup` clears `pendingFocus`.
- S:1-2, S:43-54: imports for `readFileSync` and `join`. A `setViewport` helper redefines the
  data properties, and `afterEach` restores them.
- S:326: the test now expects `aria-haspopup` to be `dialog`.
- S:354, S:366: the test uses `setViewport` in place of the getter spies.
- S:426-427: the CSS assertion now reads the component source, as `ptah-ui-block.component.spec.ts`
  does.
- S:432-436: `tabOf` helper.
- S:438 (new): after a same-category pick (anubis, then black), the next render copies the new
  `--picker-ink` and `--picker-plate`, and `focus` is not called.
- S:462 (new): above-anchor placement goes 120px, then 360px on the Light tab with no focus call,
  then 120px on Glass, then 200px once `ptah-glass` adds the accent footer. `top` is checked at
  each step.

C is 637 lines, under the 700 limit, so no helper file was needed.

## Test result

`npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts --coverage=false --maxWorkers=2`
gave `Tests: 16 passed, 16 total`. The run before the changes gave `Tests: 2 failed, 12 passed, 14 total`.

## Decisions

- **Refresh on the theme signal, not on the click.** Options were (a) a follow-up in `selectTheme`
  or (b) an `effect` on `currentTheme`. Evidence: `setTheme` can apply asynchronously
  (theme.service.ts:432-439). Option (b) also refreshes after theme changes made outside the
  picker while it is open. This is reversible.
- **Follow-ups move focus only when asked.** Refresh follow-ups leave the queued target alone, and
  a tab change clears it, so focus is not taken from the tab the user is on. This is reversible.
- **Fix the tests, not the component, for item 4.** The evidence is in root cause 4. Reading the
  source matches an existing pattern in this lib. This is reversible.

## Not done

- No nx, tsc, lint, build or Electron run, as the brief required. Typecheck and lint are not
  verified apart from what the Jest transform checked.
- Not verified in a real browser: the top layer, the order of the effect and the render in
  Electron, and the gap between the border-box cap and `scrollHeight` at narrow heights (review
  limit, not addressed).
