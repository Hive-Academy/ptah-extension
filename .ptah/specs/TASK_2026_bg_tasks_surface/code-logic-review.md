# Code Logic Review — TASK_2026_bg_tasks_surface

Score: 7/10
Verdict: APPROVED (after round 1; see Round 1)
Review family: claude (implementer: codex)

## Findings

1. **BLOCKING — the event never leaves the backend (feature is dead end to end).**
   `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:1093-1106` gates which SDK messages reach
   `messageTransformer.transform()` through an explicit allowlist (`stream_event`, `assistant`, `user`, result,
   `isCompactBoundary`, `isLocalCommandOutput`, `isTaskStarted`, `isTaskProgress`, `isTaskUpdated`,
   `isTaskNotification`). `isBackgroundTasksChanged` is not in it, and this file is unmodified in the diff
   (`git diff HEAD --stat -- libs/backend/agent-sdk/src/lib/helpers` is empty). Every `background_tasks_changed` message is
   therefore dropped before `SdkMessageTransformer` (the new branch at `sdk-message-transformer.ts:401` is
   unreachable from the live stream). The store stays empty and no task row ever renders. The unit test calls
   `transformBackgroundTasksChanged` directly, so it cannot see this.
   Fix: add `|| isBackgroundTasksChanged(sdkMessage)` to the allowlist (import it), and add a stream-transformer
   spec feeding a `background_tasks_changed` SDK message through `transform()` and asserting the yielded
   `background_tasks_snapshot`.

2. **SERIOUS — snapshot is not in `STORE_ONLY_EVENT_TYPES`, so it mints a phantom streaming state.**
   `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:72-81` lists the events that write nothing
   to `StreamingState`; `processEventForTab` (:485-499) and `routeBackgroundEvent` (:646) use it to avoid
   creating a state. The accumulator returns `skip` for the snapshot (`accumulator-core.service.ts:605-607`),
   but a settled tab with `streamingState == null` first gets `setStreamingState(createEmptyStreamingState())`.
   The comment at :479-486 explains the consequence: a state with a null `currentMessageId` cannot be finalized
   and every busy-predicate then reads a live turn (TASK_2026_382 B5). Snapshots arrive mostly after the turn
   ended (that is the point of the feature), so a finished tab would look busy / block queued sends. In the
   background-tab path the empty state is also persisted via `updateBackgroundTab`.
   Fix: add `'background_tasks_snapshot'` to the set.

3. **SERIOUS — stale rows are never cleared when the SDK process ends.**
   The SDK contract (sdk.d.ts:3496) says the level is per process, nothing is emitted at startup, and consumers
   must reset on process (re)start. Nothing here resets: no final empty snapshot is synthesized on stream
   end / abort / error (`stream-transformer.ts:1155-1230`, `chat-stream-broadcaster.service.ts:395-470`), and the
   frontend clears only on tab close/reset (`stream-router.service.ts:972`, force branch only) and surface close
   without `force` for the task store (:303 calls the non-force branch, which does not touch the task store, so
   a closed surface/canvas tile keeps its entries). An abort or crash with a running `local_bash` leaves a
   "running" row (and `hasLiveAgents` in `session-agent-roster.ts:211-216`, which feeds the orchestrator status word
   via `orchestratorStatusWord`) until the tab is closed. Resuming the session later shows the old rows until the
   new process emits a snapshot, which it need not do.
   Fix: in the broadcaster `finally` / stream end, publish an empty `background_tasks_snapshot` for the
   session (or clear the store in the frontend on `chat:complete`-with-no-pending / session end / abort), and
   clear the task store in the non-force branch of `clearSessionAgentState` (:956) as well.

4. **MINOR — task chips and inspector rows are clickable but dead.**
   `canvas-lane-tabs.component.ts:41-44` and `inspector-agents-section.component.ts:260-267` surface `task:<id>` keys.
   `select()`/`openThread` (`inspector-agents-section.component.ts:344-356`) emit `laneRequested('task:...')`; the canvas
   `selectLaneFor` ignores any key that `parseLaneKey` rejects (`canvas-detail.service.ts:33,54`). Click does nothing; the
   selected key is also not normalised away. Make rows non-interactive (`canOpen` false for `kind === 'task'`) and
   hide the steer/stop menu (`row.tray` is null so the menu is already absent; confirm).

5. **MINOR — possible double display with turn_state background tasks.**
   `turn_state` already carries `backgroundTasks` (spec at `system-message.transformer.spec.ts:1565`), driving the
   `awaiting-background` phase. The new rows are a second source for the same `local_bash` work, with different
   lifetimes (edge-paired vs level). Not a duplicate row today (separate surfaces), but the two can disagree; note
   in code or reconcile.

