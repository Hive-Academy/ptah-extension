# Code Logic Review R9f — TASK_2026_629_c0b3

Review family: Claude (reviewer) vs codex (implementer)

Scope: batch R9f, `libs/frontend/canvas/src/lib/` — `canvas-detail/canvas-detail-transcript.component.ts` (+spec), `canvas-detail/canvas-lane-view.component.ts` (+spec), `canvas-rail/canvas-focus-area.component.ts` (+spec), `canvas-session-overrides.ts` (+ new spec). All five source files and four specs were read in full; the chat-side consumers (`chat-view.component.ts` dock/retention/width, `chat-transcript.component.ts` SESSION_CARD_ACTIONS and tree lookup, `subagent-tile`, `compact-session-card`, `single-chat-subagent-view`, `execution-node`/`inline-agent-bubble` controls, `chat-view.dock.spec.ts`) and the tab-visibility/stream-flush path (`batched-update.service.ts`, `stream-viewport-controller.service.ts`, `stream-flush-scheduler.service.ts`) were read to trace behaviour. Scoped diagnostics on the four source files: 0 errors (7 errors exist only in sibling files outside the batch). I ran no specs; the writer's four pass reports were not re-run.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Verdict | REVISE |
| Blocking issues | 0 |
| Serious issues | 5 |
| Moderate issues | 6 |
| Minor issues | 3 |

The structural moves are correct and match the contract: `HIDE_AGENT_SIDEBAR` is gone, `RAIL_TRANSCRIPT_RETENTION` and `SESSION_CARD_ACTIONS` are provided on the child injector, the focus area no longer keys on tab id, the orchestrator transcript sits outside the keyed block, and the live node is rendered with tile mode off. The weakness is evidence and one runtime interaction. The headline behaviours (persistent ChatView across Open/Back, covered freeze, live full lane, Rail display update, Escape) are either asserted against stubs that cannot fail or not asserted at all, and the covered state unregisters the parent tab from the visible set, which very likely stalls the live lane while it is open.

Why 5 and not 7: no data-loss or security defect, and the production wiring reads sound; but the decision-77 Rail display case is absent (Serious by the brief), the persistent-host requirement has no test that touches a real ChatView, and there is one probable functional defect (S1) on the batch's core promise. Why not 3: the code paths themselves are small, consistent with the single-view analogue, and I found no silent data corruption.

## Contract check

| Contract point | Verdict | Evidence |
| --- | --- | --- |
| `HIDE_AGENT_SIDEBAR: true` removed from the Rail host | DONE | `canvas-detail-transcript.component.ts:51-69` provides none; the ChatView dock provider (`chat-view.component.ts:238-247`) now yields a `DisplayDockState` in Electron. Remaining uses are `conductor-tile.component.ts:221` (out of scope). |
| Protected dock renders (Displays/Agents, DISPLAY, pin, close, Turn summary, display update, host references) | CODE OK, UNTESTED in Rail | The dock is ChatView-owned and per-tab keyed; no Rail-host test exercises a display (S2). |
| `RAIL_TRANSCRIPT_RETENTION` provided | DONE | `canvas-detail-transcript.component.ts:61`; read by `chat-view.component.ts:816` and `transcript-retention.service.ts:41`. |
| Rail `SESSION_CARD_ACTIONS` select `sub:`/`bg:` on the parent tab | DONE | `:62-68`. `ChatTranscript` prefers the host token (`chat-transcript.component.ts:245-248`), and `SubagentTile.openLane` passes `sub:`/`bg:` (`subagent-tile.component.ts:96-99`). |
| No keyed `@for` on tab id around the transcript host | DONE | `canvas-focus-area.component.ts:54-58` binds `[tabId]="id"` with no `@for`. |
| Orchestrator transcript outside the keyed lane block | DONE | `canvas-lane-view.component.ts:65-67` (always rendered, `class.hidden`), the keyed block starts at `:71`. |
| Covered transcript freezes (not unmount) | CODE OK, UNTESTED, SIDE EFFECT | `:66` passes `visible`; `canvas-detail-transcript.component.ts:50` ANDs it into the token. See S1 (side effect) and S3 (untested). |
| Open/Back keeps ChatView instance and draft | CODE OK, UNTESTED | Same elements; nothing asserts instance or draft identity (S3). |
| Per-tab model/effort | DONE | `canvas-session-overrides.ts:12,27` reads the id inside the tracked part; see write-path trace below. |
| Full lane renders `<ptah-execution-node [node]="agentNode">`, tile mode off, RPC viewer only as labelled fallback | DONE in code, NOT exercised | `canvas-lane-view.component.ts:188-203`. Spec never instantiates `ExecutionNodeComponent` (S5). |
| 180 ms opacity/transform fade, off under reduced motion | DONE in CSS, not observed | `:49-56`; the animated rules are all inside `@media (prefers-reduced-motion: no-preference)`. |

