# Implementation Plan - TASK_2026_453_1eb4

Staged fix for AC-11 of TASK_2026_437_0778: open 3 canvas tiles of a 2,000-event session with no
renderer long task over 200 ms and total long-task blocked time at most 1,500 ms. The budget is
not loosened anywhere in this plan.

## Inputs and constraints

- Requirements used: `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\task.md`, `context.md`
  (user decision 2026-09-15: "Staged: cheap wins, then volume").
- Evidence used (read-only, `D:\projects\ptah-437\.ptah\specs\TASK_2026_437_0778\`):
  `fu22d-attribution-spike-report.md` (primary), `test-report-b22.md` (rev 4), `batches.md`
  (Batch 19, 20, 21, 22 outcomes, FU-22a..d, the FU-22d outcome with its citation correction).
- Code read: PR #518 versions in `D:\projects\ptah-437` (replayer, session loader, perf spec,
  perf-diagnostics, `libs/frontend/chat/CLAUDE.md`); everything else on `origin/main` in
  `D:\projects\ptah-453` (`f1a34aa55`); installed `@angular/core` 21.2.6 and
  `@formkit/auto-animate` 0.8.4 under `D:\projects\ptah-extension\node_modules`.
- Corrections applied to the spike report (from source, see "Codebase evidence"):
  1. The spike ruled out `execution-node.component.ts` `scheduleFrame` as the
     `FireAnimationFrame` source because "every node of a resumed session takes `publishNow`".
     That is not true while the tab replays: the tab is `resuming`, has no finalized messages, so
     every replayed message renders with `isStreaming = true`, and every text node takes the rAF
     path. It is a live candidate again.
  2. The spike's Step 4 said the render window mounts only the tail of 6 plus the viewport. That
     is true after finalization. During replay every replayed message is a "streaming" id, and
     streaming ids are exempt from the window, so the whole partial history mounts.
  3. "TILE_2 carries 88-98 %" is partly a bucketing artifact: `bucketByClick` assigns every long
     task that starts after the third click (about 32 ms into the window) to TILE_2. It does not
     show that the third tile's own work is heavier. The warm 1-tile pass (119 ms / 433 ms) is
     the real evidence that one tile fits.
  4. Citation drift: the canvas effect is at `orchestra-canvas.component.ts:314-329` on main, not
     `293-308`.
- Design handoff used: none (no UI design change; motion is suppressed only during history load).
- Missing decision-critical input: none. All four open decisions were answered by the user (see
  `## User Decisions`).

## User Decisions

Recorded 2026-09-15, relayed by the coordinator.

1. **C5 (replay render-window fence) is in Stage 1.** M1 measures C1, C2, C3 and C5 together.
   Stage 2 keeps options (iii-b), (ii) and (i).
2. **The measured window is extended to "all tiles settled" (C4).** An M0 baseline is taken on the
   rebased main before any product change of this task is in the build. The budget is unchanged.
3. **C2 serializes only the replay and finalize phase, across all tabs.** `session:load` and
   `chat:resume` round trips stay concurrent.
4. **The uncommitted transcript scroll work lands on main first.** Owner: the
   "scrolling-behaviour" Claude session. It is an ad-hoc scroll-fighting fix with no task id or
   branch, uncommitted on main at `f1a34aa55`, functionally final (chat 1192 tests pass), not
   reviewed, and it lands only when the user tells that session to. Its changes (read from the
   working-tree diff of `D:\projects\ptah-extension`):
   - `chat-transcript.component.ts`: `isAdjusting` removed, `lastScrollTop` added. Any upward move
     away from the bottom unpins at once and cancels a pending stick. The rAF stick-to-bottom
     re-checks `pinnedToBottom` and only moves down. `restoreScrollOnActivation` syncs
     `lastScrollTop`. `onScroll` no longer returns early during `isFinalizingTransition`.
   - `chat-transcript.component.css`: `.chat-scroll-container` gets `overflow-anchor: auto`; nested
     `.overflow-y-auto` stays `none`; the `.chat-msg-cv` content-visibility rule is removed.
   - `chat-transcript.component.html`: the `chat-msg-cv` class is removed from
     `ptah-message-bubble`.
   - `message-bubble.component.css`: the `data-finalized` / `is-streaming` content-visibility rules
     are removed.
   - `transcript-render-window.ts`: comment only. Spec: 1 new test.
   - Owner rule: `TranscriptRenderWindow`'s `IntersectionObserver` now bounds the render cost
     instead of `content-visibility`. **No component of this plan may re-add
     `content-visibility` without coordinating with that owner** — it caused scroll-anchor
     fighting.
   - Consequences in this plan: C1 and C5 are blocked on this work and on PR #518 being on main
     and the branch rebased (handoff prerequisites P1-P3). C5 was re-checked against the new
     scroll behaviour (C5 "Scroll behaviour re-check"). M0 includes these edits; an optional
     M0-cv run quantifies the content-visibility effect.

## Codebase evidence

| #   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Location                                                                                                                                                                                                                 | Architectural implication                                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| E1  | `_canvasSessionRequest` is a single-slot `signal<CanvasSessionRequest \| null>`; `requestCanvasSession` `.set`s it and arms a 5 s timer that settles `false`                                                                                                                                                                                                                                                                                                     | `libs/frontend/core/src/lib/services/app-state.service.ts:255-257, 696-714`; readonly view `:329`; clear `:721-723`                                                                                                      | Two sets before one effect flush lose the first request (FU-22a). The fix belongs in `AppStateManager`, the signal-bridge owner.                                                                                                           |
| E2  | One effect consumes it: `addTileFromSession`, then `clearCanvasSessionRequest`, then `chatStore.switchSession(sessionId).then(resolve(true)).catch(resolve(false))`                                                                                                                                                                                                                                                                                              | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:314-329`                                                                                                                                                     | The only consumer. The promise settles after history load, not at tile bind.                                                                                                                                                               |
| E3  | Callers do not await the promise                                                                                                                                                                                                                                                                                                                                                                                                                                 | `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:562-568`; `chat-view.component.ts:981-983`                                                                                                       | Changing the queue does not change caller behaviour.                                                                                                                                                                                       |
| E4  | Existing request specs: signal flip and 5 s timeout                                                                                                                                                                                                                                                                                                                                                                                                              | `libs/frontend/core/src/lib/services/app-state.service.spec.ts:617-642`; mocks `orchestra-canvas.component.spec.ts:210-214, 477-481, 636-640`                                                                            | Seams for C3.                                                                                                                                                                                                                              |
| E5  | `addTileFromSession` enforces `MAX_TILES`, focuses an existing tile for the same session                                                                                                                                                                                                                                                                                                                                                                         | `libs/frontend/canvas/src/lib/canvas.store.ts:175-190`                                                                                                                                                                   | Queue order must be preserved so cap and dedup apply per request in click order.                                                                                                                                                           |
| E6  | `SessionHistoryReplayer`: `claim` opens the session fence at claim time; `replay` runs 250-event chunks, `yieldToMacrotask` after each chunk, re-checks claim, tab presence and binding, then `finalizeSessionHistory` and `closeFence`                                                                                                                                                                                                                          | `D:\projects\ptah-437\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts:84, 92, 110-124, 154-192`                                                                                       | Serialization (C2) and the replay flag (C1) belong here; the post-yield checks are the model for the post-admission check. `claims` is a plain map "nothing renders from it" (`:94-95`), so a render signal is a new, deliberate addition. |
| E7  | Loader: claim before `chat:resume` (`:657`), `applyResumingSession` (`:685-690`), `setStatus('resuming')` (`:700`), `replay` (`:782-787`), `setStatus('loaded')` (`:803`), `release` in `finally` (`:824`)                                                                                                                                                                                                                                                       | `D:\projects\ptah-437\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts` (1,350 lines)                                                                                                            | The loader is over the soft ceiling; C1/C2 must not grow it.                                                                                                                                                                               |
| E8  | `applyResumingSession` writes `messages: []`, a fresh `streamingState`, `status: 'resuming'`                                                                                                                                                                                                                                                                                                                                                                     | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2107-2131`                                                                                                                                                      | During replay the tab has zero finalized messages.                                                                                                                                                                                         |
| E9  | `status: 'resuming'` is also written by a live continue (`markResuming`)                                                                                                                                                                                                                                                                                                                                                                                         | `libs/frontend/chat/src/lib/services/message-sender.service.ts:632-633`; `tab-manager.service.ts:1143-1151`                                                                                                              | Tab status alone cannot mean "history replay"; C1 must not key on it.                                                                                                                                                                      |
| E10 | `finalizeSessionHistory` flushes batched updates then `applyFinalizedHistory` (`messages`, `streamingState: null`, `status: 'loaded'`)                                                                                                                                                                                                                                                                                                                           | `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts:330, 444`; `tab-manager.service.ts:1647-1653`                                                                                                      | Finalize is one synchronous write; the flag clear in C1 happens in the same task.                                                                                                                                                          |
| E11 | Replay writes reach the tab through `BatchedUpdateService.scheduleUpdate` → one `requestAnimationFrame` → `setStreamingState` for every pending tab; deferred while a tab is not visible                                                                                                                                                                                                                                                                         | `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:405-428`; `batched-update.service.ts:84-95, 100-125`                                                                                                  | One rAF flush can write several tiles at once.                                                                                                                                                                                             |
| E12 | Transcript: `isStreaming` is true for `resuming`; `streamingMessages` are all trees not in finalized messages; `vm.finalizedCount = finalized.length`                                                                                                                                                                                                                                                                                                            | `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts:277-280, 315-341, 398-415`                                                                                                      | During replay `finalizedCount` is 0 and every replayed message is "streaming".                                                                                                                                                             |
| E13 | Template: `[isStreaming]="i >= vm().finalizedCount"`, `[isFinalizing]="isFinalizingTransition()"`, mount gate `renderWindow.isMounted(msg.id)`                                                                                                                                                                                                                                                                                                                   | `chat-transcript.component.html:15, 21-22`                                                                                                                                                                               | During replay every bubble gets `isStreaming = true`.                                                                                                                                                                                      |
| E14 | `syncMessages(ids, finalizedCount)` adds every id at or past `finalizedCount` to the always-mounted tail; `isMounted` is true for tail ids                                                                                                                                                                                                                                                                                                                       | `transcript-render-window.ts:118-134, 142-146`; fed at `chat-transcript.component.ts:481-491`                                                                                                                            | **During replay the window is defeated: the whole partial history mounts.** This is the volume driver the spike could not find.                                                                                                            |
| E15 | `isFinalizingTransition` goes true on the `isStreaming` true→false edge for 300 ms                                                                                                                                                                                                                                                                                                                                                                               | `chat-transcript.component.ts:456-477`                                                                                                                                                                                   | A settle window already exists after `resuming → loaded`; C1 extends suppression to cover replay itself.                                                                                                                                   |
| E16 | `message-bubble` forwards `isStreaming` and `isFinalizing` to `ptah-execution-node`; host `[attr.data-finalized]="!isStreaming()"`                                                                                                                                                                                                                                                                                                                               | `libs/frontend/chat/src/lib/components/organisms/message-bubble.component.html:102-105`; `message-bubble.component.ts:85-86`                                                                                             | Gate values reach the recursive tree through existing inputs.                                                                                                                                                                              |
| E17 | `ExecutionNodeComponent`: `flipAnimationDisabled = isNodeStreaming() \|\| isFinalizing()` bound to `[autoAnimateDisabled]` at `:192, :244`; `exec-fade-in` CSS keyframe applied when `!isFinalizing()` (`:127, 133, 153-177, 221`); text effect takes `scheduleFrame` (one rAF per node) whenever `isNodeStreaming()`                                                                                                                                            | `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:73-80, 348-364, 385-404`                                                                                                          | During replay every text node schedules a rAF (a `FireAnimationFrame` candidate). `isFinalizing` already gates FLIP and fade-in.                                                                                                           |
| E18 | Ungated FLIP container in the agent bubble: `[auto-animate]` without `[autoAnimateDisabled]`; agent footer `animate.enter="agent-fade-in"` / `animate.leave` static; `isFinalizing` input exists                                                                                                                                                                                                                                                                 | `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts:445-450, 512-518, 689`                                                                                                       | Gate must be added here (not exercised by the fixture, which has no agents).                                                                                                                                                               |
| E19 | Bubble badges use static `animate.enter="bubble-fade-enter"` / `animate.leave="bubble-fade-leave"`                                                                                                                                                                                                                                                                                                                                                               | `message-bubble.component.html:127-131, 157-161`                                                                                                                                                                         | Every finalized message with tokens mounts one of these; the fixture's `message_complete` carries `tokenUsage`.                                                                                                                            |
| E20 | `agent-execution.component.ts` uses `[auto-animate]` and `animate.enter`, but no template in `libs/` renders `<ptah-agent-execution>`                                                                                                                                                                                                                                                                                                                            | grep over `libs/frontend` (only its own selector at `agent-execution.component.ts:55`)                                                                                                                                   | Out of scope.                                                                                                                                                                                                                              |
| E21 | `AutoAnimateDirective`: controller only when `!reducedMotion && !autoAnimateDisabled`; created in `ngAfterViewInit` or when the input flips back to enabled                                                                                                                                                                                                                                                                                                      | `libs/frontend/chat/src/lib/directives/auto-animate.directive.ts:56-57, 68-99, 110-120`                                                                                                                                  | Re-enable after settle creates controllers for every still-mounted container — bounded by the render window once replay ends.                                                                                                              |
| E22 | auto-animate 0.8.4 init: `getComputedStyle`, per-child `updatePos`/`poll`/`resize.observe`, a `MutationObserver`; per-child `IntersectionObserver`; `lowPriority` uses `requestIdleCallback` (rAF only as fallback)                                                                                                                                                                                                                                              | `node_modules/@formkit/auto-animate/index.mjs:92-123, 126-178, 678-705`                                                                                                                                                  | Confirms the spike: auto-animate is not the `FireAnimationFrame` source.                                                                                                                                                                   |
| E23 | Angular `animate.enter` with a non-empty class list: adds classes, then `requestAnimationFrame` → `determineLongestAnimation` → `el.getAnimations()` (or `getComputedStyle`) **per entering element**; `animate.leave` does the same plus a fallback timer and delays DOM removal                                                                                                                                                                                | `node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:13285-13299, 13302-13345` (rAF `:13333`), leave `:13419-13466` (rAF `:13452`), `determineLongestAnimation` `:4231-4234`, `getComputedStyle` path `:4220-4230` | **Source-backed candidate for both open unknowns: the 1,400+ `FireAnimationFrame` firings and the residual ~678 ms `getAnimations` with auto-animate off.**                                                                                |
| E24 | An empty class list skips the rAF entirely: `getClassListFromValue('')` → `[]`, and `runEnterAnimation` only schedules when `activeClasses.length > 0`                                                                                                                                                                                                                                                                                                           | `_debug_node-chunk.mjs:4108-4114`; `:13323` condition (leave `:13409`)                                                                                                                                                   | A bound value of `''` is a zero-cost off switch.                                                                                                                                                                                           |
| E25 | The compiler supports the bound form `[animate.enter]="expr"` (`BindingKind.Animation` → a function the runtime calls at enter/leave time); dev-mode assert requires a string or function                                                                                                                                                                                                                                                                        | `node_modules/@angular/compiler/fesm2022/compiler.mjs:9917-9918, 10259-10265`; assert `_debug_node-chunk.mjs:4012-4016`                                                                                                  | C1 can gate Angular enter/leave motion without a new directive. The value must be `''`, never `null`.                                                                                                                                      |
| E26 | Zone app with `eventCoalescing: true`                                                                                                                                                                                                                                                                                                                                                                                                                            | `apps/ptah-extension-webview/src/app/app.config.ts:117`                                                                                                                                                                  | Another rAF user; the attribution step must separate it.                                                                                                                                                                                   |
| E27 | Other rAF call sites in the tile path: transcript stick-to-bottom (`chat-transcript.component.ts:534-548`), chat-view resize (`chat-view.component.ts:314`), canvas layout (`canvas-layout.service.ts:60`), inline agent bubble scroll (`inline-agent-bubble.component.ts:769`)                                                                                                                                                                                  | as cited                                                                                                                                                                                                                 | Few calls each; listed so the M0 histogram can name them.                                                                                                                                                                                  |
| E28 | `yieldToMacrotask` is the one macrotask-yield helper; rAF never fires in a hidden window                                                                                                                                                                                                                                                                                                                                                                         | `libs/frontend/core/src/lib/services/macrotask-scheduler.ts:1-18, 73-77`; `libs/frontend/core/CLAUDE.md` Key Files                                                                                                       | A paint yield between replays must race rAF with a timer, never wait on rAF alone.                                                                                                                                                         |
| E29 | Precedent: `ChatViewComponent` injects chat-store child services directly for animation suppression (`CompactionLifecycleService.suppressAnimateOnce`) and `SessionLoaderService`                                                                                                                                                                                                                                                                                | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:41-42, 150-160`                                                                                                                                  | C1 reads the replayer from chat-view and passes a plain input down; the transcript stays service-free for this.                                                                                                                            |
| E30 | chat-view specs do not stub `SessionLoaderService`, so the real root loader (which already injects the replayer) is constructed                                                                                                                                                                                                                                                                                                                                  | `chat-view.component.spec.ts:335-370`                                                                                                                                                                                    | Injecting the replayer in chat-view adds no new dependency to those specs (Assumption A4 check).                                                                                                                                           |
| E31 | Perf harness: window = native clicks with one rAF between clicks, closed by a `MutationObserver` that finds all marker strings; `longtask` observer disconnected later in `collectLongTasks`; hard-coded `BACKUP_DIR = 'D:\\projects\\ptah-437-backup'`; assertion `max <= 200`, `total <= 1500`                                                                                                                                                                 | `D:\projects\ptah-437\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts:158-176, 443-482, 538-625, 791-795`                                                                                   | Window can close before finalization (User Decision 2). Output dir must be configurable for `ptah-453`.                                                                                                                                    |
| E32 | Fixture: ~150-190 turns per session; each turn = user message + assistant message with 2-4 deltas, 1-2 `Read` tools, `tokenUsage`                                                                                                                                                                                                                                                                                                                                | same spec `:223-317`                                                                                                                                                                                                     | ~380 messages per tile; one text node and 1-2 tool nodes per assistant message; no agent nodes.                                                                                                                                            |
| E33 | `bucketByClick` assigns a task to the last click at or before its start                                                                                                                                                                                                                                                                                                                                                                                          | `D:\projects\ptah-437\apps\ptah-electron-e2e\src\support\perf-diagnostics.ts:72-104`                                                                                                                                     | Correction 3 above.                                                                                                                                                                                                                        |
| E34 | Degradation audit flags catch/`.catch` sentinel returns, empty catches; ratchet per directory                                                                                                                                                                                                                                                                                                                                                                    | `tools/degradation-audit/check-degradation.ts:1-60`                                                                                                                                                                      | No new `catch { return <literal> }` or empty `.catch`.                                                                                                                                                                                     |
| E35 | `libs/frontend/chat/CLAUDE.md` rule 7 is the replayer contract (claims, chunks, fence, yield semantics)                                                                                                                                                                                                                                                                                                                                                          | `D:\projects\ptah-437\libs\frontend\chat\CLAUDE.md:70-74`                                                                                                                                                                | C1 and C2 add two bullets to rule 7.                                                                                                                                                                                                       |
| E36 | Pending scroll work (uncommitted in `D:\projects\ptah-extension` working tree at `f1a34aa55`): `onScroll` unpins on `top < lastScrollTop - 1 && distanceFromBottom > 1` and cancels the pending stick; re-pins within `NEAR_BOTTOM_PX`; stick rAF returns unless still pinned and only sets `scrollTop` when `scrollTop < scrollHeight - clientHeight`; `.chat-scroll-container { overflow-anchor: auto }`; `.chat-msg-cv` and bubble content-visibility removed | `git -C D:\projects\ptah-extension diff` of `chat-transcript.component.{ts,css,html}`, `message-bubble.component.css`, `transcript-render-window.ts`                                                                     | Line numbers E12-E15 and E27 shift after it lands (re-cite, P3). Every mounted bubble now pays full layout and paint, so replay mount volume (E14) costs more than in the Batch 22 measurements. C5 re-checked against it.                 |

## Architecture decision

- **Chosen approach**: five components in two stages plus measurement gates (per User Decisions).
  - Stage 1: C3 queue canvas session requests (FU-22a); C1 replay motion gate (auto-animate FLIP,
    Angular `animate.enter/leave`, `exec-fade-in` off from replay start through the post-finalize
    settle); C2 replay admission (one replay-and-finalize at a time across tabs, a paint yield
    between them); C5 replay render-window fence (replayed history mounts through the window);
    C4 harness amendments (settle-inclusive window, rAF call-site attribution, trace summary,
    event-count override, DOM node count, configurable output dir).
  - Measurement M0 (baseline on the rebased main with #518 and the scroll work, after C4, before
    any C1/C2/C3/C5 change is in the build) and M1 (after C1, C2, C3 and C5). Decision point
    after M1.
  - Stage 2 (gated by M1 and a user decision): option (iii-b) per-frame mount budget if only the
    max task fails, then (ii) tail-paged history only if event-count-driven JS cost remains over
    budget; (i) not recommended for AC-11.
- **Rationale**:
  - The motion gate targets measured cost (auto-animate off: −31 % to −37 % total, spike 3a) and
    the two unexplained buckets, which source now ties to Angular `animate.enter/leave` (E23-E24)
    and per-node streaming rAF during replay (E17).
  - Admission targets the max-task budget: one rAF flush writes all pending tiles at once (E11),
    so three concurrent replays stack DOM work in the same frames; warm 1-tile already fits.
  - The queue is a correctness bug on the same click path and blocks a realistic stagger.
  - C5 targets the linear-with-events volume (E12-E14) at its source with no contract change.
- **Rejected alternatives**:
  - Gate on tab `status === 'resuming'`: shared with a live continue (E9), so a user's own new
    turn would lose its motion and the C5 fence could apply to a live turn.
  - Gate on the replayer claim (claim → release): the claim spans the `chat:resume` round trip,
    during which a targeted compaction reload keeps the old transcript visible
    (`session-loader.service.ts:680-691`); the flag must start at replay start.
  - A new "motion suppressed" input threaded through bubble/node/agent bubble: `isFinalizing`
    already carries exactly "a finalize burst is happening, no fades, no FLIP" (E15-E18); a
    second input would duplicate it.
  - Disable Angular animations globally via `ANIMATIONS_DISABLED` during load: the token is read
    from the element injector per view (E23 `areAnimationsDisabled`), not reactive, and would
    also silence unrelated surfaces.
  - Stagger in the canvas effect (await each `switchSession`): serializes the RPC too, only covers
    canvas opens, and edits `orchestra-canvas.component.ts` beyond the queue drain while canvas
    work is active in other worktrees.
  - Stagger by only yielding between tiles without serialization: the chunk yields already
    interleave; the shared rAF flush still stacks tiles per frame.
  - Debounce the sidebar click instead of queuing: `chat-view.component.ts:982` also requests,
    and a slow effect flush still drops requests.
- **Assumptions** (each with the check that resolves it):
  - A1: between replay chunks the browser renders frames, so the partial history does mount
    during replay (E11 + E14 make it possible; frame timing makes it likely). Check: M0 DOM node
    count sampled while `resuming` (C4) and a C5 unit spec asserting the mount set while replaying.
  - A2: the 1,400+ `FireAnimationFrame` firings are dominated by E17 (per text node during
    replay) and E23 (per `animate.enter/leave` element). Check: the M0 rAF call-site histogram.
  - A3: component effects run before their template in the same change-detection pass, so
    `isFinalizingTransition` is already true when the first finalized render happens. Check: C1
    spec asserts no `bubble-fade-enter` class and no FLIP controller on the finalize render.
  - A4: injecting `SessionHistoryReplayer` in `ChatViewComponent` needs no new spec stubs (E30).
    Check: run `@ptah-extension/chat` specs after C1.
  - A5 (**revised against M0, 2026-09-16**): Stage 1 with C5 may meet AC-11; without C5 it would
    not — M0 makes that stronger, not weaker. M0 measured (`test-report.md`): dev cold max
    1,926 / 1,326 / 1,062 ms and total 6,941 / 5,463 / 4,077 ms (mean total ≈ 5,494 ms);
    production cold max 1,201 ms, total 4,767 ms. AC-11 is missed by 6.0× on max and 3.2× on
    total, so the baseline this estimate starts from is 5,494 ms, not 5,745 ms.
    **The animation-gate credit is cut to its low end.** A5 previously credited the Angular
    animation gate with an unmeasured 0-15 % of the remainder. M0's rAF histogram shows E23
    (`animate.enter` / `animateLeaveClassRunner`) does not appear as a distinct rAF call site at
    all, and E26 (`scheduleCallbackWithRafRace`, the scheduler the Angular animation callbacks may
    route through) is 30 calls / 2.0 %. Read the credit as **0-5 %**, and attribute no part of the
    `scheduleFrame` share to it: `scheduleFrame`'s branch is gated by `isNodeStreaming()`, not by
    `isFinalizing()` (C1 subsection 1a), so C1 does not touch it.
    Revised estimate: C1 + C2 + C3 without C5 ≈ 5,494 ms × 0.63-0.69 (spike 3a, auto-animate off)
    minus 0-5 % ≈ **3.3-3.8 s total** — still ~2.2-2.5× over the 1,500 ms budget, and the max task
    still bounded by one tile's own replay. C5 then removes D × ~90 % of the remainder (Stage 2
    model: D = 55-70 %) AND the `scheduleFrame` rAF path in full (88.3 % of 1,517 captured rAF
    calls; `FireAnimationFrame` is 18.9 % of the 2,000-event window, 1,386 calls / 1,257.53 ms,
    scaling 3.09× for a 4× event increase) → about **1.0-1.9 s total**; max bounded by one tile's
    largest task (estimate 150-500 ms). The scroll work removes content-visibility, which raises
    the DOM share D before C5 and is part of why M0 sits above the Batch 22 numbers. All figures
    are Assumptions. Check: M1 (see "What M1 must show" below).
  - A8: the per-message-node residual rAF (a message whose `message_complete` has not yet
    replayed, `message-node.fn.ts:47`) is bounded at about one node per chunk flush and needs no
    fix. Check: the M1 rAF histogram (C1 subsection 1a).
  - A7: with the scroll work, a replayed bubble that leaves the tail of 6 while still inside the
    viewport stays mounted because the observer has already reported it intersecting (observer
    callbacks and the replay flush both run at frame cadence). Check: C5 spec (tail shift with an
    intersecting slot keeps it mounted) and M1 DOM counts; see C5 "Scroll behaviour re-check".
  - A6: `jest-environment-jsdom` provides `requestAnimationFrame`; the C2 paint yield also has a
    timer path, so specs can drive it with fake timers either way. Check: C2 spec.
- **Effect on existing code**: replaces the single-slot request API in `AppStateManager`
  (`canvasSessionRequest` / `clearCanvasSessionRequest` are deleted, not kept beside the queue);
  adds admission and a replay-tab signal to the replayer; changes static animation attributes in
  two templates to bound forms; widens what `isFinalizing` means from "stream just ended" to "a
  finalize burst or a history replay is in progress" (scroll handling no longer reads it after
  the scroll work, E36); feeds the render window a replay-aware streaming boundary (C5). Left
  alone: session loader, `TabManagerService`, streaming write path, `TranscriptRenderWindow`
  class, the scroll logic and CSS from the scroll work (no `content-visibility` re-added), canvas
  store and tile, auto-animate directive, `AC-11` budgets.

## Component specifications

### 1. C1 — Replay motion gate

- **Purpose**: no enter, leave or FLIP motion while a tile's history replays and through the
  settle after finalization; normal motion for live updates.
- **Exact signal**:
  - `SessionHistoryReplayer.replayingTabIds: Signal<ReadonlySet<string>>` (private writable,
    public readonly) and `isReplaying(tabId: string): boolean` (a signal read).
  - Set: the tab id is added on `replay()` entry, before admission (C2) and before the first
    chunk.
  - Cleared: in a `finally` inside `replay()` on every exit — `replayed` (after
    `finalizeSessionHistory` and `closeFence`, same synchronous task), `superseded`, or a throw.
    A newer replay of the same tab re-adds it; removal must be keyed by claim so an older
    replay's `finally` does not clear a newer replay's flag.
  - Transcript gate: `motionSuppressed = computed(() => historyReplaying() ||
isFinalizingTransition())`. The `resuming → loaded` edge starts the existing 300 ms
    `isFinalizingTransition` (E15), so suppression is continuous from replay start to 300 ms after
    finalize. Live events held by the fence are delivered at finalize (E6 `:189-190`), inside the
    suppressed window — the same as today's finalize burst.
- **Responsibilities**:
  - Replayer: own and publish the replay-tab set (no UI timing knowledge).
  - `ChatViewComponent`: read `isReplaying(tabId)` and bind `[historyReplaying]` on each
    `<ptah-chat-transcript>` (template `chat-view.component.html:64-72`).
  - `ChatTranscriptComponent`: new `historyReplaying = input<boolean>(false)`; bind
    `[isFinalizing]="motionSuppressed()"` instead of `isFinalizingTransition()` on the bubble.
  - `message-bubble.component.html:129-130, 159-160`: bound forms,
    `[animate.enter]="isFinalizing() ? '' : 'bubble-fade-enter'"` and the matching leave.
  - `inline-agent-bubble.component.ts`: `[autoAnimateDisabled]="isFinalizing()"` on the container
    at `:449`; bound enter/leave on the footer at `:517-518`.
  - `execution-node.component.ts`: no change (already gated by `isFinalizing`, E17).
  - `libs/frontend/chat/CLAUDE.md` rule 7: one bullet for the replay-tab signal and the gate.
- **Verified contracts and entry points**: E6, E10, E13, E15-E19, E21, E23-E25, E29.
- **Dependencies**: components → replayer (same lib, precedent E29); no new lib edge; frontend
  only.
- **Integration points**: canvas tiles reach it through `canvas-tile.component.ts` →
  `ChatViewComponent` → `ChatTranscriptComponent` (spike Step 4, team-leader spot-check).
- **Failure behaviour**: a throwing chunk or yield clears the flag in `finally`; the loader's
  failure branch sets `loaded` (E7 `:791-800`) and the 300 ms settle runs as today. A flag left
  set would freeze motion for that tab only — prevented by the claim-keyed `finally`, pinned by a
  spec. Reduced-motion behaviour is unchanged (directive still honours it).
- **Quality requirements**: OnPush, signals, `inject()`; no `[innerHTML]`; zero rAF from
  `animate.enter/leave` while suppressed (E24); `chat-transcript.component.ts` stays under 700
  lines (612 on main, about 620 after the scroll work). C1 does not touch the scroll methods,
  `lastScrollTop`, the CSS, or add `content-visibility` (User Decision 4). After the scroll work
  `onScroll` no longer reads `isFinalizingTransition`, and C1 leaves that signal itself unchanged
  (it adds a separate `motionSuppressed` computed), so scroll handling is unaffected.
- **Prerequisites**: P1, P2, P3 (handoff) — blocked until PR #518 and the scroll work are on main
  and the branch is rebased.
- **Verification seam**:
  - Replayer spec: flag set on entry, cleared on each outcome, claim-keyed clear across a
    superseding replay.
  - New `chat-transcript.replay-motion.spec.ts`: with `historyReplaying` true, bubbles receive
    `isFinalizing = true`; after it turns false and status settles, the flag stays true for the
    300 ms window then false (fake timers).
  - `message-bubble` spec: with `isFinalizing` true no `bubble-fade-enter` class is added to the
    badge and `requestAnimationFrame` is not called for it; with false the class is added.
  - `inline-agent-bubble` spec: controller not created while `isFinalizing` is true.
  - Perf: M1 compared with M0.
- **Files**:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.spec.ts` (only if the new cases do not fit the C2 spec file; prefer the new file)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-motion.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md`

#### 1a. C1 scope decision — the `scheduleFrame` rAF path stays with C5 (M0 correction)

**Decision: C1 does NOT widen. The 88.3 % rAF cost is recovered by C5, through the `isStreaming`
contract that already exists, and `execution-node.component.ts` stays unchanged in both
components.** This is an architecture decision, not a user decision: the source settles it.

**The team-leader's finding is correct, and it is a finding about attribution, not about design.**
Verified in this worktree:

| Evidence                                                                                                                                    | Location                                                                                                        | Implication                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `isFinalizing` drives only `[class.exec-fade-in]` and `flipAnimationDisabled`                                                                | `execution-node.component.ts:127, 133, 153-177, 321, 362-364`                                                   | C1's gate cannot reach the rAF branch. The team-leader is right.                                                   |
| The render-throttle effect branches on `isNodeStreaming()` alone: `publishNow` and `return` when false, `scheduleFrame` when true            | `execution-node.component.ts:385-404` (`:391-393` early return, `:398` `scheduleFrame`)                          | One gate owns the whole rAF path, and it is `isNodeStreaming`, not `isFinalizing`.                                 |
| `isNodeStreaming = isStreaming() \|\| node().status === 'streaming'`                                                                        | `execution-node.component.ts:348-350`; input at `:312`                                                          | The gate is reachable from the transcript without touching this file — through the `isStreaming` input.            |
| The transcript binds `[isStreaming]="i >= vm().finalizedCount"`                                                                              | `chat-transcript.component.html:21`; `finalizedCount` at `chat-transcript.component.ts:407`                     | This single binding is the sole producer of the flag for every replayed bubble.                                    |
| During replay every replayed tree is a `streamingMessages` entry — it is excluded only once its id is in the tab's `messages`                | `chat-transcript.component.ts:316-342` (`:323-327`); finalize writes `messages` (E10)                          | Replay ⇒ replayed bubbles sit at or past `finalizedCount` ⇒ `isStreaming` true ⇒ `scheduleFrame`. Cause confirmed. |
| Text and thinking nodes are built with `status: 'complete'`, never `'streaming'`                                                             | `chat-execution-tree/src/lib/builders/message-node.fn.ts:144-153`                                               | For the nodes that carry markdown, the bubble input is the ONLY term that can make `isNodeStreaming` true.         |
| C5 already replaces exactly that binding: `streamingBoundary = historyReplaying() ? totalCount : finalizedCount`, bound as `i >= boundary`   | this plan, C5 responsibilities                                                                                   | C5 flips `isStreaming` to false for every replayed bubble, so the effect takes `publishNow` — the rAF path is gone. |

So the rAF branch is not "ungated by C1 and therefore unowned". It is owned by C5, by construction,
and always was — C5's own text already names the consequence ("text nodes `publishNow` instead of
one rAF per node (E17)"). What M0 changes is the SIZE of that C5 line item, not who owns it.

- **Options compared**:
  - **(a) Leave it to C5 (chosen).** Expected recovery: the whole of the `scheduleFrame` share —
    1,339 of 1,517 captured rAF calls, 88.3 % (`test-report.md` rAF histogram) — because the
    branch is not taken at all when `isStreaming` is false, on top of the ~380 → ~20-40 mount
    reduction that removes most of the node instances that would call it. Risk to live streaming:
    none beyond what C5 already carries — `streamingBoundary` collapses to `finalizedCount` when
    `historyReplaying()` is false, so a live turn keeps `isStreaming` true, keeps the one-render-
    per-frame throttle, and keeps its typing behaviour. The live-event fence means no live chunk
    renders during replay anyway (E6). Spec cost: zero new inputs, zero new files beyond those C5
    already creates. File-ownership order: unchanged — Batch 4 does not touch
    `execution-node.component.ts` and does not pre-empt Batch 5's binding.
  - **(b) Widen C1 to pass `historyReplaying` into `execution-node` (rejected).** It would add a
    second gate on a branch that already has one, and Batch 5 would then have to unpick it: C1
    would set `isStreaming` semantics one way at `:21` while C5 replaces that very binding at
    `:21` two batches later. That is Batch 4 breaking Batch 5's premise, which the decomposition
    explicitly forbids. It also pushes `historyReplaying` three components deep
    (transcript → bubble → node → nested node, `execution-node.component.ts:198, 233, 250`) for a
    signal the bubble's existing `isStreaming` input already carries, duplicating a contract — the
    same reason this plan already rejected "a new 'motion suppressed' input threaded through
    bubble/node/agent bubble". Recovery over (a): ~0 %, since (a) already removes the branch.
  - **(c) Move C5's `streamingBoundary` binding forward into C1 (rejected).** It reaches the cost
    one batch earlier and is otherwise identical, but it reorders the stage/batch content, which
    this decision is not permitted to do, and it would split C5's mount-window change from the
    `isStreaming` change that shares its correctness argument and its spec file.
- **Residual not covered by C5, recorded as an Assumption (A8).** A message node carries
  `status: completeEvent ? 'complete' : 'streaming'`
  (`chat-execution-tree/src/lib/builders/message-node.fn.ts:47`), so the single message whose
  `message_complete` has not yet been replayed still takes the rAF branch on its own status, with
  `isStreaming` false. That is bounded at roughly one node per chunk flush — about 8 per tile at
  `REPLAY_CHUNK_SIZE = 250` over 2,000 events
  (`session-history-replayer.service.ts:84`) — versus 1,339 measured calls. No fix is planned.
  Check: the M1 rAF histogram; if `scheduleFrame` does not fall below ~10 % of a much smaller
  total, reopen this decision before Stage 2.
- **Verification seam (no new component change).** The property "a replayed node publishes
  synchronously while a live node still schedules a frame" is asserted by two existing/planned
  specs composed:
  1. `execution-node.render-throttle.spec.ts` already pins the node half, with a
     `requestAnimationFrame` spy at `:100`: `:191-205` (leaving streaming publishes on the same
     tick, no frame flush), `:207-211` (a settled node renders on the first pass without waiting
     for a frame), `:233-240` (a node whose own `status` is `'streaming'` is still throttled — the
     A8 residual, already pinned). Batch 4 and Batch 5 must both leave this file green and
     unedited.
  2. C5's `chat-transcript.replay-mount.spec.ts` pins the transcript half and MUST assert both
     directions explicitly, as one test each: while `historyReplaying` is true, every rendered
     `<ptah-message-bubble>` receives `isStreaming = false`; with `historyReplaying` false and a
     live streaming message present, the message at index `>= finalizedCount` receives
     `isStreaming = true` (so the live typing throttle survives). C5's verification seam already
     names the first; the second is added by this decision and is the live-streaming regression
     guard.
- **Change the team-leader must make to Task 4.1 AC 6**: keep the sentence
  "`execution-node.component.ts` unchanged" exactly as it is, and append one clause recording why,
  so the next reader does not re-open it —
  "…unchanged: its `scheduleFrame` rAF branch is gated by `isNodeStreaming()`
  (`:348-350, 385-404`), not by `isFinalizing()`, and is recovered in Batch 5 by C5's
  `streamingBoundary` binding. Task 4.1 must NOT add a second gate for it." No other Task 4.1
  acceptance criterion changes, and Task 4.1's file list is unchanged. Task 5.1 gains the second
  spec case named above.

### 2. C2 — Replay admission (staggered tile opens)

- **Purpose**: at most one history replay runs its chunks and finalization at a time, across all
  tabs, with a paint opportunity between two replays.
- **Policy**:
  - Scope: the `replay()` phase only (chunks + `finalizeSessionHistory` + `closeFence`). The
    `session:load` and `chat:resume` round trips stay concurrent.
  - Order: FIFO by `replay()` entry (click order for canvas opens).
  - Uncontended: no replay active and no waiter → admitted synchronously, with no added `await`,
    so a ≤250-event replay keeps today's synchronous timing (E6 `:164-174`).
  - Contended: wait for the slot. On admission re-run the post-yield checks of E6 `:176-186`
    (claim current, tab present, tab still bound) and return `superseded` with the same status
    handling; a superseded waiter releases the slot at once.
  - Release: in `finally` on every exit (replayed, superseded, throw, failed yield). Before the
    next waiter runs: `yieldToMacrotask()` then a paint yield = the first of
    `requestAnimationFrame` or a 50 ms timer (rAF never fires in a hidden window, E28). The helper
    stays private to the replayer (one consumer; no speculative core export).
  - "One tile finalizes before the next starts rendering": the slot is held through
    `finalizeSessionHistory` and `closeFence`, and the paint yield lets that finalized render
    commit before the next replay's first chunk.
- **Interaction with the Batch 20 claim/fence**: the fence opens at claim time and stays open
  while a replay waits, so live `chat:chunk` events for a waiting session are buffered longer.
  `LIVE_EVENT_FENCE_LIMIT` (2,000, E6 `:92`) is unchanged; past it the existing overflow path
  delivers without the fence. Two tabs replaying one session queue separately and share the fence
  as today. Global `SessionManager` status can flip `loaded` while a later replay waits — the
  pre-existing FU-20a, recorded, not fixed here.
- **Per-tile latency cost**: tile k waits for the replay and finalize of tiles 0..k-1 plus one
  paint yield each (≤ ~50 ms). Estimate +0.5 to +1.5 s per tile ahead (Assumption, from warm 1-tile
  wall 198 ms and cold 3-tile walls 3.9-7.6 s); M1 records wall time per tile.
- **Verified contracts and entry points**: E6, E7, E11, E28, E35.
- **Prerequisites**: P1 and P3 (the replayer exists only after PR #518). C2 touches no transcript
  file, so it does not wait for P2 to be written, but it must not be in the M0 build.
- **Dependencies**: `@ptah-extension/core` `yieldToMacrotask` (existing); no new edges.
- **Integration points**: every resume path through `SessionLoaderService.switchSession`
  (canvas, sidebar in single mode, compaction reload) — admission is a replayer rule, so the
  loader is not modified.
- **Failure behaviour**: a throw leaves `replay()` as today (fence open for the caller's failure
  branch, E6 `:152-153`) and the `finally` releases the slot; a failed paint yield cannot reject
  (timer path). A waiter whose tab closed exits `superseded` on admission. No sentinel catch.
- **Quality requirements**: replayer stays under 700 lines (331 now; admission + flag ≈ +100);
  no timers left pending after release (spec with fake timers).
- **Verification seam**: CREATE `session-history-replayer.admission.spec.ts`: three chunked
  replays on three tabs run strictly in sequence (no chunk of B before A's finalize); FIFO; a
  superseded waiter, a closed-tab waiter and a throwing active replay each release the slot; an
  uncontended ≤250-event replay has finished writing before `replay()`'s promise settles with no
  extra microtask; fence events for a waiting session are delivered after that session's
  finalize. Existing `session-history-replayer.service.spec.ts` and session-loader specs green.
  Perf: M1 per-tile buckets (C4 marker-based buckets).
- **Files**:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts` (shared with C1)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.admission.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md` (rule 7 bullet; shared with C1)

### 3. C3 — Canvas session request queue (FU-22a)

- **Purpose**: every `requestCanvasSession` call is processed once, in order, however many land
  before the canvas effect runs.
- **Responsibilities**:
  - `AppStateManager`: replace `_canvasSessionRequest` with
    `_canvasSessionRequests = signal<readonly CanvasSessionRequest[]>([])`; expose
    `canvasSessionRequests` (readonly) and `takeCanvasSessionRequests(): readonly
CanvasSessionRequest[]` (returns the queue and empties it; no write when already empty).
    `requestCanvasSession` appends. Delete `canvasSessionRequest` and
    `clearCanvasSessionRequest`. Update the `CanvasSessionRequest` doc (E1 `:108-121`) and the
    `requestCanvasSession` doc (`:682-695`).
  - Timeout: when the 5 s timer settles `false`, remove that request from the queue if still
    there, so a request reported as failed is never executed later. (Today the last unconsumed
    request survives on the slot; the queue would otherwise open a burst of stale tiles when the
    canvas mounts.)
  - `OrchestraCanvasComponent` effect (`:314-329`): read `canvasSessionRequests()`; when
    non-empty, `untracked(() => takeCanvasSessionRequests())` and run the existing per-request
    body for each in order (`addTileFromSession`, then `switchSession` with the same
    `.then/.catch` resolution). Promise semantics unchanged (settles after `switchSession`).
- **Verified contracts and entry points**: E1-E5.
- **Prerequisites**: none (no #518 file, no transcript file). May start before P1-P3, but must not
  be in the M0 build.
- **Dependencies**: canvas → core (existing direction); no chat change.
- **Integration points**: callers E3 unchanged (same method signature). `app-state.service.spec.ts`
  type `canvasSessionRequest: CanvasSessionRequest | null` at `:52` changes with the rename.
- **Failure behaviour**: tile cap → `resolve(false)` per request as today; `switchSession`
  rejection → `resolve(false)`; the timer drops an unconsumed request. The effect writing a signal
  it reads re-runs once with an empty queue and returns.
- **Quality requirements**: no `setTimeout` leak (timer cleared on resolve, as today); no new
  degradation-audit site (`.catch` handler keeps calling `resolve`, not returning a literal).
- **Verification seam**:
  - `app-state.service.spec.ts`: two requests before `take` are both returned in order; `take`
    empties; a timed-out request is removed and resolves `false`; resolve `true` path.
  - `orchestra-canvas.component.spec.ts`: two requests queued before one `TestBed.tick()` → two
    `addTileFromSession` and two `switchSession` calls in order; cap on the second → `false` only
    for the second.
  - e2e: none required; the perf spec's per-click rAF stays (it is the disclosed stress cadence).
- **Files**:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\core\src\lib\services\app-state.service.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\core\src\lib\services\app-state.service.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts`

### 4. C4 — Perf harness amendments

- **Purpose**: a measurement that counts every tile's work to settle, attributes rAF firings,
  and runs from this worktree; budgets unchanged.
- **Responsibilities**:
  - Settle-inclusive window (User Decision 2): after all markers are found, keep observing the
    canvas tiles' subtree; the window closes after a 1,000 ms quiet period with no mutation inside
    `[data-testid="canvas-tile"]` (longer than the 300 ms settle + 320 ms FLIP duration), capped
    at 10 s. A cap hit writes `settled: false` and throws "measurement unusable" — never a pass.
  - Keep the `longtask` observer connected until the window closes; `wallMs` measured to close.
  - Per-tile buckets by marker appearance time (record `performance.now()` when each marker is
    found) in addition to `bucketByClick`, so a serialized run shows each tile's own share.
  - `PTAH_PERF_RAF_ATTRIBUTION=1` (diagnostic tests only, never with the assertion): an
    `addInitScript` wrapper on `window.requestAnimationFrame` that records the first stack frame
    outside the wrapper per call, counted by `url:line:column` and function name; written to the
    diagnostics JSON with the top 20 sites.
  - `PTAH_PERF_TRACE=1`: re-add the spike's `Tracing.*` capture (same categories) as a permanent
    diagnostic; a pure `summarizeTraceEvents` in `perf-diagnostics.ts` returns count and total
    `dur` per event name, main-thread only (filter by the renderer main thread id) so background
    GC/compile threads are not summed into the window.
  - `PTAH_PERF_EVENTS` override (500 / 1,000 / 2,000) for diagnostic tests only; the gated cold
    test always uses 2,000.
  - DOM node count of `[data-testid="canvas-tile"] *` at settle, and sampled once while any tile
    is still replaying (A1 check).
  - Output dir from `PTAH_PERF_OUT_DIR`, default `os.tmpdir()/ptah-perf` (FU-22b); fix the stale
    "below" reference.
  - FU-22b size: move the fixture builder (`makeRand`, `buildLargeSessionEvents`,
    `makeSessionFixture`, `SessionFixture`) to a support file, and the page/CDP capture helpers
    (trace, rAF wrapper, settle observer) to another, so the spec file shrinks instead of growing.
  - Scroll sanity check after the window closes (outside the measured window): each tile's
    `.chat-scroll-container` is within `NEAR_BOTTOM_PX` (120) of its bottom and shows its own
    marker. A failure is reported as a functional regression of C5 / the scroll work, not as a
    perf result.
  - Update `apps/ptah-electron-e2e/CLAUDE.md` "Perf specs" with the new flags.
- **Verified contracts and entry points**: E31-E33.
- **Prerequisites**: P1 and P3 (it edits the spec and `perf-diagnostics.ts` that PR #518 adds).
  M0 needs P1, P2 and P3.
- **Dependencies**: Playwright + CDP only; no product code.
- **Failure behaviour**: unusable measurements throw with a reason (timeout, unsettled, missing
  marker); diagnostic writes stay guarded (the `.cpuprofile` write gets the same guard).
- **Quality requirements**: harness adds no work inside the asserted window beyond today's
  scoped `MutationObserver` (the rAF wrapper and tracing are diagnostic-only); skip proof without
  `PTAH_PERF_SPECS`.
- **Verification seam**: `perf-diagnostics` unit behaviour for `summarizeTraceEvents` and marker
  bucketing if the e2e project runs unit specs; otherwise `lint,typecheck` on `ptah-electron-e2e`,
  a skip-proof run, and M0 itself.
- **Files**:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\support\perf-diagnostics.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\support\perf-session-fixture.ts`
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\support\perf-page-capture.ts`
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\CLAUDE.md`

### 5. C5 — Replay render-window fence (Stage 1, User Decision 1)

- **Purpose**: replayed history is mounted through the render window like finalized history, not
  as always-mounted streaming content.
- **Responsibilities**:
  - `ChatTranscriptComponent` view model gains `streamingBoundary = historyReplaying() ?
totalCount : finalizedCount`.
  - The render-window effect (`:481-491`) passes `streamingBoundary` instead of `finalizedCount`,
    so during replay only the tail of 6 plus observer-reported ids mount (E14).
  - The template binds `[isStreaming]="i >= vm().streamingBoundary"`, so replayed bubbles render
    as settled content: text nodes `publishNow` instead of one rAF per node (E17), no typing
    cursor, `data-finalized` true.
  - `vm().isStreaming` (skeleton, E12 `:39`) and `TranscriptRenderWindow` itself are unchanged.
- **Verified contracts and entry points**: E12-E14, E16, E17, E36.
- **Prerequisites**: P1, P2, P3 and C1.
- **Scroll behaviour re-check** (against the scroll work, E36):
  1. _Pinned bottom during replay._ Each flush appends messages; the content-follow effect
     schedules the stick, which moves down only while pinned. With C5 the tail of 6 moves as
     messages append. A bubble that leaves the tail stays mounted if the observer already reports
     it intersecting, which is the normal case for anything in the viewport (A7). If a slot leaves
     the tail before its first observer callback, it drops to a placeholder (120 px, or its
     leaving-edge height). The browser's `overflow-anchor: auto` keeps the anchor node still, so
     the distance from the bottom does not change. `onScroll` then does not unpin, because its
     unpin rule needs `distanceFromBottom > 1`, and the next stick re-sticks. No new unpin path.
  2. _User scrolls up mid-replay._ One upward move unpins at once and cancels the pending stick
     (scroll work rule). Appended replay content lands below without pulling the reader. Before
     C5 the same happened, but over ~380 mounted bubbles.
  3. _Placeholders mounting on scroll-up._ During replay C5 now leaves off-screen history
     unmounted, so scrolling up mounts placeholders exactly as after finalize today. The height
     correction above the viewport is absorbed by `overflow-anchor: auto` on the container. This
     is the owner's mechanism, and C5 adds no scroll write.
  4. _`lastScrollTop`._ C5 never writes `scrollTop` and does not read `lastScrollTop`. Only the
     existing stick and activation paths write them.
  5. _Finalize edge._ Before C5, finalize unmounted ~350 bubbles per tile in one pass, which is a
     large height change at the anchoring and stick boundary. With C5 the mount set is already
     windowed, so finalize changes `isStreaming` bindings but not the mount set. There is less
     scroll disturbance, not more.
  6. _Nested scrollers_ (`.overflow-y-auto`, `overflow-anchor: none`): untouched.
  7. _No `content-visibility`_ is added by C5 or any other component.
  - Residual risk: the tail-shift case in item 1 is timing dependent and jsdom has no layout, so
    it cannot be proven by a unit spec. It is covered by the C4 post-window scroll sanity check in
    M1. If that check fails, the fix stays inside C5 (for example, during replay, keep ids that
    were in the previous tail mounted until the next observer callback). It must not touch the
    scroll logic without the scroll-work owner.
- **Dependencies**: the C1 `historyReplaying` input (C5 after C1).
- **Integration points**: stick-to-bottom follows message count as today; the observer mounts
  within `RENDER_WINDOW_MARGIN_PX` of the viewport.
- **Failure behaviour**: without `IntersectionObserver` the window mounts everything (degradation
  unchanged, `transcript-render-window.ts:36-38, 143`). A flag stuck true would leave a live turn
  virtualized — prevented by C1's claim-keyed `finally`. A superseded replay's partial tree is
  replaced by the next resume's `applyResumingSession`.
- **Quality requirements**: expected mounted bubbles per tile during replay ≤ 6 + observer set
  (about 20-40 with 120 px placeholders and a 2,000 px margin) instead of ~380.
- **Expected recovery (revised against M0, 2026-09-16)**: C5 is the single largest Stage 1 line
  item, and M0 raised it. It now carries two effects, not one:
  1. _Mount volume_ — D × ~90 % of the layout/paint/GPU share (D = 55-70 %). Unchanged.
  2. _The `scheduleFrame` rAF path (new; see C1 subsection 1a)_ — binding
     `[isStreaming]="i >= vm().streamingBoundary"` makes `isNodeStreaming()` false for every
     replayed bubble, so the render-throttle effect takes `publishNow` and never reaches
     `scheduleFrame` (`execution-node.component.ts:348-350, 385-404`). M0 attributes **1,339 of
     1,517 captured rAF calls (88.3 %)** to that one call site, inside a `FireAnimationFrame`
     bucket worth **18.9 % of the 2,000-event window (1,386 calls, 1,257.53 ms)** that scales
     **3.09× for a 4× event increase**. C1 does not reach any of it.
  Combined, C5 is expected to take the Stage 1 remainder from ≈ 3.3-3.8 s to ≈ 1.0-1.9 s (A5).
  This is an Assumption sized from M0 counts; a call-count share is not a time share.
- **What M1 must show to confirm** (all from the C4 amendments, per 3-tile cold run):
  1. `scheduleFrame` falls below ~10 % of a much smaller rAF total, and under ~150 absolute calls
     (from 1,339) — the A8 residual is the only expected source left.
  2. `FireAnimationFrame` self-time share falls from 18.9 % to under ~5 % of the window.
  3. DOM node count sampled while `resuming` falls from ~21,000 whole-canvas (M0 runs I/J and
     production: 21,113 / 20,931 / 20,954) to **≤ 2× the settled count per tile**, reported
     per-tile, not whole-canvas.
  4. AC-11: all 3 cold dev runs and the production cold run pass max ≤ 200 ms and total
     ≤ 1,500 ms (from 1,926 / 1,326 / 1,062 and 6,941 / 5,463 / 4,077; production 1,201 / 4,767).
  5. The C4 post-window scroll sanity check passes (C5 residual risk, item 1).
  If 1 and 2 hold but 4 fails, the remaining cost is mount/paint volume and Stage 2 (iii-b) is the
  indicated next step. If 1 fails, reopen the C1 subsection 1a decision before Stage 2.
- **Verification seam**: CREATE `chat-transcript.replay-mount.spec.ts` (local fake
  `IntersectionObserver`, not a shared helper, so the scroll work's spec file is not edited):
  while replaying, a 50-message streaming list mounts only the tail until the observer reports;
  a slot reported intersecting stays mounted when it leaves the tail; bubbles get
  `isStreaming = false`; **and (added by the C1 subsection 1a decision) the live direction: with
  `historyReplaying` false and a live streaming message present, the message at index
  `>= finalizedCount` still receives `isStreaming = true`** — this is the regression guard that a
  real live turn keeps its per-frame typing throttle. The node half of the property is already
  pinned by `execution-node.render-throttle.spec.ts:100, 191-211, 233-240`, which C5 must leave
  green and unedited. When replay ends and status settles, a live streaming message is exempt
  from the window again. The spec must not reference `isAdjusting` (removed by the scroll work).
  The existing "Gate A: mounted bubbles are bounded" and scroll specs stay green. Perf: M1 DOM
  node count, totals, and the C4 scroll sanity check.
- **Files**:
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts` (shared with C1)
  - MODIFY `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html` (shared with C1)
  - CREATE `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-mount.spec.ts`

## Stage 1 — cheap wins, then measure

### Stage 1 acceptance criteria

- S1-AC1 (C3): N requests issued before one effect flush open N tiles in FIFO order; a
  timed-out request is never processed later; cap and failure resolve `false` per request.
- S1-AC2 (C1): from replay start to 300 ms after finalize, no auto-animate controller is created
  on transcript containers, no Angular enter/leave class is applied (bound value `''`), no
  `exec-fade-in` class; after the settle a live child addition animates again; reduced motion
  unchanged.
- S1-AC3 (C2): one replay-and-finalize at a time across tabs, FIFO; every exit releases the slot;
  an uncontended ≤250-event replay has no added async step; fence ordering unchanged (existing
  replayer and loader specs green).
- S1-AC4 (C5): during replay only the tail of 6 and observer-reported ids mount, and replayed
  bubbles render with `isStreaming = false`. After replay a live streaming message is exempt from
  the window again. The M1 DOM node count per tile during replay is at most 2× the post-finalize
  count. The C4 scroll sanity check passes on every M1 run. No `content-visibility` is added.
- S1-AC4b (C4): settle-inclusive window; flags work; scroll sanity check; skip proof; M0 recorded.
- S1-AC5 (gates): `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/canvas
@ptah-extension/chat --maxWorkers=2` header 3; `run-many -t lint,typecheck` on the same plus
  `ptah-electron-e2e` and `ptah-extension-webview`; `npx nx run degradation-audit:lint
--skip-nx-cache` TOTAL equal to the rebased main's baseline (303 at `f1a34aa55` + #518).

### Measurement batches (senior-tester)

- Protocol (TASK_2026_437 `handoff.md` §8): idle machine, runner count 0 before and after every
  run (the spike's `Get-CimInstance` check), at most 2 test runners, `--maxWorkers=2`, no
  `nx reset`, explicit-path staging, a discarded run is re-run, never averaged in.
- **M0 — baseline**: built from the rebased main that contains PR #518 and the scroll work
  (P1-P3), plus C4, and no C1, C2, C3 or C5 change. Runs: cold 3-tile dev ×3 (assertion test);
  warm 1-tile ×1; warm 3-tile ×1; production cold ×1; `PTAH_PERF_RAF_ATTRIBUTION=1` cold ×1;
  `PTAH_PERF_TRACE=1` cold at 500 and at 2,000 events ×1 each; DOM node counts in every run.
- **M0-cv — optional, only if cheap** (diagnostic, never a gate): one cold 3-tile dev run
  without the scroll work's content-visibility removal, to measure its cost. Cheapest path:
  1. If C4 is ready before the scroll work merges, run it on that build.
  2. Otherwise, apply a temporary local re-add of the removed `.chat-msg-cv` rule and class and
     the bubble rules, run once, then restore the files byte for byte. Confirm the restore with
     `git status` / `git diff`; this follows the FU-22d spike precedent.
     The run is never committed. Report it next to the M0 cold runs as "content-visibility delta".
     It does not reopen User Decision 4.
- **FireAnimationFrame step (in M0)**: read the rAF histogram. Expected top sites, each
  source-cited: Angular `runEnterAnimation` / `animateLeaveClassRunner` (E23),
  `execution-node` `scheduleFrame` (E17), `BatchedUpdateService.scheduleUpdate` (E11), Angular
  scheduler / zone coalescing (E26), transcript scroll (E27). Cross-check with the trace: if the
  `FireAnimationFrame` count scales with events from 500 to 2,000, the caller is per node or per
  element. Record the verdict in the test report; it confirms or refutes A2.
- **M1 — after Stage 1** (C1, C2, C3 and C5 together): the same run set as M0, plus the C4
  scroll sanity check on every run.
- **Decision point after M1**:
  - AC-11 MET = all 3 cold dev runs and the production cold run pass `max <= 200 ms` and
    `total <= 1,500 ms` under the settle-inclusive window → stop; record in `test-report.md`.
  - Otherwise → report the remaining gap (max and total), the rAF histogram and the DOM counts,
    and ask the user to choose the Stage 2 option. No Stage 2 code starts without that decision.

## Stage 2 — volume (gated by M1 and a user decision)

Model (spike 3b): total blocked time ≈ 2.9-3.1 ms per per-session event with 3 tiles, about
1 ms per replayed event. Assumed split of main-thread cost: DOM-volume-driven share D = 55-70 %
(layout/paint/GPU ~40-48 % of the window plus the DOM-driven part of `FireAnimationFrame`), and
event-driven JS share J = 30-45 % (accumulator, tree build, finalize, GC). The trace summed all
threads, so these shares are Assumptions until M0's main-thread trace summary.

C5 (formerly option (iii-a): mounted bubbles per tile during replay ~380 → ~20-40, D × ~90 %
recovery, **plus the whole `scheduleFrame` rAF path — 88.3 % of M0's captured rAF calls, inside a
`FireAnimationFrame` bucket worth 18.9 % of the 2,000-event window; see C5 "Expected recovery"**)
moved to Stage 1 by User Decision 1, so the table below sizes what is left after M1.

| Option                                                                | What it cuts                                                                | Expected recovery (of the Stage 1 remainder)                                                                   | UX impact                                                                                 | Files                                                                                                                                                                                                                              | Risks                                                                                                                                                                                                  |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| (iii-b) per-frame mount budget in `TranscriptRenderWindow`            | Mounts at most K newly intersecting ids per frame (K ≈ 8), rest next frames | Max task only (spreads mounts); total roughly unchanged                                                        | Brief placeholder band on a fast flick                                                    | `transcript-render-window.ts` + spec, `chat-transcript.component.ts`                                                                                                                                                               | Medium: interacts with the scroll work's `overflow-anchor: auto` and placeholder mounting — design with the scroll-work owner; needs a rAF-with-timer rule for hidden windows; no `content-visibility` |
| (i) virtualize the nested execution-node tree inside mounted messages | Nodes inside each mounted message                                           | Fixture: small (≤ 1 text + 2 tools per message), below 10 % once C5 is in. Large for agent-heavy real sessions | Collapsed/deferred children inside long messages; permission prompts must stay mounted    | `execution-node.component.ts`, `inline-agent-bubble.component.ts`, `message-bubble.component.html` + specs                                                                                                                         | High: recursive template, FLIP containers, permission and question cards inside virtualized subtrees                                                                                                   |
| (ii) tail-paged history                                               | Replayed events per tile 2,000 → N (e.g. 250), both D and J                 | ~80-88 % of total at N = 250                                                                                   | "Load older" on scroll-up; search/branch/rewind anchors on unloaded messages need a fetch | shared `rpc-chat.types.ts` (`ChatResumeResult` cursor), `agent-sdk` `session-history-reader.service.ts`, `rpc-handlers` `chat-session.service.ts`, CLI `interact.ts` + JSON-RPC docs, replayer, finalization, transcript paging UI | High: public contract change across backend, CLI and renderer; stats, compaction boundary, dedup and live-event fence at page edges                                                                    |

- **Recommendation** (applies only if M1 fails):
  - (iii-b) if M1 total is within 1,500 ms and only the max task fails.
  - (ii) if M1's main-thread trace shows event-driven JS (replay, tree build, finalize, GC) alone
    above 1,500 ms total. It is a user decision because it changes the `chat:resume` contract.
  - (i) is not recommended for AC-11. Record it as a follow-up for agent-heavy sessions.
- **Stage 2 acceptance criteria**: AC-11 MET under the same M1 run set, with the scroll sanity
  check. No regression in existing transcript specs ("Gate A: mounted bubbles are bounded" and
  the scroll work's specs; re-cite their lines after P3).

## Integration architecture

- **Data flow** (tile open, after Stage 1):
  1. Sidebar click → `AppStateManager.requestCanvasSession` appends to the queue (C3).
  2. Canvas effect takes the queue → per request `addTileFromSession` → `ChatStore.switchSession`.
  3. Loader: `session:load` → claim + fence → `applyResumingSession` → `chat:resume` (concurrent
     across tiles).
  4. Replayer `replay()`: flag tab replaying (C1) → admission (C2) → chunks → `processStreamEvent`
     → `BatchedUpdateService` rAF flush → tab `streamingState`.
  5. Transcript: `historyReplaying` → `motionSuppressed` → bubbles/nodes get `isFinalizing`;
     (C5) replayed ids go through the window.
  6. `finalizeSessionHistory` → `applyFinalizedHistory` → `closeFence` delivers live events →
     flag cleared → loader `setStatus('loaded')` → `release`.
  7. Transcript edge → 300 ms settle → motion back on; admission slot released after a paint
     yield → next tile's replay.
- **State or persistence**: queue lives in root `AppStateManager` (app lifetime, never
  persisted); replay-tab set and admission queue live in root `SessionHistoryReplayer` (app
  lifetime, in-memory); `TabState` unchanged, so tab persistence is unaffected (`resuming` is
  already non-restorable, `tab-persistence.ts:141-148`).
- **External boundaries**: none new. No IPC, RPC, file or AI-tool boundary changes in Stage 1 or
  (iii). Option (ii) would change the `chat:resume` contract and needs Zod-validated shared types.
- **Failure and rollback**: every new wait is released in `finally`; every product change is a
  revertable per-batch commit; C4 can be reverted independently of product commits.
- **Observability**: one `console.warn` if a replay waits for admission longer than a threshold
  (e.g. 10 s) with the tab id and queue length, so a wedged slot is visible; the perf spec's
  diagnostics JSON is the evidence path for timing.

## Architecture-level quality requirements

- **Functional**: S1-AC1..5 (including S1-AC4 and S1-AC4b); AC-11 decided by M1 (or the Stage 2
  measurement); scroll behaviour of the scroll work preserved (C4 sanity check, its specs green).
- **Performance**: AC-11 budget unchanged — no long task > 200 ms, total ≤ 1,500 ms, cold 3 tiles
  of 2,000 events, dev ×3 and prod ×1, settle-inclusive window. Warm 1-tile must not regress
  beyond run noise versus M0.
- **Security**: not applicable (no new boundary; markdown still flows through
  `libs/frontend/markdown`).
- **Maintainability**: frontend-only; no backend import; canvas → core and chat → core/chat-state
  directions unchanged; `session-loader.service.ts` not modified; replayer and transcript under
  700 lines; no version-suffixed copies; old single-slot API deleted.
- **Testability**: every gate, admission path and queue ordering above has a unit spec in a new
  or existing file; perf evidence is the Batch 22 spec with C4.

## Conflicts with concurrent work

- **PR #518 (`fix/task-437-main-loop-isolation`)**: adds `session-history-replayer.service.ts`
  and its spec, rewrites parts of `session-loader.service.ts`, adds the perf spec and
  `perf-diagnostics.ts`, edits `libs/frontend/chat/CLAUDE.md`. C1, C2, C4 and C5 build on those
  files: prerequisite P1. C3 does not depend on #518.
- **`task-442-fluid-canvas-spans`**: merged as #514; its worktree is at `f1a34aa55` with no diff
  and no uncommitted change. No conflict.
- **`task-451-compact-tile-sizing`** (uncommitted): `canvas-layout-intent.ts` + spec,
  `canvas-layout.service.ts` + spec, `canvas-tile.component.ts`,
  `canvas-workspace-grid.component.ts`, `canvas.store.ts`. This plan touches none of them; C3 edits
  only `orchestra-canvas.component.ts` and its spec (not in 451's diff). Low risk; if 451 later
  touches `orchestra-canvas.component.ts`, the effect body at `:314-329` is the likely hunk.
- **Scroll work, main checkout `D:\projects\ptah-extension`** (uncommitted at `f1a34aa55`; owner:
  the "scrolling-behaviour" Claude session; no task id or branch; lands when the user tells that
  session to): `chat-transcript.component.{ts,html,css,spec.ts}`, `transcript-render-window.ts`
  (comment), `message-bubble.component.css`. High overlap with C1 and C5
  (`chat-transcript.component.ts`, `.html`) and it changes the measurement baseline. Resolution
  (User Decision 4): it lands on main first (prerequisite P2); C1 and C5 start only after the
  rebase; C1/C5 specs go in new files; no component re-adds `content-visibility` or edits the
  scroll methods or CSS without that owner.

## Team-leader handoff

- **Recommended executors**:
  - C3: frontend-developer (core + canvas signals/effect, unit specs).
  - C1 + C2: one frontend-developer, sequential in one batch or two consecutive batches — both edit
    `session-history-replayer.service.ts`.
  - C5: frontend-developer, after C1 (shares transcript files and the `historyReplaying` input).
  - C4: senior-tester (harness only).
  - M0, M1: senior-tester on an idle machine.
- **Complexity**: MEDIUM. Small file count, but async ordering in the replayer and a measurement
  window change need careful specs and clean runs.
- **Prerequisites** (external, not batches of this task):
  - P1: PR #518 (`fix/task-437-main-loop-isolation`) merged to main.
  - P2: the scroll work committed on main by its owner session. The user triggers this; this task
    does not commit it.
  - P3: `perf/task-453-tile-open-long-tasks` rebased on a main that contains P1 and P2. Then
    re-open and re-cite E6, E7, E12-E15, E27, E31-E33, E35 and E36, the Gate A spec line, and the
    `chat-transcript.component.ts` line count.
- **Start gates per component**:
  - C3: may start now. It touches no #518 file and no scroll-work file.
  - C4: after P1 + P3, because it edits #518's perf spec and diagnostics. It touches no
    scroll-work file.
  - C2: after P1 + P3 (replayer). It touches no scroll-work file.
  - C1 and C5: blocked until P1, P2 and P3 are all done.
  - M0: after P1, P2, P3 and C4.
- **Dependencies and ordering** (component level):
  - M0's build contains no C1, C2, C3 or C5 change. C3 or C2 committed earlier must be excluded:
    either commit them after M0, or build M0 from the commit before them. The team-leader picks
    one and records it.
  - C1 before C5 (shared transcript files and the `historyReplaying` input).
  - **C1 must not gate `scheduleFrame`** (C1 subsection 1a). Amend Task 4.1 AC 6 with the recorded
    clause; add the live-direction case to Task 5.1's spec. Neither batch edits
    `execution-node.component.ts` or `execution-node.render-throttle.spec.ts`.
  - C1 and C2 share `session-history-replayer.service.ts`: sequential or one batch.
  - M1 after C1, C2, C3 and C5 are all in the build.
  - Stage 2 only after M1 fails and the user chooses an option.
- **Parallel-safe work**: C3 (core + canvas) and C4 (e2e) are file-disjoint with each other and
  with C1/C2/C5 (chat). C5 is not parallel with C1. C2 is not parallel with C1.
- **Files affected**:
  - CREATE
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.admission.spec.ts` (C2)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-motion.spec.ts` (C1)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-mount.spec.ts` (C5)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\support\perf-session-fixture.ts` (C4)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\support\perf-page-capture.ts` (C4)
  - MODIFY
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\core\src\lib\services\app-state.service.ts` (C3)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\core\src\lib\services\app-state.service.spec.ts` (C3)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts` (C3)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts` (C3)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts` (C1, C2)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` (C1)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\templates\chat-view.component.html` (C1)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts` (C1, C5)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html` (C1, C5)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html` (C1)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.spec.ts` (C1)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts` (C1)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts` (C1)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md` (C1, C2)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts` (C4)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\support\perf-diagnostics.ts` (C4)
    - `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\CLAUDE.md` (C4)
  - REWRITE: none.
  - Stage 2 only (not in Stage 1): `transcript-render-window.ts` + spec (iii-b); option (i) and
    (ii) file lists in the Stage 2 table.
- **Verification points**:
  - P3 re-citation done and recorded before C1/C2/C4/C5 start.
  - `grep` shows no `content-visibility` added by this task's diff, and no edit to `onScroll`,
    `scheduleStickToBottom`, `restoreScrollOnActivation` or the transcript CSS.
  - The scroll work's own specs stay green in the `@ptah-extension/chat` run.
  - Confirm the bound `[animate.enter]` form compiles in the dev and production webview builds
    (`ptah-extension-webview:build` both configurations) — E25.
  - Confirm no template still binds `isFinalizingTransition()` directly on `ptah-message-bubble`.
  - `grep` shows no remaining `canvasSessionRequest(` / `clearCanvasSessionRequest` references.
  - Tests: `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/canvas
@ptah-extension/chat --maxWorkers=2` (read the header: 3 projects). Never `nx test projA projB`.
  - `npx nx run-many -t lint,typecheck -p @ptah-extension/core @ptah-extension/canvas
@ptah-extension/chat ptah-electron-e2e ptah-extension-webview`.
  - `npx nx run degradation-audit:lint --skip-nx-cache` at the baseline total.
  - Perf: skip proof without `PTAH_PERF_SPECS`; M0 (and the optional M0-cv) and M1 per the
    protocol above; results in
    `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\test-report.md`.