6. **MINOR — type filter is a denylist inside a UI function.**
   `session-agent-roster.ts:197` hardcodes `local_agent`/`local_workflow`. `remote_agent`-style types would show as
   both background agent (via `isAgentTaskType`, `libs/shared/src/lib/type-guards/guards/exec.ts:343`, which only denies
   `local_bash`) and task row. Move the predicate next to `isAgentTaskType` so the two cannot drift.

7. **MINOR — test adequacy.** Only the leaf transformer, store and roster projection are tested. Missing: the
   stream-transformer allowlist (finding 1), accumulator routing `background_tasks_snapshot` to the store with
   `skipStoreEffects`, `StreamingHandlerService` not minting state for a snapshot (finding 2), session-id
   matching tab `claudeSessionId`, clear-on-end (finding 3). `transformBackgroundTasksChanged` returns `[]` silently when
   no owner id; also untested.

## Checked and fine

- Delivery below the transformer: `chat-stream-broadcaster.service.ts` publishes every yielded event generically
  (no eventType allowlist); `LiveMessageProjection.observe` ignores unknown types; the delivery coordinator keys
  anchors by messageId only for message_start/complete, so the constant `background-tasks-<session>` messageId is
  harmless. The accumulator's `assertNever` is satisfied (`accumulator-core.service.ts:605`).
- `subagent-history-page.ts` exhaustive `Record` updated; the other `FlatStreamEventUnion` consumers found
  (`ptah-cli-stream-loop.service.ts`, broadcaster) do not switch exhaustively on it.
- Session match: backend owner = `effectiveSessionId` (real SDK id after `system:init`, `stream-transformer.ts:~686`)
  or `msg.session_id`; the frontend routes by `event.sessionId` the same way as other events, and roster reads
  `tab.claudeSessionId`. Replace-per-session semantic in `BackgroundTaskStore.replace` is correct; ambient filtering
  is correct per sdk.d.ts:3509.
- Session switch: roster is keyed by the tab's own session id, so no cross-session leakage.
- `AgentKind` switches: `AGENT_KIND_LABEL` (Record) and avatar glyph updated; `DOCK_KINDS` includes `task`.
- `local_bash` rejection in `transformTaskStarted` left intact as intended.

## Round 1

Re-check of findings 1-7 (static read only; no type-check result exists, the diagnostics service timed out for the implementer).

1. FIXED. `stream-transformer.ts:1111` now admits `isBackgroundTasksChanged` (imported at :54); `stream-transformer.spec.ts:1546` drives it through `transform()`.
2. FIXED. `streaming-handler.service.ts:80` adds `'background_tasks_snapshot'` to `STORE_ONLY_EVENT_TYPES`; both the active-tab and background-tab paths use that set.
3. FIXED, with one caveat. Terminal cleanup `stream-transformer.ts:1237-1250` runs in `finally`, only when a snapshot was seen, and yields an empty snapshot for `effectiveSessionId`. The `for await` loop (:598) spans the whole SDK query and handles `result` without breaking, so a turn end does not trigger it; tasks that outlive a turn are not cleared (CHAT_COMPLETE is untouched). Frontend clears: `chat-message-handler.service.ts:737-744` on `CHAT_SESSION_ENDED` (now also clears when `tabId` is absent), and `stream-router.service.ts:956-959` clears the task store on both branches.
4. FIXED. Task chips/rows/menu items are disabled and excluded from `visibleKeys`, `selectedKey`, roving focus and `choose()`; `inspector-agents-section.component.ts:337,348` refuses navigation.
5. ACCEPTED (documented at `session-agent-roster.service.ts:87`).
6. PARTIAL, see R1-A.
7. FIXED (new specs for transformer, handler, accumulator, router, message handler, roster).

### New / remaining findings

- R1-A (moderate). `session-agent-roster.ts:199` now filters with `isAgentTaskType`, whose denylist is only `local_bash` (`libs/shared/src/lib/type-guards/guards/exec.ts:343`). Every other non-ambient type (`monitor_mcp`, `mcp_task`, ...) is treated as an agent and dropped from task rows, so the surface effectively shows `local_bash` only. That avoids the double display the existing `task_started` path would create, but contradicts the stated goal of showing Monitor/MCP tasks. Confirm those types render through the existing agent path; if not, they are invisible.
- R1-B (minor). The `yield` inside `finally` (`stream-transformer.ts:1250`) is not delivered if the consumer terminates the generator via `return()` (the yielded value is discarded and the generator stays suspended). The frontend `CHAT_SESSION_ENDED` clear covers that case, so impact is low.
- R1-C (minor). The terminal snapshot is skipped if no snapshot was seen on this stream object; a resumed query that inherits stale frontend rows from a previous process only gets reset by `CHAT_SESSION_ENDED`, not by the new stream.
- No compile errors found by reading: imports (`BackgroundTasksSnapshotEvent`, `BackgroundTaskStore`, `isAgentTaskType`), the `AgentKind` `Record`, and the generator yield union all line up. Not machine-verified.

