# Implementation Plan - TASK_2026_683_3c29

Smooth, small, native motion for page navigation and for switching between live chat sessions,
with a stagger that starts where the user is looking. Read-only investigation; no source was
changed, nothing was built or run.

## Inputs and constraints

- Requirements used: `context.md` (this folder), `task.md`,
  `.ptah/specs/TASK_2026_629_c0b3/decisions.md` row 74 (file line 80),
  `.ptah/specs/TASK_2026_677_efcd/design-spec.md` 7.1-7.3 (lines 747-780), the TASK_2026_655 and
  TASK_2026_674 `context.md` files (resync paths), root `CLAUDE.md`.
- Corrections applied:
  - Revision round 1: `implementation-plan-review.md` (8 findings, see "Review response").
  - User decisions U1-U4 (2026-10-16), recorded under Decisions.
  - Revision round 2: `implementation-plan-review-r2.md` (new findings 1-2), resolved by user
    decisions U5 (visible-only cascade) and U6 (S7 in Electron only) and by moving the
    conditional F6/F7 fixes to their own batches B7/B8. The user approved the plan at the
    review cap; there is no third review round. See "Review response".
- Design handoff used: none for this task. CV-2.1 design-spec 7.1 is prior art. This plan
  changes two of its rules (header and composer fade, turn-item indexing). See Decisions D3, D4.
- Missing decision-critical input: there is no baseline measurement yet. It does not block the
  design: the motion design removes main-thread work and adds none. It does gate the two
  conditional batches (B7 for F6 scroll restore, B8 for F7 empty-state flash). The user approved the measurement
  (U4). Render-caused long tasks over 50 ms are reported here and fixed in a follow-up (U2).
- Installed versions (verified): `@angular/core` 22.1.7, `@angular/router` 22.1.7,
  `electron` 44.4.3 (`node_modules/electron/dist/version`). `@angular/animations` is not
  installed. The VS Code engine is `^1.100.0` (`apps/ptah-extension-vscode/package.json:16`).
- Both hosts load the same renderer build and the same global stylesheet:
  `apps/ptah-electron/project.json:7` (`implicitDependencies: ptah-extension-webview`) and
  `apps/ptah-extension-webview/project.json:28-29` (`src/styles.css`).

## Current state map

