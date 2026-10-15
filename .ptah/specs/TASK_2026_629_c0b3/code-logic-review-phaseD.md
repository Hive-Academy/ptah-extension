# Code Logic Review, Phase D (B6, B7a, B7b, B7c, B8a, B8b) — TASK_2026_629_c0b3

Scope read in full: `canvas-detail-geometry.ts`, `canvas-workspace-grid.component.ts` (detail hunks), `canvas-workspace-grid.styles.ts`, `canvas-grid-items.ts`, `canvas-detail/*` (service, panel, transcript, session details, lane tabs, lane view), `orchestra-canvas.component.ts`, `canvas-tile.component.ts`, `canvas-needs-you-queue.component.ts`, `tile-agent-mini-panel.component.ts`, `compact-session-callout.component.ts`, `compact-session-card.component.ts`. Cross-checked against `TabManagerService.registerVisibleTab`, `BatchedUpdateService.canFlush`, `AgentMonitorStore.onAgentProgress/getSubagentTranscript`, `AgentCardComponent`, `app-shell.component.html`. No tests, typecheck or git mutation were run (read-only per instruction).

## Summary

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Verdict | REVISE |
| Serious | 5 |
| Moderate | 7 |
| Minor | 5 |

The structure matches the plan (one overlay slot, one transcript host, one service). The failures are all at the seams: shared global state (visible-tab set, window key events), a stream-driven effect, and one regression in the tile click path. Each Serious finding sits on a likely path.

## Serious

### S1. Closing or moving the detail unregisters the tab from the visible set while its tile is still visible, which freezes streaming for that tab

- Evidence: `canvas-detail-transcript.component.ts:51-55` registers `tabId` and unregisters it on cleanup. `tab-manager.service.ts:2865-2880` keeps a plain `Set`, not a counter. The tile registers once in `canvas-tile.component.ts:571-578`. That effect depends only on `tabId()` and `visible()`, so it does not re-run when the detail closes. `batched-update.service.ts:~170` has `canFlush`: `visible.size > 0` means `visible.has(tabId)` and nothing else.
- Scenario: 3+ tiles, session A streaming. Open the detail on A (the transcript registers A; the tile already had). Press Esc, or press → to go to B (the transcript cleanup unregisters A). A's tile is still mounted and visible, and after Esc it becomes the live focused tile. A is no longer in `visibleTabIds`, so every later flush for A is deferred. The live tile (or card) stops updating until A is deregistered and registered again, or `drainDeferredForTab` runs on an active-tab change. The user sees a hung stream.
- Fix: the transcript should not register at all. The tile of the same tab is registered while the grid is visible and stays mounted (as a card). If registration is kept, use a ref count in `TabManagerService`. Add a spec: open, close, then assert `visibleTabIds` still contains the tab.

### S2. The window keydown handler runs while the canvas is retained but hidden, and it steals keys from other surfaces

- Evidence: `orchestra-canvas.component.ts:69` (`'(window:keydown)'`) and `:342-360`. `app-shell.component.html:792-802` and `app-shell.component.ts:115-118,236-243` keep the canvas instance alive when the user goes to single chat or a standalone view, and the plan says so ("never destroyed while the shell lives"). The handler checks only `this.detailTabId()`. It does not read `SURFACE_ACTIVE`.
- Scenario: the detail is open, the user opens Settings or the Tasks board or switches to single-chat layout. Pressing Esc calls `preventDefault` and closes the hidden detail. Pressing ← or → on any non-input element (a radio group, a tablist, a slider, the chat scroller) calls `detail.next()`, which calls `canvasStore.focusTile()` and then `switchTab()`. The active chat tab changes invisibly, and `preventDefault` kills the arrow behaviour of the widget in front of the user.
- Fix: bail out unless the canvas surface is active (inject `SURFACE_ACTIVE`, or check `sessionViewport` visibility). The plan said the host element, not `window` (`plan-part-2.md:204-209`). If a window listener is kept, it must be gated.

### S3. ← and → on a lane tab also switch the session (the plan's stopPropagation / tablist exclusion is missing)

