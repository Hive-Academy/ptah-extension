# Renderer-side load and freeze/crash paths — TASK_2026_437

Scope: what in the RENDERER (Angular webview, `libs/frontend/**`,
`apps/ptah-extension-webview`) turns a main-process stall (or its catch-up
burst) into a renderer freeze or crash, with several canvas tiles open.
Backend/main-process causes are covered by sibling agents (main-process /
main-loop investigators) and are only cited here where the renderer receives
their output.

## 1. Tile open / session resume

**CONFIRMED — synchronous replay loop, and the transcript IS duplicated on
the wire, though the duplicate half is unused when events are present.**

- `SessionHistoryReaderService.readSessionHistory` (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:155-311`)
  always computes and returns BOTH `events: FlatStreamEventUnion[]` (full
  replay stream) and `messages: {id,role,content,timestamp}[]` (the "legacy"
  projection) from ONE JSONL parse, uncapped — no tail window, no event count
  ceiling. `ChatSessionService.resumeSession` (`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:876-949`)
  forwards both arrays verbatim into `ChatResumeResult`, which crosses IPC to
  every tile that calls `chat:resume`.
- On the renderer, `SessionLoaderService.switchSession`
  (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:764-772`)
  only ever branches: `if (events.length > 0)` replay events, `else if
(messages.length > 0)` use the legacy array. **The `messages` array is
  therefore dead weight on every session that has `events`** — computed on
  the backend, serialized over IPC (structured clone), and discarded without
  being read. This confirms "duplicate `messages` array with no cap" as a
  real, wasted cost, not as double-rendering.
- The replay itself (`:764-776`) is a **synchronous `for` loop** calling
  `streamingHandler.processStreamEvent(event, tabId, sessionId, {isReplay:
true, fanOut:false})` once per event, on the calling (main renderer) thread
  — nothing yields between iterations. Each call runs the shared
  `StreamingAccumulatorCore` event-type switch (in-place `Map` mutation,
  O(1) amortized per event per the chat-streaming CLAUDE.md), so the loop
  itself is roughly linear in event count, not quadratic. For a session with
  2,044 events this is on the order of low tens of milliseconds in isolation;
  opening three tiles back-to-back after main catches up from a stall means
  three such loops plus three `chat:resume` IPC round-trips land on the
  renderer in a short window, each blocking the UI thread for its own
  duration with no interleaving (no `requestIdleCallback` / chunking in this
  loop).

**CONFIRMED — `finalizeSessionHistory` is quadratic, and the task's
`message-finalization.service.ts:303-321` citation is accurate.**

- `MessageFinalizationService.finalizeSessionHistory`
  (`libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:277-399`)
  iterates `stateCopy.messageEventIds` (one entry per message) and, INSIDE
  that loop, does `[...stateCopy.events.values()].find(...)` **twice per
  message** — once for `message_start` (`:303-306`) and once for
  `message_complete` (`:319-321`). Each `find` call materializes a fresh
  array of the FULL event map and scans it. This is `O(messages × events)`:
  for a session with `M` messages and `E` events, cost is `M × E`, not `M +
E`. A 2,044-event session with, say, 150-250 root/sub messages (typical for
  a long agent turn with subagent fan-out) does on the order of
  300,000-500,000 element visits just for these two scans, on top of the
  `ExecutionTreeBuilderService.buildTree` call at `:291` (which IS
  incremental/memoized per the chat-streaming CLAUDE.md, so that part is not
  the concern). For a 35 MB JSONL — plausibly 10,000+ events across main +
  agent transcripts — the same pattern scales into the seconds range,
  synchronously, once per tile opened. This runs on `finalizeSessionHistory`,
  which `switchSession` calls right after the replay loop (`:773-776`), so
  the two costs stack in the same synchronous stretch per tile.
- Fix direction: build a `Map<messageId, {start, complete}>` once (single
  `O(events)` pass) before the loop, instead of re-deriving it per message
  inside the loop. `finalizeCurrentMessage` (`:121-262`) does NOT have this
  problem — it looks up a single `messageId`, so its `find` calls are O(events)
  once per turn-end, not O(events) per message.

