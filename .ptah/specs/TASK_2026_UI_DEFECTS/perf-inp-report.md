# Webview INP / scroll performance report

Scope: read-only source and git-history review on 2026-10-07. No build, test, lint, typecheck, serve, or source edit was run. The supplied sampled heap profile is the primary runtime evidence; source findings below distinguish verified mechanisms from items requiring a performance trace.

## Ranked root causes

### 1. Stream-message drains deliberately re-enter Zone and schedule whole-application ticks (verified; highest impact)

Evidence:

- The webview is zoneful: `apps/ptah-extension-webview/project.json:15` and `apps/ptah-extension-webview/src/main.ts:1` load `zone.js`; `apps/ptah-extension-webview/src/app/app.config.ts:142` installs `provideZoneChangeDetection(...)`, not a zoneless provider.
- The router correctly attaches `message` outside Angular (`libs/frontend/core/src/lib/services/message-router.service.ts:138-149`) and coalesces arrivals into an outside-zone macrotask (`:174-195`).
- But each drain wraps all pending host events in `ngZone.run` (`:198-216`); it then invokes every handler and every member of a `BATCH` synchronously (`:238-267`). Therefore each scheduled stream drain enters Zone and can trigger the `ApplicationRef.tick -> synchronizeOnce -> template refresh` stack seen in the heap profile. `runCoalescing` only folds eligible runs in one event-loop turn; it cannot prevent a later stream macrotask from ticking.

Why it costs: the profile assigns ~80% / 5.7 MB of allocations to that tick path, and `onMessage` itself is the top self allocator (~1 MB). Even with `OnPush`, a zone tick still performs application scheduling/traversal and refreshes every dirty/signal-dependent boundary. Fast host streaming can make this cadence dominate input and scroll responsiveness.

Fix: keep transport/handler ingestion outside Zone. Separate handlers into (a) state writes that can use signal scheduling without `ngZone.run`, and (b) explicitly UI-visible work, published at most once per animation frame (or a bounded 33-50 ms trailing batch) through a small stream-ingestion service. Preserve the current synchronous RPC-response exception (`needsSynchronousFlush`, `:152-172`) for ordering. A more invasive alternative is Angular zoneless change detection after an audit of third-party/event assumptions; do not simply remove `ngZone.run` before the handler contracts are audited.

Expected impact: removes the per-drain whole-app Zone tick from the dominant sampled path; likely the largest improvement to keyboard INP during streaming. Risk: high—RPC response ordering, non-signal handler mutations, and error handling need targeted tests/instrumentation.

### 2. Per-stream update rebuilds transcript structures and revisits a large list (verified; high impact)

Evidence:

- Every `tabs()` identity change makes each active transcript find its tab linearly (`chat-transcript.component.ts:354-357`), rebuilds the execution tree (`:378-387`), creates a finalized-id `Set` (`:389-395`), filters the finalized list (`:397-401`), filters streaming trees and maps them into new message objects (`:403-429`), then merges lists (`:455-469`).
- The render-window synchronization maps every message to ids on the view update (`:785-789`), while the template iterates all message slots (`chat-transcript.component.html:33-69`). Virtualization exists for bubble content, but not for the persistent slot/div/directive per message.
- Identity tracking is present (`track trackByMessageId($index, msg)`, HTML `:33-36`), so there is no evidence of missing list tracking. The report should not attribute the issue to that.

Why it costs: a token update can allocate arrays, Sets, execution-message wrappers and id arrays proportional to transcript/tree size before the render window limits expensive bubble DOM. This aligns with the profile's template allocation evidence and gets worse with long sessions or several retained tabs.

Fix: make stream state append/update granular instead of replacing broad tab objects; cache finalized ID sets and finalized-filter results by source identity; make `ExecutionTreeBuilderService` publish stable node identities / change sets; and move transcript render-window `syncMessages` behind an identity/count/change-set guard so it does not allocate `map` on content-only chunks. Consider windowing slots too (with an accessible retained history/anchor strategy) for very long transcripts.

