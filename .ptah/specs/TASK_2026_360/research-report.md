# TASK_2026_360 — Research report (orchestrator, 2026-08-31)

Root-cause analysis of the streaming-status desync. Every claim has a file:line anchor.

## Summary

The UI has no single source of truth for "the agent is busy". Three frontend signals and
three backend channels each decide independently, and they disagree after a turn ends.

## Frontend: three independent "busy" flags

| Consumer                                  | Reads                                                                                                                                                      | Written by                                                                                                                                              |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stop button + tab spinner                 | `TabManagerService._streamingTabIds` via `isTabStreaming()` — `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts:407-410` | `markTabStreaming` / `markTabIdle` (`tab-manager.service.ts:2071-2091`)                                                                                 |
| Input enablement, `ChatStore.isStreaming` | `tab.status` — `chat-input.component.ts:423-439`, `chat.store.ts:125-127`                                                                                  | `markStreaming` / `markLoaded` / `applyFinalizedTurn` microtask / `markTabAwaitingBackground` microtask (`tab-manager.service.ts:1073-1116, 1318-1339`) |
| Workspace sidebar dot                     | `SessionLivenessRegistry` (`libs/frontend/chat-state/src/lib/session-liveness.registry.ts`)                                                                | `ChatMessageHandler` on CHAT_CHUNK / turnEnded / subagentEnded / turnFailed (`chat-message-handler.service.ts:327-379, 455-460`)                        |

## Backend: three channels with no ordering guarantee

1. `Stop` hook → `StopHookHandler` (`libs/backend/agent-sdk/src/lib/helpers/stop-hook-handler.ts:88-96`) →
   `SdkAdapterEvents.emitTurnEnded` → `SessionLifecycleNotifier` → direct `broadcastMessage(SESSION_TURN_ENDED)`
   (`libs/backend/rpc-handlers/src/lib/handlers/session-lifecycle-notifier.ts:112-137`).
   The SDK dispatches hook `control_request`s from its transport read loop
   (`handleHookCallbacks` in `sdk.mjs`), independent of when the consumer pulls messages.
2. Stream chunks → `SdkMessageTransformer` (async generator) → `ChatStreamBroadcaster` →
   `StreamBatchBuffer` (16 ms timer / 64-event cap, un-awaited size flushes)
   (`libs/backend/rpc-handlers/src/lib/chat/streaming/stream-batch-buffer.ts:46-55`,
   `chat-stream-broadcaster.service.ts:148-253`). `message_complete` forces a flush + CHAT_COMPLETE.
3. `SESSION_STATS` → `onResultStats` → `sendStatsWithRetry` → direct broadcast
   (`libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:387-402`).

Consequence: `session:turnEnded` can reach the webview BEFORE the final chunks of the same
turn. Commit b401e65eb (chat stream batching) widened this window.

## Defect 1 — self-heal re-lights the spinner from any late event; nothing clears it

`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:327-355`: after a turn
ended, any event with `stateMutated` re-adds the tab to `_streamingTabIds` unless
`lastTerminalReason` is an abort. `markTabStreaming` then wipes `lastTerminalReason`
(`tab-manager.service.ts:2073`), disarming the `handleSessionStats` safety net
(`streaming-handler.service.ts:526`).

Events that arrive after `Stop` and return `mutated`:

- the late `message_complete` of the finished turn (ordering race above);
- every post-turn background event — `background_agent_started|completed|stopped`,
  `agent_progress`, `agent_status`, `agent_completed`
  (`libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:568-585`).

No later `Stop` comes for an idle session → stop button stays red until the next turn ends.
Matches the screenshot exactly (stats merged, so `Stop` had been observed at stats time; the
re-light came from a post-`result` event).

The same re-mark exists on the background-workspace path: `routeBackgroundEvent`
(`streaming-handler.service.ts:403-410`) marks streaming and forces `status: 'streaming'`
on every mutated event for a partitioned tab.

## Defect 2 — `awaiting-background` is set, then overwritten

`TurnEndHandlerService.handleTurnEnded` (`libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts:152-165`)
correctly clears the spinner and sets `awaiting-background` when the SDK reports
`background_tasks`. The tab bar renders a pill (`tab-bar.component.ts:91-93`). The first
`agent_progress` from the background subagent hits Defect 1 and turns the spinner + stop
button back on. UI says "streaming" while the agent idles.

## Defect 3 — woken / auto-resumed turns never set `tab.status` back to `streaming`

`ScheduleWakeup`, session crons and background-task completion start a new turn with no
user message from Ptah. `processEventForTab` sets `status: 'streaming'` only when it attaches
a session (`streaming-handler.service.ts:252-255`). During a woken turn: `status === 'loaded'`
(input enabled, `isStreaming()` false) while the stop button is on. A message the user sends
is held by `SessionStreamPump` (`session-stream-pump.service.ts:72-85, 204-214`) with no UI
feedback. `pendingSessionCrons` is stored (`tab-manager.service.ts:1512-1525`) but nothing
renders "sleeps until"; there is no `sleeping` `SessionStatus`
(`libs/frontend/chat-types/src/lib/chat-types.ts:450-454`).

