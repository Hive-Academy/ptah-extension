# Code Logic Review - Fix D3 (final scoped re-review)

Scope: `git diff` of `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts` and its spec. The prior review with the three Serious defects is `code-logic-review-fix-d2.md`.
Method: static reading of the component, spec, `canvas-lane-view.component.ts`, `chat-view.component.html`, the z-index inventory in `libs/frontend/chat`, `tailwind.config.js` and Angular's repeater source (`_debug_node-chunk.mjs:14710`). I did not run the spec; the writer and orchestrator report 10/10 and 11/11. Nothing was rendered in a browser, so layout and z-index claims are from the DOM and CSS chain, not from pixels.

## Summary

| Metric | Value |
|---|---|
| Score | 8/10 |
| Verdict | APPROVE |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 0 |
| Minor | 4 |

All three D2 Serious defects are closed in production terms. What remains is minor and does not justify another round.

## D2 defects, closed or not

### Defect 1: repeated rejection must produce a new text node, no render-forcing trick. CLOSED

- `canvas-detail-transcript.component.ts:122-127`: each rejection synchronously increments `noticeSequence`, sets the message and re-arms the timer. No microtask or `setTimeout` sits between clear and set.
- `:57`: `noticeKeys = computed(() => agentNotice() ? [noticeSequence()] : [])`. The array has a new element on every rejection, because the sequence changes even though the message string does not.
- `:42`: `@for (seq of noticeKeys(); track seq)` tracks by identity. The old view is destroyed and a new one created, with a new `<span>` and a new text node, in one change-detection pass.
- Zoneless check:
  - The template reads `noticeKeys()` and `agentNotice()`, so signal writes mark the OnPush view dirty and schedule a render.
  - There is no intermediate state to coalesce. The signals only ever move from `[n]` to `[n+1]`.
  - The sequence signal is what prevents the D2 failure, where the interpolation saw "msg" then "msg" and wrote nothing.
- The live region (`:41`, `role="status" aria-live="polite"`) is outside the `@for` and persists. A node inserted into an existing polite region is announced, which is the intended pattern.
- Spec (`spec.ts` diff, the `firstNotice`/`secondNotice` block): two `openLane` calls with one `detectChanges()` after the second. It asserts `secondNotice !== firstNotice` and `firstNotice.isConnected === false`. This would fail on a message-only signal, so it is not vacuous. It no longer calls `detectChanges()` between clear and set.
- Timing note: the first `detectChanges()` sits between the first and second rejection. That is fine, because a user click always gets a render before the next click.

### Defect 2: layout, visibility, pointer events, stacking. CLOSED (static)

- No layout space when empty:
  - The status div is `absolute inset-x-0 top-2` and is out of flow.
  - The host is `block h-full min-h-0 relative` (`:38`).
  - The overflow caused by the earlier trailing in-flow span (8 px permanent scroll in the `overflow-auto` lane host, `canvas-lane-view.component.ts:50`) is gone.
  - The `ptah-chat-view` height chain is untouched.
- Visible without scrolling:
  - The overlay is anchored to the top of the transcript host, which is `h-full` inside `div.h-full` inside `rail-focus-fade h-full` inside the lane host (`canvas-lane-view.component.ts:50,64,67`).
  - It stays within the viewport of the lane. The lane host scroll cannot move it, because the host never exceeds 100% of its parent.
- `pointer-events-none`: set on the container, and the `span` child inherits it. Clicks pass through to the chat-view strip below. The overlay never receives focus (a `div` and `span` with no tabindex), so it does not take keyboard focus.
- Stacking:
  - Nothing sits above the transcript inside it. The lane header (`CanvasFocusHeader`) is outside the transcript host.
  - The top of the chat view is the agent-origin banner, `ptah-session-stats-summary`, and the background tray. None of them uses positioned popovers. Stats uses native tooltips, and I found no `z-` classes in the summary or the tray.
  - The overlay is `z-10`. The `relative` host and the chat-view roots (`chat-view.component.html:1,3`) have no `z-index`, so they create no stacking context, and `z-10` competes only with ancestors.
  - Nearby positioned elements: `chat-view.component.html:269,326` (`z-10` resize handles, below the transcript area) and `chat-input.component.ts:163,176` (`z-10`, bottom). They do not overlap the top band.
  - Dropdowns that can open over the transcript are higher: `send-to-messaging` `z-30` and the file suggestions `z-50`. The tab bar's `z-50` is not inside the lane.
  - The new `relative` on the host does not re-anchor any existing absolute descendant, because the chat-view root is already `relative`.
- Cost: the notice covers about 28 px of the top of the stats strip, or the top of the compact card, for at most 4 s. This is cosmetic and by design.

### Defect 3: banned alpha class, contrast. CLOSED

- `:43` uses `text-base-content` and `bg-base-200`, with no alpha form. I found no `/NN` utilities in the file, so the `no-alpha-base-content` ratchet is satisfied for this file. The writer's report says the ratchet's only offender was `canvas-rail-card`, which the orchestrator has since fixed.
- WCAG contrast, recomputed from the `tailwind.config.js` values:

