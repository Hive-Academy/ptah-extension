# Code Logic Review - canvas-render-followups

Scope: `git diff origin/fix/canvas-tile-leaks-and-pause` (commit 22b2b487 plus uncommitted lanes). Verdict: **REVISE** (no data-loss blockers; two a11y/behaviour regressions should be fixed or consciously accepted). Score 6/10. Tests not run; static review only.

## Blocking
None strictly. B-candidates below are rated Serious.

## Serious
1. **Reverse Tab skips Rewind** (message-bubble.component.html:~327 `@if (toolbarVisible())`). Rewind mounts only after focusin/pointerenter. Shift+Tab from the next focusable lands on Branch (the last tabbable in the bubble) and Rewind is never reached in that direction. Forward Tab is fine (Branch focusin mounts Rewind before the next Tab). Fix: render Rewind always but visually hidden (opacity-0 + focus:opacity-100), or lazy-mount only the heavy parts.
2. **Screen-reader browse mode cannot find Rewind** (same block). Before this change Rewind was in the a11y tree (opacity-0 does not hide). Now it exists only after pointer/focus. NVDA/VoiceOver virtual-cursor users never trigger either. Same fix as 1.
3. **inline-agent-bubble still has `(scroll)="onAgentScroll()"`** (inline-agent-bubble.component.ts:449) while the diff also adds the outside-zone listener (:384-392, :816). Handler runs twice per scroll and the in-zone binding still ticks CD per event, defeating the change. Remove the template binding. Not covered by lane-1's "five listeners".

## Moderate
- message-bubble.component.ts:536 `onToolbarFocusOut`: when `relatedTarget` is null (window blur, focused button removed) the guard sets focused=false, unmounting a focused Rewind and dropping focus. Only treat null as leave if `document.activeElement` is outside root.
- chat-transcript.component.ts:741-752 `ngZone.run` re-entry: component is OnPush and nothing marks it dirty, so `[pinnedToBottom]="isPinnedToBottom()"` is NOT re-evaluated by the run alone (the old `(scroll)` listener marked the view dirty). It is saved in practice because load-older prepend changes the messages signal in the same pass, so the input is fresh when the directive's effect reads it (transcript-prepend-anchor.directive.ts:83). Fragile; inject ChangeDetectorRef and `markForCheck()` inside the run, or make the pin a signal.
- Destroy cleanup reads viewChild signals (`tabContainerRef()` tab-bar.component.ts:~470, `scrollContainer()` chat-transcript.component.ts:~851). If the query is already cleared, the listener is not removed. Capture the element at setup (as compact-session and inline-bubble do). Low leak impact (element dies with component).
- canvas-tile `focused` input defaults `false` (canvas-tile.component.ts:432): any host that forgets to bind it gets paused animations plus a 600px window. Pausing `.animate-pulse`/`.loading` on unfocused tiles can make a live streaming tile look stalled; confirm with design.
- tab-bar setupScrollListener (tab-bar.component.ts:400) runs once; fine today, but not guarded against double-bind.