- Evidence: `canvas-lane-tabs.component.ts:152-175` handles the arrows with `preventDefault()` and no `stopPropagation()`. The window handler (`orchestra-canvas.component.ts:349-358`) excludes only `input/textarea/select/contenteditable`. It does not check `event.defaultPrevented` or `closest('[role=tablist]')`. `plan-part-2.md:208-209,213-215` required both, and the lane tablist to stop propagation.
- Scenario: the user focuses a lane tab and presses →. The lane moves to the next lane, the event bubbles to the window, and `detail.next()` runs `open(nextTabId)`, which resets the lane to `orchestrator`. The user ends up on another session's Orchestrator tab. Keyboard lane selection (AC 5.1/5.2, roving tabindex) cannot work.
- Fix: add the `defaultPrevented` and `closest('[role=tablist], [role=menu], [role=listbox], [role=slider]')` guards in the handler, and `stopPropagation` in the lane tabs. Ignore events with `altKey/ctrlKey/metaKey/shiftKey` (Alt+← is history-back in Electron).

### S4. A running sub-agent lane refetches its transcript on every progress event, and the result can never render

- Evidence: `canvas-lane-view.component.ts:243-275`. The effect reads `selectedSubagent()`. `agent-monitor.store.ts:2016-2046` (`onAgentProgress`) writes a new `SubagentRecord` and a new Map on every progress event, so `find()` returns a new reference each time and the effect re-runs. Each run does `messages.set([])`, `loading.set(true)`, and a new `subagent:transcript` RPC. The cleanup marks the previous run `active = false`, so its result is discarded.
- Scenario: a running sub-agent emits progress events every few hundred ms, which is faster than the RPC round trip. The viewer flashes to empty or loading, issues an RPC per event, and every response is discarded because a newer run has superseded it. The transcript is never shown, and the host gets an RPC storm.
- Fix: derive a keyed `computed(() => ({agentId, sessionId}))` with an equality function on those two strings, and run the effect on that key only. Do not clear `messages` when only the record changed. Add a manual refresh (it already exists) or a debounced re-fetch on status change for the live case.

### S5. Clicking the composer, a button or a link in a live (non-card) tile no longer focuses the tile

- Evidence: `canvas-tile.component.ts:680-683`. The early return `isInteractiveTarget` applies in all modes, not only card mode. The click used to be a bare `(click)="onTileClick()"` on the inner div, so every click bubbled to `focusRequested`. The class header contract (`:124-125`) says "emits focusRequested ... before any message is sent — keeps global activeTabId in sync".
- Scenario: 2 tiles (both live, since the budget is 2). The user clicks the textarea of the unfocused tile. The click target is a `textarea`, so the handler returns. `focusTile` is never called, so the ring and active tab stay on the other tile while the user types in this one. This is the primary interaction path of every ≤2-tile canvas.
- Fix: apply `isInteractiveTarget` only when `cardMode()` is true. The live branch must always emit `focusRequested`.

## Moderate

### M1. Card actions "Answer" and "Open" use `toggle`, so they close the detail they were meant to open

- Evidence: `canvas-tile.component.ts:661-666` (`openCardSession` calls `detail.toggle(tabId)`), reached from `compact-session-card.component.ts:368-373` (`openFullView`, bound to `(answer)`, `(showOutput)` and the session branch of `openRequest`). `canvas-detail.service.ts:24-32` closes when the id matches and no lane key is given.
- Scenario: the detail is open on session A, on the Orchestrator or on a lane tab. A's card shows a question, and the user clicks "Answer". The detail closes. From a lane tab it closes instead of switching to Orchestrator. Same for "Open" on a session permission.
- Fix: the callout actions should call `open(tabId)` (idempotent). Only the card body click and Enter/Space toggle.

### M2. Detail slot geometry assumes a "row" is the tiles with identical `y`

- Evidence: `canvas-detail-geometry.ts:24-27` (`rowEnd` from tiles where `tile.y === selected.y`) and `:38-40` (`belowIds` = `y >= rowEnd`). The layout is a skyline pack (`canvas-layout-intent.ts:532-570`), so compact tiles stack at different `y` beside full tiles.
- Scenario: A full (x0 w6 y0 h6), B compact (x6 y0 h2), C compact (x6 y2 h2), D compact (x6 y4 h2). Select C: `rowEnd` = 4. The slot is placed at 4 cells and overlays A's lower third, and A is not in `belowIds`. The slot covers tile content, which breaks "no card hidden".
- Fix: `rowEnd` = the first line at or below `selected.y + selected.h` that no tile straddles (loop: raise `rowEnd` to the bottom of every tile whose `y < rowEnd` and whose bottom is `> rowEnd`, until stable). `belowIds` = tiles with `y >= rowEnd`. Add a spec with a mixed compact layout.

### M3. Slot geometry follows live measurements while the grid is frozen by the detail's lock

