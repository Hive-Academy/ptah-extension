# Batch B6 code-logic review (Thoth child-route motion)

Review family: claude (implementer: codex)

Verdict: REVISE
Score: 6/10
Defects: 4 (1 serious, 3 moderate/minor)

Scope read in full: `libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts` (diff plus the activeTab/routeTab logic at 273-340, 400-411), its spec diff, `libs/frontend/ui/src/lib/motion/motion-stage.directive.ts`, and the motion CSS in `apps/ptah-extension-webview/src/styles.css:912-1010`. I did not re-run `npm run verify`. I relied on the batch report's passing result and my own read of the tests.

## Contract check

- Stage directive use is correct. `ptahMotionStage` with `[motionIndex]` sits on the inner div (`thoth-shell.component.ts:224-227`). The index is `THOTH_TAB_IDS.indexOf(activeTab())` (`:408`), so rail order sets the direction. The directive's `ngOnChanges` runs `setIndex` in the same change-detection pass as the `@switch`, before the leave class paints. The old panel therefore leaves in the new direction.
- Each `@case` body uses the literal `class="ptah-motion-panel" animate.enter animate.leave` form from the plan. `animate.enter` and `animate.leave` are element-level, so they fire once per panel insertion or removal. There is no router-event trigger, so nothing can fire twice.
- The component adds no CSS, and the glass exception stays in B1's CSS. No opacity is animated.
- Cleanup on destroy lives in the directive's `DestroyRef`. B6 holds no timers or listeners.
- Reduced motion: `styles.css:991-1000` hides `.ptah-motion-leave` and forces a 0.01ms animation duration, so the new panel appears at once. The leaving panel is removed without waiting for a long animation.
- Scope: B6 touched only the two files assigned in plan batch B6. The other modified files in the worktree belong to other batches.
- Rapid navigation: each switch creates a new panel and removes the old one. Overlapping leave panels are absolute, `pointer-events: none`, and removed after about 180ms. I found no stuck state. The tab component under a leaving panel stays mounted for that window, which is acceptable.

## Defects

1. SERIOUS: leave overlay misaligned by the stage's padding (`thoth-shell.component.ts:224`).
   - The stage div carries `px-3 py-6 sm:px-4 lg:py-8` and is `position: relative`, so it is the padding box for the leave overlay.
   - `.ptah-motion-leave` is `position:absolute; inset:0` (`styles.css:954-961`). That places the leaving panel at the stage's padding edge, not at the content box where the in-flow panel sits.
   - The old tab's content jumps left and up by 12-16px and 24-32px, and it widens, on the first frame of every switch. It is also `overflow:hidden`, so its edges are clipped at the padding edge.
   - Fix: move the padding onto the `.ptah-motion-panel` wrappers, or add an unpadded stage wrapper and keep the padded div inside the panel. This is only visible live in Electron. The batch report's own list of unchecked items (overlap, scroll position) hides it.

2. MODERATE: the test does not assert the animate wiring (`thoth-shell.component.spec.ts:348-387`).
   - It checks the `data-motion-dir` attribute and that a `.ptah-motion-panel` containing the tab element exists.
   - It never checks that `animate.enter` or `animate.leave` produce `ptah-motion-enter` or `ptah-motion-leave`.
   - It never checks that only one panel exists after a switch, because `expectPanel` uses `querySelector` and takes the first match.
   - It never checks `:scope > .ptah-motion-panel`, which is the selector the directive's `replay` relies on.
   - Removing the `animate.*` attributes would leave the test green.

3. MODERATE: the test's direction assertions do not prove ordering or same-pass binding (`spec:376-384`).
   - The initial `forward` assertion is the directive's default, so it is trivially true.
   - Direction is read only after `NavigationEnd` plus `detectChanges`. It does not show that the direction is already set when the old panel is removed, which is the plan's "same-pass binding rule".
   - There is no rapid-switch case, such as memory→gateway→skills in quick succession, and no reduced-motion case.

4. MINOR: initial panel animates on first insertion (`thoth-shell.component.ts:232-235`).
   - `animate.enter` also runs when the Thoth shell is first rendered. That overlaps with the top-level surface crossfade, so there is a double enter animation on entry to Thoth. The plan does not say whether that is intended.
   - Suppress it on first render, or document it as intended. I could not confirm the live behaviour.

## Five logic questions (brief)

1. Silent failure: if the stage or panel classes are not matched by CSS, the tabs still switch with no motion. Nothing signals it, and test 2 would not catch it.
2. Rapid clicking: handled, with no stuck state (see Contract check).
3. Wrong data: `indexOf` returns -1 only for an invalid tab id. `activeTab` is typed and the route param is validated at `:273-338`, so this is not a practical risk.
4. Dependency failure: nothing to fail except the missing B1 CSS, which leaves tabs working without motion.
5. Missing: padding handling for the overlay (defect 1) and a live Electron check.