## Round 2 (tiles)

Score: 6/10
Verdict: REVISE (minor; nothing blocking)

Checks (static read only):

- (6) Reverted files: `git diff main` is empty for all eight source files (dock, dock menu, inspector section/row, roster, roster service, avatar types/component). Only `session-agent-roster.spec.ts` differs from main (2 lines, `active` -> `streaming` tab status), harmless.
- (4) Compile read-through: `resolvedTabId` exists in `chat-view.component.ts` (used at :359, :464); `BackgroundTaskStore.firstSeenAt(sessionId, taskId)` exists and matches the container call; `command?` is on `BackgroundTaskSnapshotEntry` (`stream-background.ts:321`); `LoaderCircle`, `isAgentTaskType`, `input.required` all resolve; the changed `transformBackgroundTasksChanged(msg, state, sessionId)` signature matches the call at `sdk-message-transformer.ts:456`. Angular is 22, so signal writes inside `effect` are allowed. Spec mocks using `as TransformerState` should still compile. Not machine-verified.
- (3) Timer effect (`background-task-tiles-container.component.ts:57-62`): reads only `tiles()`, writes `now`, which it does not read, so no loop; `onCleanup` clears the interval on every re-run and on destroy. It restarts on every snapshot (new array identity), which is cheap. No leak.
- (2) Session resolution: `tab.claudeSessionId` read through the tab lookup inside a `computed`, the same source the roster used; the store is keyed by the event's session id, which `attachSession` binds on the first event, so a new/resumed tab resolves once the id is attached. Forks use the new id, same as other events. Fine.

Findings:

R2-1 (moderate). Command correlation is order-dependent and silently degrades. `sdk-message-transformer.ts:655-670` attaches the command only inside `markNonAgentTask` at `task_started`. The SDK documents the level snapshot as usually arriving BEFORE the `task_started` bookend (sdk.d.ts:3496), so `getBackgroundTaskCommand` is empty when the first snapshot is built (`system-message.transformer.ts:~48`) and no later snapshot is sent until membership changes; the tile shows the description for the task's whole life. The reverse order (`task_started` before the assistant message holding the `tool_use`) leaves the entry in `pendingBashCommands` forever (until the 64 cap / an empty snapshot) and never attaches it. Fix: have `recordBackgroundBashCommand`/`markNonAgentTask` also resolve by the snapshot (e.g. keep `toolUseId` on the task record and let the snapshot builder look up `pending` by the task's tool_use_id when available), or re-emit a snapshot when a command is attached. At minimum treat the command as best-effort and say so.
R2-2 (minor). Bounds: `pendingBashCommands` is capped at 64 (FIFO) and pruned on an empty snapshot per session, so it is bounded. `backgroundTaskCommands` is only pruned inside `retainBackgroundTaskCommands`, which runs on SDK snapshots; the new terminal empty snapshot yielded by `stream-transformer.ts` bypasses the transformer, so a query that ends with live tasks leaves its per-session map until process exit. Small, but not cleared. Also unbounded command length: a heredoc command goes into the event and the tooltip (`whitespace-pre-wrap`, `max-w-80`); truncate (e.g. 500 chars) in `recordBackgroundBashCommand`.
R2-3 (minor). a11y of the tiles (`background-task-tiles.component.ts:40-70`): the focusable `<span tabindex=0>` has `aria-label` but no role (aria-label on a generic element is not reliably announced), and the same text is also in a `role="tooltip"` child that is `display:none` until hover/focus, so it is never exposed to assistive tech and is not tied by `aria-describedby`. Suggested: give the tile `role="status"`/`role="group"` with the label, or use `aria-describedby` pointing at the tooltip id; also `group-focus` shows the tooltip but there is no Escape dismissal (WCAG 1.4.13). The tooltip is absolutely positioned inside the composer wrapper; clipping by an `overflow` ancestor was not checked.
R2-4 (minor). Duplicate filtering with `isAgentTaskType` in both container and presentational component is redundant but harmless; the earlier R1-A caveat stands (only `local_bash` yields tiles, so Monitor/MCP types are never shown).
