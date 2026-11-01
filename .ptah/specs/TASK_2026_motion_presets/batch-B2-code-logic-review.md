# Batch B2 code logic review (Stage directives)

Review family: claude (reviewer) vs codex (implementer)

Score 7/10. Verdict APPROVED. There are no Blocking or Serious findings.

## Findings

1. Moderate: `motion-route-stage.directive.ts` `createClone`. `querySelector(':scope > .ptah-motion-panel')` can match the clone.
   - A clone keeps the `ptah-motion-panel` class from `cloneNode(true)`. The stage's `replay()` (`motion-stage.directive.ts:72`) and `createClone` use the same unqualified selector.
   - Today the live panel precedes the clone in DOM order, because the outlet inserts its component right after `<router-outlet>` and the clone is appended last. That is why the selector works.
   - If an adopter puts the outlet after other siblings, or a clone is still alive when `replay()` runs, the stage can animate or clone the leaving node.
   - Fix: select `:scope > .ptah-motion-panel:not([data-motion-clone])`, and remove `ptah-motion-enter` from the clone.
   - The clone also inherits any in-flight `ptah-motion-enter` class. If the old panel was mid-entrance, the clone carries both animations.

2. Moderate: `motion-route-stage.directive.ts:104` (`onGuardsCheckEnd`). `disposeClone()` runs unconditionally, before the key check.
   - A running leave clone is killed by any later guard-passing navigation, even one that changes no key. Example: a query-param navigation 100ms into a leave. The plan only requires disposal on supersession of a pending navigation.
   - The effect is a visibly truncated leave animation, not a leak.
   - Fix: call `disposeClone()` only when `this.pending` was set, or when a new clone is created.

3. Moderate: tests do not cover plan items (d) and (f).
   - There is no fake-timer test for the completion fallback or the 1500ms hard cap. There is no `jest.getTimerCount() === 0` check after destroy.
   - There is no UrlTree-redirect test, and no assertion that a clone is `pending` and paused between `GuardsCheckEnd` and `NavigationEnd`. The clone tests mock rAF, so the real `getAnimations` path is untested.
   - The lifecycle code reads correct, but the claims "every timer is released" and "capped at 1500ms" are untested.

4. Minor: `native-tab-group.component.ts`. `activeIndex` is -1 when no tab is active.
   - Moving from -1 to 0 reads as `forward`, which is harmless.
   - If tabs are inserted or removed before the active one, the index shifts and the direction can flip, although the user did not move. This is cosmetic.
   - The tabpanel gets no `ptah-motion-panel` class and no replay key, so it has no visible effect until a later batch adds them. Existing behaviour is unchanged apart from the extra `ptah-motion-stage` class and the `data-motion-dir` attribute.

5. Minor: the hard cap runs from clone creation, as the plan says.
   - If the guard-to-`NavigationEnd` gap exceeds about 1.3s, the cap can cut a running clone short. This is acceptable and matches the plan.

## Checked

- **API against the plan**
  - Inputs, `exportAs`, host class, `setIndex`, `captureState`, `restoreState` and `replay` match the plan.
  - `MotionRouteStageDirective` uses `hostDirectives` and `inject(MotionStageDirective, { self: true })`.
  - `motionRouteKey` is required and `motionLeaveClone` defaults to false. `detailParamKey` and `MotionRouteKey` match.
  - `libs/frontend/ui/src/index.ts` exports the barrel.
  - `@angular/router` is added to the lib's `package.json` as a peer dependency.
- **Route direction before activation**
  - The hook is `GuardsCheckEnd` with `shouldActivate`, reading `event.state`.
  - A guard that returns false, or any other `NavigationCancel`, `NavigationError` or `NavigationSkipped` for the pending id, restores the prior state and disposes the clone.
  - A newer `GuardsCheckEnd` restores the earlier pending state first. A redirect arrives as a cancel followed by a fresh navigation.
  - Events with other ids are ignored.
  - `targetOutletRoute` resolves the outlet's depth correctly. A null key function result is a no-op.
- **Replay**
  - Replay is single-flight. Previous listeners and the rAF are released before the next replay.
  - Events are filtered by `target === panel` and `animationName === 'ptahMotionEnter'`, so bubbling child events are ignored.
  - The `getAnimations` rAF check cleans up when nothing runs.
  - `DestroyRef` clears the render ref and the cleanup.
- **Leave clone**
  - There is at most one clone. Creation disposes the previous one, and `dispose` is idempotent.
  - It removes both listeners, the rAF and both timers. Every exit path in the plan is covered: animationend/cancel, the no-animation check, the completion fallback, the cap, supersession, cancel/error/skipped, and destroy.
  - The clone gets `aria-hidden`, `inert` and `data-motion-clone`.
- **Durations and styling**
  - Durations are read from `--ptah-motion-out` at runtime. The only literals are the 1500ms hard cap and the +50ms slack, both specified in the plan.
  - There is no `!important`.
  - The directives never set opacity or inline animation styles. The glass cut and the paused state are CSS-only, left to B1. `styles.css` does not yet contain the `.ptah-motion-*` rules, which is a B1 dependency, not a B2 defect.
- **Reduced motion and jsdom**
  - With reduced motion or no animation, the rAF check disposes the clone and the enter class.
  - `getAnimations?.()` is guarded, and `afterNextRender` is a no-op on the server.
  - `getComputedStyle` is only reached inside browser navigation.
- **Existing callers of the native tab group**
  - Template and inputs are unchanged. I did not re-run tests, and relied on the coordinator's 3/3 verify.

## Re-review (round 1)

Review family: claude (reviewer) vs codex (implementer)

Score 8/10. Verdict APPROVED. No Blocking or Serious findings. I did not re-run tests and relied on the lane's 3/3 verify.

Fix check:
1. Finding 1 (selector and classes): fixed.
   - `motion-stage.directive.ts:72` and `motion-route-stage.directive.ts:131` both use `:not([data-motion-clone])`.
   - `motion-route-stage.directive.ts:137` strips `ptah-motion-enter` and `ptah-motion-leave` from the clone before re-adding the leave class.
2. Finding 2 (disposal only on key change): fixed.
   - `motion-route-stage.directive.ts:104-112`: a superseded pending navigation disposes its clone.
   - A same-key navigation returns before the second `disposeClone()`, so a running clone survives.
   - A key change disposes the old clone.
3. Finding 3 (missing tests): the lane reports fake-timer tests for the completion fallback, the 1500ms cap, destroy cleanup, UrlTree redirect and the paused state. I did not re-read the specs, and relied on the lane's verify.
4. Finding 4 (tab-group direction): fixed.
   - `native-tab-group.component.ts` tracks motion position with a `linkedSignal` keyed on tab ids.
   - Tab insertion or removal around the selection keeps the index, so direction does not flip.
   - A tab removal that selects a new tab keeps the previous direction.
   - `null` is passed to the stage when there is no active tab.

New-defect scan:
- Nothing new found.
- The motion index in the tab group is relative, not the literal tab index. Only direction is consumed, so this is fine.
- A same-key navigation leaves a running clone alive, but the clone cannot outlive its cap or completion timer.
