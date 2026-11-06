# Code Logic Review: rail-reorder-motion

Score: 7/10. Verdict: REVISE (1 blocking, 6 minor). Read-only review; no tests or builds were run.

Files read in full: `canvas-rail-flip.ts`, `canvas-rail-flip.spec.ts`, the diffs of `canvas-rail.component.ts`, `canvas-rail-card.component.ts`, `compact-rail-card.component.ts`, `app-state.service.ts`, plus the surrounding template and `implementation-notes.md`.

## Effect timing: confirmed correct

`capture()` does run before the rail's DOM update. In `@angular/core` 22.2.3 (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:6224`), `refreshView` runs the parent template first, so the signal inputs `tiles`, `states` and `collapsed` are already set. It then calls `runEffectsInView(lView)`, and only after that refreshes the embedded views and child components, which includes the rail's own `@for` view. So the effect sees the new `grouped()` value while the old DOM is still in place. That is the capture-before-refresh ordering the design needs.

The `afterNextRender({ earlyRead, write })` pair is also valid: `earlyRead` measures the new layout and `write` plays the animation.

## Defects

### 1. BLOCKING: scroll clamping or scroll anchoring produces a wrong start offset
- Where: `canvas-rail-flip.ts:9-14` and `:21-25`.
- Positions are stored in content space: `rect.top - origin + scrollTop`. The offset the animation needs is the viewport delta, `v1 - v2 = (c1 - c2) + (s2 - s1)`. The code ignores the `(s2 - s1)` term.
- Between `capture()` and `measure()` the DOM changes inside one task, so the user cannot scroll. The browser can still change `scrollTop` itself, in two ways:
  - **Clamping.** The list shrinks while the rail is scrolled to the bottom, for example a session finishing and leaving the group.
  - **Scroll anchoring.** Chromium/Electron adjusts the scroll offset when content above the anchor changes size.
- In both cases a card that stayed put on screen gets `delta = c1 - c2 ≠ 0` and visibly jumps by the delta before sliding back. This violates "no layout shift".
- The unit test at `canvas-rail-flip.spec.ts:16-33` encodes the content-space behaviour, so it would not catch this.
- Fix:
  - Drop the `scrollTop` term. Store and compare viewport positions (`rect.top - containerRect.top`).
  - Capture and measure share one task, so there is no user scroll to compensate for.
  - Update the spec accordingly.

### 2. Minor: every `grouped()` re-evaluation re-triggers capture and cancels animations
- Where: `canvas-rail.component.ts:517-534`.
- `grouped` depends on the `states` input as well as the order. Any new `Map` or `tiles` array identity re-runs the effect.
- Each run cancels the in-flight animations and, if the remaining offset is at least 1 px, starts a new 240 ms animation. The slide then restarts its easing and duration, so it drags out and looks jerky under frequent state updates.
- Fix: track a `computed` layout signature (group key plus the ordered tab ids per group) with value equality. Run the effect on that, not on `grouped()`.

### 3. Minor: `running` Map retains detached elements, and overwritten animations are lost
- Where: `canvas-rail-flip.ts:39-40` and `:3`.
- Cards recreated across `@for` groups leave their old element in `running` until `onfinish` fires. A detached target is not guaranteed to fire it, so the entry can persist until `cancel()`.
- If two `afterNextRender` callbacks run in one tick (a second CD pass), `running.set` overwrites the first animation without cancelling it. That animation then escapes `cancel()` and `capture()`. The second animation also replaces the first's transform instead of adding to it, so its start offset is wrong.
- Fix:
  - At the start of `capture()`, drop the entries where `!element.isConnected`.
  - In `play()`, call `running.get(element)?.cancel()` before `set`.
  - Bump a generation counter in the effect and ignore stale `earlyRead` and `write` callbacks.

### 4. Minor: an interrupted entry fade snaps to full opacity
- Where: `canvas-rail-flip.ts:13` (cancel) and `:35`.
- Transforms continue from the visual position, but a card mid-fade has its opacity reset to 1 when it is cancelled. Result: a pop. The acceptance criterion says interrupted animations continue from the visual position.
- Fix: read the computed opacity before `cancel()`, or let a fresh card finish its fade (`commitStyles` or skip the cancel for opacity-only animations).

### 5. Minor: late hydration fades in every card
- Where: `canvas-rail.component.ts:519-533`.
- `flipReady` becomes true after the first render. If tabs arrive after that (async session restore), `first` is empty, so every card is "fresh" and fades in on what is effectively the first render.
- Fix: when `first.size === 0`, skip playback. Or set `flipReady` only once the first non-empty capture has happened.

### 6. Minor: interleaved read and cancel in `capture()`
- Where: `canvas-rail-flip.ts:10-15`.
- Each `cancel()` invalidates style, and the next `getBoundingClientRect` then forces a recalculation. With many running animations on a long rail this causes repeated forced layouts.
- Fix: read all rects first, then cancel in a second pass.

### 7. Minor: light theme `anubis-light` readability is unproven
- Where: `compact-rail-card.component.ts:55-70`, `:197-201`; `canvas-rail-card.component.ts:93-95`, `:131-143`.
- Inactive cards and the collapsed button are now bounded only by a `border-base-content/10` hairline on `bg-base-100`. That is a weak boundary for a control.
- The composite active fill (22% primary into `b3`) is not covered by `state-ink-contrast.spec`. The implementation notes admit this. In `anubis-light`, where the primary is a bright teal, the state inks and text on that fill may drop below the 3:1 margin the old comment promised.
- Fix:
  - Add the composite fill as a surface in the contrast spec for both themes.
  - Consider `border-base-content/15-20` for inactive cards in the light theme.

## Non-issues checked
- Effect ordering relative to the view update (see above).
- First render, `collapsed()` toggles and reduced-motion: no playback.
  - `previousCollapsed` starts as `null`, so the first effect run never plays.
  - A toggle calls `cancel()` and skips `play`.
  - A missing `matchMedia`, as in jsdom, resolves to "animate allowed" without throwing.
- `Element.prototype.animate` guard in `play()`: jsdom is safe.
- Folded "finished" list: `isRendered()` skips `display:none` elements, so they are never measured or animated. Dependence on `finishedExpanded` is not tracked, which is fine.
- Keys are stable (`card:<tabId>`, `group:<key>`), so moving a card between groups (a new DOM node) slides instead of fading in.
- Group-header selector `:scope > h2, :scope > button` cannot hit a nested card button. A collapsed rail has no header, so nothing is selected.
- Destroy: `destroyRef.onDestroy` cancels all running animations. Pending `afterNextRender` hooks die with the injector.
- Scroll events never trigger the effect. Only transform and opacity are animated.
- Native `focus()` and keyboard moves: there is no `scrollIntoView` in the rail. `focus()` during a short transform offset is transient and harmless.
- `setConnected` messages are correct, and no other code was found depending on the old text.
- Card CSS: `:host(.rc-focused)` outranks `:host` and hover, so the active frame is not repainted by hover. The attention frame's inner card is reset to a transparent background.
- The `[class]` host binding removal is consistent with the `[class.rc-focused]` binding that remains.

## Test coverage note
`canvas-rail-flip.spec.ts` exercises the helper only, in jsdom. No component-level test proves that capture precedes the DOM refresh. Reasoning from Angular's source supports it, but a regression there would be silent.