## Five logic questions

### 1. How does this fail silently?

- Opening a lane for an agent that is not owned or not present (stale tile, foreign session, evicted record) does nothing visible. `CanvasDetailService.selectLaneFor` validates key syntax only (`canvas-detail.service.ts:22-25`), stores `sub:x`, and the lane view then falls back to the orchestrator (`canvas-lane-view.component.ts:264-274`). The single chat view shows "This agent is not available in this conversation." (`chat-transcript.component.ts:773-779`); the Rail shows nothing and keeps the stale key, so the lane may jump open later if the record appears (M3).
- Pressing Escape after opening a lane with the mouse does nothing, because focus has fallen to `body` (S4).
- While a lane is open the live node can go stale with no indicator (S1).

### 2. What user action produces unexpected behaviour?

- Clicking Background inside the live lane. The inline bubble's background action flips the record to `background`; the `sub:` lane filter requires `status !== 'background'` (`canvas-lane-view.component.ts:249-252`), so the lane silently collapses to the orchestrator conversation while the stored key stays `sub:x` (M2).
- Opening a lane from a transcript tile and then pressing Escape (S4).
- Clicking Stop or answering a permission in the live lane: the same request is offered twice (lane header plus inline bubble) (M1).

### 3. What input data produces a wrong answer?

- A resumed or history-loaded tab whose agent node is not in `tab.messages[].streamingState` falls to the RPC viewer even though the agent is live, with the labelled fallback text. The label is honest, so this is degraded rather than wrong.
- `agentNode` merges finalized message trees with the streaming tree, newest first (`:299-311`). It uses the same `tab-${tabId}` build key as `ChatTranscript` (`chat-transcript.component.ts:465`), so the shared cache is reused, which is correct.

### 4. What happens when a dependency fails?

- `getSubagentTranscript` rejection sets `error` and the viewer shows it, with Refresh (`:344-351`, `:378-386`). Fine.
- `monitor.stopAgent` rejection: `stop()` uses try/finally with no catch (`:392-399`), so a failed stop surfaces as an unhandled promise rejection from the click handler and no message to the user. Pre-existing shape, but now reachable from the Rail lane.
- `detail` is `inject(..., {optional: true})` in the transcript (`canvas-detail-transcript.component.ts:44`); without a `CanvasDetailService` ancestor every tile click is a silent no-op. In production it is always provided by `OrchestraCanvasComponent:68`, so this is only a hazard for a future host.

### 5. What is missing that the requirements never mentioned?

- Focus management on Open and Back (S4).
- A "lane vanished" notice (M3).
- Lane-key migration on sub to background transition (M2).
- Workspace switch destroys the board (`canvas-rail-board.component.ts:51` `@if (visible())`), hence the ChatView and its per-instance `DisplayDockState` (provided in `chat-view.component.ts:238-247`). Dock open, pinned and width state are lost on a workspace round trip; only the Rail keepalive across focus swaps was contracted, so this is a note (M6).

## Findings

### Serious

**S1. Covering the transcript unregisters the parent tab from the visible set, which very likely stalls the live full lane (core R9f promise).**
- File: `canvas-detail/canvas-detail-transcript.component.ts:50,72-83`; consumers `libs/frontend/chat-streaming/src/lib/batched-update.service.ts:175-181`, `libs/frontend/chat/src/lib/services/stream-viewport-controller.service.ts:46-52,56-68`, `stream-flush-scheduler.service.ts:35-47`.
- Scenario: the user opens a `sub:`/`bg:` lane on a streaming tab. `active = parentActive && visible` turns false, the `registration` effect cleanup runs `unregisterVisibleTab(tabId)`. The Rail transcript was the only registrant, so the visible set empties. `deriveViewport` adds the active tab only on the chat surface (`isChatSurface && activeTabId`), and the canvas surface is current, so the declared viewport is empty and `tierFor(tabId)` returns `'hidden'` once the host accepts v2. `StreamFlushScheduler.enqueue` does nothing for `'hidden'` (queue held until a later visible/focused enqueue). `BatchedUpdateService.canFlush` does fall back to the active tab, which is why this may be masked in the older path.
- Impact: the lane now reads its content from `tab.streamingState` (`agentNode`, `:299-311`), so a running sub-agent opened in the Rail can freeze or lag until Back. That is the reverse of the "live full lane" requirement. The old RPC viewer did not depend on this stream.
- Fix: keep the tab registered while the lane is open. Gate registration on `parentActive()` only (or on "orchestrator or a live agent lane is shown") and use `visible` solely for SESSION_VISIBLE/SESSION_FOCUSED (render freeze). Add a test with the real `TabManagerService.visibleTabIds` asserting the tab id remains registered while a sub lane is selected.
- Confidence: medium-high on the code path; I did not run it, and it depends on `v2Accepted`.

