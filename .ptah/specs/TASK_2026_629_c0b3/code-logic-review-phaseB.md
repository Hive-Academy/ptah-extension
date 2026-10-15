# Code Logic Review, Phase B (B3 running cap, B4 needs-you queue) — TASK_2026_629_c0b3

Scope: commits 4b3f0b411 and d498dd294 in `libs/frontend/canvas/src/lib/` (`canvas-running-cap.ts`, `canvas.store.ts`, `orchestra-canvas.component.ts`, `canvas-needs-you-queue.ts`, `canvas-needs-you-queue.component.ts`). Read in full, plus the responder, `PermissionHandlerService` response and routing paths, `focusTile`, `SessionStatus` and the agent monitor status types. No tests, typecheck or lint were run (read-only per CLAUDE.md). The known idle-tile send gap (decisions.md row 17) is not re-reported.

## Score and verdict

Score: 7/10. Verdict: **PASS** (no Serious findings). Four Moderate findings are worth fixing before Phase B is closed. None corrupts data or misleads the user on a likely path.

## Strict-owner counting choice (`parentSessionId === sessionId`)

The choice is sound for the cap and the queue.

- `agentVisibleInSession` returns true for `parentSessionId === undefined` (`session-scope.ts:60-66`). Using it in the cap would let one unparented agent count for every tile, which could push the count to 9 on its own. That is the cap-never-clears hazard.
- Strict equality fixes this but undercounts an unparented agent, which counts for no tile. That is the safe direction for a soft cap. The residual risk is covered in M1.
- Queue lane ownership (`canvas-needs-you-queue.ts:93-96`) uses the same rule. Strictness matters more there, because a lane permission shown against the wrong tile would be answered for the wrong session.

## Moderate

### M1. A streaming tab with no `claudeSessionId` is invisible to the cap
- Evidence: `canvas.store.ts` `runningSessionCount` passes `canvasTabs.map(tab => tab.claudeSessionId)` into `countRunningSessions`. The counter skips falsy ids (`canvas-running-cap.ts:29`). `tab-manager.service.ts:921` creates tabs with `claudeSessionId: null`, "Set by StreamingHandler on first streaming event".
- Scenario: the user starts turns in several fresh tiles in quick succession (or a Tasks-board launch fires them). Until each tab's first stream event binds a session id, `status === 'streaming'` is true but the tab counts for nothing. At 8 counted sessions, a ninth, tenth and eleventh turn in unbound tabs are all invisible, so `canStartRunningSession()` stays true and the cap overshoots. It self-corrects after the first event, so the effect is a transient overshoot, not a permanent leak.
- Related, same cause: a CLI or subagent record whose `parentSessionId` is still undefined (`agent-monitor.store.ts:427,593`; `parentSessionId` is `knownSessionId(...)` and may be absent) counts for no tile. A running subagent in an `awaiting-background` tab with no resolved parent also counts for nothing.
- Fix: count in-flight tabs by tab, not by session id. Pass tab objects into the counter and key the distinct set on `tab.claudeSessionId ?? tab.id`. This still counts a session once and removes the null blind spot. For unparented agents, either accept the undercount and document it, or attribute them to the single canvas tab when exactly one candidate exists.

### M2. The cap only sees the active workspace's tiles
- Evidence: `canvas.store.ts:135-140` (`tiles` is active-workspace only) feeds `canvasTabs` in `runningSessionCount`.
- Scenario: canvas workspaces are hydrated per path and "hidden" canvases exist (`workspaceTiles` per path). Nine sessions running in workspace A, then the user switches to workspace B. B reports 0 running and allows nine more. The real count is 18, and the 9-session limit that AC 7.1 describes is not enforced across the app.
- Fix: if the requirement is per canvas, state it in decisions.md and the on-screen message. If it is global (the message text suggests so: "9 sessions are running"), iterate `_workspaceTiles()` across all paths instead of `tiles()`.

### M3. A refused `newCanvasSessionRequest` is dropped, and the only feedback is a header chip
- Evidence: `orchestra-canvas.component.ts` request effect: when `canStartRunningSession()` is false it sets `headerMessage` and then unconditionally calls `clearNewCanvasSessionRequest()`.
- Scenario: the user triggers "new canvas session" from outside the canvas (the request source in `appState`) while at the cap. The request is cleared and never replayed. The chip appears only inside the header's `@if (tiles().length > 0)` block, and only if the canvas panel is mounted and visible. If it is not, the user gets no feedback and the action silently does nothing. When a slot frees later, the chip clears with no tile created, which is consistent with a drop but not announced anywhere.
- Fix: also surface the refusal through the app's notification path (a toast), or keep the request pending until a slot frees (with a timeout) if replay is the intent. Record which one in decisions.md.