## Re-review round 1

Review family: claude (implementer: codex)

Verdict: APPROVED. Score: 8/10. Blocking 0, Serious 0, Moderate 2, Minor 1.

Scope: thoth-shell.component.ts (whole template and class), thoth-shell.component.spec.ts (new tests), styles.css 912-990 (stage, leave, glass rules), motion-stage.directive.ts. I did not re-run verify; I relied on the lane's reported green run (3/3 tasks) and read the assertions myself.

### Previous defects

1. Stage padding vs `inset:0` leave panel: FIXED. The stage is now `class="w-full"` (component.ts:225) and the identical `px-3 py-6 sm:px-4 lg:py-8` sits on each panel (:231,236,241,246). Original padding (diff line `-<div class="w-full px-3 py-6 sm:px-4 lg:py-8">`) is unchanged in value, so the visible content offset is the same. The absolute leave panel (styles.css `.ptah-motion-leave`, `inset:0`) now spans the stage's full width with identical padding, so leaving and entering content share an origin. The leave panel has `overflow:hidden` and takes the stage's height, so a taller outgoing tab is clipped during the exit. That is acceptable and matches the preset design.
2. Spec asserts neither enter/leave classes nor a single panel: PARTIALLY FIXED, adequate. A single direct-child `.ptah-motion-panel` is asserted after every switch (spec ~367-411, rapid-switch test ~455-473). The enter/leave bindings are asserted only by regexing the component source (spec :231-245). See defect 1 below.
3. Direction test checks only the default: FIXED. The spec asserts forward, back and forward across cron, skills and gateway. It also asserts via MutationObserver that `data-motion-dir` is written before the old panel is removed, in both directions (~414-453), which is the property that makes the leave animation use the right sign. The rapid switch ends on `back` with one Skills panel.
4. First-render enter doubling: FIXED. `hasSwitchedTabs` stays false until a NavigationEnd whose tab differs from `activeTab()` (component.ts:339). The seeded shell, the `/thoth` redirect to a remembered tab (routeTab is seeded from the final snapshot, so `tab === activeTab()`) and the workspace-switch remount (constructor sets routeTab to the remembered tab before the replaceUrl navigation, so the later NavigationEnd compares equal) all keep the guard false. Later switches set it true before `routeTab.set` in the same synchronous block, so the new panel's enter binding evaluates true at creation. Re-entry to Thoth creates a new shell instance, so the guard resets with it. The flag is never cleared within an instance, which is correct, because every later switch should animate.

### Defects

1. Moderate: the enter/leave wiring test is a source-text assertion, not behaviour. `thoth-shell.component.spec.ts:231-245` reads the `.ts` file and regex-matches the template. It fails on whitespace or attribute reformatting and says nothing about runtime. It also cannot detect that `[animate.enter]=""` (empty string, component.ts:231 and the three siblings) is accepted by Angular without emitting a stray class or warning. The lane is right that jsdom lacks `getAnimations`. A sturdier substitute is to stub `document.documentElement.getAnimations` and assert the live `ptah-motion-enter` and `ptah-motion-leave` classes, or at least assert the first render carries no `ptah-motion-enter`. The existing assertions are meaningful for layout and direction but not for the class wiring. Keep as a follow-up, not a blocker.
2. Moderate: no test covers the guard's initial-render branch at DOM level, or the workspace-switch remount path (guard stays false when the constructor swaps to the remembered tab). The spec checks `hasSwitchedTabs()` flips false to true (~396,409) but never covers the remount case, which is the subtle one.
3. Minor: the layout assertion `stage().classList.contains('px-3') === false` plus panel `px-3`/`py-6` (spec ~383-391) does not check the `sm:px-4 lg:py-8` responsive classes. The first test covers them only through the source regex.

### Five-question summary

- Silent failure: none new. An empty-string enter binding degrades to no animation, which is the intended no-op.
- Unexpected user action: rapid switching ends on one panel (spec rapid test). Re-clicking the active tab returns early (component.ts selectTab).
- Wrong data: an unrecognised `:tab` falls back to the remembered tab through `routeTab() ?? thothActiveTab()`, and `indexOf` always resolves because both are valid ids.
- Dependency failure: a missing `getAnimations` means no animation, but the panel is still removed and replaced. CSS reduced-motion hides the leave panel (styles.css accessibility block).
- Missing: a live visual check in Electron remains with the visual reviewer, as the lane acknowledged.
