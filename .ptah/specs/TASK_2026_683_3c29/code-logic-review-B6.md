# Code Logic Review B6 - TASK_2026_683 (canvas motion)

Score: 8/10. Verdict: APPROVED. Blocking 0, Serious 0, Moderate 1, Minor 3.

Scope: `git diff` of the four canvas files, the whole of both components' relevant paths, the installed Angular runtime (`@angular/core` `_debug_node-chunk.mjs`, `@angular/compiler` `compiler.mjs`), and plan sections 7 and B6. No tests were run. I relied on the orchestrator's `nx typecheck,lint,test -p canvas` PASS.

## Checks asked for

### 1. Lane fade signal and rAF removed, nothing depended on them: PASS
- `fade` signal, its effect with rAF/cancel, `.rail-focus-fade`, `.rail-fade-start` and both bindings are gone (`canvas-lane-view.component.ts:51-64`, `:186`, `:279`). `signal` and `effect` imports are still used (`:232`, `:260`, `:283`, `:291`).
- The only remaining hits for `rail-fade-start` / `rail-focus-fade` are in `measurements/m0.json` (historical baseline) and the plan. Nothing under `apps/ptah-electron-e2e` and no other spec references them. `rail-fade-start` / `rail-focus-fade` are not used as selectors anywhere.
- The `rail-lane-enter` easing is now `var(--ptah-ease-soft)`. The token is defined at `apps/ptah-extension-webview/src/styles.css:41`.

### 2. `[animate.enter]="splitDisplayed() ? 'rail-pane-enter' : ''"": PASS with one visual concern
Angular semantics, verified in the installed source:
- A binding compiles to a creation-time `ɵɵanimateEnter(() => expr)` closure (`compiler.mjs:10550-10566`, `getAnimationOp`). It is not a per-CD update. The closure is evaluated once, when the queued enter animation runs (`runEnterAnimation`, `_debug_node-chunk.mjs:14040`), so there are no replays on later re-renders.
- `getClassListFromValue` turns `''` into an empty list, so `runEnterAnimation` does nothing (`:14048-14072`). Initial single-pane board creation is a no-op.
- It fires only for newly created sections. In `openBeside` (`canvas-rail-board.component.ts:613-638`) the existing section keeps its view because `@if (paneTab(side); as id)` stays truthy and `track side` is stable. Only the newly truthy side is created and animates. This holds for the normal case where the single pane is in the `left` host.
- Focus swap (`:456-458`), `activatePane` (`:598-611`) and `swapPanes` (`:679`) only change signals. No section is created, so there is no replay. Tab or workspace switch does not replay either, because `!visible()` collapses the split first (`:431-437`) and a remount is therefore single.
- Encapsulation: the section is in this component's own template, so it carries `_ngcontent-*`. The class Angular adds via `renderer.addClass` matches the emulated-scoped `.rail-pane-enter` rule, and the scoped `@keyframes` name is rewritten consistently in the same stylesheet. OK.

### 3. Reduced motion: PASS
The animation rule sits inside `@media (prefers-reduced-motion: no-preference)` (`canvas-rail-board.component.ts:85-87`). Under reduce, Angular adds the class, finds no running animation on the next rAF, and removes the class (`_debug_node-chunk.mjs:14064-14072`). The pane appears in one frame. The lane rule is gated the same way (`canvas-lane-view.component.ts:52-54`).

### 4. Rail shift and focus swap unchanged: PASS
The `data-canvas-focus-swaps` and `data-canvas-rail-shifts` host bindings are untouched (`canvas-rail-board.component.ts:78-79`). The e2e perf spec reads these attributes and the `rail-pane-container > section[data-pane-side]` selector, and both are intact.

### 5. New assertions can fail: PASS, with caveats
- Lane spec: `className` must equal exactly `'h-full min-h-0'`, which fails on the old `rail-focus-fade ... rail-fade-start` binding. The rAF stack filter for `canvas-lane-view.component.ts` does not match the spec's own file name (`...component.spec.ts`), so it is not self-triggering. It would catch the removed effect.
- Board spec: it regex-matches the source text and checks that `splitDisplayed()` flips false to true. It fails if the binding is removed or changed. It does not exercise the runtime value, which is the limit the plan accepts (jsdom has no `getAnimations`).

## Findings

### Moderate: translateX(8px) can extend the pane container's scrollable overflow during the 180 ms entrance
- File: `canvas-rail-board.component.ts:84` (keyframes), container at `:165` (`overflow-x-auto`).
- Scenario: Open beside in side-by-side mode. The new right pane starts at `translateX(8px)`. Transforms add to scrollable overflow, and the parent is `overflow-x-auto` (which also forces `overflow-y: auto`). On Windows Electron classic scrollbars a horizontal scrollbar can flash for 180 ms. That adds about 15 px of height to the container, so the panes resize mid-animation, which is a layout shift. The same applies to stacked mode, where the new pane is on the bottom edge of the `flex-col`.
- Impact: visible jank on the one animation this batch adds, contradicting the plan's "compositor-only, no shift" quality line (plan section 7).
- Fix: use an opacity-only entrance, `from { opacity: 0; }`, or translate toward the inside (`translateX(-8px)`, which does not extend scrollable overflow in LTR). Confirm in the S8 M1 frame strip that no scrollbar appears.

### Minor
- `canvas-rail-board.component.ts:630-633`: after `closePane` / `closeSplit` the survivor can sit in the `right` host (`:668`). A later `openBeside` then resets `activeSide` to left and flips to right. The animated (new) section is the `left` host holding the previously focused session, and the new session reuses the right host. The entrance plays on the old session, not the new one. It is cosmetic and follows existing host-per-side behaviour. Do not fix it in this batch.
- `canvas-rail-board.component.spec.ts:453-462`: the test reads the component source with a regex, so it is brittle. A reformatting of the attribute order fails it with no behaviour change. It also does not pin the `prefers-reduced-motion: no-preference` wrapper (`:85`), so CSS gating can regress unseen. Optional: add a `readFileSync` assertion that `.rail-pane-enter` is inside the media block.
- `canvas-rail-board.component.spec.ts:460-461`: `splitDisplayed()` goes true after `openBeside`, but this only restates the existing split behaviour and says nothing about the animation. The plan's required M1 frame-strip evidence (S8, with and without reduced motion) remains the only proof that the entrance runs.

## Five logic questions (short)
1. Silent failure: none new. If animations are unsupported (jsdom, old runtime) `animate.enter` is a no-op, which is the plan's accepted degradation.
2. User action: Open beside after Close pane on the right host animates the old session's pane (Minor above). Swap panes, focus swap and tab switch do not replay.
3. Input data: not applicable to a CSS/template change.
4. Dependency failure: if `--ptah-ease-soft` is undefined, the `animation` shorthand is invalid and the animation is dropped. The token is global in the webview `styles.css`, so this is fine in the app.
5. Missing: the M1 frame-strip evidence for S8, plus a check for the scrollbar flash above.

## Verdict
APPROVE. The one Moderate item is a one-line CSS change and does not block the batch.

Recommended follow-up: change the `from` keyframe to opacity-only, or to a negative translate, and read the S8 frame strip.
