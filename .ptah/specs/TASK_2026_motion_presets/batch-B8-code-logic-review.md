# Batch B8 code-logic review: motion preset picker

Review family: claude (implementer: codex)

Score: 7/10
Verdict: REVISE (minor; no blocking or serious defects)

## Scope examined

`motion-style-picker.component.ts` and `.spec.ts`, the `theme-toggle.component.ts` and `.spec.ts` diff, the `index.ts` export, `motion-preference.component.ts` (untracked), `theme.service.ts` motion API, `styles.css` keyframe and `data-motion-style` rules, `index.html` pre-paint, `apps/ptah-electron/src/config/motion-preference.ts`. Scoped chat-ui test run for `motion-style-picker|theme-toggle`: passed (Nx cache hit, lock released with exit code 0).

## What holds up

- Persistence: `selectStyle` calls `ThemeService.setMotionStyle` (`motion-style-picker.component.ts:96`). The service validates the value, sets the signal, persists with `vscode.setState` and a `localStorage` mirror (`theme.service.ts:394-398`). The root effect sets or removes `data-motion-style` and `rise` is the removed default (`theme.service.ts:294-296`). This matches the pre-paint logic in `index.html:146-152`. There is no second state store.
- Preset list and default come from the service's `MOTION_STYLES` and the service signal. There are six options, Rise is the default, no "None".
- Preview isolation: the frame carries `data-motion-style`, so the global `[data-motion-style=...]` variable blocks re-scope the CSS variables for the chip only. Nothing is written to the document root. The animation name is not scoped by Angular, so the global `ptahMotionEnter` keyframe is used.
- Reduced-motion note: `matchMedia` follows the Electron switches from the Motion preference (`force-prefers-reduced-motion`, `force-prefers-no-reduced-motion`, or system). The note is therefore correct for all three settings (after the restart the Motion preference asks for). The listener is removed in `DestroyRef.onDestroy`.
- Motion preference: `ptah-motion-preference` is only mounted next to the picker inside `@if (isElectron)`. Its logic is untouched by B8. The theme-toggle spec scopes its radios to that element and still asserts the three labels, `settings:setMotion`, and the restart note.
- Native radios share one `name` per instance, so the fieldset/radio group and arrow-key behaviour are native. The sr-only input has a visible peer ring and a focus-visible outline. No `any`; `OnPush` and signals are used.

## Defects

1. Moderate: stuck `previewing` class blocks later previews. `motion-style-picker.component.ts:45-56,96-97`. The hover and focus rule and `.previewing` set the same `animation` declaration. If the user clicks a tile after the hover animation has finished (the normal order: hover, wait, click), no new `animationend` fires, so `previewing` stays equal to that style until another tile is chosen. While the class stays, the chip's animation declaration never changes, so hovering or focusing the selected tile again does not replay it. The same cause makes the selection preview a no-op when the pointer is already over the tile (the animation does not restart). Fix: restart the animation on selection explicitly (for example call `element.animate(...)` or toggle the class off and on across a frame), clear `previewing` on a timeout or on `animationend` regardless of match, and handle `animationcancel`. Keep the hover rule separate.
2. Minor: preview of "Direction-aware" cannot show its distinguishing behaviour. The chip never sits in a `.ptah-motion-stage[data-motion-dir]`, so `--ptah-motion-sign` is always 1 (`styles.css` around line 915). The tile looks like the forward case of whatever direction rule `directional` defines. State this limit in the tile or add a back-direction demo. The report does not mention it.
3. Minor: the selected state is shown only with a `ring` (box-shadow) in `motion-style-picker.component.ts:69`. Box-shadow disappears in forced-colors (Windows high contrast), so the selected tile has no visible indicator there. Add an outline or border fallback with `@media (forced-colors: active)`.
4. Minor: user-facing text. "Motion is reduced, so animation styles do not play." is acceptable STE but passive and does not say where to change it. Suggested: "Reduced motion is on. Animation styles do not play." The two adjacent fieldsets "Motion" and "Animation style" are easy to confuse; a one-line helper under "Animation style" would help. Not a defect against ASD-STE100 rules in the strict sense.
5. Minor: the input has both `aria-label` and a visible label with identical text (`motion-style-picker.component.ts:62-64`). It is redundant, so remove the `aria-label` and let the wrapping label name the radio. The test that asserts `aria-label` would change with it.
6. Minor: test gaps. No test for a hover-then-select sequence (defect 1), `animationcancel`, keyboard arrow selection, unique group names across two instances, or the Direction-aware label. The preview test dispatches a synthetic `animationend` and so cannot show that the class clears in a real browser.

## Five logic questions (short)