- Evidence: `orchestra-canvas.component.ts:235` locks the grid while the detail is open. The grid freezes its Gridstack application (`canvas-workspace-grid.component.ts` locked branch, `_lockedMeasurements`). `detailGeometry` (`:343-349`) reads `this.layout()`, which uses live `containerWidth/Height`.
- Scenario: the window is resized, or the sidebar toggles, with the detail open. Tiles stay at the old geometry, while `topPx`, `cellHeight`, `belowIds` and the notch are recomputed from the new layout. The slot overlaps cards or leaves a gap until the detail closes.
- Fix: compute the geometry from the same frozen measurements as the applied layout (`_lockedMeasurements ?? currentMeasurements()`), as `compactSingletonHeight` already does.

### M4. Esc closes the detail even when something else owns the key

- Evidence: `orchestra-canvas.component.ts:344-348`. There is no target or `defaultPrevented` check for Esc, unlike the arrows.
- Scenario: the user presses Esc to dismiss the composer's slash or at-mention list, a model dropdown, the Needs-you popover, or the new-session input. The overlay closes and so does the detail. The plan limits only the arrows, but Esc inside an active composer is a likely accident. Cheap guard: ignore Esc when `event.defaultPrevented`, or when the target is in an `input/textarea/[contenteditable]` or an open `popover`.

### M5. Lane transcript failures are shown as an empty transcript, and manual refresh races lane switches

- Evidence: `agent-monitor.store.ts:2423-2429` returns `[]` on RPC failure. `canvas-lane-view.component.ts:260-262` and `:280-281` can therefore never reach `error`. `loadTranscript` (`:274-285`) has no `active` guard, and its `messages/loading/error` signals live on the lane view, which survives lane switches.
- Scenario: the RPC fails and the viewer shows "no messages" with no error and no retry hint. Separately, the user clicks Refresh on lane A and switches to B before the reply. A's late reply overwrites B's `messages` and clears B's loading.
- Fix: have the view use a result type that carries the failure (or a store method that throws), and give `loadTranscript` a request token tied to the current key.

### M6. B8a open items that do break an AC

- Sub-agent permissions are not shown in the lane view. AC 5.2 says a lane tab shows "any pending permission with Allow/Deny". CLI lanes do it (`canvas-lane-view.component.ts:~36-60`), sub-agent lanes do not. If the request is routed to the parent tab's transcript, a user in the sub-agent lane sees a lane that appears stalled while the Orchestrator tab holds the prompt. Partial against AC 5.2.
- Standalone background entries are read-only (`stoppable: false`, `canViewTranscript: false`, `:150-165`). AC 5.2 lists "Stop lane" and "live output" for every lane tab. These tabs show neither, so AC 5.2 is not met for that group.
- Treat as REVISE items, or record the AC 5.2 reduction in `decisions.md`.

### M7. Tile click handler: drag release and text selection toggle the detail

- Evidence: `canvas-tile.component.ts:146` (`(click)` on the host) and `:680-683`. In card mode any non-interactive click toggles the detail.
- Scenario: (a) the user drags a card by its header and the release produces a `click` on the host, which opens the detail and locks the grid (needs a check that Gridstack suppresses this click; I did not verify it); (b) selecting card text with the mouse ends in a click and toggles. Guard with a pointer-down/up distance check or `window.getSelection()?.toString()`.

## Minor

- m1. `canvas-lane-view.component.ts:238-242`: the effect re-expands a CLI card every time it is collapsed, so the card header chevron does nothing. It also leaves `expanded = true` in the shared store after the detail closes, so the Agent Monitor shows the lane expanded.
- m2. `canvas-detail-panel.component.ts:108-112`: `scrollIntoView` runs once at construction. Arrow navigation to a session in another row reuses the same panel instance (the `@if ... as id` block is retained), so the slot moves and the scroll position does not.
- m3. No focus management: the plan (`plan-part-2.md:204-207,211`) asked for focus on the selected tab on open. Focus stays on the card.
- m4. `canvas-detail-transcript.component.ts:40-46`: `visible`, `SESSION_FOCUSED` and `SURFACE_ACTIVE` are constant `true`, so a hidden canvas (retained, `display:none`) keeps a live ChatView with active animations or polling. Bind them to the real surface state.
- m5. `compact-session-card.component.ts:358-363` (`openLane`) routes through `cardActions` even for a non-forced compact tile at ≤ budget. `detail.open()` then sets state and the host effect (`orchestra-canvas.component.ts:400-402`) closes it, so a lane-row click or a CLI-permission "Open" on a compact card in a 1-2 tile canvas only focuses the tile. `openFullView` correctly falls back to `expandToFull` in the same case.

## Five logic questions

