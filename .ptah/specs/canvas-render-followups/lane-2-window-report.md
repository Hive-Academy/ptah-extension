# Lane 2 — tile-aware render window + unfocused-tile animation pause

Worktree: `.claude-worktrees/canvas-render-followups` (stacked on PR #645). Scope: Batch 2
(tile-aware render margin) + the animation part of Batch 4 (pause infinite animations in
unfocused tiles) + moving the chat-transcript scroll handler out of the zone. Focused tile
and single chat view are behaviourally unchanged.

## Changes

### 1. `SESSION_FOCUSED` token (chat lib)

- `libs/frontend/chat/src/lib/tokens/session-context.token.ts:35-44` — new
  `SESSION_FOCUSED: InjectionToken<Signal<boolean>>`, defined and documented next to
  `SESSION_VISIBLE` in the same style. Absent → treated as **focused** (single chat view,
  tribunal conductor, tests).
- `libs/frontend/chat/src/lib/services/index.ts:88` — re-exported in the existing
  `SESSION_*` block, so it flows through `src/index.ts` to `@ptah-extension/chat`.

### 2. Tile provides its focus state + unfocused marker

- `libs/frontend/canvas/src/lib/canvas-tile.component.ts:617` —
  `{ provide: SESSION_FOCUSED, useValue: this.focused }` in the child
  `EnvironmentInjector` (beside `SESSION_VISIBLE`), so the nested
  `ChatTranscriptComponent` resolves it through the tile's injector chain.
- `canvas-tile.component.ts:135-136` — host binding
  `'[class.tile-unfocused]': '!focused()'` (host metadata, so no focus wiring is needed
  inside tile content for the CSS half).
- `canvas-tile.component.ts:140-149` — scoped styles:
  `:host(.tile-unfocused) ::ng-deep .animate-spin, .animate-pulse, .loading
  { animation-play-state: paused; }`. Styling projected/child content with
  `:host … ::ng-deep` is this repo's established pattern
  (`canvas-workspace-grid.component.ts:183-185` styles gridstack internals the same
  way).

### 3. Tile-aware render margin

- `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-render-window.ts:10-17`
  — `RENDER_WINDOW_MARGIN_PX` stays `2000` (focused / non-tile); new
  `UNFOCUSED_RENDER_WINDOW_MARGIN_PX = 600`.
- `transcript-render-window.ts:60` — per-instance `margin` (default 2000); `connect()`
  (`:111`) and `seedMountSet()` now read it instead of the constant.
- `transcript-render-window.ts:119-138` — new `setFocused(focused)` (signature `:126`):
  no-op when the margin is unchanged; otherwise updates the margin and, when an
  observer exists, disconnects it and re-creates it (rootMargin is fixed per observer).
  The identity guard in `connect()`'s callback drops entries queued by the stale
  observer. While inactive only the margin moves — the next `setActive(true)` connects
  with the new value.
- `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:183-186`
  — optional `inject(SESSION_FOCUSED)`; `:693-698` — constructor effect wiring the token
  into `renderWindow.setFocused(...)`. Outside tiles the effect runs once and is a no-op
  (margin is already 2000), so the single view is untouched.

### 4. Transcript scroll handler out of the zone

- `chat-transcript.component.ts:248-249` — `scrollHandler` arrow field (same pattern as
  the Batch 1 precedent: `tab-bar.component.ts:247`, `agent-lane-scroll.directive.ts:21`).
- `chat-transcript.component.ts:761-769` — `setupScrollListener()`: native
  `addEventListener('scroll', …, { passive: true })` inside
  `ngZone.runOutsideAngular`.
- `chat-transcript.component.ts:699-711` — bound in `afterNextRender` BEFORE
  `setupResizeObserver()`, so a throw in one setup can't lose another's binding (the
  same defensive ordering the render-window attach already has).
- `chat-transcript.component.html` — the `(scroll)="onScroll($event)"` template binding
  (was line 11) is removed; the container's other bindings are unchanged.
- `chat-transcript.component.ts:728-755` — `onScroll()` (event param dropped): body
  unchanged except the two pin-state flips now run inside `ngZone.run(...)` — the flip
  must refresh the prepend-anchor's `[pinnedToBottom]` input, the only non-signal
  binding fed from this handler. `savedScrollTop`/`lastScrollTop` stay plain-field
  writes (their readers are effect/rAF paths that don't need the zone). Auto-scroll
  pinning, saved-offset restore and the older-history sentinel path are unchanged.
- `chat-transcript.component.ts:851-852` (cleanup) —
  `removeEventListener('scroll', this.scrollHandler)` on destroy (mirrors
  `tab-bar.component.ts:470-471`).

## How scroll jumps are prevented

The placeholder discipline is unchanged and covers the new shrink path:

- A bubble unmounted by the tighter margin unmounts only via an observer entry, and
  `handleEntries` records the last MOUNTED height on that leaving edge
  (`boundingClientRect` still describes the mounted bubble), so `placeholderHeight()`
  reserves the exact measured height — never the 120px fallback for anything previously
  rendered. Pinned by the new test "keeps measured heights when the unfocused margin
  unmounts a bubble".
- Bubbles beyond the old 2000px margin were already placeholder-reserved at their
  measured heights; the shrink only affects the 600-2000px band, all of which is
  mounted at the moment of the switch — so every newly-unmounted bubble gets a
  leaving-edge measurement.
- The streaming tail (`ALWAYS_MOUNTED_TAIL` + streaming ids) is exempt by id, so
  nothing mid-stream is torn down.
- `seedMountSet()` on re-connect only ADDS ids (never removes), so the mounted set can't
  blank while the fresh observer's initial callbacks are still in flight; removals
  arrive asynchronously with correct leaving-edge heights.
- Native scroll anchoring on the transcript container keeps absorbing estimate drift
  for never-measured messages, exactly as before (`PLACEHOLDER_FALLBACK_PX` contract).

## Visual risks for the reviewer

1. **Fast scroll in an unfocused tile**: 600px mounts fewer bubbles ahead of the
   viewport; a very fast flick can reach a placeholder region before the observer
   callback lands (placeholder shows, then the content swaps in at equal height). The
   research report already flags this for review ("fast scroll, tile resize").
2. **Frozen loaders in unfocused tiles**: `animate-spin`/`animate-pulse`/DaisyUI
   `.loading` elements freeze mid-frame in unfocused tiles — including a streaming
   turn's loader in a background tile. They resume on focus. If a frozen loader reads
   as "stuck", the selector list at `canvas-tile.component.ts:144-146` is the single
   knob.
3. **`::ng-deep` reach**: the pause applies to ALL descendant content of an unfocused
   tile, not just transcript bubbles (e.g. a mini-panel spinner). It cannot reach
   outside the tile; the focused tile and the single chat view are untouched.
4. **One-IO-delivery lag**: between `setFocused(false)` and the fresh observer's
   initial callbacks the wide mounted set lingers a few ms — no visual change, just
   delayed savings.

## Tests

New coverage:

- `transcript-render-window.spec.ts:114-170` — 600/2000 margins per focus, observer
  re-created (all slots re-observed, stale-observer entries dropped), focus change
  while hidden applied on the next activation, measured height preserved when the
  unfocused margin unmounts a bubble.
- `chat-transcript.component.spec.ts:319-343` — native passive listener pins/unpins on
  dispatched scroll events and detaches on destroy; `:433-439` — default margin 2000
  without a `SESSION_FOCUSED` provider; `:441-470` — 600 → 2000 across a focus flip
  (through the component's effect). Existing pin/restore tests updated to the new
  `onScroll()` signature.
- `canvas-tile.component.spec.ts:1152-1243` — a probe component renders the injected
  `SESSION_FOCUSED` end-to-end through the child injector, and the `tile-unfocused`
  host class toggles with the `focused` input.

Observed (Jest run directly, foreground, one at a time; `tail` unavailable on this
Windows shell, so `Select-Object -Last 6` was used):

- `npx jest -c libs/frontend/chat/jest.config.ts transcript --silent` →
  **11 suites / 117 tests passed**.
- `npx jest -c libs/frontend/canvas/jest.config.ts --silent` →
  **9 suites / 238 tests passed**.
- `npx tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit` → **2 × `error TS`**,
  both at `message-bubble.component.ts:317` — another lane's in-flight edit; I never
  touched that file; **0 errors in my files**.
- `npx tsc -p libs/frontend/canvas/tsconfig.lib.json --noEmit` → same **2 pre-existing
  errors** (canvas compiles chat sources through project references); **0 in my files**.

## Open items

- The `message-bubble.component.ts:317` type errors belong to another lane (explicitly
  out of my scope) and are the only thing keeping the tsc counts above 0.
- No visual/browser pass was possible here (no running webview): the two reviewer gates
  are fast scroll in an unfocused tile and frozen-loader perception, listed above.
- The brief said "~600" for unfocused tiles; shipped as exactly 600 via the named
  constant `UNFOCUSED_RENDER_WINDOW_MARGIN_PX` so tuning after visual review is a
  one-line change.

## Revision 1

Fixes for the three code-logic-review findings:

1. **Pin state is now a signal** (`chat-transcript.component.ts`). The round-1
   `ngZone.run` re-entry around pin flips did not mark the OnPush component dirty,
   so the prepend-anchor's `[pinnedToBottom]` binding was never refreshed by it.
   `pinnedToBottom` is now `signal(true)`; `onScroll` writes it with `.set(...)`
   (`chat-transcript.component.ts:~731-745`), the binding reads it through
   `isPinnedToBottom()` (`:~757-760`), and every internal read (stick-to-bottom rAF,
   activation restore, resize observer, effects) calls the signal. The zone re-entry
   is gone — a signal write from the outside-the-zone listener refreshes the binding
   through signal scheduling, which is exactly what the reviewer preferred.
2. **Cleanup uses the captured scroll element.** `setupScrollListener` captures the
   container into `scrollElement` when it binds (`:~763-773`); `onScroll` reads that
   captured element (no viewChild read per event), and `cleanup()` removes the
   listener from it (`:~844-848`) — viewChild signals read null in `ngOnDestroy`, so
   the old cleanup could silently skip removal.
3. **`focused` defaults to true** (`canvas-tile.component.ts:~413-419`). A host that
   does not bind `focused` now gets focused behaviour (wide render margin, live
   animations) instead of a paused, narrow-windowed tile. The workspace grid binds
   it explicitly, so real tiles are unaffected.

Spec updates:

- `chat-transcript.component.spec.ts:~319-352` — the native-listener test now asserts
  the pin flip on the REAL prepend-anchor directive's `pinnedToBottom()` input
  (queried with `By.directive`), not on a cast field, and proves detach by spying
  `removeEventListener` on the bound container across `fixture.destroy()`. The older
  pin tests read the signal via `WritableSignal` casts.
- `canvas-tile.component.spec.ts` — `mountFocused` accepts `undefined` (host does not
  bind `focused`) and a new test asserts an unbound tile is treated as focused
  (probe renders `true`, injector resolves true, no `tile-unfocused` class).

Verification (scoped to the two spec files touched by this revision; long checks not
re-run per instruction):

- `npx jest -c libs/frontend/chat/jest.config.ts chat-transcript.component.spec --silent`
  → 1 suite / 23 tests passed.
- `npx jest -c libs/frontend/canvas/jest.config.ts canvas-tile.component.spec --silent`
  → 1 suite / 42 tests passed.