**Main-process side** (for cross-reference with the main-process
investigators; not re-verified in depth here since it is outside this
agent's scope): `chat-session.service.ts:876` calls `readSessionHistory`
synchronously-in-effect (awaited, but the JSONL parse and the
`aggregateUsageStats` / `projectHistoryMessages` passes over
`mainMessages`/`agentSessions` are synchronous JS on the main thread) before
the RPC can reply — this is consistent with the evidence.md's logged
`session:validate` 4.7 s and `chat:continue` 8.6 s.

## 2. Tab persistence

**PARTIAL — not a quadratic/growing-payload risk during normal streaming;
CONFIRMED as a repeat-failure risk after a `QuotaExceededError`.**

- `TabManagerService._doSaveTabState` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:2356-2380`)
  serializes `buildPersistedTabState(tabs, activeTabId)`
  (`tab-persistence.ts:121-130`), which strips `streamingState`,
  `attachedBinding`, and the two turn-state revision fields (`:105-118`) —
  the live flat-event maps never reach `localStorage`. What IS persisted
  per tab includes every finalized `ExecutionChatMessage`, including its
  (already-capped, per `capFinalizedTree`) `streamingState` `ExecutionNode`
  tree. So the payload size scales with **finalized message count × capped
  tree size**, not with raw event count — bounded by the retention caps in
  `chat-streaming`'s `execution-tree-retention.ts` / `agent-output-retention.ts`,
  not unbounded.
- `saveTabState()` (`:2153` etc.) is called from `updateTabInternal` on every
  streaming flush (500 ms debounce, `SAVE_MAX_WAIT_MS` 5 s ceiling,
  `:2300-2309`), but `_doSaveTabState` gates the actual `JSON.stringify` +
  `localStorage.setItem` behind `persistNeeded` (`tab-persistence.ts:246-256`),
  which does a per-field `===` comparison against the last successfully
  written snapshot. Because `streamingState` is excluded and
  `lastActivityAt` has a 30 s granularity (`:95`), a flush that only moved
  streaming content is a no-op here — confirmed by the doc comment at
  `tab-persistence.ts:33-48`. So **per-frame stringify during a live turn is
  NOT happening** as the candidate implied; the 5 s ceiling still fires but
  is filtered by the equality check.
- **The real defect**: on `localStorage.setItem` throwing (quota exceeded),
  the `catch` at `:2377-2379` only `console.warn`s — `this._lastPersisted` is
  NOT updated on failure (it is only set after a successful `setItem`,
  `:2376`). The next `saveTabState()` call (next debounce/ceiling tick, so up
  to every 5 s while a turn streams) sees the SAME stale `_lastPersisted`,
  `persistNeeded` returns `true` again, and the service repeats the FULL
  `JSON.stringify(buildPersistedTabState(...))` over the whole tab set —
  every open tab, every finalized message, every capped tree — only to fail
  the same `setItem` again. With several canvas tiles each holding a long
  session, this is a real, repeating main-thread cost (JSON.stringify over
  potentially several MB of finalized trees) triggered as often as every 5 s
  for the rest of the session, not a one-time failure. This matches the
  candidate's "repeats the full stringify on every save after a quota
  failure" — CONFIRMED, with the mechanism being the stale `_lastPersisted`
  rather than the streaming per-frame call itself.
- Fix direction: on catch, either mark a "quota exceeded" flag that
  short-circuits subsequent `_doSaveTabState` calls until the payload shrinks
  (tab close, retention prune), or back off with an increasing delay instead
  of retrying every debounce/ceiling tick.

## 3. IPC flood after a main stall

**PARTIAL — chat streaming is well-protected; `FILE_CONTENT_CHANGED` is not,
and every inbound `window.message` costs a zone-triggered change-detection
tick regardless of type.**

- Chat streaming events already arrive batched: `MessageRouterService`
  (`libs/frontend/core/src/lib/services/message-router.service.ts:58-86`)
  special-cases `MESSAGE_TYPES.BATCH` and dispatches its inner `events[]` in
  a tight loop — so the burst is already coalesced on the SENDING (main
  process) side before it reaches the renderer as one `postMessage`. Once
  dispatched, chat events feed `BatchedUpdateService.scheduleUpdate`
  (`libs/frontend/chat-streaming/src/lib/batched-update.service.ts:85-95`),
  which is RAF-coalesced (`requestAnimationFrame`, one flush per frame) and
  additionally VISIBILITY-GATED (`shouldDefer`/`canFlush`, `:97-117`): a
  backgrounded or hidden tile's updates are deferred into
  `deferredTabUpdates` and only drained when it becomes visible again
  (`drainDeferred*`, `:127-158`). So a queued burst of chat events for a
  BACKGROUND tile does not force signal writes or CD on tiles the user is
  not looking at — CONFIRMED this path is protected.
- **`FILE_CONTENT_CHANGED` has no coalescing at all.** Its handler,
  `DiffTabsService.onFileContentChanged`
  (`libs/frontend/git-ui/src/lib/services/diff-tabs.service.ts:366-382`), is
  invoked directly from `MessageRouterService.dispatch` (`:67-73`) — O(1) map
  lookup — for EVERY individual `FILE_CONTENT_CHANGED` message, with no
  debounce. It then does `for (const tab of this._diffTabs())` twice
  (worktree-diff tabs and file-view tabs) per event, calling
  `refreshFileView`/`refreshDiffTab` (each an async RPC round-trip) for every
  matching open tab. `GIT_STATUS_UPDATE`, by contrast, IS debounced
  (`onGitStatusUpdate`, `:344-360`, `DIFF_REFRESH_DEBOUNCE_MS` window). A
  worktree delete/prune under `.claude-worktrees` (the confirmed main-process
  defect: watchers not excluding those folders) generates one
  `FILE_CONTENT_CHANGED`-style event per touched file — thousands, queued by
  main during the stall — and NONE of them are coalesced before reaching the
  renderer.
- **Bigger multiplier: every inbound `window.message` runs inside NgZone.**
  `apps/ptah-extension-webview` is explicitly Zone-based
  (`provideZoneChangeDetection({eventCoalescing:true})`,
  `app.config.ts:117`). A DOM `message` event handler
  (`message-router.service.ts:54`) is patched by zone.js, so each dispatched
  message — even one that hits `handlerMap.get()` and finds nothing
  (`:68-69`) — still runs inside `NgZone.run()` and can trigger an Angular
  change-detection pass. `eventCoalescing: true` coalesces CD across
  **synchronous** task batches (e.g., several `dispatch` calls inside one
  `dispatchBatch` loop, or several DOM events in the same microtask), but it
  does NOT coalesce a queue of thousands of SEPARATE macrotask-level
  `message` events delivered one at a time by Electron's IPC as main drains
  its backlog — each is its own zone task and each schedules its own tick.
  This is the renderer-side amplifier for a burst of file-change pushes: not
  just N calls to `onFileContentChanged`, but up to N Angular CD passes
  across every open tile's component tree.
- Fix direction: debounce/coalesce `FILE_CONTENT_CHANGED` the same way
  `GIT_STATUS_UPDATE` already is (a single revalidation per short window,
  keyed by path-set rather than per-message); and/or have the main process
  batch file-change notifications the same way it already batches chat
  events (`MESSAGE_TYPES.BATCH`), so the renderer sees one message instead
  of thousands regardless of handler-side debouncing.

## 4. Per-frame streaming cost scaling with transcript length / tile count

**REFUTED as a quadratic/whole-message re-parse; CONFIRMED as RAF-throttled
but still O(tile count) DOM work per frame.**

- `ExecutionNodeComponent`'s markdown render (`libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:366-419`)
  does NOT re-parse per delta. The `effect()` (`:385-404`) only calls
  `publishNow` immediately for a SETTLED node; for a streaming node it stores
  `pendingContent` and schedules at most ONE `scheduleFrame` callback,
  publishing the latest content once per animation frame. `_renderedContent`
  is a signal, so `<markdown>` (ngx-markdown, full `marked` tokenize +
  DOMPurify) only re-runs when the published STRING actually changes — this
  is a deliberate, already-fixed throttle (see the comment at `:366-377`
  explicitly calling out the O(length²) risk of driving straight from the
  delta stream, and stating it was fixed). So candidate 4's "full markdown
  re-parse per frame" is **not current behavior** for this component.
- The remaining, real cost is `flipAnimationDisabled`
  (`:352-364`): the `[auto-animate]` directive installs a
  `MutationObserver` + `getBoundingClientRect()` per child on every mutation,
  which is explicitly disabled while `isNodeStreaming()` or `isFinalizing()`
  is true — again already mitigated in-code, not a live defect.
  With N canvas tiles simultaneously streaming, the COST is still `O(N)`
  markdown publishes and CD passes per animation frame (one RAF callback per
  streaming node across all visible tiles), which is expected and roughly
  linear in visible tile count — not the quadratic-per-turn blowup the
  candidate worried about. This did not surface any confirmed defect;
  flagging as a residual, bounded scaling factor only.
- Did not find a `tabs().find(...)` pattern inside a `computed()` recomputed
  every frame in the files inspected (`tab-manager.service.ts`,
  `execution-node.component.ts`); `MessageFinalizationService` and
  `SessionLoaderService` use `.find()` but only at finalize/resume time, not
  per render frame. Not able to fully rule this out repo-wide within scope —
  flagged as an UNKNOWN below rather than confirmed or refuted.

## 5. Renderer crash observability

**CONFIRMED — no renderer-process crash/hang observability exists.**

- `apps/ptah-electron/src` has no `webContents.on('render-process-gone', …)`,
  no `webContents.on('unresponsive'/'responsive', …)` listener anywhere
  (grepped the whole `src` tree). The only related hits are (a)
  `did-fail-load` on the initial `loadURL` in
  `electron-browser-capabilities.ts:90-93` — covers a failed PAGE LOAD, not a
  live renderer crash/hang after the page is up — and (b) a `'worker-unresponsive'`
  RECOVERY MODE in `recovery-mode-ipc.spec.ts`, which is IPC-channel
  plumbing for when the BACKEND worker (the in-process host) is unresponsive,
  not the renderer's own `BrowserWindow`/`webContents` process.
- `apps/ptah-extension-webview/src/app/app.config.ts:86-112` registers
  `WebviewErrorHandler` as Angular's `ErrorHandler` (plus
  `provideBrowserGlobalErrorListeners()`), which logs uncaught in-zone
  errors and unhandled promise rejections to `console.error` — but console
  output from a webview/BrowserWindow renderer is **not forwarded to the
  Electron main-process log** (no `webContents.on('console-message', …)`
  found either). So even a "soft" renderer failure (an uncaught exception
  that Angular's error handler DOES catch) is invisible outside DevTools;
  a hard failure (V8 OOM, native crash) kills the renderer process before
  `ErrorHandler` can run at all.
- **User-visible consequence of a renderer OOM/crash under this bug's load
  profile** (per the confirmed math above: multiple tiles doing synchronous
  O(messages×events) finalization plus uncapped duplicate transcript
  payloads, at the same moment several thousand uncoalesced
  `FILE_CONTENT_CHANGED` messages arrive and each drives its own zone tick):
  the window goes blank/white or freezes with no error dialog, no log line
  in `Ptah Electron-*.log`, and no automatic recovery — indistinguishable
  from the main-process hang already documented in `context.md`, except the
  fix surface is entirely different (renderer memory/CPU vs. main-thread
  event-loop lag). Nothing in the current code tells an operator which one
  happened.
- Fix direction: add `webContents.on('render-process-gone', …)` and
  `on('unresponsive'/'responsive', …)` handlers that write to the Electron
  log (same file the main-process lag samples already go to) and,
  ideally, forward `webContents.on('console-message', …)` for at least
  `error`-level renderer console output — this is the one gap that would
  let a future investigation tell a renderer collapse apart from a main
  freeze without reproducing it live.

## Summary table

| Candidate                                                  | Verdict                                                            | Scaling factor                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Tile open replays session in one sync renderer loop        | CONFIRMED                                                          | O(events) per tile, stacks across tiles opened together                    |
| `chat:resume` returns uncapped duplicate `messages` array  | CONFIRMED (wasted, not double-rendered)                            | O(transcript length), pure IPC/serialization overhead                      |
| `message-finalization.service.ts:303-321` quadratic        | CONFIRMED                                                          | O(messages × events) per tile per open                                     |
| Tab persistence retries full stringify after quota failure | CONFIRMED                                                          | O(finalized message bytes across all tabs), repeats every ≤5s post-failure |
| Streaming per-frame full stringify (pre-failure)           | REFUTED                                                            | equality check skips streaming-only flushes                                |
| IPC flood — chat events                                    | REFUTED (already batched/RAF/visibility-gated)                     | —                                                                          |
| IPC flood — `FILE_CONTENT_CHANGED`                         | CONFIRMED (no coalescing)                                          | O(queued file-change events), each forcing a zone CD tick                  |
| Per-frame full markdown re-parse                           | REFUTED (already RAF-throttled, signal-gated)                      | —                                                                          |
| `tabs().find()` in hot computeds                           | UNKNOWN (not found in inspected files, not exhaustively ruled out) | —                                                                          |
| No renderer crash/hang observability                       | CONFIRMED                                                          | N/A — silent failure mode, not a scaling factor                            |
