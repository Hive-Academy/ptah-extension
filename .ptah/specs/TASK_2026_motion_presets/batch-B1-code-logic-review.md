# Batch B1 code logic review

Review family: claude (reviewer) vs codex (implementer)

Score: 7/10
Verdict: REVISE (one Serious finding, cheap to fix; everything else is sound)

## Findings

1. **Serious** - `apps/ptah-extension-webview/src/styles.css` (`@keyframes ptahMotionEnter`, ~line 905; glass override ~line 954).
   The glass rule only sets `--ptah-motion-enter-opacity: 1`. The enter animation is still `ptahMotionEnter`, whose `from` keyframe declares `opacity`. So a panel that is or contains `data-glass-surface` / `backdrop-blur` still runs an opacity animation (1 to 1) for 320 ms.
   - Failure: the binding rule is "no opacity animation on an element that is or contains glass". The investigation reports (router-view-transition-report.md:30, session-switch-report.md:45) say an opacity-animated ancestor changes the Backdrop Root boundary. A keyframed opacity property is also what browsers use to promote and animate an effect node.
   - A value of exactly 1 may keep Chromium from forming a Backdrop Root, but the CSS does not guarantee it, and nothing in the lane verified it (no Electron frames; B1 report "Not done").
   - Result if it does matter: glass panes sample a different backdrop during the entrance and snap at the end. This is the exact snap the glass rule was written to remove.
   - Fix: add a transform-only keyframe (`ptahMotionEnterGlass`, `from { transform: ... }` only). In the glass selector (`:is([data-glass-surface], [class*='backdrop-blur'], :has(...))`) set `animation-name: ptahMotionEnterGlass`. The `--ptah-motion-enter-opacity: 1` override then becomes unnecessary.
   - Extend `motion-presets.spec.ts` ("keeps opacity at one on glass entrances") to assert the glass rule switches to a keyframe with no `opacity`. The current assertion only checks the variable, so it passes with the defect.

2. **Moderate** - `styles.css` leave/enter overlap (`.ptah-motion-leave` z-index 1, 180 ms, over `.ptah-motion-enter` 320 ms) for the non-glass presets.
   - The leaving panel is on top and fades to 0 faster than the entering panel fades in. Around 90 ms the stacked coverage is roughly 0.4 + 0.6 x 0.4, about 0.65. About a third of the scene shows through, so the pane dims for a moment (no blank frame, no double image, but a dip).
   - Not a defect against the approved plan and the token durations are fixed. If it reads as a flicker in the Electron visual matrix, delay the leave's start or use `mix-blend-mode: plus-lighter` on the leave, or shorten the enter's opacity curve.

3. **Minor** - `styles.css` `.ptah-motion-stage { position: relative }` (~line 897).
   - It is a global (0,1,0) rule. A stage host that also carries a positioning utility (`absolute`, `sticky`) loses or wins by stylesheet order. The only current consumer is the `ptah-native-tab-group` tabpanel, which has just `outline-none`, so there is no live conflict today.
   - Pin this in the B3 consumers: do not put `ptahMotionStage` on hosts that are already positioned.

4. **Minor** - `apps/ptah-extension-webview/src/index.html:146-153`.
   - `has()` is a space-delimited exact match, so a stored value of `"fade rise"` (contains a space) is accepted and written as `data-motion-style="fade rise"`.
   - ThemeService then corrects it to Rise once Angular boots. This needs a hand-corrupted store and the effect is one boot of a no-op attribute (no selector matches it, so it renders as Rise). No action needed; mention only for parity completeness.

5. **Minor** - `motion-presets.spec.ts` is a string-contract test. It cannot catch cascade or specificity bugs (for example the `[data-motion-clone='pending']` play-state rule beating the `animation` shorthand on `.ptah-motion-leave` depends on source order). The order is correct today (pending rule at ~line 943 follows the leave rule). Optional: add an order assertion.

## Checked