**S2. Decision 77(b): no test anywhere opens or updates a fenced `ptah-ui display [id]` in the Rail host. Treated as Serious per the brief.**
- File: `chat/src/lib/components/templates/chat-view.dock.spec.ts:927-951` (single view only: `mount()` without `contextual`); the Rail cases at `:844-916` cover agents, retention, width and close, not displays. `chat-transcript.display.spec.ts:952` provides `SESSION_CONTEXT` null.
- The transcript spec title "restores dock" (`canvas-detail-transcript.component.spec.ts:10`) asserts only that `HIDE_AGENT_SIDEBAR` is absent from an injector, with the template set to `''` (`:20`). The writer's report admits the gap (`lane-R9f-report.md:31`).
- Impact: parity rows 68, 72, 73, 78, 112 name this exact case; the dock is being re-enabled in a host (SESSION_CONTEXT, retention, hidden-when-covered) where no display-feed evidence exists. The covered case is a related risk: the transcript is frozen while a lane is open, so a display emitted during that time depends on resume catch-up, which is untested.
- Fix: add `chat-view.dock.spec.ts` case `mount({ contextual: true, railRetention: true })` mirroring `:927-951` (open, update in place, one `ptah-display-dock`, same panel instance, then context round trip). Add one canvas-level case mounting the real `ChatViewComponent` under the Rail child injector.

**S3. The persistent-host requirement (rows 100, 101-context) has no test that touches a real ChatView or the `visible` gating.**
- File: `canvas-lane-view.component.spec.ts:71-76` overrides the component's imports to `[AgentCardComponent, NgTemplateOutlet]` with `NO_ERRORS_SCHEMA`, so `ptah-canvas-detail-transcript` is an inert unknown element. `canvas-detail-transcript.component.spec.ts` never calls `setInput('visible', false)` and never reads `SESSION_VISIBLE`/`SESSION_FOCUSED`/`SURFACE_ACTIVE` from `childInjector` (the only SURFACE_ACTIVE test at `:120-169` covers the parent signal).
- Impact: the contract points "Open/Back keeps the ChatView instance and draft", "covered transcript freezes (not unmount)" and "at most ONE live ChatView in the board host" are verified nowhere. Parity row 100 names `canvas-lane-view.component.spec.ts` for "same instance/draft; frozen while covered". `canvas-focus-area.component.spec.ts:173-235` proves the lane-view instance survives swaps using a stub, which is meaningful for the focus area but says nothing about the transcript or ChatView.
- Fix: in the lane spec, keep the real `CanvasDetailTranscriptComponent` with a stub `ChatViewComponent` token (or a minimal host) and assert (a) the same transcript element and a stub ChatView instance across `laneKey` orchestrator to `sub:x` to orchestrator, (b) the combined token reads `false` while a lane is selected and `true` after Back, (c) a typed draft value in a stub input survives. In the transcript spec add a `visible=false` case on `childInjector`.