1. Silent failure: `setMotionStyle` persistence failures are swallowed by the service (`localStorage` try/catch, `setState`), so the UI shows the new style although it may not persist. Acceptable and outside B8; the picker cannot tell.
2. Unexpected user action: select a tile after hovering it and the preview does not play (defect 1).
3. Wrong output from data: none found; the value comes from the typed `MOTION_STYLES`.
4. Dependency failure: `matchMedia` missing is handled (optional call); `ThemeService` and `VSCodeService` injections are not optional for the picker, and `VSCodeService` is optional in the toggle (hidden if absent).
5. Missing: forced-colors fallback, direction demo.

## Verdict

REVISE for defect 1 (and ideally 3); defects 2 to 6 are optional. Everything else in B8 meets the stated criteria, and the Motion preference behaviour is intact.

## Re-review round 1

Review family: claude (implementer: codex)

Score: 8/10
Verdict: APPROVED (no blocking or serious defects; the three minor items below are optional)

Evidence: read `motion-style-picker.component.ts` and `.spec.ts` in full, the `theme-toggle.component.ts` integration (lines 299-301, 313-314), and `styles.css` lines 909-958 (`ptah-motion-stage`, `data-motion-dir`, `ptahMotionEnter`). `npm run verify -- -p @ptah-extension/chat-ui`: lint, test, typecheck 3/3 succeeded, exit 0 (0/3 cache hits, so a real run).

### Previous defects

- Prior 1 (stuck `previewing`, no replay): FIXED. Hover/focus animation (ts:34-37) is now separate from `.previewing` (ts:38-40). `selectStyle` (ts:95-103) removes the class, sets inline `animation: none`, forces reflow, removes the inline value, then adds the class. This cancels and restarts the animation even when hover or focus already runs the same declaration. `animationend` and `animationcancel` both clear the class (ts:62-63, 111-115), guarded by `target === currentTarget`.
- Prior 2 (direction demo): FIXED. The frame has `ptah-motion-stage` and `data-motion-dir` (ts:58-60), which matches `styles.css:912-919`. The direction alternates (ts:105-109).
- Prior 3 (forced colors): FIXED. A real `outline: 2px solid Highlight` on the checked frame (ts:41-46) replaces the box-shadow ring that forced-colors removes.
- Prior 4 (STE text): FIXED. "Reduced motion is on. Animation styles do not play. Use Motion above to change this setting." Short, active, and tells where to act. The Motion control is mounted next to the picker inside the same `@if (isElectron)` (theme-toggle:299-301), so "above" is always true.
- Prior 5 (redundant aria-label): FIXED. Each radio is named by its wrapping label ("Fade" etc.); the preview frame is `aria-hidden`; the fieldset legend names the group.
- Prior 6 (test gaps): MOSTLY FIXED. Added: hover/select/cancel sequence, direction alternation, labelled radios, unique group names, reduced-motion note and listener removal.

### State-machine walk-through (no stuck state found)

- Hover, then select: the inline `none` cancels the hover animation, the removal restarts it, and `previewing` is cleared on end. OK.
- Select, then hover again: after `animationend` the class is gone; hover re-triggers the hover rule. OK.
- Select while another tile previews: each tile has its own chip and class, so they are independent. OK.
- Hover ends mid-selection preview: `.previewing` keeps the animation, with no cancel event. OK.
- Hover ends mid-hover animation: the animation is cancelled, `animationcancel` fires, and the guard clears a class that is absent. OK.
- Reduced motion: the global rule only shortens duration (0.01 ms), so `animationend` still fires. If an animation never runs, the class stays but has no visual effect, and the next selection resets it.
- Destroy mid-preview: no timers or observers are held; the `matchMedia` listener is removed via `DestroyRef`. OK.

### Defects (all minor, optional)

1. Minor: the direction toggle fires only on the frame's `mouseenter` (`motion-style-picker.component.ts:60`) and again on select (ts:97). Hovering the label text or focusing by keyboard plays the preview without alternating. Hover then click flips the direction twice, so the click preview can repeat the previous direction. Suggestion: toggle on `mouseenter` of the label and on focus, and not on select, or document the behaviour.
2. Minor: in forced-colors the checked outline (ts:41-46) uses the same `outline` property as the focus-visible outline (ts:58), so a focused checked tile shows no separate focus indicator. Native arrow keys move focus and selection together, so the effect is small. Suggestion: use `outline-offset` 4px for the focus state or a border for the checked state.
3. Minor: test quality. `motion-style-picker.component.spec.ts:73` is titled "after hover" but a frame `mouseenter` cannot trigger CSS `:hover`. It also checks only the reflow call count and the final `style.animation === ''`, not the order none, reflow, restore. A regression that dropped the `animation: none` step would pass. Add an assertion that records the inline value at the time of the `offsetWidth` read (for example in the spy's getter). The keyboard test (spec:110) simulates the radio change by hand, and says so in a comment. This is honest but only weak evidence.

No new silent failure, race, leak or unvalidated boundary found. The animation appearance and forced-colors presentation still need the Electron visual check the report already requests.