### M4. Stuck disabled buttons when the responder early-returns
- Evidence: `canvas-needs-you-queue.component.ts:153-174` adds the key to `answering`, then calls `respondLane`. `agent-permission-responder.ts:27` returns silently if `answeredRequestIds` already contains `requestId`. Nothing then removes the item, and the `answering` key is cleared only when the item leaves the list (`:143-151`).
- Scenario: a lane request was answered earlier (the id is in `answeredRequestIds`), but the agent re-emits a permission queue entry with the same `requestId` (a reconnect or replay). The queue row reappears, Allow and Deny are pressed, the responder no-ops, the item stays, and both buttons stay disabled forever for that row. The user has to answer in another surface to clear it. The same set also makes a legitimate retry impossible after a transport that failed silently, since the id is never removed on success.
- Fix: have `respondLane` return a boolean (sent or skipped), and have the component clear the `answering` key when it was skipped. Or clear it in a `finally` and rely on the items list for the removal.

## Minor

- m1. `focusTile` (`canvas.store.ts:391-395`) does not check that the tile still exists. `openSession` passes a `tabId` from the computed list, so the race window is one change-detection tick wide. Add a membership guard anyway: it would otherwise set a focused id and call `switchTab` for a closed tab.
- m2. `resolve()` in the queue (`canvas-needs-you-queue.ts:37-48`) falls back to `sessionId` matching after tab and routing targets. A request whose own `tabId` is a non-canvas tab but whose `sessionId` equals a canvas tile's session is attributed to that tile. That is arguably right, but Allow then reports the tile's `tabId` as the deciding tab (`respondSession`). `handlePermissionResponse` uses it for hard-deny bucketing and for the decision pulse that cancels the prompt on other tabs, so the pulse could skip the tab that owns the request.
- m3. Requests that resolve to no canvas tile (no matching tab, target or session) are dropped silently (`if (!tile) continue`). That is by design, since they appear in their own surface. The header says "All clear" while such requests exist elsewhere, which can mislead. A tooltip that says "canvas sessions only" would be enough.
- m4. Lane subagent rows count `pending`, `paused` and `background` as running (`canvas-running-cap.ts:7-12`). A record that never receives a terminal event holds a slot, so the cap clears only when the record is removed. This matches the store's own `ACTIVE_SESSION_SUBAGENT_STATUSES`, so there is no divergence, but there is no staleness bound.
- m5. In a layout-focus preset, "Open session" on a tile other than the layout-focused one calls `focusTile` but does not clear `layoutFocusTabId`. Whether that tile becomes visible depends on the grid. I did not verify this (`canvas-workspace-grid.component.ts:278-301`).
- m6. `headerMessage` is set inside `handleCreateSession` and the request effect. The clear effect runs only on `canStartRunningSession` changes. A message set while the cap is not reached cannot occur today, but there is no auto-dismiss, so the chip persists indefinitely while the cap holds.

## Checked and found correct

- Double counting: `new Set(sessionIds)` dedupes tabs bound to the same session, and the in-flight check uses `claudeSessionId` equality with `some()`.
- In-flight statuses: `streaming` and `resuming` are the only turn-in-flight values. `switching` is never assigned in the codebase (only in `chat-input.component.ts:545` and `tab-persistence.ts:154`), so missing it is harmless. `awaiting-background` and `sleeping` are idle by the type docs, and background work is covered by the agent and subagent clauses.
- Terminal statuses: `AgentStatus` is checked as `=== 'running'`, so `failed`, `timeout` and `stopped` never count. Subagent terminal statuses (`completed`, `failed`, `killed`, `stopped`) are excluded.
- Cap clearing: the counts are all computed signals, so the cap clears reactively. The request effect clears the request in the same run as the decision, so a refused request cannot replay when a slot frees.
- Adopt and open paths are untouched, as specified. The popover is closed on a refused create, and `canAddTile` and `MAX_TILES` are unchanged.
- Routing revision: `permissions.routingTargetRevision()` is read first inside the `items` computed, before `targetTabsFor` and `questionTargetTabsFor` (which read plain Maps), so a target change invalidates the list.
- Stale items: `handlePermissionResponse` removes the request synchronously, `handleQuestionResponse` does likewise, and `clearPermission` removes lane entries. An answer from another surface therefore removes the queue row on the next computed run. The `clearAnsweredItems` effect then prunes `answering`.
- Double answers: `respondLane` dedupes by request id across the card and the queue. For session permissions, `answer()` re-checks that the item still exists before sending.
- Ordering: the queue sorts a copy by timestamp and key. Nothing writes to the tile order, and `focusTile` does not reorder.
- Questions: they offer Open session only and never reach the responder. Surface-mode requests are filtered out of both lists.

## Five logic questions

1. Silent failure: M1, M2 (cap undercounts without any signal), M3 (dropped request), M4 (dead buttons).
2. Unexpected user action: pressing Allow on a replayed lane request does nothing (M4). Triggering a new session at the cap from outside the canvas does nothing visible (M3).
3. Wrong answer from data: a null `claudeSessionId` while streaming, and an unparented agent (M1).
4. Dependency failure: if `vscode.postMessage` throws, the responder rolls back its dedupe and the component clears `answering` and rethrows. This is handled correctly. A backend that ignores an unknown id is logged on the host and harmless, because the item is removed locally.
5. Missing requirement: cross-workspace cap scope (M2), and a staleness bound for pending subagent records (m4).

## Verdict

PASS with four Moderate follow-ups. Top risk: the cap overshoots when several fresh tiles stream before their session ids bind, and across workspaces (M1, M2).