**S4. Escape and Back are unreachable on the primary open path; no focus is moved or restored.**
- File: `canvas-lane-view.component.ts:48,420-426,68-70`.
- Scenario: the user clicks a tile in the transcript. The transcript wrapper turns `display:none` (`:65`), and the focused tile button is inside it, so focus drops to `body`. The Escape listener is bound on the lane-view host, which receives nothing from `body`. Pressing Back removes the button that has focus (`@if` at `:68`), and focus again drops to `body`; nothing returns it to the opener or the composer. The single-view analogue does both: `afterNextRender(() => backButton.focus())` (`single-chat-subagent-view.component.ts:121`) and `closeSubagent` restores opener focus (`chat-transcript.component.ts:736-745`).
- Impact: the named "Escape" case works only if the user first tabs into the lane. Keyboard users lose their place on every Open/Back.
- Fix: on lane open, focus the Back button after render; on Back/Escape, restore the opener or the composer. If the Rail intends Escape at board level, bind it on the focus area host instead.
- Test gap: the Escape case dispatches on the host element itself (`canvas-lane-view.component.spec.ts:212`), which is the one place the event can always reach. No case covers Escape from a textarea (ignored by `onEscape`) or Escape while the orchestrator is shown.

**S5. Contract cases that are missing or vacuous in the lane and transcript specs.** Each is numbered per the brief.
- S5a (stop, vacuous): `canvas-lane-view.component.spec.ts:120-144` calls `fixture.componentInstance.stop('task','owner')` directly. The sub-agent fixtures have no `taskId`, so the template Stop button (`:172-187`) is never rendered or clicked. The test passes if the button is deleted.
- S5b (steer): absent. The writer states it. Row 104 names steer.
- S5c (copy): absent, same as S5b.
- S5d (background): the case opens a record already in `background` status (`:229-241`). The transition from `sub:` to `bg:` that the live lane now makes reachable is untested and, as written, collapses the lane (M2).
- S5e (full node, tile mode off): `:199-214` and `:229-241` assert only that an element named `ptah-execution-node` exists. With the imports override, `ExecutionNodeComponent` is never instantiated, so `[agentTileMode]="false"`, `[node]`, `getPermissionForTool` and `(permissionResponded)` bindings are unchecked, and the real component's DI (`SURFACE_ACTIVE`, `LoggingService`, `SubagentTranscriptViewerService`, `ScrollDirtyService`) is never resolved in a lane context. I traced those tokens and they are root-provided or bound at the composition root (`execution-node.component.ts:525-534`, `scroll-dirty.service.ts:9-11`), so I expect it to work, but the spec cannot detect the opposite.
- S5f (depth-2): the `nested` fixture exists but nothing asserts that the nested agent is reachable or rendered; `expect(agentNode()).toBe(agent)` only proves the top-level lookup. The depth-2 recursion in `findAgentNode` (`:429-437`) is not asserted (e.g. opening `sub:nested`).
- S5g (Rail tile click, does not mount `SingleChatSubagentView`): `canvas-detail-transcript.component.spec.ts:20,29` sets the template to `''` and asserts `querySelector('ptah-single-chat-subagent-view')` is null. It can never be non-null, so it is vacuous. The real behaviour (the transcript's `skipSelf` token preferring the host) is not tested through a real `ChatTranscript`; `openLane` is only called by hand on the injector.
- Fix: mount the real `ExecutionNodeComponent` (it needs a modest provider set) for one lane case and assert inputs through `By.directive`; click the rendered Stop with a `taskId` fixture; click Back and Escape-from-textarea; add a real-`ChatTranscript` tile click case in the chat lib or a stubbed `SubagentTile` under the real child injector.

### Moderate

**M1. Duplicate Stop and duplicate permission prompts in the live lane.** The lane renders its own Stop (`canvas-lane-view.component.ts:172-187`) and its own permission group (`:147-171`), and then the full `ExecutionNode` agent bubble, which has its own Stop (`inline-agent-bubble.component.ts:301-311`, `onStopClick :1090`) and inline permissions via `getPermissionForTool` (`:192`). The same pending request shows twice and the same agent has two Stop buttons. They share the underlying actions, so there is no corruption, but it is confusing and the two permission paths (`responder.respondSession` versus `chatStore.handlePermissionResponse`) can diverge. Pick one owner (the bubble per row 104) and delete the lane-header duplicates.

**M2. Lane collapses when a `sub:` agent is backgrounded from inside the lane.** `selectedSubagent` filter at `:247-253`; `selectedKind` at `:264-274` then returns `orchestrator`. The stored key stays `sub:x`, so lane tabs and `aria-labelledby` (`:61`) point at a lane that is not shown. Fix: when `selectedSubagent` for `sub:` resolves empty but a `background` record exists for the same `parentToolUseId`, migrate with `selectLaneFor(tabId, 'bg:'+id)`; or match both statuses for `sub:`.

**M3. No "agent not available" feedback and stale key persistence for Rail tile clicks.** `canvas-detail-transcript.component.ts:65` forwards any key; `selectLaneFor` accepts it; the lane view falls back silently. Single view shows a notice (`chat-transcript.component.ts:773-779`). Add a notice, or have `openLane` return a boolean and not store a key whose agent is not resolved.

**M4. Live lane omits inputs the single view passes.** `SingleChatSubagentView` passes `[isStreaming]` (`single-chat-subagent-view.component.ts:81`); the lane does not (`canvas-lane-view.component.ts:189-194`), nor `[ptahUi]`. For a running agent `isNodeStreaming` still reads `node.status === 'streaming'` (`execution-node.component.ts:503`), so the effect is limited, but `ptah-ui` blocks inside the agent output (`ptahUi` null) will not get the host context. Check whether row 112 host references (`$agents`, `$usage`) are expected inside the lane; if so pass the same context the transcript does.

**M5. Failed stop is unobserved.** `stop()` at `:392-399` has no catch; the click handler returns a rejected promise. Show the error or surface it through the existing notice path.

**M6. Workspace switch tears down the ChatView and its dock state.** `canvas-rail-board.component.ts:51` wraps the whole board in `@if (visible())`; each `ChatViewComponent` owns its `DisplayDockState` (`chat-view.component.ts:238-247`). After a workspace round trip, dock open/pinned/width and display surfaces reset, and retained frozen transcripts (up to four) are rebuilt. Not a regression introduced here, and not in the contract, but it is the limit of "persistent". Record it; do not claim cross-workspace persistence.

### Minor

- m1. Back button precedes lane content and the CLI branch uses `h-full` (`canvas-lane-view.component.ts:76`), so the CLI card overflows by the button height inside an `overflow-auto` host. Cosmetic.
- m2. The wrapper that fades carries `transform` during the 180 ms (`:50-55`); descendants with `position: fixed` (dock overlay) are positioned against it for that window. Short-lived.
- m3. The spec header comment in the writer report mentions NG0956 from the keyed block; track `key` is a string so the warning is spurious, but it signals the test double replaces the array each cycle (`[tabId()+':'+laneKey()]`). Consider tracking `laneKey()` directly without the array literal.

## Stale state and lifecycle

- Focus swap: `[tabId]="id"` (`canvas-focus-area.component.ts:55`) updates the `@if` alias in place; one lane view, one transcript, one ChatView; `SESSION_CONTEXT` moves via `tabIdSignal`. Per-tab lane keys come from `detail.laneKeyFor(id)` so a swap restores each tab's lane. OK.
- Tab close in the same flush: `board.close` awaits `removeTile`, which awaits `tabManager.closeTab` and only then drops the tile (`canvas.store.ts:351-356`). Between those two steps the focused id is the closed tab. `ChatView` handles that (`chat-view.component.ts:836-848` filters retained and active ids by existence; `dock.spec.ts:909-916`), and `agentNode`/`freezeSessionOverrides` return null on a missing tab. `registration` cleanup is idempotent (`tab-manager.service.ts:2854-2861`). OK. Lane key cleanup uses `onTabClosed` (`canvas-detail.service.ts:28-36`), which is registered lazily, but only needed once a key has been written. OK.
- Agent disappears: the lane falls back to the orchestrator and reveals the transcript; the stale key is kept (M3). The RPC effect: `requestVersion` bumps in cleanup discard stale responses (`:333-335`). A node to null to node flicker would leave `loading` true until the next fallback; harmless because the viewer is not shown with a live node.
- Memory: no ResizeObserver, timers or subscriptions are created by the lane or transcript. The fade effect cancels its frame on cleanup (`:319-321`). `childInjector.destroy()` runs once (`ngOnDestroy`, spec `:227-251`). The Escape handler is a host listener scoped to the lane-view element. OK.

## Write-path trace: `canvas-session-overrides.ts`

- Writes: `tabManager.setOverrideEffort(id, effortState.currentEffort() ?? null)` (`:17`) and `setOverrideModel(id, current)` (`:33`) to `tab-manager.service.ts:2401/2406` (in-memory `TabState.overrideModel/overrideEffort`, `chat-types.ts:701/708`). Neither field appears in `tab-persistence.ts` (grep over `libs/frontend`), so the write is in-memory only and does not need a format check.
- Readers (key = tab id, scope = `tabs()` of the active workspace): `model-selector.component.ts:201` (`tab.overrideModel ?? tab.sessionModel ?? global`), `effort-selector.component.ts:256`, and `message-sender.service.ts:432,436,685,689`. Key and scope agree with the writer. OK.
- The fix reads `tabId()` before the `isLoaded` guard so the effect re-runs on a tab change (`:12`, `:27`); previously the read sat inside `untracked`. The spec (`canvas-session-overrides.spec.ts:8-42`) proves per-tab freeze through a to b to a with `setOverride*` called twice each. Gap: it does not cover an absent tab at effect time (a tab id whose record has not hydrated never freezes because nothing retriggers; same as before) or a resumed tab that has `sessionModel` (the freeze replaces the displayed session model with the global default; pre-existing behaviour, now reachable for any focused tab rather than only mounted tiles).

## Data flow (tile click to lane)

1. Tile `openLane(laneKey(kind,id))` (`subagent-tile.component.ts:96-99`): OK.
2. `ChatTranscript` prefers the host `SESSION_CARD_ACTIONS` (`chat-transcript.component.ts:245-248`): OK.
3. Host `openLane` to `selectLaneFor(tabId, key)` (`canvas-detail-transcript.component.ts:65`): validates tile and key syntax only (M3).
4. `laneKeyFor(tabId)` feeds the lane view; `selectedKind` resolves or falls back (`canvas-lane-view.component.ts:264-274`): OK.
5. `visible=false` to token false to `registration` cleanup (S1) and ChatView freeze.
6. Live node from `tab.messages` and shared-key streaming tree (`:299-311`): OK, subject to S1.
7. Back/Escape to `selectLaneFor(tabId,'orchestrator')`: no focus restore (S4).

## Edge cases

| Case | Handled | Notes |
| --- | --- | --- |
| Focus swap A to B to A | YES in code | Instance identity tested only against a stub (S3) |
| Focused tab closes | YES | See Stale state |
| Lane agent disappears | PARTIAL | Silent fallback, stale key (M3) |
| Sub-agent backgrounded in lane | NO | Lane collapses (M2) |
| Escape from textarea | YES in code | Not tested (S4/S5) |
| Escape after mouse open | NO | Focus on `body` (S4) |
| Reduced motion | YES in CSS | Not observed by the writer; the animated rules are gated, no unconditional opacity rule (`:49-56`) |
| History/resumed tab, no live node | YES | Labelled saved transcript with Refresh |
| Streaming tab, lane open | LIKELY NO | S1 |
| Rail display fence update | UNKNOWN | S2 |
| Second workspace board | N/A | Separate `@if (visible())` board; ChatView per live board |

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Dock restored in Rail (rows 68-78) | PARTIAL | Code enabled; no Rail test (S2) |
| Display update in place, host references (row 112) | MISSING evidence | S2 |
| Rail SESSION_CARD_ACTIONS to `sub:`/`bg:` | COMPLETE in code | Test vacuous (S5g); no feedback (M3) |
| One persistent ChatView (row 100) | PARTIAL | Untested with a real ChatView (S3) |
| Per-tab model/effort (row 101) | COMPLETE | Verified by spec |
| Retention cap 4 provided | COMPLETE | |
| Full lane live node, stop/background/steer/copy/depth-2/permission (row 104) | PARTIAL | S5a-f, M1, M2 |
| Fallback + Refresh | COMPLETE | Tested |
| Escape / Back | PARTIAL | S4 |
| 180 ms fade, reduced-motion off | COMPLETE in CSS | Not observed in a browser |

Implicit requirements not addressed: focus management (S4), live-lane freshness while the orchestrator is covered (S1), notice when a lane agent is unavailable (M3).

## Verdict

- Recommendation: REVISE (APPROVE-WITH-FIXES once S1 to S4 are closed and the S5 cases are real).
- Confidence: MEDIUM-HIGH on the findings from code reading; S1 is the one to verify first by running it with v2 accepted.
- Top risk: S1 — opening a lane unregisters the streaming parent tab from the visible set, so the new live lane can freeze while the user watches it.
- What a robust implementation would add: register-visible independent of the lane cover; Rail-host display-update and persistent-ChatView integration tests with a real ChatView; real `ExecutionNode` mount with Stop/steer/copy/depth-2 assertions; Back and Escape focus handling; `sub:` to `bg:` key migration; single owner for Stop and permissions in the live lane; a "not available" notice for unresolved lane keys.