## Verified OK
- **Zone**: tab-bar `checkScroll` writes signals (hybrid scheduler schedules CD). Agent-monitor panel, lane directive, compact-session `isUserScrolledUp`, chat-transcript `savedScrollTop`/`lastScrollTop` are plain fields read only by handlers/effects, not templates. Listeners are passive with no preventDefault; DestroyRef cleanup present for panel, lane directive, compact, transcript. saveTabState timers (tab-manager.service.ts:2590-2610) call only `_doSaveTabState` (persist), no CD needed; clearTimeout works regardless of zone.
- **Render window**: setFocused disconnects the old observer before `connect()`; identity guard drops queued entries; no observer leak; inactive state only changes margin. Rapid flips re-create the observer cheaply (initial callback re-delivers all entries). Placeholder heights are kept in `heights`, so unmount does not shift scroll. Tail remains mounted (`tail()` checked before intersecting). Pin, load-older and prepend logic unchanged apart from the issue above.
- **ng-deep**: already used in canvas-workspace-grid with the same justification; acceptable. `:host(.tile-unfocused) ::ng-deep` selector is correct.
- **Assistant footer**: `ptah-copy-button` becomes a direct flex item of `.chat-footer`; `focus-within:opacity-100` preserves keyboard reveal. Layout equivalent assuming copy-button host is not `display:inline` with padding; visually verify.
- **tool-call-item separator**: before/after `flex-1 border-t` inside `flex items-center gap-2` is equivalent (Tailwind 3.4.19 emits `content:''` for before:/after:).
- **tool-call-header**: new `@if (!streaming && clickable) ... @else if (!streaming)` has identical branch truth table.
- **Textarea** (DaisyUI 4.12 `textarea-xs`: padding .25rem, line-height 1rem overridden by leading-snug): `min-h` of 1lh+0.5rem equals content+padding (border 2px excluded, harmless; it also overrides daisy's 3rem min-height). max 72px border-box caps ~3 lines. `field-sizing` needs Chromium 123+, fine for current VS Code/Electron; also removes stale inline height after send.
- **Backticks**: none inside any inline `template:` or `styles:` literal in the diff (only in comments and one JS template string in transcript-render-window.ts:699).

## Specs vs production
- chat-transcript spec calls `onScroll()` directly and dispatches real scroll events (good), but never asserts the OnPush input refresh, so the dirty-marking gap is invisible.
- message-bubble spec dispatches synthetic `focusin/focusout` with hand-built relatedTarget; it never tests Shift+Tab ordering, null relatedTarget, or a11y-tree presence, which is where the defects are.
- canvas-tile spec exercises a real injector chain with a probe: good model of production.
- No spec for the duplicate inline-bubble binding.

## Five questions (brief)
1. Silent failure: duplicate scroll binding hides that the zone win was not achieved; stale OnPush input.
2. Unexpected user action: Shift+Tab; screen-reader browse; window blur while Rewind focused.
3. Wrong answer: pinned flag input stale only if no messages change (low).
4. Dependency failure: no IntersectionObserver falls back to mounting everything (unchanged).
5. Missing: no a11y requirement stated for lazy Rewind; no test for tab-order.

## Round 2 - verification

Verdict: **APPROVE**. Static review of `git diff origin/fix/canvas-tile-leaks-and-pause`; tests not run.

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 reverse-Tab skips Rewind | Resolved | message-bubble.component.ts has no diff; the .html keeps only the assistant copy-button wrapper removal (:146-152) |
| S2 screen-reader access to Rewind | Resolved | Rewind is always rendered again (same revert) |
| S3 duplicate inline-bubble `(scroll)` binding | Resolved | No `scroll)` binding left in inline-agent-bubble.component.ts; listener bound outside the zone |
| M1 focusout with null relatedTarget | Moot | The lazy toolbar code is removed |
| M2 stale OnPush `[pinnedToBottom]` | Resolved | `pinnedToBottom` is a signal (chat-transcript.component.ts:277); the template reads it via `isPinnedToBottom()` (:775); no `ngZone.run` re-entry. Every signal read in the content-follow effects (:640-675) sits inside `untracked`, so the effects do not re-run on pin flips. |
| M3 cleanup reads viewChild | Resolved | The element is captured at setup (chat-transcript :744+, tab-bar.component.ts:~403); cleanup removes the listener through the captured element |
| M4 `focused` default | Resolved | `input<boolean>(true)` at canvas-tile.component.ts:~432 |

New defects: none found. Residual (minor): setupScrollListener is guarded by `scrollElement`, so a recreated scroll container would not be re-bound. The container is static in the template, so this is theoretical. The unfocused-tile pause of `.animate-pulse` and `.loading` may still make a streaming tile look stalled, which is a design call.
