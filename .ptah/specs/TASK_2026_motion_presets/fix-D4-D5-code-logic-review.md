# Fix D4/D5 code logic review

Review family: reviewer claude, implementer codex.
Score: 6/10. Verdict: REVISE.
Scope: styles.css (MOTION section, vt-active rule), motion-presets.spec.ts, motion-stage.directive.ts/.spec.ts, theme-toggle.component.ts/.spec.ts, plus surface-view-transitions.ts for the class lifecycle.
Check run: `npm run verify -- -p @ptah-extension/ui,@ptah-extension/chat-ui` returned 6/6 succeeded, all cache hits (exit 0). Webview checks not run, as instructed. No live Electron run.

## Class lifecycle (`ptah-vt-active`) - OK

- Set only in `SurfaceTransitionTracker.track()` (surface-view-transitions.ts:68), and only for animated top-level surface changes (`shouldAnimateSurfaceChange`, :104).
- Removed only in `settle()` (:81), driven by `transition.finished` fulfilled or rejected (:71-74). The skip paths (pointerdown/keydown `skipTransition`) resolve or reject `finished`, so they remove it.
- Rapid double navigation: the superseded transition's `settle` returns early (`current !== transition`). The class stays until the latest transition settles, so it cannot stick.
- Reduced motion and in-surface changes never set it, so child route and tab motion is unaffected.
- A new surface change during an in-surface animation suppresses only entrances that start during the crossfade.

## Defects

1. **Serious (unverified): suppression is `animation: none !important`, so a late entrance can start when the class is removed.** styles.css:840. An element that still carries `.ptah-motion-enter` / `.ptah-pane-switch-enter` / `.inspector-stats-enter` when `settle()` removes `ptah-vt-active` regains `animation-name: ptahMotionEnter`. A CSS animation starts when its name goes from `none` to a name, so the entrance plays right after the crossfade (the double-enter this fix targets).
   - It depends on whether Angular `animate.enter` strips the class when it sees no animation at enter time. No test or evidence covers this. The CSS spec only regex-matches the source text.
   - Minimal fix: do not rely on `none`. Use `animation-duration: 0.01ms !important; animation-delay: 0s !important; animation-iteration-count: 1 !important;` so the animation finishes inside the suppression window. Alternatively strip the class on `settle`. Add an Electron or jsdom check that the computed `animation-name` is not restarted after removal.
2. **Moderate: the D4 test for CSS is a source-text regex** (motion-presets.spec.ts:10). It proves the rule exists, not that a child stage is still. Add a behavior test, for example mount a `.ptah-motion-enter` node in jsdom with the stylesheet, toggle the class and assert the computed `animation-name`. The same test would catch defect 1.
3. **Moderate: D5 is not demonstrated against real content height.** The spec places a synthetic 620px menu in a 1186x738 viewport (theme-toggle.component.spec.ts, "620px"). The real height with the Motion and Animation style groups was never measured (the report admits this).
   - The cap is now `100dvh - 16px` (theme-toggle.component.ts:62, :586), so the Motion controls sit below the glass section and are reachable without scrolling only if the content is at most about 722px.
   - Minimal fix: measure `panel.scrollHeight` in Electron at 738px, or move the two Electron groups above the glass/scene section if it exceeds the viewport.
4. **Minor: the removed 28rem cap also changes the non-Electron popover** (VS Code and TUI hosts get a taller menu on large windows). Gate the removal on `isElectron`, or accept it explicitly.
5. **Minor: `replay()` silently drops a legitimate in-surface replay requested during the roughly 380ms crossfade** (motion-stage.directive.ts:71, :73). This is acceptable per the decision (the root crossfade owns the window). Note it so a tab switch right after navigation is not reported as a bug.

## Checks against the brief

- Focus order: DOM order is unchanged (theme grid, then motion preference, then style picker), so it is logical. The `place()` fallback at small heights (:600-:609) keeps scrolling inside the capped panel, so the viewport-height cap is sane.
- Spec realism: the directive spec (motion-stage.directive.spec.ts:48-70) tests real class behavior, including the queued-replay case.

## Re-review round 1

Review family: reviewer claude, implementer codex

Score: 8/10. Verdict: APPROVED.

Defects 1-4 from the initial review:

1. Restart on class removal - FIXED. `apps/ptah-extension-webview/src/styles.css:840-844` only overrides duration (0.01ms), delay (0s) and iteration count; `animation-name` is untouched, so removing `ptah-vt-active` does not cause a none-to-named restart. Glass entrance name rules (lines 991+) still apply. The animation still runs and fires `animationend`, so Angular `animate.enter` completes. Leave animations (`.ptah-motion-leave`, line 962) are not suppressed: they run their normal 180ms and are removed promptly, under the frozen root snapshot (glass leaves are display:none). Reduced-motion rules (line 1015, 2979) use the same 0.01ms `!important` values; no conflict.
2. Behavior test - FIXED (partially strong). `motion-presets.spec.ts:9-52` mounts an element, toggles the real class and reads computed style plus parsed CSSOM declarations.
3. Electron motion groups above glass options - FIXED. `theme-toggle.component.ts:271-275` places them before the glass fieldset; DOM order equals visual order; `onDialogKeydown` (line 461) is keyed on role=tab / `.theme-grid` only, so keyboard behavior is unaffected. Spec at `theme-toggle.component.spec.ts:415` asserts the order.
4. 28rem cap for non-Electron - FIXED. CSS only caps Electron (lines 65-67, 216) and `place()` (line 590) keeps `rem(448)` otherwise; both branches tested (spec 415, 442).

Remaining defects:

- R1 (Minor) `motion-presets.spec.ts:36-47`: the computed-style assertions run only `if (during.animationDuration === '0.01ms')`; if jsdom does not resolve `:is()`/`!important`, they silently skip and only CSSOM text declarations are checked (the real cascade guard is the lane's manual Chromium check). Also the base `.ptah-motion-enter` rule is a hand-written stand-in, not the real one.
- R2 (Minor) Electron panel is now limited only by viewport height minus 16px (no 28rem cap), so on tall windows the popover is very tall; acceptable, scrolls via overflow-y-auto.
- Known/accepted: `motion-stage.directive.ts:71-73` drops an in-surface replay during the ~380ms crossfade.

Verify: `npm run verify -- -p ptah-extension-webview,@ptah-extension/chat-ui` exit 0, 6 tasks succeeded (6 cached).