| # | Surface | Mechanism | Where (file:line) | What the user sees today |
| --- | --- | --- | --- | --- |
| 1 | VS Code page nav (Dashboard, Thoth, Tribunal, Tasks, Marketplace, Settings) | `AppStateManager.setCurrentView` -> `SurfaceRouterService.navigateToSurface` -> `router.navigateByUrl` | `app-shell.component.html:566-656`, `app-shell.component.ts:658-693`, `app-state.service.ts:1015-1026`, `surface-router.service.ts:128-155, 242-264` | Instant swap. The outlet box is shown or hidden (`app-shell.component.html:69-71`). The retained chat row gets `display:none` in the same pass (`retained-view.directive.ts:68-79`). There is no exit and no enter. |
| 2 | Electron navbar tabs (Canvas, Apps, Tasks, Tribunal, Analytics, Setup hub) | same router path | `electron-shell.component.ts:134-214, 498-521` | Instant swap. The content area is `ptah-app-shell` inside `#configurationSurfaceHost` (`electron-shell.component.ts:303-311`). Without a workspace, an `@if` switches between welcome and a bare `<router-outlet>` (`:266-274`). |
| 3 | Router config | `provideRouter(appRoutes, withComponentInputBinding(), withDisabledInitialNavigation())`, no `withViewTransitions` | `app.config.ts:179-183`; routes `app.routes.ts:78-195` | Chat is a component-less route (`app.routes.ts:87-95`), so chat and canvas are never in the outlet. They live in the retained row. |
| 4 | Child routes (Thoth tabs, Marketplace pages) | `loadChildren` trees | `app.routes.ts:141-160` | Instant. Out of scope, stays instant. |
| 5 | Chat tab switch (VS Code tab bar, sidebar session row in single mode) | `TabManagerService.switchTab` -> `ChatViewComponent.resolvedTabId` | `tab-bar.component.ts:321`, `app-shell.component.ts:860-866`, `chat-view.component.ts:775-778` | One `<ptah-chat-transcript>` per retained tab (LRU cap 8, `transcript-retention.service.ts:20`). Inactive ones are `display:none` (`chat-transcript.component.ts:276`). The CV-2.1 stagger plays (`chat-view.component.ts:1203-1243`, `chat-view.component.css:222-235`). See F1-F3. |
| 6 | URL follows the tab | `ChatTabRouteSync` replace navigations `/chat/<id>` | `chat-tab-route-sync.service.ts:130-213, 273-285` | Nothing visible today. With router view transitions it would cancel page transitions (F8). |
| 7 | Opening a session that has no tab yet | `SessionLoaderService.switchSession` -> `session:load` RPC -> `openSessionTab` -> `chat:resume` -> replay | `session-loader.service.ts:836-952, 989, 1090`; `tab-manager.service.ts:893` (new tab `status: 'loaded'`, `messages: []`) | Assumption F7: the empty-chat state can show briefly before the history replay starts. |
| 8 | Canvas rail focus (Electron's only chat surface) | `CanvasStore.focusTile` -> `ptah-canvas-focus-area [focusedTabId]` | `canvas-rail-board.component.ts:158-185`, `canvas-focus-area.component.ts:33-73` | The focus area re-renders in place. Its `@if (...; as id)` keeps the view. One `ChatView` per pane through `SessionEmbedComponent` (`session-embed.component.ts:39-43, 76-91`), Rail retention cap 4 (`transcript-retention.service.ts:21`). The lane view blanks and fades the pane (`canvas-lane-view.component.ts:52-57, 65-66, 286-292`) and the inner ChatView stagger plays too. See F4. |
| 9 | Split open ("open beside") | `@if (paneTab(side); as id)` creates the second `<section>` | `canvas-rail-board.component.ts:600-625, 158-196` | The new pane pops in. The survivor snaps to half width. |
| 10 | Swap panes | CSS `order` flip only | `canvas-rail-board.component.ts:662-673` | Instant. Stays instant (D7). |
| 11 | Activate the other pane in a split | focus only, no tab change | `canvas-rail-board.component.ts:585-598` | No motion. Stays this way. |
| 12 | Lane tabs (orchestrator / CLI / subagent lanes) | keyed `@for` on `tabId:laneKey`, `rail-lane-enter` 180 ms | `canvas-lane-view.component.ts:52-54, 71-72` | A small rise on lane change, already gated for reduced motion. Kept; the easing is aligned. |
| 13 | VS Code layout toggle (single <-> canvas) | `[class.hidden]` on two always-rendered panes | `app-shell.component.html:659-668, 805-839` | Instant. Not a router navigation. Stays instant (user decision U3). |
| 14 | Workspace switch (canvas) | Rail board `@if (visible())` rebuilds the board subtree | `canvas-rail-board.component.ts:73, 82` | The board is rebuilt. With the new design the first shown session cascades once. |

## Why switching feels abrupt today (findings)

- **F1 - the stagger likely hides what the user is reading.** Proven from source:
  - `playEnter` indexes `.st-t` in DOM order from the top of the mounted window, capping the
    index at 8 (`chat-view.component.ts:1223-1231`).
  - A turn can carry up to six `.st-t` items (`message-bubble.component.html:14, 71, 93, 116, 123, 163`).
  - The render window mounts messages up to 2000 px beyond the viewport
    (`transcript-render-window.ts:3-10`).
  - Items at index >= 8 share the maximum delay of 360 ms with `backwards` fill
    (`chat-view.component.css:227-230`).

  Inferred, depending on mounted item count and scroll position: in a long thread pinned to the
  bottom, the first eight indices fall on turns above the viewport. Most visible items then
  wait about 360 ms invisible and fade in together. This contradicts design-spec 7.1 ("Items
  already in view animate; content below the fold does not wait", `design-spec.md:750`). The
  exact visible delay is measured in M0 (`getAnimations()` delays of the items inside the
  viewport).
- **F2 - persistent chrome blinks.** The session header and the composer fade from opacity 0 on
  every switch (`.st-f`, `chat-view.component.html:35, 269`; `chat-view.component.css:222-225`),
  even though they never unmount.
- **F3 - extra main-thread work on every switch.** The switch frame runs a `querySelectorAll`
  over the whole transcript, writes a style per item, forces a synchronous layout
  (`void host.offsetWidth`) and then toggles a host class that invalidates style for the whole
  ChatView subtree (`chat-view.component.ts:1225-1235`).
- **F4 - canvas stacks two motions.** On every focus swap the lane view sets opacity 0 on the
  whole pane and clears it one `requestAnimationFrame` later (`canvas-lane-view.component.ts:286-292`):
  at least one blank frame, then a 180 ms transition. Inside that pane the ChatView plays F1
  as well (`chat-view.component.ts:1415-1416`: every host plays the stagger).
- **F5 - pages have no transition at all.** There is no `withViewTransitions` (`app.config.ts:179-183`).
  The retained row is hidden at once (`retained-view.directive.ts:68-72`).
- **F6 (assumption) - possible scroll jump.** `display:none` resets `scrollTop`, and the restore
  runs in a `requestAnimationFrame` scheduled from an effect (`chat-transcript.component.ts:1117-1125, 1300-1316`).
  If change detection itself ran inside a rAF callback, the restore lands one frame late and that
  frame paints at the top of the thread. M0 records the first three frames to confirm or rule out.
- **F7 (assumption) - empty-state flash.** A newly opened session gets an empty tab after
  `session:load` and before the replay starts. The replay flag is set only when the replay
  starts (`session-history-replayer.service.ts:485-490`). The transcript's empty state is not
  gated on that window (`chat-transcript.component.html:173-180`). M0's frame strip confirms
  this or rules it out.
- **F8 - design hazard for router view transitions.** The Router calls
  `document.startViewTransition` for every navigation (`node_modules/@angular/router/fesm2022/_router-chunk.mjs:3670-3712, 3976`).
  A second `startViewTransition` skips the running one. When the user returns to chat, the URL
  lands on a bare `/chat`, and `ChatTabRouteSync` immediately issues a replace to `/chat/<id>`
  (`chat-tab-route-sync.service.ts:175-178`). That second navigation would cancel the return
  transition. Tab switches navigate too (`:212`). The design below handles both.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| `withViewTransitions(options?)` exists; options are `skipInitialTransition` and `onViewTransitionCreated({transition, from, to})`. The callback runs in an injection context. | `node_modules/@angular/router/types/router.d.ts:121-146, 863` | Native router integration. No new dependency. |
| The Router starts the VT after resolvers and lazy chunks (`afterPreactivation`), activates routes inside the update callback, and resolves the callback after `afterNextRender` plus `setTimeout`. Without `document.startViewTransition` it falls back to `setTimeout`. | `_router-chunk.mjs:3670-3720, 3965-3990` | No blank frame while a chunk loads. Degrades safely in jsdom. A view transition starts for every navigation, so the callback must skip same-surface ones (F8). |
| `skipInitialTransition` sets the internal `skipNextTransition` flag. | `_router_module-chunk.mjs:1830-1840` | The boot navigation (`App.handleInitialView`, `app.config.ts:174-178`) does not animate. |
| `CREATE_VIEW_TRANSITION` / `VIEW_TRANSITION_OPTIONS` are not in the public typings. | `router.d.ts` (no match) | Do not override them. Customize only through `onViewTransitionCreated`. |
| `animate.enter` adds its classes when an element is CREATED and removes them on `animationend`, or after one rAF if no animation runs. `''` gives an empty class list (no-op). It is disabled when `document.documentElement.getAnimations` is missing. | `node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:4073-4076, 4200-4207, 14023-14078` | `animate.enter` cannot replay on retained or re-rendered views (transcripts, focus area), so it does not fit session switches. It fits newly mounted elements (split pane). It is a no-op in jsdom, which explains the TASK_2026_468 note. |
| `ANIMATIONS_DISABLED`, `MAX_ANIMATION_TIMEOUT` (4000 ms) tokens; TestBed `animationsEnabled` option. | `types/_debug_node-chunk.d.ts:43, 66`; `types/testing.d.ts:363-367` | No need to configure these. |
| `SurfaceRouterService.currentSurface` follows `NavigationEnd`; `navigateToSurface(..., {replaceUrl})`. | `surface-router.service.ts:78-89, 128-155` | The top-level surface id is the first primary segment. The skip rule compares that segment between `from` and `to`. |
| `openSurface` follows `currentSurface` in an effect. | `app-state.service.ts:568-590` | The Electron welcome/outlet `@if` changes after activation, inside the VT update window. |
| Retained chat row: hide = inline `display:none`, then a two-pass detach. | `retained-view.directive.ts:53-98` | The VT old-state capture happens before this runs, so the row is captured correctly. |
| Transcript host `[class.hidden]="!active()"`. `workActive = active && SURFACE_ACTIVE`. The vm is frozen while hidden. | `chat-transcript.component.ts:275-277, 323-327, 562` | The tab edge is the `active` input. A page return flips only `SURFACE_ACTIVE`, so no stagger replays on a page return. Re-showing a `display:none` subtree restarts its CSS animations, so a rapid A->B->A switch replays without a reflow. |
| The 6 trailing messages are always mounted, whatever the observer reports. | `transcript-render-window.ts:20-25` | A cap of 6 trailing messages is in the DOM on the switch frame with no IntersectionObserver wait. Not all six need be visible: when the transcript is pinned they are the bottom of the thread, and some can sit above the viewport. `isMounted` is therefore not a visibility test (review r2 finding 1), so the entrance selects by measured geometry instead (U5). |
| Every slot has a persistent `.chat-msg-slot` wrapper carrying `[ptahTranscriptSlot]`, whether or not its bubble is mounted. | `chat-transcript.component.html:35-44`; `transcript-slot.directive.ts:25-33` | Each slot wrapper has a real box on the switch frame, so `getBoundingClientRect()` on it is meaningful. `viewChildren(TranscriptSlotDirective)` is in DOM order, oldest first, so a reverse walk is newest first. |
| `afterNextRender(spec, options?)` accepts `earlyRead`, `write`, `mixedReadWrite`, `read`; `write` receives `earlyRead`'s return value. | `node_modules/@angular/core/types/core.d.ts:2720-2725` | One registration measures in `earlyRead` and marks in `write` within the same render pass. All reads precede all motion writes, so no extra layout is forced. |
| The activation scroll restore runs from an effect through `requestAnimationFrame`, i.e. after the tick's after-render phase. | `chat-transcript.component.ts:1117-1125, 1300-1316` | An `earlyRead` in the switch tick always sees the pre-restore `scrollTop`. The measurement must project the viewport onto the restore target (D11). |
| CV-2.1 forces a synchronous reflow on every switch. | `chat-view.component.ts:1234` (`void host.offsetWidth`), after a `querySelectorAll` over all mounted `.st-t` (`:1228`) | Both are deleted. The new pass reads geometry once, before its writes. |
| jsdom provides `DOMRect` and `DOMRectReadOnly`, but no layout (all rects are zero). | `node_modules/jsdom/lib/jsdom/living/interfaces.js:241-242` | The selection is a pure function tested with fake rects. Component specs stub `getBoundingClientRect` and the scroll metrics. |
| `pinnedToBottom` defaults to `true`; `savedScrollTop` is `null` on first show. | `chat-transcript.component.ts:394, 424` | Rule: stagger when pinned or on first show; otherwise do a single pane fade. |
| Existing motion tokens live only on component `:host` (`--ptah-ease-soft`, `--ptah-ease-gentle-in`). | `chat-view.component.css:125-128`, `chat-transcript.component.css:1-4`, used with fallback in `message-bubble.component.css:33, 42` | `::view-transition-*` pseudo-elements inherit from `:root`, so the tokens move to `:root` in `styles.css`. The `:host` copies are deleted. |
| The global reduced-motion rule zeroes durations but not delays, and `*` does not match `::view-transition-*`. | `styles.css:747-756`; design-spec 7.3 (`design-spec.md:776-778`) | Every staggered rule and every VT rule needs its own reduced-motion block, and the router must skip under reduced motion. |
| No spec pins `is-entering`, `data-st-i`, `playEnter` or `rail-fade-start`. | grep over `libs/frontend/**/*.spec.ts` (no hits) | Replacing CV-2.1 breaks no test. New specs are needed. |
| `webview-routing.spec.ts` pins the router features of `app.config.ts` with `toContain`. | `apps/ptah-extension-webview/src/app/webview-routing.spec.ts:979-995` | Add one assertion for the new feature. Adding the feature breaks nothing. |
| An Electron perf harness exists: long-task observer, CDP trace, session fixtures. | `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:49-79, 139-182`; `perf-session-fixture.ts:80, 164, 444` | M0/M1 reuse it. No new tooling. |
| Canvas exposes focus-swap and rail-shift counters as attributes. | `canvas-rail-board.component.ts:75-77`; `canvas-render-metrics.service.ts` | M0/M1 check `railShifts` delta 0 and `focusSwaps` delta per swap (decisions row 74). |
| Core routing barrel; tags `scope:webview`/`type:core`. | `libs/frontend/core/src/lib/routing/index.ts`; `libs/frontend/core/project.json` | The router feature goes in core routing, beside `SurfaceRouterService`. `chat` already depends on core, so the dependency direction is unchanged. |

## Architecture decision

- **Chosen approach.**
  - Pages use the Router's native View Transitions: `withViewTransitions`, wrapped by one small
    core feature function that skips same-surface navigations and reduced motion, plus a
    root tracker so `ChatTabRouteSync` does not cancel a running page transition.
  - Session switches keep the existing switch edge (ChatView `resolvedTabId`).
    - The transcript takes its entrance snapshot at one deterministic boundary: the first
      after-render pass after the tick in which `entering` rose, provided the transcript
      is then `workActive()`. By then its template has rendered the unfrozen vm.
    - That pass is one `afterNextRender({ earlyRead, write }, { injector })` (U5). `earlyRead`
      measures the newest viewport-visible slots (at most six) and returns their ids;
      `write` marks them through `Renderer2`, oldest visible first, so the first visible
      message gets index 0. The slots come from `viewChildren(TranscriptSlotDirective)`: no
      document query, no IntersectionObserver, and no layout forced by a write before a read.
    - The selection is a pure, transcript-agnostic function in its own file
      (`transcript-entrance.ts`, `selectVisibleEntrance`).
    - Persistent chrome stays still.
  - Canvas drops its duplicate pane blank. Only a newly mounted split pane uses native
    `animate.enter`.
- **Rationale.** View Transitions are the only native way to get an old-out/new-in page
  cross-fade when the old view is destroyed (routed surfaces) or detached (retained row). The
  Router already starts them at the right moment, after the chunk loads. Session surfaces are
  reused or retained views, where `animate.enter` never fires (`_debug_node-chunk.mjs:14023-14078`).
  An entrance set that is frozen once, at the first settled active render after the switch, and
  capped at six visible slots costs about 1 + 7 rect reads plus at most 18 DOM writes. These run
  in the same task as that render, so before the first paint (the after-render hooks of a tick
  run inside the tick).
  Streamed, replayed or resynced items can never be re-animated: slots that appear after that
  pass are never marked, and the pass runs once per rising edge.
- **Rejected alternatives.**
  1. `document.startViewTransition` around session switches (tab switch, rail focus). The VT
     must start before the state write, so every entry point would need wrapping
     (`TabManagerService.switchTab`, `CanvasStore.focusTile`, keyboard paths, notifications) and
     the write would become asynchronous by one capture frame. Callers that read `activeTabId()`
     synchronously would break. Input would also be paused for the length of the transition, and
     a full-pane snapshot of a live stream would be captured. The user chose the cascade (U1).
  2. An `animate.enter` cascade on transcript items. It never fires for retained or re-shown
     transcripts or for the in-place focus area. Forcing a remount with a keyed `@for` would
     rebuild the whole transcript on every switch, which is the cost row 74 tries to remove.
  3. A custom `CREATE_VIEW_TRANSITION` provider. It is a private router token (not in
     `router.d.ts`).
  4. `@angular/animations` route animations. The package is deprecated, not installed, and the
     task forbids it.
  5. `Element.startViewTransition` (scoped VT). Assumption: not shipped in every host Chromium
     we target. It needs no design today, and swapping it in later is local to the core feature.
- **Assumptions (each with its check).**
  - A1: `document.startViewTransition` exists in the Electron 44 renderer and the VS Code
    1.100+ webview iframe (Chromium 111+). Check: M0 records `typeof document.startViewTransition`
    and `process.versions.chrome`. If it is absent, the Router falls back by itself
    (`_router-chunk.mjs:3677-3680`), so nothing breaks.
  - A2: `::view-transition { pointer-events: none }` lets clicks during the 200 ms transition
    reach the live DOM.
    - Check: M1 S7 records click receipt during a transition in Electron (U6). The VS Code
      host is a follow-up; until then it is unmeasured there.
    - Fallback if it fails: `SurfaceTransitionTracker` installs one capture-phase `pointerdown`
      and `keydown` listener on `document` for the app's lifetime. While busy, it calls
      `skipTransition()` on the active transition, so the overlay is gone before the event's
      default action. It is released on destroy.
  - A3: Custom properties from `:root` resolve inside `::view-transition-*`. Check: computed
    style in DevTools during a transition.
  - A4: jsdom (cssstyle) round-trips `style.setProperty('--i', ...)` through
    `getPropertyValue('--i')`. Check: the first transcript spec. Fallback: the same pass also
    writes `data-enter-i`, and the spec asserts that.
  - A5: F6 and F7 are real. Check: M0 frame strip and first-frame scroll samples. Neither fix
    ships without that evidence; each is its own batch (B7, B8), run only if M0 confirms it.
  - A7: projecting the viewport onto the restore target (D11) predicts the post-restore visible
    set. It holds when no slot height changes between the switch tick and the restore rAF.
    Check: M1 records, per switch, the `getAnimations()` delay of the first message inside the
    viewport; it must be 0 ms. If it is not, B7 (moving the restore into the same render pass)
    becomes required rather than conditional.
  - A6: `skipTransition()` called in the same task as `startViewTransition` prevents the
    old-state capture. The installed Router calls `document.startViewTransition` first and
    `onViewTransitionCreated` synchronously after it (`_router-chunk.mjs:3685-3713`). The
    capture runs at the next rendering opportunity.
    - Check: M1 trace shows no view-transition capture paint for a same-surface navigation.
    - If it does: the cost is one capture frame per tab-switch URL replace, and that is
      reported.
- **Effect on existing code.** Replaced: CV-2.1's `wireSessionSwitchStagger`, `playEnter`,
  `clearEnterTimer` / `_enterTimer`, the `.st-f` / `.st-t` rules and markers, the canvas lane
  `fade` mechanism, and the duplicate `:host` easing tokens. Left alone: the banner, fade and
  inspector `animate.enter` uses, replay motion suppression (`chat-transcript.component.ts:1095-1116`),
  the render window, retention, the resync paths (TASK_2026_655/674), the outlet wrapper markup,
  retained-row semantics and the routes.

## Motion spec

Tokens, added to `:root` in `styles.css` (the `:host` copies are deleted):

| Token | Value | Source |
| --- | --- | --- |
| `--ptah-ease-soft` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | moved from `chat-view.component.css:126` |
| `--ptah-ease-gentle-in` | `cubic-bezier(0.4, 0, 0.2, 1)` | moved from `chat-view.component.css:127` |
| `--ptah-motion-out` | `120ms` | new; exits |
| `--ptah-motion-in` | `200ms` | new; entrances |
| `--ptah-stagger-step` | `28ms` | new; per-item delay |

| Surface | Animates | Stays fixed | Timing | Stagger | Reduced motion |
| --- | --- | --- | --- | --- | --- |
| Page change, VS Code (whole page is the surface) | `::view-transition-old(root)` and `-new(root)`: opacity cross-fade | -- | both 180 ms `--ptah-ease-soft`. They are symmetric so identical pixels do not dip. | none | The feature calls `skipTransition()` right after the Router creates the transition (A6); CSS `animation: none` on all `::view-transition-*` |
| Page change, Electron | named group `ptah-surface` (content host): old fades out, new fades in and rises 4 px. Root cross-fades symmetrically. | navbar, workspace sidebar, git dock (root pixels unchanged, so a symmetric cross-fade is invisible) | old 120 ms `--ptah-ease-gentle-in`; new 200 ms `--ptah-ease-soft` | none | same |
| Same-surface navigation (`/chat` -> `/chat/<id>`, Thoth tab, Marketplace page) | nothing (`skipTransition()` in the creating task, A6). `remountActiveSurface` does not navigate (`surface-router.service.ts:207-215`), so it never creates a transition. | everything | -- | -- | -- |
| A new page navigation while a page transition runs | The new `startViewTransition` skips the running one, which jumps to its end state. The new one animates from the current DOM. The tracker follows the latest. | -- | -- | -- | -- |
| Session switch, pinned to bottom or first show | the newest at most 6 viewport-visible messages (`.chat-msg-slot` wrapper, U5): opacity 0 -> 1, translateY 6 px -> 0 | session header, composer, tab bar, rail, focus header, lane tabs, every message outside the viewport or beyond the cap (no delay, no fade) | 200 ms `--ptah-ease-soft`, `animation-fill-mode: backwards` | `--i` = 0 for the oldest visible message of the set up to 5 for the newest; delay `--i * --ptah-stagger-step`, max 140 ms; total <= 340 ms. One tall reply filling the viewport gets `--i` 0 and no delay. | `animation: none; animation-delay: 0` |
| Session switch, user had scrolled up (restored offset) | the transcript scroller only: opacity 0 -> 1 | as above | 160 ms `--ptah-ease-soft` | none | none |
| Session switch, inspector rows (`.st-r`) | existing translateX 8 px fade | -- | 200 ms; delay `60ms + min(--i, 6) * --ptah-stagger-step` | existing `--i` (`session-inspector.component.html:31-76`) | existing block, kept |
| Canvas focus swap | the same transcript rule (via the embedded ChatView) | the pane, its focus header, lane tabs (the lane-view pane fade is removed) | as above | as above | as above |
| Canvas split pane appears | the new `<section data-testid="canvas-tile">` via `animate.enter`: opacity 0 -> 1, translateX 8 px -> 0 | the surviving pane (it resizes instantly, no leave animation, D7) | 180 ms `--ptah-ease-soft` | none | gated with `prefers-reduced-motion: no-preference` |
| Lane switch | existing `rail-lane-enter` | -- | 180 ms; the easing changes from `ease-out` to `--ptah-ease-soft` | none | existing gate |

Rules that apply everywhere:

- Only `opacity` and `transform` animate.
- Nothing animates on a stream delta, a resync, a replay or an older-history prepend.
- No element is held invisible for more than 140 ms.
- No motion moves focus or changes the accessibility tree. The DOM swaps inside the Router's
  update callback, exactly as without a transition. So after a page change,
  `document.activeElement` and the focus restoration must match M0 (M1 S7). That covers both
  pointer and keyboard routes, and the Electron remount focus path
  (`electron-shell.component.ts:440-462`).

## Component specifications

### 1. Surface view-transition feature (core routing)

- Purpose: turn on the Router's View Transitions for top-level surface changes only.
- Responsibilities:
  - `withSurfaceViewTransitions(): ViewTransitionsFeature` returns `withViewTransitions({ skipInitialTransition: true, onViewTransitionCreated })`.
  - The callback calls `transition.skipTransition()` when `shouldAnimateSurfaceChange(from, to, prefersReducedMotion())` is false. Otherwise it hands the transition to `SurfaceTransitionTracker.track`.
  - `shouldAnimateSurfaceChange(from: ActivatedRouteSnapshot, to: ActivatedRouteSnapshot, reducedMotion: boolean): boolean`
    is a pure function: `!reducedMotion && surfaceOf(from) !== surfaceOf(to)`.
  - `surfaceOf(root) = surfaceIdFromSegment(root.firstChild?.url[0]?.path)`. This is the first
    primary URL segment that the top-level route consumed, normalized by the same function
    `SurfaceRouterService` uses (`surface-router.service.ts:227-236`;
    `libs/shared/src/lib/types/webview-surface.types.ts:147-149`). It does not use
    `routeConfig.path`. Why it holds for every top-level route shape in `app.routes.ts:78-195`:
    - Each top-level route has a single-segment `path` equal to its surface id, so it consumes
      exactly that segment. This covers component-less `chat` with its empty-path and `:tabId`
      children (`:87-95`), component routes, `loadComponent` routes, and the `loadChildren`
      trees `thoth` and `marketplace` (`:141-160`).
    - The `''` and `**` redirects (`:193-194`) are applied before the target snapshot is built,
      so `to` already sits on `chat`.
    - Matrix parameters are not part of `UrlSegment.path`.
    - An empty `from` (pre-boot `/`) normalizes to `chat`. That navigation is the skipped
      initial one anyway.
  - `prefersReducedMotion()` is guarded with `typeof matchMedia === 'function'`.
- Verified contracts and entry points: `withViewTransitions`, `ViewTransitionsFeatureOptions`,
  `ViewTransitionInfo` (`router.d.ts:121-146, 863`). `from` and `to` are the root snapshots
  (`_router-chunk.mjs:3976`). Feature type `ViewTransitionsFeature` (`router.d.ts:781`).
- Dependencies: `@angular/router` only. Core -> router is the existing direction
  (`surface-router.service.ts` imports Router).
- Integration points: `app.config.ts:179-183` adds `withSurfaceViewTransitions()`. Exported from
  `libs/frontend/core/src/lib/routing/index.ts`.
- Failure behaviour: without `startViewTransition`, the Router falls back to `setTimeout`
  (`_router-chunk.mjs:3677-3680`). The Router already catches VT promise rejections
  (`:3689-3703`). A thrown matchMedia error counts as "reduced motion = false".
- Quality requirements: near-zero main-thread cost on skipped navigations. The Router creates
  the transition first and calls the callback synchronously after it
  (`_router-chunk.mjs:3685-3713`). `skipTransition()` therefore runs in the creating task,
  before the next rendering opportunity in which the capture would happen (A6, measured in M1).
- Verification seam: new `surface-view-transitions.spec.ts` with a real Router
  (`provideRouter(routes, withSurfaceViewTransitions())`) over a route table that mirrors every
  top-level shape of `app.routes.ts`. It uses a stubbed `document.startViewTransition` that
  invokes the update callback and returns
  `{ updateCallbackDone, ready, finished, skipTransition: jest.fn() }`. Cases:
  - chat -> settings: not skipped, and tracked.
  - `/chat` -> `/chat/<id>`, and `/chat/<a>` -> `/chat/<b>`: skipped.
  - Thoth child -> Thoth child, and Marketplace page -> page: skipped.
  - Redirects `''` -> chat and unknown `**` -> chat, started from chat: skipped. The same
    redirects started from settings: animated.
  - `/settings;panel=x` -> `/settings`: skipped.
  - Reduced motion: skipped.
  - The first navigation: skipped (`skipInitialTransition`).
  - Rapid navigation: chat -> settings is started, then chat -> tasks before the first
    settles. A navigation cancelled before activation creates no transition (the stub is not
    called for it). The tracker ends on the latest transition, and `busy` returns to false
    after its `finished`.
- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion\libs\frontend\core\src\lib\routing\surface-view-transitions.ts`
  - CREATE `...\libs\frontend\core\src\lib\routing\surface-view-transitions.spec.ts`
  - MODIFY `...\libs\frontend\core\src\lib\routing\index.ts`

### 2. SurfaceTransitionTracker (core routing, same file as 1)

- Purpose: let code that follows a navigation wait until the page transition has finished.
- Public API:

  ```ts
  @Injectable({ providedIn: 'root' })
  export class SurfaceTransitionTracker {
    /** True while a tracked surface transition is animating. */
    readonly busy: Signal<boolean>;
    /** Runs `fn` synchronously when idle; otherwise once the tracked transition settles. */
    afterTransition(fn: () => void): void;
    /** Called by the feature only. Keeps the latest transition; earlier ones are superseded. */
    track(transition: ViewTransition): void;
  }
  ```

- Responsibilities:
  - Hold at most one `ViewTransition`, and clear it on `finished.finally(...)` even when the
    transition is skipped or rejected.
  - Flush the queued callbacks in order. Callbacks queued for a superseded transition run when
    the latest one settles.
  - The tracker does not judge whether a callback is still wanted; callers guard themselves
    (component 5).
  - Only if A2 fails in M1: the input-skip listener described under A2. Lifetime is the root
    injector, released through `DestroyRef`.
- Dependencies: none.
- Integration points: component 1 (`track`), component 5 (`afterTransition`).
- Failure behaviour: `finished` rejects only when the update callback rejects. `finally`
  always releases, so no callback is lost. No timer.
- Verification seam: in the same spec. Idle runs synchronously (same tick). Busy defers until
  `finished`. A superseded transition still flushes. `finished` rejection still flushes.
- Files: as in 1.

### 3. Global motion tokens and view-transition CSS

- Purpose: one source for easings and durations, and the `::view-transition-*` rules.
- Responsibilities:
  - A `MOTION` section in `styles.css` with the `:root` tokens above.
  - `.ptah-vt-surface { view-transition-name: ptah-surface; }`.
  - `::view-transition { pointer-events: none; }` (A2).
  - Root old/new symmetric opacity 180 ms. `ptah-surface` old 120 ms fade, new 200 ms fade plus
    a 4 px rise. Keyframes `ptahPageOut`, `ptahPageIn`, `ptahPageRiseIn`.
  - A `prefers-reduced-motion: reduce` block setting `animation: none !important` on
    `::view-transition-group(*)`, `::view-transition-old(*)` and `::view-transition-new(*)`.
- Verified contracts: global stylesheet `project.json:28-29`. The existing token values come
  from `chat-view.component.css:125-128`.
- Dependencies: none.
- Integration points: components 4, 6, 7 consume the tokens and the class.
- Failure behaviour: without VT support these rules are inert.
- Quality: compositor-only properties; no layout properties.
- Verification seam: visual check in M1 (frame strip), plus a reduced-motion run (M1 S6).
  CSS is not unit-tested.
- Files: MODIFY `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion\apps\ptah-extension-webview\src\styles.css`
  (new section near the `ACCESSIBILITY STYLES` block, `:743-756`).

### 4. Electron content host naming

- Purpose: in Electron, only the content area moves. Chrome stays put.
- Responsibilities: add `ptah-vt-surface` to exactly one element per state:
  - `#configurationSurfaceHost` (`electron-shell.component.ts:304-308`) when a workspace is open.
  - `ptah-electron-welcome` (`:271`) and the no-workspace outlet wrapper (`:273`). These sit in
    mutually exclusive `@if` branches, so a name is never duplicated (a duplicate name would
    abort the transition).
  - VS Code: no name. Root is the surface.
- Verified contracts: template lines above.
- Dependencies: component 3.
- Failure behaviour: if a second element ever carries the name, Chromium skips the transition
  and the swap stays instant. M1 checks for a console warning.
- Verification seam: a spec that renders the shell in each of the three states and asserts that
  exactly one element has `.ptah-vt-surface`. Extend an existing `electron-shell.*.spec.ts`
  setup (for example the one in `electron-shell.config-gate.spec.ts`) in a new spec file.
- Files:
  - MODIFY `...\libs\frontend\chat\src\lib\components\templates\electron-shell.component.ts`
  - CREATE `...\libs\frontend\chat\src\lib\components\templates\electron-shell.view-transition.spec.ts`

### 5. ChatTabRouteSync: defer URL corrections during a page transition

- Purpose: stop the `/chat` -> `/chat/<id>` replace from cancelling the return-to-chat
  transition (F8).
- Responsibilities: `replaceChatUrl` runs through `SurfaceTransitionTracker.afterTransition`.
  - When idle: same call, same timing, so existing specs are unchanged.
  - When busy: the service keeps a private `routeGeneration` counter. It is incremented on every
    `NavigationStart` (from the same `router.events` subscription as `:108-115`, widened to
    both event types) and on every queued correction. A queued correction captures the counter
    and, when it flushes, is DISCARDED unless all of these hold:
    - (a) the counter is unchanged, so no newer navigation started and no newer correction was
      queued;
    - (b) `this.surfaceRouter.pendingSurface() === null`;
    - (c) `this.chatTabOf(this.router.url) !== undefined`, so the router is still on chat
      (the same guard `followUrl` applies at `:136-140`);
    - (d) the URL does not already name `activeTabId()`.

    If all hold, it replaces toward the then-active tab.
  - The service never navigates away from a surface the user picked after the correction was
    queued, and never overwrites a newer navigation. The newest queued correction supersedes the
    older ones, so at most one replace runs.
- Verified contracts: `followUrl` and `followActiveTab` call sites (`chat-tab-route-sync.service.ts:178, 212`),
  `replaceChatUrl` with the `correction` bookkeeping (`:273-285`).
- Dependencies: core `SurfaceTransitionTracker` (chat -> core, existing direction).
- Failure behaviour: if the transition never settles (impossible by spec; Chromium caps the
  update callback at 4 s), the URL stays `/chat` and the tab state stays correct (the class doc
  says so, `:265-272`).
- Verification seam: add to `chat-tab-route-sync.service.spec.ts`, with a fake tracker that is
  idle in the default setup so existing cases are untouched. New cases (each on the real Router
  with `MemoryPlatformLocation`, as the existing spec does):
  - Busy: the replace happens after `finished`, toward the latest tab.
  - A tab switch during the wait still produces exactly one replace.
  - Idle: the navigation is issued synchronously.
  - Settings -> chat (correction queued), then chat -> settings within 80 ms: after `finished`,
    no navigation is issued, and the URL stays `/settings`.
  - Settings -> chat (correction queued), then chat -> tasks within 80 ms, then a second
    transition finishes: no navigation back to chat.
  - Chat -> settings started while a correction is queued: the queued correction never runs,
    and the settings navigation completes unchanged (`navigated`).
- Files:
  - MODIFY `...\libs\frontend\chat\src\lib\services\chat-tab-route-sync.service.ts`
  - MODIFY `...\libs\frontend\chat\src\lib\services\chat-tab-route-sync.service.spec.ts`

### 6. Session-switch entrance (ChatView + transcript)

- Purpose: one calm, bottom-anchored cascade per session switch, with chrome held still.
- Responsibilities:
  - **ChatViewComponent.**
    - Replace `wireSessionSwitchStagger` / `playEnter` / `_enterTimer` / `clearEnterTimer`
      (`chat-view.component.ts:1194-1249`, call at `:1416`, destroy at `:698-700`) with
      `protected readonly enteringTabId = signal<string | null>(null)`.
    - The existing `resolvedTabId` edge effect, keyed on the tab id (same semantics: a view-mode
      switch or a first session id never replays), sets it and re-arms one outside-zone timer of
      `ENTER_WINDOW_MS = 400` that sets it back to `null`. The timer is cleared on destroy.
    - Host binding `'[class.is-entering]': 'enteringTabId() !== null'` (`host` at `:195-197`)
      keeps the inspector `.st-r` rows.
    - Template: `[entering]="tabId === enteringTabId()"` on `<ptah-chat-transcript>`
      (`chat-view.component.html:103-115`).
    - Remove `st-f` from the header (`:35`), and remove the composer `st-f` and `--d` (`:269`).
  - **ChatTranscriptComponent.**
    - `readonly entering = input(false)`.
    - `private readonly slotRefs = viewChildren(TranscriptSlotDirective)`. The directive gains
      a public `readonly element: HTMLElement` from its existing `ElementRef`
      (`transcript-slot.directive.ts:16-20`).
    - **Deterministic snapshot boundary.** One effect tracks `entering()` only.
      - On a rising edge it bumps a private `enterGeneration` and registers ONE
        `afterNextRender({ earlyRead, write }, { injector })` (injector: the component's; spec
        shape verified at `core.d.ts:2720-2725`) that carries that generation.
      - That pass is the after-render phase of the same tick in which the parent bound
        `active=true` and `entering=true`. The transcript template has therefore already
        re-rendered with `workActive()` true and the unfrozen vm
        (`chat-transcript.component.ts:323-327, 558-570`). After-render hooks run inside the
        tick, so the writes land before the first paint of the shown session, as
        `playEnter`'s did (`chat-view.component.ts:1203-1213`).
    - **`earlyRead` (reads only, no DOM write):**
      - Return "abort" if the generation changed, or `!entering()`, or `!workActive()`.
      - If `historyReplaying()` or the vm has zero slots, return "nothing". A non-retained
        session whose history arrives later never animates.
      - If neither `pinnedToBottom()` nor `savedScrollTop === null`: return "pane fade".
      - Otherwise measure:
        - Read the scroller (`scrollContainer()`, `#messageContainer`,
          `chat-transcript.component.ts:381-382`) once: `getBoundingClientRect()`,
          `scrollTop`, `scrollHeight`, `clientHeight`.
        - **Project the viewport onto the restore target (D11).** The activation restore has
          not run yet: it lands in a later `requestAnimationFrame`
          (`chat-transcript.component.ts:1117-1125, 1300-1316`). Target = `scrollHeight -
          clientHeight` when pinned or on first show. The viewport passed on is the scroller
          rect moved down by `target - scrollTop` (`DOMRectReadOnly.fromRect`). No scroll is
          written here.
        - Walk `slotRefs()` in reverse (newest first) and read each slot's
          `getBoundingClientRect()` lazily, feeding `selectVisibleEntrance(viewport, items,
          ENTER_CAP = 6)`. The walk stops at the first slot whose bottom is above the viewport
          top, or once 6 visible slots are collected: about 1 + 7 rect reads.
        - Return the selected ids, oldest visible first.
    - **`write` (receives `earlyRead`'s value; writes only):**
      - On "abort" or "nothing", do nothing. Re-check the generation (a falling edge between the
        phases aborts).
      - On "pane fade", add `ptah-pane-enter` to the scroller.
      - On ids: for each id at position k (k = 0 is the oldest visible), resolve its slot
        element, then `renderer.addClass(el, 'ptah-turn-enter')`,
        `el.style.setProperty('--i', k)` and `data-enter-i` (A4).
      - Remember the marked elements in a private array.
    - **`selectVisibleEntrance` (pure, new file `transcript-entrance.ts`).**
      - Signature: `export function selectVisibleEntrance(viewport: DOMRectReadOnly,
        itemsNewestFirst: readonly { id: string; rect: DOMRectReadOnly }[], cap: number):
        string[]`. No transcript types, no Angular import.
      - Walk newest first. Skip items entirely below the viewport (`rect.top >=
        viewport.bottom`). Stop at the first item whose `rect.bottom <= viewport.top`. Collect
        every item that intersects the viewport. Stop once `cap` items are collected.
      - Return the collected ids reversed (oldest visible first), so index 0 is the first
        visible message. Empty input or `cap <= 0` returns `[]`.
      - The component may pass a lazy iterable adapter or pre-read rects; the walk's early
        stop is what bounds the reads, so the component reads rects inside the same newest-first
        loop rather than for every slot.
    - **Shareability (decision record, D12).** There is one consumer today, so no shared
      directive is introduced (no abstraction for one consumer). When a second list needs it
      (for example the TASK_2026_679 "Previous sessions" modal or the canvas rail cards), move
      the function to `@ptah-extension/ui` and wrap it in a container + item directive pair. The
      transcript-agnostic signature makes that a move, not a rewrite.
    - **Performance.** Runs once per session switch; about 1 + 7 rect reads plus the three
      scroll metrics, all before the writes in the same frame; `transform` / `opacity` only.
      It replaces CV-2.1's `querySelectorAll` over every mounted `.st-t`
      (`chat-view.component.ts:1228`) and its forced reflow `void host.offsetWidth` (`:1234`).
    - **Risk (recorded).** The measurement must describe the viewport AFTER the transcript
      restores its pinned-bottom position. Source shows the restore always lands in a rAF after
      the switch tick, so the projection (D11) is required, not optional. If M0 confirms F6
      (a painted first frame at the wrong scroll), B7 moves the restore into the same render
      pass; the projection stays correct either way because `earlyRead` runs before any
      write. The B4 case "long thread, tall last reply, pinned bottom" pins this with real
      `active` / vm updates. A7 is the M1 check.
    - **Falling edge (or destroy).** Bump the generation, remove the class and the property from
      the remembered elements, and clear the array.
    - The snapshot is taken once per rising edge and never re-evaluated. Slots that mount,
      stream, replay or resync later are never marked (unchanged rule; it holds for the
      visible-only selection too).
    - A rapid A->B->A switch: A's falling edge clears its marks in one tick, and its next rising
      edge re-marks in a later tick. A also went `display:none` -> block. So the animation
      restarts without a reflow.
    - The conditional F6 and F7 fixes are no longer part of this component. They are
      component 10, owned by B7 and B8 after M0.
  - **CSS.**
    - `chat-view.component.css`: delete the `:host` tokens (`:125-128`), the `.st-f` rule
      (`:222-225`), the `.st-t` rule (`:227-230`) and their reduced-motion lines. Retime `.st-r`
      per the motion spec.
    - `chat-transcript.component.css`: delete the `:host` tokens (`:1-4`). Add
      `.ptah-turn-enter` (`ptahTurnEnter` keyframes), `.ptah-pane-enter`, and the reduced-motion
      block (none plus delay 0).
  - **message-bubble.component.html**: remove the now-dead `st-t` classes
    (`:14, 71, 93, 116, 123, 163`).
- Verified contracts: listed inline. The `active` input (`chat-transcript.component.ts:323`),
  the vm freeze (`:562`), `pinnedToBottom` (`:394`), `savedScrollTop` (`:424`) and the render
  window tail (`transcript-render-window.ts:25`) are all cited. Also `afterNextRender`'s
  `earlyRead` -> `write` hand-off (`core.d.ts:2720-2725`), the scroller view child
  (`chat-transcript.component.ts:381-382`), the rAF restore (`:1117-1125, 1300-1316`) and the
  persistent slot wrapper (`chat-transcript.component.html:35-44`).
- Dependencies: component 3 tokens (B2 lands first). No new services. `transcript-entrance.ts`
  depends on nothing (DOM lib types only); the transcript depends on it.
- Integration points: Rail and embeds get this through the same ChatView
  (`session-embed.component.ts:39-43`). The VS Code main panel gets it through `app-shell.component.html:834-839`.
- Failure behaviour:
  - No slots at the switch (history loading): the map stays empty and content arrives with no
    entrance.
  - Resync (`switchSession` reason `resync`) keeps the tab id, so there is no edge.
  - New slot ids created during the window are never marked (the snapshot is taken once).
  - A destroyed transcript removes its marks (no-op on detached nodes). ChatView clears its timer
    on destroy.
  - If a host shows a transcript only in a later tick, the pass aborts on `!workActive()` and
    that switch has no entrance. That is safe and visible in M1. (A hidden surface is an
    example: `SURFACE_ACTIVE` false.)
  - No slot intersects the projected viewport (for example a zero-height scroller): the
    selection is empty and nothing animates. A missing scroller element returns "nothing".
  - A falling edge between `earlyRead` and `write` is caught by the generation re-check in
    `write`.
- Quality: per switch, one effect, one after-render pass with about 1 + 7 rect reads and three
  scroll-metric reads (all before any write in that pass), and at most 6 x 3 attribute writes
  plus their removal. No `querySelectorAll`, no IntersectionObserver, no forced layout, no
  per-item timer or observer. Zero long tasks attributable to motion.
- Verification seams:
  - New `transcript-entrance.spec.ts` for the pure `selectVisibleEntrance`, with fake rects
    (jsdom has no layout; `DOMRectReadOnly.fromRect` exists,
    `node_modules/jsdom/lib/jsdom/living/interfaces.js:241-242`). Cases:
    - **Tall last reply fills the viewport:** one visible item, returned as index 0.
    - **Fewer than 6 visible:** only the visible ones, oldest visible first.
    - **More than 6 visible:** the newest 6 (cap), oldest of those first.
    - **Partially visible top slot:** included; the slot above it stops the walk and is
      excluded.
    - **Not pinned (scrolled up):** items below the viewport are skipped, items above it stop
      the walk, only the intersecting middle ones are returned.
    - **Empty list:** `[]`.
    - The walk stops early: a spy on a lazy items source shows no item older than the first
      fully-above slot is read.
  - New `chat-transcript.session-enter.spec.ts`. It hosts REAL transcripts in a test host
    component that binds `[active]` and `[entering]` like `chat-view.component.html:103-115`.
    Tab messages are fed through the existing harness
    `organisms/transcript/testing/transcript-spec-harness.ts`, and the test steps `fixture.detectChanges()` /
    `ApplicationRef.tick()` so that real `active`, vm-freeze and after-render passes run. A
    synchronous signal-only test is not enough. Geometry is stubbed: the scroller's
    `getBoundingClientRect`, `scrollTop`, `scrollHeight` and `clientHeight`, and each slot
    wrapper's `getBoundingClientRect` (keyed by `data-ptah-transcript-message-id`). Cases:
    - **Retained A->B.** B was rendered earlier, then hidden with new messages appended while
      hidden (frozen vm). On switch, the marked set is B's newest visible CURRENT slots (up to
      6), not the frozen snapshot. `--i` runs from 0 upward, and the marks exist after the
      first tick (before any timer).
    - **Long thread, tall last reply, pinned bottom.** `scrollTop` is still 0 at the pass (the
      restore rAF has not run). Only the last reply is marked, with `--i` 0; no offscreen
      predecessor holds an index. This pins the D11 projection.
    - **Fewer than 6 visible in a long pinned thread.** Exactly the visible ones are marked,
      0..k-1.
    - **Non-retained load.** B mounts with zero slots and `historyReplaying` false. Messages
      arrive one tick later, then replay sets and clears `historyReplaying`. Nothing is ever
      marked.
    - **Rapid A->B->A.** Each rising edge marks only its own transcript. The falling edges clear.
      A's second edge re-marks.
    - **Unpinned.** `ptah-pane-enter` on the scroller and no slot marks.
    - **Streaming during the window.** A slot appended after the pass is never marked.
    - **Resync during the window.** All slot ids are replaced with `entering` still true:
      nothing new is marked.
    - **Destroy during the window.** No error. The array is released.
  - New `chat-view.session-enter.spec.ts`. Cases:
    - a tab switch sets `entering` on the target transcript only;
    - the host carries `is-entering` until 400 ms (fake timers);
    - a view-mode switch does not trigger;
    - destroy clears the timer;
    - the header and composer carry no `st-f`.
- Files:
  - MODIFY `...\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
  - MODIFY `...\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
  - MODIFY `...\libs\frontend\chat\src\lib\components\templates\chat-view.component.css`
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.css`
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-slot.directive.ts`
    (public `element`)
  - MODIFY `...\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-entrance.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-entrance.spec.ts`
  - CREATE `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.session-enter.spec.ts`
  - CREATE `...\libs\frontend\chat\src\lib\components\templates\chat-view.session-enter.spec.ts`

### 7. Canvas: remove the double motion, animate the new split pane

- Purpose: on focus swap, show one motion (component 6). Give a newly opened split pane a small
  entrance.
- Responsibilities:
  - `canvas-lane-view.component.ts`: delete the `fade` signal (`:192`), its effect (`:286-292`),
    the `rail-focus-fade` and `rail-fade-start` CSS (`:55-56`) and the bindings (`:65-66`).
    Change the `rail-lane-enter` easing to `var(--ptah-ease-soft)` (`:54`).
  - `canvas-rail-board.component.ts`: on the pane `<section>` (`:160`) add
    `[animate.enter]="splitDisplayed() ? 'rail-pane-enter' : ''"`. The value is read at creation,
    so only the second pane of a split animates and the first board render does not (`''` is a
    no-op, `_debug_node-chunk.mjs:4200-4207`). Add a `styles` block with `.rail-pane-enter`
    inside `@media (prefers-reduced-motion: no-preference)`. No `animate.leave`: the leaving pane
    would keep its width until its animation ends, then the survivor would jump (D7).
- Verified contracts: lines above. `focusSwaps` / `railShifts` attributes (`canvas-rail-board.component.ts:75-77`)
  are unchanged.
- Dependencies: component 3 tokens. Component 6 for the swap motion (behavioural, not a code
  dependency).
- Failure behaviour: if animations are unsupported, `animate.enter` is a no-op
  (`_debug_node-chunk.mjs:14025-14027`).
- Quality: no rail shift. No added work per swap. One fewer rAF per swap.
- Verification seams:
  - Update or extend the lane-view spec: `tabId` changes add no `rail-fade-start` class, and no
    rAF is requested by the lane view.
  - Split-pane entrance, two required parts:
    - A spec assertion on the BINDING only, for example that the board template or compiled
      component carries `animate.enter` on the pane section, and that `splitDisplayed()` false
      at creation yields `''`. It is explicitly NOT proof of animation. Installed Angular
      disables `animate.enter` when `document.documentElement.getAnimations` is missing, which
      is the case in jsdom (`_debug_node-chunk.mjs:4071-4076, 14023-14038`).
    - REQUIRED M1 evidence: the frame strip of S8 shows the second pane fading in over about
      180 ms, and the S8 run under reduced motion shows it appearing in one frame.
- Rebase: `canvas-rail-board.component.ts` is also changed by the unmerged
  `fix/chat-transcript-followups` branch (TASK_2026_674: the wide aside inspector moves to
  `@defer (on idle)`). This component's batch must **rebase after the PR for
  fix/chat-transcript-followups** merges, and its line references must be re-checked then.
- Files:
  - MODIFY `...\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.ts`
  - MODIFY `...\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-board.component.ts`
  - MODIFY the matching existing spec(s) under `libs\frontend\canvas\src\lib\canvas-detail\`
    (the implementer locates the lane-view spec; CREATE `canvas-lane-view.motion.spec.ts` if
    none covers `fade`).

### 8. Router wiring and the composition-pin spec

- Purpose: switch the feature on.
- Responsibilities:
  - `app.config.ts:179-183`: add `withSurfaceViewTransitions()` and a short comment that it
    sits beside the two load-bearing features.
  - `webview-routing.spec.ts:979-995`: add
    `expect(source).toContain('withSurfaceViewTransitions()')`.
  - The jsdom routing suite keeps its own `provideRouter` (`:143-158`), so the timings it pins
    do not change.
- Dependencies: component 1.
- Failure behaviour: see 1.
- Verification seam: `webview-routing.spec.ts`.
- Files:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion\apps\ptah-extension-webview\src\app\app.config.ts`
  - MODIFY `...\apps\ptah-extension-webview\src\app\webview-routing.spec.ts`

### 9. Measurement harness (Electron)

- Purpose: before/after evidence for row 74's acceptance and for this plan's findings.
- Responsibilities: one perf spec that runs the scenarios below. It reuses `perf-page-capture.ts`
  (`installLongTaskObserver`, `collectLongTasks`, `startTraceCapture`, `stopTraceCapture`) and
  `perf-session-fixture.ts` (`makeSessionFixture`, `prepareCanvasWithSessions`,
  `sessionRowButton`). It writes JSON plus screencast frames.
- Dependencies: existing e2e support only.
- Failure behaviour: when CDP tracing is unavailable, `startTraceCapture` returns `null`
  (`perf-page-capture.ts:167-172`). The spec then records the observer metrics only and flags
  `trace: unavailable`.
- Verification seam: the orchestrator runs it on the base commit (M0) and after all code
  batches (M1). Typecheck alone does not prove the recorder works. B0 is accepted only after a
  recorded M0 fixture run produces a complete `m0.json` (all scenarios, non-empty windows) and
  a frame strip.
- Host scope: Electron only (U6). No VS Code harness scenario is written in this task. VS Code
  S7 evidence (click receipt, focus during page transitions) is a follow-up, not in this task
  (see "Follow-ups").
- Files:
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion\apps\ptah-electron-e2e\src\specs\perf\nav-session-motion.perf.spec.ts`

### 10. Conditional M0 fixes (F6 scroll restore, F7 empty-state flash)

- Purpose: fix F6 and F7 only if M0 proves them (A5, D9). Each is its own batch (B7, B8) after
  M0, so B4 carries the entrance only (review r2 finding 2).
- Responsibilities:
  - **F6 (B7), only if M0 shows a wrong-scroll first frame:** move
    `restoreScrollOnActivation`'s write from `requestAnimationFrame` into the activation render
    pass, `afterNextRender({ write })` (`chat-transcript.component.ts:1300-1316`, called from
    the activation effect at `:1117-1125`), keeping the `scrollGeneration` guard and
    `cancelScrollFrame` semantics. The entrance's `earlyRead` still runs before this write in
    the same pass, so the D11 projection stays correct.
  - **F7 (B8), only if M0 shows the empty-state flash:** do not render
    `ptah-chat-empty-state` (`chat-transcript.component.html:173-180`) while the tab has a
    `sessionId()` and its history has not settled. Use the existing skeleton markup
    (`:154-171`). The implementer must name the settled signal from source before writing it
    (A5). If none exists, stop and report.
- Dependencies: M0 evidence. Both edit `chat-transcript.component.ts` (and B8 also the
  `.html`), which B4 owns, so both run after B4 and after each other, never in parallel with
  B4.
- Failure behaviour: if M0 does not confirm a finding, its batch is closed as "not needed (M0)"
  and no file changes.
- Verification seams:
  - B7: new `chat-transcript.scroll-restore.spec.ts`. Real transcript; after the activation
    tick (no rAF flushed) `scrollTop` equals the target for pinned and for a saved offset; a
    falling edge before the pass writes nothing. Existing transcript specs stay green. M1:
    the three-rAF first-frame scroll samples show the target from frame 1.
  - B8: new `chat-transcript.empty-state.spec.ts`. A tab with a `sessionId()` and unsettled
    history shows the skeleton, not `ptah-chat-empty-state`; a settled empty session shows the
    empty state. M1: S4 frame strip has no empty-state frame.
- Files:
  - B7: MODIFY `D:\projects\ptah-extension\.claude-worktrees\nav-session-motion\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`;
    CREATE `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.scroll-restore.spec.ts`
  - B8: MODIFY `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
    and, only to expose the settled signal, `chat-transcript.component.ts`;
    CREATE `...\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.empty-state.spec.ts`

## Measurement plan (the orchestrator runs it)

The user approved one renderer build and the one Electron perf spec, before and after (U4). The
orchestrator runs them and announces them to the other sessions. Run one heavy check at a time.
All scenarios, S7 included, run in Electron only (U6).

- **When.** M0 on the base (`6c0490f1f`, i.e. this worktree with only the B0 spec added). M1
  after B1-B6, plus B7 and B8 when M0 triggered them.
- **Command.** `npx playwright test --config=apps/ptah-electron-e2e/playwright.config.ts src/specs/perf/nav-session-motion.perf.spec.ts`
  (the existing `build-precheck.ts` gate applies).
- **Fixture.** Four Rail sessions with 60-120 messages each (`buildLargeSessionEvents`), so the
  Rail retention cap of 4 is exceeded by one when a fifth is opened. Use one short session, and
  one session the user has not opened (for S4).
- **Scenarios.** Each switch window runs from the click to +600 ms.
  - S1: 10 page round trips: Canvas -> Tasks -> Analytics -> Canvas (navbar tabs).
  - S2: 10 Rail focus swaps between retained sessions.
  - S3: 5 swaps to a non-retained session.
  - S4: 3 opens of a not-yet-open session from the session list (F7).
  - S5: rapid switching: 5 focus swaps 80 ms apart, and 3 page clicks 80 ms apart.
  - S6: S1, S2 and S8 again under `page.emulateMedia({ reducedMotion: 'reduce' })`.
  - S7: interaction and focus during a page transition, in Electron only (U6; the VS Code host
    is a follow-up).
    - Pointer: click a navbar tab, and 80 ms later click a second tab and a plain button inside
      the incoming surface. Record whether each target's click listener fired (a counter installed
      by `page.evaluate`), and which surface finally shows.
    - Keyboard: focus a navbar tab, press Enter, then 80 ms later Tab and Enter again. Record
      `document.activeElement` (tag, test id) at +0, +100, +400 ms.
    - Focus restoration: start with focus inside a routed surface that is destroyed by the
      navigation. Record `document.activeElement` after +400 ms. M1 must equal M0 for every
      record.
    - Also covered: the Electron remount path (`electron-shell.component.ts:440-462`) through a
      workspace switch with a configuration surface open.
  - S8: open a split ("open beside") twice; close it in between.
  - Optional, manual: one swap while a session streams. Assumption: the fixture cannot stream.
- **Record per window.**
  - Long tasks: count, max and sum (`longtask` observer). Per-window attribution comes from
    `bucketByClick` (`perf-diagnostics.ts:106`).
  - Layout shift: sum of `layout-shift` entry values without recent input.
  - Trace: `DroppedFrame` / `PipelineReporter` dropped-frame count, `Layout` and
    `UpdateLayoutTree` counts, and any forced layout (a `Layout` that carries a JS stack).
  - `document.getAnimations().length` at +50 ms and +400 ms. The expected new cap is <= 6 turn
    animations plus inspector rows, and 0 under S6.
  - Entrance placement (U5, A7): at +50 ms, for every animated `.chat-msg-slot`, whether it
    intersects the scroller viewport after the restore, and the animation delay of the first
    (topmost) visible one.
  - Presence of `::view-transition` at +50 ms (`document.documentElement` computed
    `view-transition-name` / `getAnimations` targets with a pseudo-element).
  - First-frame scroll: `scrollTop` and `scrollHeight` of the active `chat-transcript-scroller`
    sampled in three chained rAFs after the click (F6).
  - Screencast frames (`Page.startScreencast`, every frame) for a frame strip from 0 to 600 ms
    (F1, F2, F4, F7 visual evidence).
  - `data-canvas-rail-shifts` delta (must be 0) and `data-canvas-focus-swaps` delta (must equal
    the number of swaps).
  - `Memory.getDOMCounters` before S2 and after S2 plus a GC (nodes and listeners back to within
    +/-2 %). Heap-snapshot detached-node count is optional (row 74: 0 detached).
  - Once per run: `typeof document.startViewTransition` and `process.versions.chrome` (A1).
- **Pass criteria at M1.**
  - No long task over 50 ms that is attributable to motion code (stack in `ChatView`,
    `ChatTranscript`, lane view or router VT).
  - Zero forced layouts from motion code.
  - Layout shift 0 in rail and transcript.
  - Rail shifts 0.
  - Visible content blank for at most 140 ms on any switch.
  - Every animated message on a session switch is inside the viewport, and the first visible
    one has a 0 ms delay (U5, A7).
  - Header and composer pixels unchanged across a swap (frame strip).
  - Page transitions visible in S1 and absent in S6.
  - A return to chat in S1 is not cut short (F8).
  - S7 (Electron): every click reaches its target (or A2's fallback is applied and
    re-measured). `activeElement` and focus restoration equal M0.
  - S8 shows the split-pane entrance, and none under reduced motion.
  - The overall per-switch long-task maximum is reported against the 50 ms target
    (`context.md:9-13`, row 74), with the per-window attribution of motion versus render.
    By user decision U2, a render-caused excess does not fail this task. It is filed as the
    follow-up under TASK_2026_629 row 74 with the M1 numbers. A motion-caused excess fails it.
- **Output.** `.ptah/specs/TASK_2026_683_3c29/measurements/m0.json`, `m1.json` and frame
  strips. The orchestrator writes the comparison.

## Integration architecture

- **Data flow, page.**
  1. Click.
  2. `AppStateManager.setCurrentView` (`app-state.service.ts:1015`).
  3. `SurfaceRouterService.navigateToSurface` (`surface-router.service.ts:128`).
  4. Router: recognize, then guards, then chunk.
  5. `createViewTransition` (`_router-chunk.mjs:3976`) -> `onViewTransitionCreated` (skip or
     track).
  6. Update callback: `ActivateRoutes`, `NavigationEnd`, then the `currentSurface` and
     `openSurface` effects run and the retained row is hidden or shown.
  7. `afterNextRender` + `setTimeout` resolves the callback, and the pseudo-elements animate.
  8. `finished` releases the tracker, which flushes a deferred `ChatTabRouteSync` correction.
- **Data flow, session.**
  1. `switchTab` / `focusTile`.
  2. `resolvedTabId` changes. The ChatView effect sets `enteringTabId` and the timer.
  3. In the same tick the target transcript gets `active=true` and `entering=true`. Its
     template re-renders with the unfrozen vm. Its effect registers one
     `afterNextRender({ earlyRead, write })`.
  4. In that pass, still inside the tick and before paint: `earlyRead` reads the scroller once,
     projects its viewport onto the restore target (D11) and walks the slots newest first
     through `selectVisibleEntrance`; `write` gives the class and `--i` to at most 6 visible
     slot elements, oldest visible at 0 (or the scroller gets the pane fade). CSS runs on the
     compositor.
  4a. The activation scroll restore lands in the next rAF (or in the same pass once B7 ships).
  5. At 400 ms `enteringTabId` returns to `null`, `entering` falls, and the marks are removed.
- **State or persistence.** All new state is in memory and component-scoped (ChatView,
  transcript signals). The tracker is root-scoped and holds at most one `ViewTransition`. Nothing
  is persisted.
- **External boundaries.** None. No input crosses a trust boundary. No RPC changes.
- **Failure and rollback.**
  - Every piece degrades to today's instant swap: no VT support, reduced motion, duplicate
    name, or `animate.enter` unsupported.
  - Each batch reverts on its own. B4, B5 and B6 depend on the B2 tokens only through CSS
    variables (shipped first as ordered). B3 depends on the B1 tracker. B5 depends on B4's
    `entering` input. B7 and B8 revert on their own; reverting B7 returns the restore to its
    rAF, which the D11 projection already handles.
- **Observability.** The M0/M1 JSON, plus the existing canvas counters (`data-canvas-focus-swaps`,
  `data-canvas-rail-shifts`). The Router logs VT promise errors in dev mode
  (`_router-chunk.mjs:3689-3703`).

## Architecture-level quality requirements

- **Functional.**
  - Top-level page changes cross-fade in both hosts. In Electron only the content area moves.
  - A session switch cascades at most the 6 newest viewport-visible messages in at most
    340 ms; the first visible message starts at 0 ms (U5).
  - Header and composer never animate on a switch.
  - Streamed, resynced, replayed and prepended items never animate.
  - Reduced motion shows every change instantly, with no capture.
- **Performance.** No added long task, forced layout or per-item timer or observer. The switch
  frame does less work than today (no DOM query, no forced reflow, one fewer rAF on canvas).
  The 50 ms per-switch target is measured and reported with attribution. Motion-caused excess
  fails the task; render-caused excess goes to the follow-up (U2).
- **Interaction and accessibility.**
  - Clicks and keys during a page transition reach their targets (S7, Electron; the VS Code
    host is a follow-up, U6).
  - Focus outcome after navigation equals M0.
  - A new navigation while one is running skips the running transition to its end state.
- **Security.** Not applicable.
- **Maintainability.**
  - Core stays host-neutral: no host branching. The Electron naming lives in the Electron shell
    template.
  - The tokens have one source.
  - No `@angular/animations`.
  - No private router tokens.
  - The CV-2.1 code is replaced, not kept beside the new path.
  - Tags are unchanged (`scope:webview`).
- **Testability.**
  - Pure skip rule and tracker: unit-tested with a real Router and a stubbed
    `startViewTransition`.
  - Visible selection: the pure `selectVisibleEntrance` is unit-tested with fake rects (jsdom
    has no layout).
  - Transcript and ChatView: entrance tested on real transcripts through the class, `--i` and
    `data-enter-i` writes at the after-render boundary, which jsdom supports, with stubbed
    slot and scroller geometry.
  - `animate.enter`: only its binding is unit-asserted. Its animation is proven in M1 only.
  - Visual and frame evidence comes from M1.

## Decisions

User decisions (2026-10-16, relayed by the coordinator):

| # | Decision | Effect on this plan |
| --- | --- | --- |
| U1 | Session-switch style: (A) cascade. The newest visible messages cascade in (at most 6, about 0.3 s), the old session leaves at once, and the header and composer stay still. | Component 6 as specified; D5 confirmed. |
| U2 | Long tasks from rendering: (A) report the numbers in this task; fix later in a follow-up under TASK_2026_629 row 74. | The M1 pass criteria fail on motion-caused long tasks over 50 ms. Render-caused ones are reported and filed as the follow-up. |
| U3 | VS Code layout toggle: (A) keep it instant. | Surface 13 stays unchanged. No `startViewTransition` outside the Router. |
| U4 | Measurement: (A) one renderer build plus the one Electron perf spec, before and after. The orchestrator runs it and announces it to other sessions. | M0/M1 as specified. The VS Code host question is settled by U6. |
| U5 | Visible-only cascade (fixes review r2 finding 1). The entrance selects the newest viewport-visible messages (cap 6) in `afterNextRender({ earlyRead, write })`: `earlyRead` measures, `write` marks; the first visible message gets index 0. The selection is a pure function in its own file. No IntersectionObserver, no shared directive yet. | Component 6 (`selectVisibleEntrance`, `transcript-entrance.ts` and spec); D4 amended; D11, D12; B4 files and cases; M1 placement criterion (A7). |
| U6 | VS Code e2e: Electron only. No VS Code harness scenario in this task; S7 is recorded in Electron. | Component 9 and B0 lose the VS Code spec; "Still open" closed; follow-up entry "VS Code S7 evidence". |

Architecture decisions:

| # | Decision | Options considered | Evidence | Reversible |
| --- | --- | --- | --- | --- |
| D1 | Pages use `withViewTransitions` through a core feature function with a same-surface (first primary URL segment) and reduced-motion skip | own `startViewTransition` in `AppStateManager` (would freeze rendering while a chunk loads); `@angular/animations` (deprecated, not installed) | `router.d.ts:121-146`; `_router-chunk.mjs:3965-3990` | yes, one line in `app.config.ts` |
| D2 | `SurfaceTransitionTracker` defers `ChatTabRouteSync` URL corrections while a transition runs. Each deferred correction is guarded by a route generation, an idle router and "still on chat". | let the replace cancel the VT (return to chat never animates); patch the private `CREATE_VIEW_TRANSITION` | F8; `chat-tab-route-sync.service.ts:130-140, 175-178, 212, 273-285` | yes |
| D3 | Session header and composer no longer fade on a switch (changes design-spec 7.1 row 1) | keep the fade | F2; U1 | yes, CSS only |
| D4 | The stagger targets the newest <= 6 viewport-visible messages (amended by U5; previously "the last <= 6 mounted trailing messages"), one item per message, step 28 ms, 200 ms (changes 7.1 row 2: top-down DOM order, up to 6 items per turn, 45 ms / 260 ms, cap 8) | fix CV-2.1's indexing only; mounted tail only (review r2 finding 1) | F1; `transcript-render-window.ts:20-25, 245-252`; `design-spec.md:750` intent | yes |
| D5 | Session switches do not use a View Transition | full pane cross-fade via VT | rejected alternative 1; U1 | yes |
| D6 | The canvas lane-view pane fade is removed; the canvas relies on the shared transcript entrance | keep both | F4 | yes |
| D7 | Swap panes stays instant; a closing pane has no leave animation; a new split pane gets `animate.enter` | FLIP on swap; leave animation | `canvas-rail-board.component.ts:662-673`; leave keeps layout until `animationend` (`_debug_node-chunk.mjs:14119-14170`) | yes |
| D8 | Child-route changes (Thoth tabs, Marketplace pages) do not animate | animate every navigation | same-surface rule; these surfaces own their in-page UI | yes, by changing the skip rule |
| D9 | The F6 and F7 fixes are conditional on M0 evidence, and each is its own batch after M0 (B7, B8) | fix blind; keep them inside B4 (review r2 finding 2) | A5 | n/a |
| D10 | The entrance snapshot is taken in the first after-render pass after the rising edge (`earlyRead` measures, `write` marks, U5), via `Renderer2` on `viewChildren(TranscriptSlotDirective)`, not through template bindings evaluated during the edge | template `[class]` / `[style.--i]` from a signal set in the edge effect (could read the frozen vm, review finding 2) | `chat-transcript.component.ts:323-327, 558-570`; `chat-view.component.ts:1203-1213`; `core.d.ts:2720-2725` | yes |
| D11 | `earlyRead` projects the scroller viewport onto the activation restore target (pinned: `scrollHeight - clientHeight`) instead of reading the live `scrollTop` | measure the live position (sees the pre-restore offset, since the restore runs in a later rAF); write the scroll first, then read (forces a layout); wait a frame (the cascade would start a frame late) | `chat-transcript.component.ts:1117-1125, 1300-1316`; A7 | yes |
| D12 | `selectVisibleEntrance` stays in `libs/frontend/chat` as a pure function; no shared directive now | a container + item directive pair in `@ptah-extension/ui` now | one consumer today; candidates TASK_2026_679 "Previous sessions" modal and canvas rail cards would justify the move | yes, a file move |

## Review response

Round 1: `implementation-plan-review.md` (REVISE, 8 findings). 7 accepted. Finding 3 is resolved
by user decision U2 rather than by restoring the original criterion. Its "Lane-introduced
constraints" section was not adopted, as instructed.

| # | Finding | Response | Where in the plan |
| --- | --- | --- | --- |
| 1 | A deferred correction can navigate back to chat after a rapid page switch | **Accepted.** Each deferred correction is discarded unless (a) the route generation is unchanged (bumped on every `NavigationStart` and every new correction), (b) the router is idle, (c) the URL is still on chat (the `followUrl` guard, `chat-tab-route-sync.service.ts:136-140`), and (d) the URL does not already name the active tab. New specs cover chat -> settings and chat -> tasks within 80 ms with a queued correction, and confirm a newer navigation completes unchanged. | Component 5; D2; B3 |
| 2 | The entrance snapshot is not tied to the first settled active render | **Accepted.** The snapshot moves to the first after-render `write` pass after the tick in which `entering` rose, aborted unless `workActive()`. That pass runs after the transcript re-rendered with the unfrozen vm (`chat-transcript.component.ts:323-327, 558-570`) and before paint, like `playEnter` (`chat-view.component.ts:1203-1213`). It is taken once. Replay or zero slots marks nothing. Specs run real transcripts through the existing harness for retained A->B (hidden-time appends), a non-retained load, rapid A->B->A, streaming and resync during the window. | Component 6; D10; B4 |
| 3 | The 50 ms target is weakened without user approval | **Resolved by the user (U2), not by the plan.** The user chose to report render-caused long tasks in this task and fix them in a follow-up under TASK_2026_629 row 74. The overall per-switch maximum stays a measured, reported criterion against `context.md:9-13`. Motion-caused excess still fails this task. | Measurement pass criteria; quality requirements; U2 |
| 4 | The skip rule's route-identity contract is unproven; "before capture" is overstated | **Accepted.** The rule now uses the first primary URL segment consumed by the top-level route (`root.firstChild.url[0].path`), normalized by `surfaceIdFromSegment` (`webview-surface.types.ts:147-149`), the same reading `SurfaceRouterService` uses (`surface-router.service.ts:227-236`). The plan states why this holds for every top-level route shape in `app.routes.ts:78-195`. Spec cases were added for redirects (`''`, `**`), matrix params, child routes, and a rapid or cancelled navigation. The skip timing is restated: the Router creates the transition first and calls the callback synchronously after it (`_router-chunk.mjs:3685-3713`). "No capture" is now assumption A6, measured in M1. | Component 1; Motion spec; A6 |
| 5 | Interaction and focus during the overlay are not acceptance-tested | **Accepted.** New S7 records click receipt for a second click 80 ms in, keyboard Enter/Tab, `document.activeElement` at +0/+100/+400 ms, and focus restoration after a routed surface is destroyed. It also covers the Electron remount focus path (`electron-shell.component.ts:440-462`). It runs in Electron (perf spec) and in VS Code (new harness scenario, `useAppBuild`). The M1 criterion is "equals M0". Behaviour for a new navigation during a running transition is specified (the running one is skipped to its end state; the tracker follows the latest). If `pointer-events: none` does not let clicks through, the A2 fallback skips the transition on `pointerdown` or `keydown`. The VS Code scenario run needs the user's go-ahead, because U4 covers one Electron spec. | Motion spec; A2; component 9; S7; B0 |
| 6 | Several observations are stated more strongly than source proves | **Accepted.** F1 now separates what source proves (DOM-order index capped at 8, up to six `.st-t` per turn, 2000 px margin, shared 360 ms max delay) from the inferred visible effect, which M0 measures. The tail claim now says "6 trailing messages are always mounted", and that not all six need be visible. F6 and F7 remain assumptions, and their fixes are gated on M0 frames (A5, D9). | F1; Codebase evidence; A5 |
| 7 | B1 and B2 are oversized for one lane; B0's typecheck does not prove the recorder | **Accepted.** B1 is split into B1 (router feature, tracker, wiring), B2 (tokens, VT CSS, Electron naming) and B3 (URL reconciliation). The old B2 is split into B4 (transcript entrance) and B5 (ChatView edge and CV-2.1 removal). Ownership stays file-exclusive. B0 is accepted only after a recorded M0 run produces a complete `m0.json` and a frame strip. | Batches; component 9 |
| 8 | The split-pane assertion cannot be proved in jsdom | **Accepted.** B6 acceptance now requires a binding-only spec assertion, explicitly not proof of animation, plus M1 S8 frame evidence with and without reduced motion. | Component 7; B6; S8 |

Round 2: `implementation-plan-review-r2.md` (REVISE, round-1 findings 1-6 and 8 resolved, 7
partially; two new Medium findings). Both are resolved by user decisions. The user approved the
plan at the review cap, so there is no third review round.

| # | Finding | Response | Where in the plan |
| --- | --- | --- | --- |
| r2-1 | The session entrance selects mounted messages, not the newest visible ones; an offscreen predecessor can hold the visible bubble up to 140 ms | **Resolved by U5.** `earlyRead` measures the scroller once, projects it onto the restore target (D11), walks the slots newest first and stops at the first slot above the viewport or at 6 visible; `write` marks oldest visible first, so the first visible message gets index 0. The selection is the pure `selectVisibleEntrance` with its own fake-rect spec. A pinned long-thread case with a tall last reply and one with fewer than six visible slots are added to the transcript spec. Cap 6 kept; no forced layout (reads before writes) and no IntersectionObserver. | Component 6; Motion spec; D4, D10-D12; A7; B4 |
| r2-2 | B0 exceeds one lane; B4 carries unbounded conditional work | **Resolved by U6 plus the B7/B8 split.** B0 is one Electron recorder (S1-S8); the VS Code scenario is dropped and recorded as a follow-up, so no second recorder lane is needed. The recorded M0 run stays an orchestrator gate. F6 and F7 move to B7 and B8, each run only if M0 confirms it and sequenced after B4 because they edit B4's transcript files. B4 keeps the entrance and its specs only. | Component 9; component 10; B0, B4, B7, B8; Team-leader handoff |

## Team-leader handoff

- **Recommended executors.** frontend-developer for all batches, each suitable for a codex
  lane. Each lane brief must repeat the CLAUDE.md verification-command rules (verify only the
  changed project, `--parallel=1`, `--maxWorkers=2`, one heavy check at a time, no
  build/serve/e2e).
- **Complexity.** MEDIUM. The behaviour change is small and local. The risk is in timing (VT
  versus follow-up navigations; switch edge versus vm freeze), which the specs pin.
- **Dependencies and ordering.**
  1. B0, then M0 (the orchestrator, U4).
  2. B1 and B2 (independent).
  3. B3 after B1 (tracker).
  4. B4 after B2 (tokens).
  5. B5 after B4 (it binds the transcript's new `entering` input).
  6. B6 after B2, and after the `fix/chat-transcript-followups` PR merges (rebase).
  7. B7 (F6) only if M0 confirms F6, and after B4: it edits `chat-transcript.component.ts`,
     which B4 owns.
  8. B8 (F7) only if M0 confirms F7, after B4 and after B7 (if B7 runs): it edits
     `chat-transcript.component.html` (B4) and possibly `chat-transcript.component.ts` (B4, B7).
  9. M1 after B1-B6 and any triggered B7/B8.
- **Parallel-safe work.** B1 and B2. Then B3, B4 and B6. B0 with anything. B5, B6 and B3 may run
  beside B7 or B8 (file-disjoint). B7 and B8 are never parallel with B4 or with each other.
  Within one phase, no two parallel batches share a file; B4 -> B7 -> B8 is the only
  sequenced file hand-over.
- **Rebase note.** B6 touches `canvas-rail-board.component.ts`, which the unmerged
  `fix/chat-transcript-followups` branch (TASK_2026_674) also changes. Mark B6 "rebase after
  PR for fix/chat-transcript-followups". No other batch touches that branch's files
  (`canvas-lane-tabs`, `compact-session-card`, `session-history-replayer`, the rail board).
- **Files affected.** See each batch. REWRITE: none.
- **Verification points.**
  - Every symbol named in this plan was opened. Before coding, re-check that the `ViewTransition`
    lib typing is visible to `tsconfig` (the router typings already reference it).
  - Per-project commands, one at a time:
    - `npx nx test @ptah-extension/core --parallel=1`
    - `npx nx test @ptah-extension/chat --parallel=1`, or Jest on the changed specs:
      `npx jest -c libs/frontend/chat/jest.config.ts <specs> --coverage=false --maxWorkers=2`
    - `npx nx test @ptah-extension/canvas --parallel=1`
    - `npx jest -c apps/ptah-extension-webview/jest.config.ts src/app/webview-routing.spec.ts --coverage=false --maxWorkers=2`
    - `npx nx typecheck <project>` and `npx nx lint <project>` for each changed project
    - `npx nx typecheck ptah-electron-e2e` for B0 (Electron only, U6)

## Batches (file-disjoint, for codex lanes)

B0-B6 are file-disjoint. B7 and B8 are conditional on M0 and reuse B4's transcript files, so
they are sequenced (B4 -> B7 -> B8) and never run beside B4 or each other.

### B0 - Measurement harness (one Electron recorder lane)

- Files:
  - CREATE `apps/ptah-electron-e2e/src/specs/perf/nav-session-motion.perf.spec.ts`
- Acceptance:
  - The Electron spec implements S1-S8 (S7 in Electron only, U6) and the "Record per window"
    list, including the entrance-placement record, reusing `perf-page-capture.ts`,
    `perf-diagnostics.ts` and `perf-session-fixture.ts` helpers. No new support module unless
    a helper is reused twice.
  - Output goes to `measurements/m{0,1}.json` and frame strips under the task folder (the label
    comes from an env var, default `m0`).
  - It is a recorder at M0. M1 pass criteria apply when `PTAH_MOTION_ASSERT=1`.
  - `npx nx typecheck ptah-electron-e2e` passes.
  - Done only when a recorded M0 run produces a complete `m0.json` (every scenario, non-empty
    windows) and a frame strip. That run is a separate orchestrator gate, not part of the lane.
- Specs: the file itself. The orchestrator runs it (U4). No VS Code harness scenario (U6).

### B1 - Router view-transition feature and tracker

- Files:
  - CREATE `libs/frontend/core/src/lib/routing/surface-view-transitions.ts` and its `.spec.ts`
  - MODIFY `libs/frontend/core/src/lib/routing/index.ts`
  - MODIFY `apps/ptah-extension-webview/src/app/app.config.ts`
  - MODIFY `apps/ptah-extension-webview/src/app/webview-routing.spec.ts`
- Acceptance:
  - Components 1, 2 and 8 as specified.
  - Surface identity comes from the first primary URL segment via `surfaceIdFromSegment`.
  - All spec cases listed in component 1 pass, including redirects, matrix params, child
    routes and a rapid or cancelled navigation.
  - The tracker runs callbacks synchronously when idle. It flushes on `finished` even when the
    transition is skipped or rejected, and ends on the latest transition.
  - `npx nx test`, `typecheck` and `lint` pass for `@ptah-extension/core`. The webview-routing
    Jest file passes.
- Specs: `surface-view-transitions.spec.ts` (new); `webview-routing.spec.ts` (one assertion).

### B2 - Motion tokens, view-transition CSS, Electron surface naming

- Files:
  - MODIFY `apps/ptah-extension-webview/src/styles.css`
  - MODIFY `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts`
  - CREATE `libs/frontend/chat/src/lib/components/templates/electron-shell.view-transition.spec.ts`
- Acceptance:
  - Components 3 and 4 as specified.
  - `:root` holds the five tokens. Root old and new are symmetric at 180 ms.
  - `ptah-surface` is 120/200 ms with a 4 px rise. `::view-transition { pointer-events: none }`.
  - A reduced-motion block covers `::view-transition-group/old/new(*)`.
  - Exactly one `.ptah-vt-surface` in each of the three Electron shell states.
  - `npx nx test @ptah-extension/chat` (or Jest on the new spec), `typecheck` and `lint` pass.
- Specs: `electron-shell.view-transition.spec.ts` (new).

### B3 - URL reconciliation during a page transition

- Files: MODIFY `libs/frontend/chat/src/lib/services/chat-tab-route-sync.service.ts` and its
  `.spec.ts`.
- Acceptance:
  - Component 5 as specified: routed through `afterTransition`, with the four-condition
    discard guard and a route generation bumped on `NavigationStart` and on each correction.
  - Existing specs pass unchanged with an idle tracker.
  - The new rapid-navigation cases pass: a correction is never issued after the user left chat,
    and never overwrites a newer navigation.
  - Jest on the spec file passes. `typecheck` and `lint` pass for `@ptah-extension/chat`.
- Specs: `chat-tab-route-sync.service.spec.ts` (extended).

### B4 - Transcript entrance

- Files:
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.{ts,html,css}`
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-slot.directive.ts`
  - CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.ts`
  - CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/transcript-entrance.spec.ts`
  - CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.session-enter.spec.ts`
- Acceptance:
  - The transcript part of component 6: the `entering` input (default `false`, no consumer yet),
    the `afterNextRender({ earlyRead, write }, { injector })` snapshot boundary with reads only
    in `earlyRead` and writes only in `write`, the D11 viewport projection, at most 6 marks on
    viewport-visible slots with `--i` / `data-enter-i` from 0 for the oldest visible, the
    unpinned pane fade, removal on the falling edge and on destroy.
  - `selectVisibleEntrance` is pure (no Angular, no transcript types) with the U5 signature,
    and stops its walk at the first slot above the viewport or at the cap.
  - The `:host` tokens are deleted. `.ptah-turn-enter` and `.ptah-pane-enter` are added with a
    reduced-motion block (none plus delay 0).
  - No F6 or F7 work (moved to B7 and B8).
  - All `transcript-entrance.spec.ts` cases and all spec cases of component 6 (including
    "long thread, tall last reply, pinned bottom" and "fewer than 6 visible") pass on real
    transcripts. `chat-transcript.replay-motion.spec.ts` and the other existing transcript
    specs stay green.
  - Jest on the transcript specs passes. `typecheck` and `lint` pass for `@ptah-extension/chat`.
- Specs: `transcript-entrance.spec.ts` (new); `chat-transcript.session-enter.spec.ts` (new).

### B5 - ChatView switch edge and CV-2.1 removal

- Files:
  - MODIFY `libs/frontend/chat/src/lib/components/templates/chat-view.component.{ts,html,css}`
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html`
  - CREATE `libs/frontend/chat/src/lib/components/templates/chat-view.session-enter.spec.ts`
- Acceptance:
  - The ChatView part of component 6: `enteringTabId` with one 400 ms outside-zone timer that
    is cleared on destroy, `[entering]` bound on each transcript, and the host `is-entering`
    class for `.st-r` (retimed).
  - CV-2.1 is fully removed: `playEnter`, `wireSessionSwitchStagger`, `_enterTimer`,
    `clearEnterTimer`, `.st-f`, `.st-t`, `data-st-i`, the composer `--d`, and the `:host`
    tokens. A grep must return no hits.
  - The chat-view spec cases of component 6 pass. Existing chat-view specs stay green.
  - `npx nx test @ptah-extension/chat --parallel=1`, `typecheck` and `lint` pass.
- Specs: `chat-view.session-enter.spec.ts` (new).

### B6 - Canvas motion (rebase after PR for fix/chat-transcript-followups)

- Files:
  - MODIFY `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts`
  - MODIFY `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`
  - MODIFY the lane view spec, or CREATE `canvas-lane-view.motion.spec.ts`
- Acceptance:
  - Component 7 as specified.
  - No `fade` signal, `rail-fade-start` or `rail-focus-fade` remains, and the lane view requests
    no rAF on a `tabId` change.
  - The pane section carries `[animate.enter]="splitDisplayed() ? 'rail-pane-enter' : ''"`,
    with CSS gated by `prefers-reduced-motion: no-preference`. The spec asserts the binding
    only, and that is not proof of animation.
  - The entrance is proven by the M1 S8 frame strip, with and without reduced motion.
  - The rail-shift and focus-swap counters are unchanged.
  - Rebased on the merged `fix/chat-transcript-followups`, with rail-board line references
    re-verified.
  - `npx nx test @ptah-extension/canvas --parallel=1`, `typecheck` and `lint` pass.
- Specs: lane-view motion assertions; rail-board binding assertion.

### B7 - F6 first-frame scroll (only if M0 confirms F6; after B4)

- Files:
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
    (sequenced after B4, which owns it)
  - CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.scroll-restore.spec.ts`
- Acceptance:
  - Component 10, F6 part: the activation restore writes in the activation render pass
    (`afterNextRender({ write })`), not in a rAF; the `scrollGeneration` guard and
    `cancelScrollFrame` semantics are kept.
  - The B4 entrance specs stay green unchanged (the D11 projection holds with or without B7).
  - If M0 does not confirm F6: no file changes; report "not needed (M0)".
  - Jest on the transcript specs passes. `typecheck` and `lint` pass for `@ptah-extension/chat`.
- Specs: `chat-transcript.scroll-restore.spec.ts` (new).

### B8 - F7 empty-state flash (only if M0 confirms F7; after B4 and B7)

- Files:
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.html`
    (sequenced after B4)
  - MODIFY `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`
    only to expose the settled signal (sequenced after B4 and B7)
  - CREATE `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.empty-state.spec.ts`
- Acceptance:
  - Component 10, F7 part: the empty state is not rendered while the tab has a `sessionId()`
    and unsettled history; the existing skeleton shows instead. The settled signal is named
    from source in the batch report; if none exists, stop and report (A5).
  - If M0 does not confirm F7: no file changes; report "not needed (M0)".
  - Jest on the transcript specs passes. `typecheck` and `lint` pass for `@ptah-extension/chat`.
- Specs: `chat-transcript.empty-state.spec.ts` (new).

## Still open

- None. The VS Code S7 question is settled by U6 (Electron only).

## Follow-ups

- VS Code S7 evidence (click receipt, focus during page transitions) — follow-up, not in this
  task (U6).
- Render-caused long tasks over 50 ms, if M1 shows any — follow-up under TASK_2026_629 row 74
  (U2).
- Move `selectVisibleEntrance` to `@ptah-extension/ui` with a container + item directive pair
  when a second list needs it (D12).