Expected impact: substantially lower allocation and template work per chunk, especially long conversations. Risk: medium-high—stable identity and finalization handoff semantics are deliberate (`:435-443`) and must be retained.

### 3. Markdown is throttled, but still reparses the entire growing response once per animation frame (verified; high impact for long assistant output)

Evidence:

- `ExecutionNodeComponent` documents the full `marked` tokenize, five extensions, DOMPurify pass, and DOM re-parse cost (`execution-node.component.ts:441-451`). It updates its rendered content on rAF while streaming (`:467-495`).
- Each rendered text node is recursively represented in the execution tree (`:120-130`), so multiple simultaneously-growing nodes multiply that work.
- User-message markdown passes through `SurfaceMarkdownPipe`, whose transform only stores/returns the string (`libs/frontend/markdown/src/lib/surface-markdown.pipe.ts:14-16`); this audit found no evidence that this pipe itself parses markdown per tick. Do not target it first.

Why it costs: rAF is an effective upper bound, but parsing/sanitizing/replacing an increasingly long document remains O(message length) each rendered frame, hence O(n²) across a turn. DOM mutations also feed auto-scroll observers.

Fix: use an incremental stream renderer for the currently-open markdown block, or publish only completed block boundaries plus a small unsanitized-as-text tail that is escaped until closed; retain full marked+DOMPurify rendering for finalized content. Bound active stream render frequency (e.g. 100-150 ms) when frame time is already late, rather than always one parse per frame. Measure separately before changing sanitizer behavior.

Expected impact: large reduction in long-response CPU/layout churn. Risk: high—markdown correctness, syntax highlighting, custom extensions and sanitization must remain equivalent; progressive rendering can alter visible formatting.

### 4. Auto-follow still forces layout after DOM mutations (verified; secondary but can amplify stream lag)

Evidence:

- Transcript scrolling is now a passive outside-zone listener (`chat-transcript.component.ts:848-861`) and rAF-coalesces programmatic bottom sticking (`:868-886`), which is good.
- On every scroll it reads `scrollTop`, `scrollHeight`, and `clientHeight` (`:827-845`); the rAF then reads dimensions and writes `scrollTop` (`:880-885`). The transcript also runs a `ResizeObserver` (setup starts `:916`) whose callback can schedule auto-follow.
- Inline agent bubbles observe every subtree mutation (`inline-agent-bubble.component.ts:771-789`) and, after a 50 ms debounce, read `scrollHeight` then call `scrollTo` (`:796-811`, `:750-758`). This listener is outside Zone (`:761-769`) but the observer/layout work is still on the main thread.

Why it costs: markdown/tree DOM changes can make geometry reads force style/layout; a pinned transcript and nested streaming agent bubble can both do it. It does not explain the sampled Zone tick by itself, but competes directly with scrolling and keyboard event handling.

Fix: have stream rendering emit a single height/dirty signal and schedule one shared rAF measurement/write per transcript; in that frame batch all reads before any writes. Prefer a bottom sentinel / `IntersectionObserver` for pinned state where feasible; restrict inline-bubble observation to direct content or explicit stream publications instead of `subtree: true`.

Expected impact: smoother scroll under rich streamed output; modest alone, material combined with markdown/ingestion work. Risk: medium—scroll anchoring and user-unpin behavior are visible correctness requirements.

### 5. Keyboard input schedules a zoneful update; autocomplete can add synchronous search/allocation (verified mechanism, runtime contribution unverified)

Evidence:

- The composer binds native `(input)` and `(keydown)` in `chat-input.component.ts:212-243`; in this zoneful app these events enter Angular. `handleInput` writes the message signal on every keystroke (`:751-758`). This is expected but explains why keyboard INP is a useful symptom of unrelated app-wide ticks.
- When an `@` or `/` trigger is active, `filteredSuggestions` lowercases/trims the query, calls local file search or obtains every command, allocates a `Set`, merged array and mapped suggestion objects (`:698-749`). Trigger events update the query (`:1067-1073`; subsequent query-change handlers were not timed in this audit).
- The normal input handler performs no explicit layout work, and the textarea uses CSS `field-sizing: content` (`:209-225`); no evidence supports blaming manual textarea resizing.