| Theme | Foreground on background | Ratio |
|---|---|---|
| anubis | `#e8e6e1` on `#1a1a20` (`:105`, `:103`) | about 13.9:1 |
| anubis-light | `oklch(23.574% ...)` on `oklch(93.982% ...)` (`:179`, `:177`) | about 13.9:1 |

  Both clear 4.5:1, and no alpha compositing is involved.
- The spec asserts `text-base-content` (`firstNotice.classList.contains('text-base-content')`).

## Other checks

- Timer count:
  - There is one timer. `showUnavailableNotice` calls `clearTimeout` before arming (`:123,126`).
  - The spec asserts `getTimerCount() === before + 1` after two synchronous rejections, so removing the clear would fail it.
- Cleanup:
  - The timer is cleared on a successful open (`:85-86`), on expiry (`:126`) and on destroy (`:113`, `DestroyRef.onDestroy`).
  - The spec spies on `clearTimeout` and asserts it was called with the armed handle after `fixture.destroy()`. The assertion would fail if the destroy hook were missing.
- Spec strength: it covers status presence and not `sr-only`, the DOM node replacement, clearing on success, the 4 s auto-clear while the region persists, and the destroy cleanup. The earlier `sr-only` assertion was replaced, not just weakened.
- Jest 30 is in use (`package.json`), so `jest.restoreAllMocks()` in `finally` affects only spies. It does not reset the module-level `jest.mock('ngx-markdown')` factory.

## Findings

### 1. (Minor) Dev-mode NG0956 console warning on every repeated rejection

- File: `canvas-detail-transcript.component.ts:42`.
- Scenario: `track seq` is identity tracking, and the whole one-item collection is recreated on each repeat rejection. Angular's `ɵɵrepeater` logs NG0956 in dev mode when the collection is fully recreated and the view is expensive to recreate (`_debug_node-chunk.mjs:14710`). The writer's report confirms it is emitted in the spec.
- Impact: dev console noise only; production is silent. The recreate is intentional.
- Fix, optional: add a short comment at `:42` stating the recreation is intentional. Or replace the `@for` with a keyed `@if` or `ngComponentOutlet` swap. Not worth a round.

### 2. (Minor) Layout and stacking guarantees are not pinned by the spec

- File: spec diff, the notice block.
- Gap: nothing asserts `pointer-events-none`, `absolute` or the empty-state size. A later "tidy-up" that makes the container `static` or drops `pointer-events-none` would silently re-open D2 defect 2 or block clicks on the stats strip. Only the class `text-base-content` is asserted.
- Fix: assert `status.classList` contains `pointer-events-none` and `absolute`, and that `status.offsetHeight === 0` with no notice. jsdom reports 0 for layout, so the class assertions are the practical option. Visual-reviewer should confirm the z-index and placement once in a real render.

### 3. (Minor) Spec timer assertions depend on incidental Angular timers

- File: spec diff, `timersBeforeRejection` and `scheduled.mock.results.at(-1)`.
- Scenario: `getTimerCount()` and "last `setTimeout` result is the notice timer" assume no other timer is armed between the signal write and the component's `setTimeout`. In `showUnavailableNotice` the signals are written before `setTimeout` (`:124-126`), and the zoneless scheduler may arm its own timer on the write. Today the notice timer is still the last call, and the spec passes.
- Impact: the assertions could become flaky if Angular's scheduling order changes.
- Fix: write the timer to a spy-able seam, or filter the spy calls by delay `=== 4000`.

### 4. (Minor) Post-destroy re-arm and one big `it`

- A late `openLane` after destroy (for example from a stale child) would arm a 4 s timer and set signals on a destroyed component (`:122-127`). The effect is a harmless 4 s timer and nothing else, and `childInjector` is destroyed in `ngOnDestroy`. A `destroyed` guard is cheap if wanted.
- The notice assertions are appended to the existing monolithic visibility `it`, with fake timers installed mid-test. A failure in the earlier part skips the notice checks. Splitting the test would be cleaner.

## Five logic questions

1. Silent failure: none found. A rejected click always produces visible and announced feedback, and a failed or a successful open both clear state.
2. Unexpected user action: clicking the same unavailable tile repeatedly re-announces and resets the 4 s timer, which is intended. Clicking an available tile clears the notice. The notice does not intercept pointer events.
3. Wrong-answer inputs: none. `open()` is compared with `=== true`, so any non-boolean result counts as a rejection, which is safe.
4. Dependency failure: if `CanvasDetailService` is absent (`detail` is optional), `undefined === true` is false and every click shows "not available yet". That is acceptable and unchanged from before.
5. Unspecified: no manual dismiss, and no behavior when the lane is switched away. The auto-clear bounds both to 4 s. `visible()` going false does not clear the notice.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH. Layout and z-index were verified by reading the CSS and DOM chain, not by rendering.
- Top risk: an unpinned layout contract (finding 2), so a future class change could reintroduce the layout-space or click-blocking problems.
- What a robust implementation would add: class and size assertions for the overlay, a delay-filtered timer spy, and a visual-reviewer pass on a real render of the split pane and compact card.