## Defect 4 — `session:status.isStreaming` means "loop attached", not "generates now"

`ChatStreamBroadcaster.isStreaming` is true for the whole life of an SDK session because the
`for await` never exits in streaming-input mode (its own comment,
`chat-stream-broadcaster.service.ts:103-115, 124-126`). `SessionLivenessReconcilerService.probe`
treats it as "generates now" and calls `markStreaming` + `markTabStreaming` on every restored
tab (`libs/frontend/chat/src/lib/services/chat-store/session-liveness-reconciler.service.ts:41-44`),
called from `ChatLifecycleService.bootstrap` (`chat-lifecycle.service.ts:66`). After a webview
reload or workspace switch, every live-but-idle session shows a red stop button and a
disabled input until its next turn ends.

## Defect 5 (minor) — foreground SubagentStop marks liveness idle

`chat-message-handler.service.ts:327-332`: liveness `markIdle` whenever `backgroundTasks` is
empty — true for every FOREGROUND subagent that finishes mid-turn, so the workspace dot
flickers off while the parent still streams. `handleSubagentEnded` also calls
`backgroundAgents.onStopped` with `toolCallId: ''` for foreground agents
(`turn-end-handler.service.ts:183-195`).

## Backend facts the design can rely on

- Turn boundary on the SDK stream is the `result` message; `StreamTransformConfig.onTurnEnd`
  fires first inside that branch, unconditionally (`stream-transformer.ts:104-111, 309-312`);
  `SessionLifecycleManager.markTurnEnded` releases the pump's `turnInFlight`
  (`session-lifecycle-manager.ts:415-421`; `sdk-agent-adapter.ts:1217-1221`).
- `Stop` hook payload carries `background_tasks[]`, `session_crons[]` (with `schedule`,
  `recurring`) and `terminal_reason` (`sdk.d.ts:5574-5591`; shared mirror
  `libs/shared/src/lib/types/sdk-hook.types.ts`). The d.ts comment: "Lets hooks distinguish
  'session is done' from 'session is paused waiting for background work to wake it'".
- `task_notification` (`system` subtype) marks a background task settling; transformer already
  maps agent tasks to `agent_completed` and drops `local_bash`
  (`system-message.transformer.ts:396-456`).
- `SubagentStop` hook → `subagentEnded` with the remaining `background_tasks`
  (`subagent-stop-hook-handler.ts:71-79`).
- `StopFailure` → `turnFailed`.
- Root-turn start is the first `message_start` with `role: 'assistant'` and no
  `parentToolUseId` after a `result` (or after session start).
- Canonical session id: the SDK UUID from `system.init`; a new session streams under its
  tabId until `SESSION_ID_RESOLVED` — the frontend `SessionLivenessRegistry.rekey` already
  handles the alias (`session-liveness.registry.ts:61-86`).
- Every transport unwraps `MESSAGE_TYPES.BATCH` (`chat-stream-broadcaster.service.ts:25-30`),
  so a new message type pushed through `StreamBatchBuffer` is delivered in order with chunks.
- Frontend already has a workspace-aware tab lookup
  (`findTabBySessionIdAcrossWorkspaces`, `updateBackgroundTab`) and a per-session liveness
  registry keyed by canonical id — both are the natural sinks for a backend state event.

## Recommendation carried into the architecture phase

1. Backend derives `turnState` per session:
   `generating | awaiting-background | sleeping | idle | failed`, plus
   `backgroundTasks[]`, `sessionCrons[]`, `sleepUntil?`, `terminalReason?`, `revision`.
   Inputs: root `message_start` (→ generating), `result`/`Stop` (→ idle | awaiting-background
   | sleeping by payload), `task_notification`/`SubagentStop` snapshots (→ update remaining
   tasks; no state flip on their own), `StopFailure` (→ failed), `interrupt`/abort (→ idle).
2. Emit it as ONE message type through the same `StreamBatchBuffer` as the chunks so order
   is guaranteed. Keep `SESSION_TURN_ENDED`/`SESSION_STATS` for their existing consumers
   (finalization, stats) but strip every status side-effect from them.
3. Frontend: one reducer applies `turnState` to the tab (`status`, `_streamingTabIds`,
   `pendingBackgroundTasks`, `pendingSessionCrons`) AND to `SessionLivenessRegistry`, by
   canonical session id, across workspace partitions. Delete the self-heal re-mark
   (`streaming-handler.service.ts:348-354, 403-405`) and the status writes in
   `routeBackgroundEvent`; `TurnEndHandlerService` keeps finalization only.
4. `session:status` returns the backend turn state (not "loop attached"); the reconciler
   applies it through the same reducer on boot and on workspace switch.
5. Add a `sleeping` `SessionStatus` and render `sleepUntil` / next cron in the tab bar pill.
