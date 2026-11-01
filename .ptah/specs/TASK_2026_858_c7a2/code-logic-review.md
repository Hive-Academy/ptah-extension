# Code Logic Review - TASK_2026_858_c7a2 (B1 + B2)

Score: 7/10
Verdict: APPROVED
Review family: claude (implementer: codex)

Scope read in full: `transcript-motion.directive.ts`, `transcript-entrance.ts`, the `.chat-msg-item` block in `chat-transcript.component.{html,css,ts}`, the chat-view pane-switch change, the `styles.css` hunks, the stagger and directive specs. Not run: build, e2e, a real browser. Angular 22.2.3 runtime source was read to settle the creation-time question.

## Checks against the six requirements

1. Stagger on batch: OK. `planEntrance` (`transcript-entrance.ts:36-52`) gives indexes only to added ids in the last 6. Open batch, replay open batch and pinned append pass. Unpinned append and later replay batches do not stagger.
2. Leave: OK in logic. `ngOnChanges` sets `inert`, `aria-hidden` and `data-ptah-leaving` before the `@for` detaches the node (`transcript-motion.directive.ts:57-65`). The preorder hook of the scroller div runs before the nested `@for` update. Offscreen, replacement, suppressed and more than 6 leaves are cut. The collapse keyframe cancels the 0.75rem flex gap with `margin-block-start: -0.75rem` (`chat-transcript.component.css:41-45`), which is correct. `animate.leave` is a static class, as the lessons require.
3. Streaming: OK. Existing ids give no new entries (`added.length === 0`), so there is no replay. Angular evaluates `[animate.enter]` only at creation. I confirmed this: `convertAnimations` in the compiler puts the op in the create block (`compiler.mjs:10823-10829`). So the persistent map entry cannot replay on a later change detection pass.
4. Presets: OK. The component reuses the global `ptahMotionEnter`, `ptahMotionEnterGlass` and `ptahMotionLeave` keyframes. `data-glass` and `data-motion-style` are both set on `:root` (`theme.service.ts:279,296`). So the combined `:host-context([data-glass='on'][data-motion-style=...])` selector matches. Reduced motion uses `0.01ms` and never `animation: none`. `calc(min(var(--ptah-msg-i,0),5) * var(--ptah-stagger-step))` is valid CSS (number x time). The `html.ptah-vt-active .ptah-msg-enter` rule uses `!important` and beats the component rule (`styles.css:842-846`).
5. Pane switch: OK. `paneSwitching` is true for the pending and entering phases (`chat-view.component.html:62`). In `chat-view.component.ts`, `pendingEntranceTabId.set(null)` and `startEnter` run in the same synchronous turn, so there is no gap with no suppression. An inactive transcript, or a first pass after activation, is suppressed (`!active`, `!wasActive && active`).
6. Cap and window: OK. `slice(-cap)` limits the stagger to 6 rows, so the longest delay is 180 ms. A strict head prepend returns an empty map.

## Findings

1. Moderate - `transcript-motion.directive.spec.ts`, `chat-transcript.stagger.spec.ts`. The specs check directive state (`index()`, `enterClass()`), the `--ptah-msg-i` style and the leave attributes. jsdom does not run `animate.enter` or `animate.leave`, so the specs do not prove three things: the enter class is applied, the leave class waits for the animation, and the node stays in the DOM during the leave. The ordering claim "marks before detach" is proved only by reasoning. Fix: have the B3 e2e or the visual pass prove these in Electron. Add one assertion that a leaving node is still in the DOM with `data-ptah-leaving` right after the update.

2. Moderate - `transcript-motion.directive.ts:36-41`, `chat-transcript.component.html:42`. Entries never expire. An entry lives as long as the id is in the list. This is safe today, because `track slot.id` never re-creates a row. If a future change re-creates a row for a live id (for example `track` by index, or a wrapper `@if`), the row would replay its entrance with its old delay. Fix: remove the entries after the entrance window (cap x step + duration), or when `active` goes false.

3. Moderate - `chat-transcript.component.css:58-70`. Reduced motion and the glass cut use `display: none` on the leave class. Angular still reads the computed duration (180 ms) and waits for the fallback timer (`longest.duration + 50`, `_debug_node-chunk.mjs:14580`), because `animationend` never fires on a hidden node. So cut nodes stay in the DOM, inert and hidden, for about 230 ms. This is not a visible defect. But it is not the "near-zero duration" the plan states for leave, and a test that counts `.chat-msg-item` right after a removal sees stale nodes. Fix: for cut nodes set `animation-duration: 0.01ms` (or `animation: ptahMotionLeave 0.01ms`) instead of `display: none`. Then `animationend` fires at once.

4. Moderate - leaving nodes still contain `[data-ptah-transcript-message-id]` slots (`chat-transcript.component.html:50`). `TranscriptPrependAnchorDirective` (`MESSAGE_SLOT_SELECTOR`) and the slot observers may pick a leaving slot as an anchor for up to 230 ms. If a prepend lands in that window, the scroll compensation could use a collapsing node. Unverified. Fix: exclude `[data-ptah-leaving]` in the anchor query.

5. Minor - `transcript-motion.directive.ts:42-49`. Every `ngOnChanges` copies the map and calls `entrances.set(new Map)`. This includes every streaming chunk and every `pinnedToBottom` toggle. The cost is O(n) per chunk, and the new map object notifies the signal consumers for nothing. Fix: skip the `set` when the new map has the same entries.

6. Minor - `chat-transcript.component.css:48`. `interpolate-size: allow-keywords` with `height: auto` in a keyframe needs Chromium 129 or later. Electron is fine. On an older webview (the VS Code webview), `height` switches at 50% instead of tweening, which is a small layout jump. The cost is low and the host is not the priority. Note it only.

7. Minor - `chat-view.component.ts` (`wireSessionEntrance`). The effect reads `pendingEntranceTabId()` and writes it. This makes the effect depend on its own output and run once more per tab change. The second run is a no-op. Fix: read it with `untracked`.

8. Minor - process. `git diff main` shows the install-scope notice deletions. These come from main moving ahead, not from this task. Merge main before the PR so the diff stays clean.

## Five logic questions

1. Silent failure: if `animationend` never fires, Angular removes the node after a fallback timer; no node leaks (finding 3). The directive has no timers and no listeners.
2. Unexpected user action: removing messages while scrolled up leaves a cut (no animation), which is by design.
3. Wrong-answer input: an id that streams from a temporary id to a final id would count as remove plus add. The stagger spec covers the legacy and presentation paths for this.
4. Dependency failure: `getBoundingClientRect` on a `display:none` host gives zero rects. This case is already routed to a cut by `suppressed || !active`.
5. Missing: expiry of entries (finding 2) and a real-DOM proof (finding 1).

## Blocking: 0. Serious: 0. Moderate: 4. Minor: 4.