- Selectors vs B2 API: `.ptah-motion-stage`, `.ptah-motion-panel`, `ptah-motion-enter` / `ptah-motion-leave`, `[data-motion-dir='back']` and `[data-motion-clone]` (`pending` and `running`) match `motion-stage.directive.ts:26,40,57,72-88` and `motion-route-stage.directive.ts:136-138,166`. The directive's `ptahMotionLeave` animation-name check (line ~151) matches the keyframe name. The B2 cleanup relies on `animationend` plus a cap timer (min 1500 ms); under reduced motion the clone is `display:none`, there is no animation, and the rAF `getAnimations` path disposes it, so there is no leak.
- Direction sign: `.ptah-motion-stage[data-motion-dir='back']` takes `--ptah-motion-back-sign`, which is -1 only for Directional. Enter x and leave x both flip, so back navigation is mirrored. All other presets keep sign 1.
- Defaults: `:root` carries Rise values (18 px / -10 px). The preset blocks come later in the file with equal specificity, so they win. An absent or unknown attribute therefore renders as Rise. There is no `none` preset and no `!important` in the new section (the test also asserts the slice).
- Durations come only from `--ptah-motion-out/in/switch/stagger` (180 / 320 / 380 / 36 ms), matching the tuning report.
- Overlap: the leave is absolute `inset:0` over the positioned stage with `forwards`, and the enter uses `backwards`, so there is no blank frame and no layout jump (overlap dip noted in finding 2).
- Glass selectors: the `:is([data-glass-surface], [class*='backdrop-blur'], :has(...))` grouping is valid CSS (`:has` is not nested in `:has`). It covers a panel that is glass or contains glass, and the clone (which carries the panel's classes). The glass exit is a cut (`display:none`, `animation:none`) with no opacity animation. The entrance defect is finding 1.
- Root view transition: `ptahPageIn` is opacity-only, old(root) is held opaque (animation none from the wildcard rule, `mix-blend-mode: normal`), and new(root) fades over 380 ms. There is no translate and no named elements, so the navbar, rails and dock do not move. The old `ptah-vt-surface` / `ptahPageRiseIn` rules are removed, and nothing else in `apps`/`libs` references them.
- Reduced motion: the leave and clone are hidden. The global block gives all animation durations 0.01 ms and sets `animation: none` on the view-transition pseudos, so the root crossfade and the enter animations collapse. No new rule overrides it.
- Persistence agreement: key `ptah-motion-style` is used identically in ThemeService (`theme.service.ts:72-79,388-398`, state first, then localStorage hint, default Rise, no boot write) and in the pre-paint script (`index.html:146-153`, exact name match, state-then-mirror, omits the attribute for Rise). The effect (`theme.service.ts:294-296`) removes the attribute for Rise. Invalid state falls back to a valid mirror in both. The parity spec covers the Electron and VS Code shapes for default, state, mirror-only, invalid-state-with-mirror, stored default and invalid values, and asserts no boot writes. There is no flash of a wrong preset.
- Setter: `setMotionStyle` ignores invalid values, and the localStorage write is guarded against storage failure. Storage failure in `vscode.setState` follows the existing scene and accent pattern.
- Not run: I did not run the tests or any visual check. I relied on the lane's reported verify results. Residual uncertainty: real Chromium glass sampling during the entrance (finding 1) and the dip in finding 2 need the Electron visual matrix.

## Re-review round 1

Review family: claude (implementer: codex)

Score: 9/10
Verdict: APPROVED (no Blocking or Serious defects; two Minor notes)

### Previous defects

- Serious (glass entrance still opacity-keyframed): FIXED. `styles.css:934` `@keyframes ptahMotionEnterGlass` has a `from` with `transform` only. `styles.css:968-970` selects it by `animation-name` on `.ptah-motion-panel.ptah-motion-enter:is([data-glass-surface], [class*='backdrop-blur'], :has(...))`. Specificity is 0,3,0 against `.ptah-motion-enter` at 0,1,0, so it wins. The `--ptah-motion-enter-opacity: 1` override is gone. Glass exit (`styles.css:981`) is `animation: none; display: none`, a cut. Matches user-decisions (glass = transform-only entrance + cut exit).
- Moderate (coverage dim ~0.65 at 90 ms): FIXED. Computed with `1 - (1-leave)*(1-enter)`, with the real easings (`--ptah-ease-soft` cubic-bezier(.22,.61,.36,1) on the enter, `--ptah-ease-gentle-in` cubic-bezier(.4,0,.2,1) on the leave; easing applies per keyframe interval):

  | t (ms) | leave | enter | coverage |
  | --- | --- | --- | --- |
  | 45 | 1.00 | ~0.62 | 1.00 |
  | 90 | 1.00 | 0.80 | 1.00 |
  | 135 | 1.00 | ~0.87 | 1.00 |
  | 150 | ~0.80 | ~0.93 | ~0.99 |
  | 165 | ~0.20 | ~0.94 | ~0.95 |
  | 180 | 0 | 0.94 | 0.94 |
  | 320 | gone | 1.00 | 1.00 |

  The minimum is about 0.94 (a 6% see-through for roughly 50 ms), not 0.65. Because the leave sits on top (`z-index: 1`) and is opaque until 135 ms, the dip is no longer visible.

### Other checks

- Stage selector specificity: `:where(.ptah-motion-stage)` (`styles.css:912`) has 0 specificity, so a host `absolute` or `sticky` utility wins. Consumers: `motion-stage.directive.ts:26` and `motion-route-stage.directive.ts` only add a class and attributes. `thoth-shell.component.ts:231-246` uses `animate.enter` and `animate.leave` classes on `.ptah-motion-panel` and sets no conflicting `position` on the panel. The `data-motion-dir` rule (0,2,0) still wins over the `:where` sign default. Not broken.
- Clone disposal under the glass cut: `motion-route-stage.directive.ts:167-176` disposes on rAF when no running `ptahMotionLeave` animation exists, so a `display: none` glass clone is not leaked. The 1500 ms cap timer is the backstop.
- Reduced motion: `styles.css:~993` hides `.ptah-motion-leave` and `[data-motion-clone]`; enter runs at 0.01 ms with `backwards` fill (no stuck opacity 0). The root view-transition is `animation: none`. OK.
- `!important`: none in preset rules (`git diff` shows only a pre-existing line in the reduced-motion root block). The spec asserts it, scoped to the preset slice.
- Preset coverage: fade, rise, slide-left, slide-right, scale and directional each define enter and leave variables (`styles.css:840-910`). They share the single enter and leave rules. `:root` (~line 47) supplies Rise, so a missing attribute behaves as Rise. Directional back inverts through `--ptah-motion-back-sign`. There is no "None".
- Glass enter overrides for fade (18px rise) and scale (6px) keep the entrance visible when opacity cannot be used.
- Tests: `motion-presets.spec.ts` asserts the 28% / 56.25% opacity stops, the leave hold at 75%, the glass keyframe without opacity, the glass selector naming it, the exit cut, reduced-motion hiding, a transform-free root crossfade, and no `!important`. These are CSS-text contract checks, not rendered behavior. That is acceptable given no browser runs here, and the visual matrix is still owed.
- Verification: I started `npm run verify -- -p ptah-extension-webview,@ptah-extension/core` from the worktree. It had not finished within the 10 minute foreground limit (the lock queue was busy). I rely on the report's passing runs (6/6 tasks) for those projects; I did not edit the code, so nothing changed since.

### Defects

1. Minor - `styles.css:981` with `:951`. A glass leave is cut at t=0 while a non-glass entering panel starts at opacity 0 and ramps to 0.8 by 90 ms. For a glass-to-plain switch, coverage dips to 0 at t=0 and the stage background shows for about 90 ms. This is a by-design consequence of "glass exit = cut" and cannot be selected from the panel alone. A later mitigation could start the enter at a higher `--ptah-motion-enter-opacity` when the stage has a glass leave (`:has`). Not blocking.
2. Minor - `motion-presets.spec.ts:19-35`. The overlap coverage guarantee is checked only as keyframe stops in text. No test guards the relation "leave opaque until the enter is at least 0.8". If either stop is retuned the text assertion will still pass. Add a numeric assertion or a visual-matrix frame check.

Not done and out of scope: frame-by-frame glass blur in Electron stays on the visual matrix (as the B1 report says).

## Review of follow-up for B4

Review family: claude (implementer: codex)

Verdict: APPROVED. Score: 8/10. Blocking 0, serious 0, moderate 1, minor 4.

Evidence: read `styles.css:920-1000`, `motion-presets.spec.ts` in full, `native-drawer.component.ts:62-230`, the B4 owners (`[isOpen]="true"` + `animate.leave` on the host in connectors-page, provider-list-view, installed-skills-page), and Angular's leave runner (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:4015-4070, 14528-14570`). `npm run verify -- -p ptah-extension-webview`: 3 of 3 tasks succeeded, exit 0. No runtime or frame check was possible (no build, serve or e2e).

### Check 1: drawer panel exit
- Angular's wait is on the HOST, not the panel. `animateLeaveClassRunner` listens for `animationend` on the host only and ignores events whose target is not the host (`:14538-14540`, bubbling panel events are dropped). It then reads `host.getAnimations()`, else computed styles (`determineLongestAnimation`, `:4033-4036`). The host carries the global `.ptah-motion-leave` rule (`styles.css:954-961`), so it has its own `ptahMotionLeave` animation of the same duration. `display: contents` still creates the animation and its `animationend`. If a browser did not, the computed-style path and the `duration + 50 ms` fallback timer (`:14562-14565`) still remove the host. So the node is retained for `--ptah-motion-out` and then removed. Result: the wait is correct, and the panel animation (`:965-967`) runs in parallel with the same duration and timing.
- The popover stays open: the drawer template is `@if (isOpen())`, and the B4 owners keep `[isOpen]="true"`, so the top-layer popover persists until the host is removed. The inherited `pointer-events: none` from the host also disables the panel and the backdrop click during the leave.
- Specificity: `ptah-native-drawer.ptah-motion-leave .ptah-drawer-panel` is (0,2,1). The component's own `.ptah-drawer-panel[_ngcontent]` slide-in is (0,2,0), so the global rule wins by the type selector. This works but is fragile and untested.
- The backdrop is untargeted. It snaps off when the host is removed (see defect 3).

### Check 2: glass scoping
- All four glass selectors are prefixed `:root[data-glass='on']` (`styles.css:975-990`). `data-glass` is set on the root, consistent with the glass surface rules at `:3069`. Non-glass themes now take the normal preset. Glass themes keep the transform-only entrance (`ptahMotionEnterGlass` has no opacity, `:934-938`) and the cut exit.
- The enter selectors beat the base `.ptah-motion-enter` (0,1,0) by a wide margin. The root-level `::view-transition` and `ptahPageIn` rules and the preview selectors are unchanged.
- The leave cut excludes `ptah-native-drawer` via `:not(ptah-native-drawer)`. This is needed: `display: none` on the host would remove the panel immediately.

### Check 3: `!important` and reduced motion
- No `!important` in the preset rules. The spec asserts this on the motion slice (`motion-presets.spec.ts:17`).
- Reduced motion hides `.ptah-motion-leave` (a `display: none` host, so the drawer is cut), which is acceptable.

### Defects
1. Moderate - `styles.css:965` with `:989`. The drawer host is exempt from the glass cut in every theme, including active glass with glass content inside the panel. The user decision is "glass exit = cut", and B4's request said to keep the cut in active glass. The panel is now faded with `opacity` from 75% to 100% of the exit. Any `backdrop-filter` descendant in the panel stops sampling for about 50 ms at that point (Backdrop Root). The panel and the sibling backdrop are glass-safe in themselves, but panel-internal glass is not guarded. Fix: if panel contents can hold glass, animate the panel with transform only under `:root[data-glass='on']` (add `--ptah-motion-leave-opacity: 1` for that selector, or use a glass leave keyframe). Alternatively, record a decision that the drawer is exempt. This was not verified at runtime.
2. Minor - `styles.css:979-986`. A selector tie: `:root[data-glass='on'][data-motion-style='scale'] ...` and `:root[data-glass='on'] [data-motion-style='fade'] ...` have equal specificity, and the later (scale) rule wins. With root style `scale` and a nested `fade` preview, a glass panel gets 6px instead of 18px. This only affects the nested preview in glass. Fix: order the nested rules after the root-level ones, or bump the nested specificity.
3. Minor - `styles.css:965`. The backdrop (`bg-black/60`, `backdrop-blur-[2px]`) has no exit and vanishes in one frame when the host is removed, so the panel finishes fading over a dim that then pops off. The panel also exits with the active preset (rise, -10px, fade) rather than sliding out, and a close during the 180 ms slide-in jumps from the identity transform. These are visual polish and are not checked without a render.
4. Minor - `motion-presets.spec.ts:43-49`. The test is text-only. It does not assert that the panel rule outranks the component-scoped base rule, or that the host keeps a leave animation (the retention contract). The line `expect(motion).toContain('.ptah-motion-leave:not(ptah-native-drawer)')` is already implied by the glass leave regex in the preceding test, so it adds nothing. A real-browser frame check is still needed.
5. Minor - the retention contract depends on every B4 owner keeping `[isOpen]="true"` until the host leaves. There is no guard, and it is only a note in the B1 report. Any owner that flips `isOpen` before removal cuts the exit silently. Track it in the B4 and G1 review.