Fix: after fixing message ingress, profile keyboard interactions both with and without an open trigger. For trigger mode, debounce/cancel file search, pre-index commands, cache mapped suggestion view models, and cap before expensive fuzzy search. Keep draft state local to the composer so its signal does not feed broad state.

Expected impact: normal typing should benefit primarily from cause 1; autocomplete changes reduce trigger-mode spikes. Risk: low-medium—debouncing changes suggestion freshness/keyboard navigation timing.

### 6. CLS target is the Electron global-actions cluster; its own conditional width is a credible cause, exact shift trigger unverified

Evidence:

- The reported selector exactly matches `libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:218`.
- The cluster conditionally adds the back button (`:219-236`) and contains config actions, theme toggle, and notification center (`:237-241`), any of which can change width/state.
- The surrounding title bar uses two flexible spacers around a conditional tab strip (`:123-211`), so a width change in this cluster moves centered elements. The nearby comment states that an activity ticker was moved out specifically because arrivals resized the cluster and shifted tabs (`:213-217`).

Fix: reserve a fixed/minimum inline size for the action cluster and back-button slot (render an invisible, inert placeholder when absent); ensure notification/config controls reserve their badge width. Capture a layout-shift trace to identify the actual changing child before choosing exact dimensions.

Expected impact: should remove the measured header shift and improve CLS; negligible INP impact. Risk: low—mainly responsive title-bar fitting.

## Why the previous scroll-lag fix was not enough

Commit `d5b4564bd` (`perf(webview): coalesce zone runs and move hot scroll listeners out of the zone`) changed `provideZoneChangeDetection` to add `runCoalescing` and moved known hot scroll listeners out of Zone. The current transcript implementation confirms that improvement (`chat-transcript.component.ts:848-861`), as does the inline agent bubble (`inline-agent-bubble.component.ts:761-769`). It removes scroll-event-caused ticks, but it does not change the host message router's intentional `ngZone.run` dispatch (`message-router.service.ts:198-216`), stream-state allocation, markdown parsing, DOM mutation, or forced-layout paths. Therefore it cannot solve an interaction profile dominated by message-driven application ticks.

## File-disjoint implementation batches

1. **Ingress scheduling (core / app config):** `libs/frontend/core/src/lib/services/message-router.service.ts` and, only if selected, `apps/ptah-extension-webview/src/app/app.config.ts`. Audit handlers, preserve synchronous RPC responses, and publish stream UI changes outside Zone on a bounded cadence. Do not combine with transcript refactors.
2. **Transcript data/windowing:** `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`, `.html`, and its render-window/tree-builder collaborators. Stabilize identities/caches and remove full-list allocations on content-only chunks.
3. **Streaming markdown / execution tree:** `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts` plus the designated markdown rendering boundary. Implement progressive/incremental rendering only with sanitizer-equivalence coverage.
4. **Scroll mechanics:** `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts` _or_ `execution/inline-agent-bubble.component.ts` should be assigned to separate lanes if batch 2 owns transcript. Consolidate layout reads/writes and narrow observers.
5. **Composer and CLS:** `chat-input/chat-input.component.ts` for trigger-mode profiling/caching; `components/templates/electron-shell.component.ts` for width reservation. These are independent low-risk changes.

## Audit limits / explicitly unverified items

- The heap profile identifies tick/template allocation but does not map the two large minified `template` functions back to source components. The ranked causal chain is source-supported; exact per-component inclusive time needs a Chrome Performance trace with Angular source maps.
- This audit did not observe live message batch size/rate or individual handler behavior. The router's zone entry is verified; the proportion attributable to each message type is unverified.
- No missing `track` was found in the primary transcript list; primary bubbles are content-virtualized. Claims that missing tracking or zero virtualization is the root cause would be incorrect.
- The exact child causing the CLS event is unverified; the matching container and its width-changing conditions are verified.