1. Silent failure: S1 (stream freeze, no signal), M5 (transcript RPC failure rendered as empty), S4 (results discarded without notice).
2. Unexpected user action: pressing → on a lane tab (S3); Esc to dismiss a popup (M4); arrows or Esc in another view while the canvas is hidden (S2); clicking Answer when the detail is already open (M1); clicking a composer in a 2-tile canvas (S5).
3. Wrong answer from data: mixed-height skyline layouts (M2); a window resize while open (M3).
4. Dependency failure: `subagent:transcript` returns `[]` on failure and the lane view cannot tell (M5). `agent:stop` and `resumeAgent` in `AgentCardComponent` have no catch; that is pre-existing and was not changed here.
5. Missing: focus management, a sub-agent permission UI, a stopped-lane stop path for background entries.

## Items checked and found sound

- Cross-workspace: `CanvasDetailService.open` rejects tabs not in the active workspace's `tiles()`. After a workspace switch, `detailTabId` goes null and the host effect closes the service state (`orchestra-canvas.component.ts:333-340,400-402`). The panel is projected only into the active workspace's grid (`:240-245`).
- One transcript host: the grid forces `autoCard` for every tile when `count > budget && detailOpen` (`canvas-grid-items.ts:51-54`), so the selected tile's live ChatView is replaced by a card. There may be one frame where both exist in the same change-detection pass; I did not find a persistent duplicate.
- "+N more": `compact-session-card.component.ts:~200-232` counts only this tab's session permissions and questions, and the CLI permissions owned by this session. It picks the oldest and breaks ties in favour of permissions.
- Stop owner: `stop(sub.taskId, sub.parentSessionId!)` passes the owner session. A sub-agent record without `parentSessionId` cannot appear in the lane tabs (the filter is on `parentSessionId === sessionId`), so the non-null assertion is safe.
- Queue "Open session": `canvas-needs-you-queue.component.ts:195-209` uses `open()`, not `toggle()`. A vanished lane resets to the Orchestrator through the lane tabs' effect (`canvas-lane-tabs.component.ts:~140-144`). The queue lists only active-workspace tiles, so there is no cross-workspace case.
- B8b: `respondLane(agentId, requestId, ...)` is idempotent per request and clears only that request. `HIDE_AGENT_SIDEBAR` is provided in both the tile and the detail transcript.
- B6: the `detailOpen` argument and the slot sit outside Gridstack nodes. The `x/y/w/h` invariance is covered by the spec. Short container: `heightPx` has a 320 px floor, the host is `overflow-auto`, and `padding-bottom` on `gridstack` grows the scroll height by the same amount, so a short container scrolls instead of clipping. The manual Electron check is already recorded (decisions row 22).

## Requirements fulfilment (Phase D)

| AC | Status | Gap |
| --- | --- | --- |
| 4.2 position unchanged | PARTIAL | Holds for uniform rows; M2 overlap for mixed compact layouts, M3 on resize |
| 4.3 Esc / same-card click | COMPLETE | Esc over-fires (M4); toggle via callout wrong (M1) |
| 4.4 ← → wrap | PARTIAL | Fires in hidden canvas (S2) and from lane tabs (S3) |
| 4.5 one transcript | COMPLETE | S1 breaks streaming after close |
| 4.6 details column | COMPLETE | Todos and git metrics dashes are known (rows 12) |
| 4.7 ≤ budget unchanged | PARTIAL | S5 regresses click-to-focus in live tiles; m5 |
| 4.8 tile close closes | COMPLETE | |
| 4.9 role + keyboard | COMPLETE | M7 click side effects |
| 5.1 groups order | COMPLETE | |
| 5.2 lane content | PARTIAL | M6 (sub-agent permission, background Stop and output) |
| 5.3 no fork | COMPLETE | |
| 5.4 lane row opens lane tab | COMPLETE | m5 for ≤ budget compact |
| 5.5 one output at a time | COMPLETE | S4 refetch storm on the same lane |
| 5.6 stop paths | COMPLETE | |
| 5.7 HIDE_AGENT_SIDEBAR | COMPLETE | |
| 5.8 terminal tab stays | COMPLETE | |
| 6.5 queue Open session | COMPLETE | |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on S1, S2, S3, S5 (traced through the call chain); HIGH on S4 (reducer replaces the record per event); MEDIUM on M7(a) (Gridstack click suppression not verified).
- Top risk: S1, because closing or navigating the detail silently freezes streaming for the tab the user just looked at.
- Fix order: S5 (one-line guard), S1 (drop the transcript registration), S3 and S2 (key handler gating), S4 (key the effect), then M1, M2, M3.
