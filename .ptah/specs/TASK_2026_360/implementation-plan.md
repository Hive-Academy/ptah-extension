# TASK_2026_360 — Implementation plan

Backend-owned per-session **turn state** as the single source of truth for every "is the
agent busy" signal in the webview. Read `research-report.md` first for the five defects this
plan closes; every design decision below points back to one of them.

## 1. The contract (libs/shared)

### 1.1 `TurnStateEvent` — a FlatStreamEvent, delivered IN the chunk stream

Ordering is the whole point (research §"Backend: three channels"). The turn state travels as a
`FlatStreamEventUnion` member through the SAME `StreamBatchBuffer` as text deltas, so it can
neither overtake nor trail them. It is NOT a new `MESSAGE_TYPES` push.

```ts
// libs/shared/src/lib/types/execution/stream-background.ts (next to the union)
export type SessionTurnPhase =
  | 'generating' // root assistant turn in flight
  | 'awaiting-background' // turn ended; SDK reports in-flight background tasks
  | 'sleeping' // turn ended; SDK reports session crons (ScheduleWakeup / loop)
  | 'idle' // turn ended; nothing pending
  | 'failed'; // StopFailure observed for this turn

export interface SessionTurnState {
  readonly phase: SessionTurnPhase;
  /** Monotonic per session. Consumers ignore an event whose revision is <= the last applied. */
  readonly revision: number;
  readonly backgroundTasks: readonly SdkBackgroundTaskSummary[];
  readonly sessionCrons: readonly SdkSessionCronSummary[];
  readonly terminalReason: SdkTerminalReason | null;
  /** Set only for phase 'failed'. */
  readonly error?: SdkAssistantMessageError;
  readonly timestamp: number;
}

export interface TurnStateEvent extends FlatStreamEvent, SessionTurnState {
  readonly eventType: 'turn_state';
}
// add `| TurnStateEvent` to FlatStreamEventUnion
```

`SdkBackgroundTaskSummary`, `SdkSessionCronSummary`, `SdkTerminalReason`,
`SdkAssistantMessageError` already exist in `libs/shared/src/lib/types/sdk-hook.types.ts`.
`messageId` is required by `FlatStreamEvent`; use `turn-state-${sessionId}` (it is never rendered).

Add a guard `isTurnStateEvent(e): e is TurnStateEvent` in
`libs/shared/src/lib/type-guards/guards/exec.ts` and export it. Add a Zod schema
`SessionTurnStateSchema` next to the hook payload schemas (wherever
`SdkTurnEndedPayloadSchema` lives under `libs/shared/src/lib/types/**/schemas.ts`) — the RPC
boundary in §2.5 validates with it.

### 1.2 `session:status` returns the turn state

```ts
// libs/shared/src/lib/types/rpc/rpc-session.types.ts
export interface SessionStatusResponse {
  isActive: boolean;
  /** @deprecated derived: turnState.phase === 'generating'. Kept for the CLI/TUI readers. */
  isStreaming: boolean;
  /** Absent when the session is unknown to the backend. */
  turnState?: SessionTurnState;
}
```

## 2. Backend — derive the state once, emit it in order

### 2.1 `SessionTurnStateRegistry` (new, `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts`)

`@injectable()` singleton, token `SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY`
(`Symbol.for('SdkSessionTurnStateRegistry')`), registered in `di/register.ts`, exported from
`src/index.ts` (rpc-handlers reads it in §2.5). Keyed by session id string. It is a pure
in-memory reducer; no I/O.

```ts
interface TurnRecord {
  state: SessionTurnState;           // current, revision-stamped
  stopSnapshot: { backgroundTasks; sessionCrons; terminalReason } | null; // from Stop, consumed at result
  failure: { error; terminalReason } | null;                              // from StopFailure, consumed at result
  generatingEmitted: boolean;        // dedupe: one 'generating' per turn
}
markGenerating(sessionId): SessionTurnState | null   // returns a NEW state only on the first call per turn, else null
recordStop(sessionId, snapshot): void                 // Stop hook — snapshot only, NO phase change
recordFailure(sessionId, failure): void               // StopFailure hook — snapshot only
settleTurn(sessionId): SessionTurnState               // at `result`: phase = failure ? 'failed'
                                                      //   : backgroundTasks.length ? 'awaiting-background'
                                                      //   : sessionCrons.length ? 'sleeping' : 'idle';
                                                      //   clears both snapshots, resets generatingEmitted
applySnapshot(sessionId, backgroundTasks): SessionTurnState | null
                                                      // SubagentStop / task_notification while NOT generating:
                                                      //   replace backgroundTasks; if phase==='awaiting-background'
                                                      //   and now empty and no crons → 'idle'. Never touches 'generating'.
forceIdle(sessionId, terminalReason?): SessionTurnState  // stream error / abort / session end
get(sessionId): SessionTurnState | undefined
rekey(placeholderId, realId): void                    // tabId → SDK UUID; wire to SessionIdResolvedCallbackRegistry
clear(sessionId): void                                // session disposed
```

Why the Stop hook only SNAPSHOTS: the SDK fires `Stop` before the final `assistant` message
is pulled by our consumer (research §"Backend"). The phase flips at `result`, on the stream,
where order is guaranteed.

### 2.2 Producers

- `StopHookHandler` (`helpers/stop-hook-handler.ts`): after the existing fan-outs, call
  `registry.recordStop(resolvedSessionId, { backgroundTasks, sessionCrons, terminalReason })`.
  Keep `emitTurnEnded` — `TurnEndHandlerService` still uses it for the snapshot fields.
- `StopFailureHookHandler`: `registry.recordFailure(resolvedSessionId, { error, terminalReason })`.
- `SubagentStopHookHandler`: `registry.applySnapshot(resolvedSessionId, input.background_tasks ?? [])`.
  If it returns a state, there is no stream position to emit from a hook — so ALSO have
  `ChatStreamBroadcaster` subscribe (§2.4) OR rely on the in-stream `task_notification` path
  below. Do the in-stream path; the hook call keeps the registry current for `session:status`.
- `SdkMessageTransformer` — add `turnState: SessionTurnStateRegistry` to the constructor
  (inject `SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY`), thread it through
  `createIsolated()` and put it on `TransformerHelpers` (`message-transform/transformer-helpers.ts`).
  - **generating**: in `StreamEventTransformer` and `AssistantMessageTransformer`, where the
    root assistant `message_start` is built (no `parentToolUseId`, role `assistant`), call
    `helpers.turnState.markGenerating(sessionId)`; when it returns a state, PREPEND a
    `TurnStateEvent` to the returned events. `sessionId` here is the resolved one the
    transformer already computed (tabId before init, UUID after; the frontend aliases them).
  - **terminal**: `ResultMessageTransformer.transform` (currently returns `[]` and is never
    called) → return `[toTurnStateEvent(helpers.turnState.settleTurn(sessionId))]`. In
    `helpers/stream-transformer.ts:427-437` add `isResultMessage(sdkMessage)` to the list so
    the transform runs. Keep `onTurnEnd?.()` and the stats block exactly where they are — they
    run before the transform in the same iteration, so `markTurnEnded` still fires first.
  - **snapshot update**: in `SystemMessageTransformer.transformTaskNotification`, after the
    existing logic, `const next = helpers.turnState.applySnapshot(sessionId, remaining)` where
    `remaining` is the registry's current `backgroundTasks` minus the settled `task_id`; append
    a `TurnStateEvent` when non-null. (The SubagentStop hook already wrote the authoritative
    list moments earlier, so this normally emits the registry's current state.)
- `ChatStreamBroadcaster.streamEventsToWebview` (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`):
  - in the `catch`, before CHAT_ERROR: `batch.push(turnStateChunk(registry.forceIdle(sessionId, isUserAbort ? 'aborted_streaming' : undefined)))` then `await batch.flush()`.
  - in the `finally` before `batch.dispose()`: if the registry still says `generating`, push `forceIdle` and flush. Then `registry.clear(sessionId)` AFTER the existing teardown.
  - Inject the registry via `SDK_TOKENS.SDK_SESSION_TURN_STATE_REGISTRY`.
  - Wrap the event exactly like other chunks: `{ type: CHAT_CHUNK, payload: { tabId, sessionId, event } }`.

### 2.3 Alias

`SdkAgentAdapter` already fans out `SessionIdResolvedCallbackRegistry.notifyAll` on both
resolve sites. Subscribe the registry there (in `di/register.ts` or where the other
subscribers — `MemoryTriggerService`, `SkillTriggerService` — subscribe) and call `rekey`.
Handler must be synchronous and must not overwrite an entry already under the real id.

### 2.4 Nothing else emits status

`SessionLifecycleNotifier` keeps broadcasting `SESSION_TURN_ENDED` / `SESSION_TURN_FAILED` /
`SESSION_SUBAGENT_ENDED` unchanged — the frontend keeps them for the snapshot fields and the
error surface, but STOPS deriving status from them (§3).

### 2.5 `session:status` (`libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:1115-1138`)

Return `{ isActive, isStreaming: state?.phase === 'generating', turnState: state }` where
`state = registry.get(sessionId)`. Inject the registry. Parse the outgoing `turnState` with
`SessionTurnStateSchema` only in the spec, not in the handler (inbound-only validation rule).

## 3. Frontend — one applier, everything derives from it

### 3.1 `SessionStatus` gains `'sleeping'` (`libs/frontend/chat-types/src/lib/chat-types.ts:447-454`)

Document it beside `awaiting-background`. `sanitizeRestoredTab`
(`libs/frontend/chat-state/src/lib/tab-persistence.ts:118-121`) coerces it to `loaded` like the
other in-flight statuses — a restored tab re-learns its state from `session:status`.

### 3.2 `TabManagerService.applyTurnState(tabId, state)` (`libs/frontend/chat-state/src/lib/tab-manager.service.ts`, intent-method section)

One write per event, workspace-aware (`updateTabInternal` already routes to the partition):

| phase               | `status`                            | `_streamingTabIds` | other fields                                                          |
| ------------------- | ----------------------------------- | ------------------ | --------------------------------------------------------------------- |
| generating          | `streaming`, `hasLiveSession: true` | add                | `lastTerminalReason: undefined`, `pendingBackgroundTasks: []`         |
| awaiting-background | `awaiting-background`               | delete             | `pendingBackgroundTasks`, `pendingSessionCrons`, `lastTerminalReason` |
| sleeping            | `sleeping`                          | delete             | same                                                                  |
| idle                | `loaded`                            | delete             | same                                                                  |
| failed              | `loaded`                            | delete             | same; error surface stays with `handleTurnFailed`                     |

Store `lastTurnStateRevision` on `TabState` and drop events whose revision is `<=` it (a
replayed or duplicated batch must not regress the tab). `markTabAwaitingBackground`'s
microtask trick is no longer needed — delete it. Keep `markTabStreaming` / `markTabIdle`
only as the primitives this method uses; make them private if nothing else calls them after §3.4.

### 3.3 `TurnStateApplier` (new, `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts`)

`@Injectable({ providedIn: 'root' })`. Input: `TurnStateEvent` + optional `tabId`. Steps:

1. Resolve tabs: `tabId` → active tab by id; else `findTabsBySessionId(sessionId)` (active
   workspace, may be several — canvas fan-out); else `findTabBySessionIdAcrossWorkspaces`
   (background partition). Same resolution order `StreamingHandlerService.processStreamEvent`
   uses today.
2. If the phase is terminal (`awaiting-background | sleeping | idle | failed`): call
   `MessageFinalizationService.finalizeCurrentMessage(tabId, isAborted)` for each resolved tab
   FIRST — the event is ordered after the last chunk, so the tree is complete. `isAborted` =
   `terminalReason` not in `{ 'completed', null }`. `pendingStats` already stashed on the
   streaming state are consumed by finalization as today.
3. `tabManager.applyTurnState(tab.id, state)` for each tab.
4. `SessionLivenessRegistry`: `generating` → `markStreaming`; `awaiting-background` →
   `markAwaitingBackground`; `sleeping` → `markAwaitingBackground` (it is "live, will wake");
   `idle` → `markIdle`; `failed` → `markFailed`. Pass the tab's `workspacePath`.
5. If no tab resolves: still write the liveness registry (surface-owned sessions) — never warn
   for a session `StreamRouter.surfacesForSession` knows.

### 3.4 Delete every other status writer

- `StreamingHandlerService` (`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts`):
  - At the top of `processStreamEvent`, `if (isTurnStateEvent(event)) { applier.apply(event, tabId); return null; }`
    — before dedup, before the accumulator; the event is never stored in `StreamingState`.
  - Delete the self-heal block (`:327-355` the `markTabStreaming` re-mark and its comment) and
    the `markTabStreaming` + `status: 'streaming'` in `routeBackgroundEvent` (`:403-410`);
    `updateBackgroundTab` there writes `streamingState` only.
  - Delete the `attachSession → markStreaming` hijack's status writes at `:163-167` and `:252-255`
    EXCEPT `attachSession` itself (binding the session id is still needed). `SessionManager.setStatus`
    calls there go too; `SessionManager` status now mirrors the active tab's `status` (see §3.6).
  - `handleSessionStats`: remove the safety-net finalization branch (`:527-575`). Stats either
    merge onto the last assistant message (tab already finalized) or are stashed as
    `state.pendingStats` (still streaming) — the `:578-586` branch. Return `queuedContent` only
    when the tab is already finalized.
- `TurnEndHandlerService` (`libs/frontend/chat/src/lib/services/chat-store/turn-end-handler.service.ts`):
  - `handleTurnEnded`: keep ONLY `setTurnEndedFields` / `updateBackgroundTab` snapshot writes
    (`pendingBackgroundTasks`, `pendingSessionCrons`, `lastTerminalReason`). Delete
    `finalizeCurrentMessage`, `markTabIdle`, `markTabAwaitingBackground`, `status: 'loaded'`.
  - `handleSubagentEnded`: keep `backgroundAgents.onStopped` ONLY when `knownEntry` exists (a
    foreground subagent is not a background agent); keep the `pendingBackgroundTasks` snapshot;
    delete `markLoaded` / `markTabIdle` / `status: 'loaded'`.
  - `handleTurnFailed`: keep `setLastTerminalReason` + `handleChatError`; delete
    `finalizeCurrentMessage` + `markTabIdle` + `status: 'loaded'` (the `failed` turn_state does them).
- `ChatMessageHandler` (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`):
  delete every `this.liveness.mark*` call in `handleChatChunk`, `handleSessionTurnEnded`,
  `handleSessionSubagentEnded`, `handleSessionTurnFailed`. Keep the `/clear` `markIdle` in
  `handleChatComplete` (that one has no turn_state). Delete `workspaceFor` if it has no caller left.
- `MessageSenderService` (`libs/frontend/chat/src/lib/services/message-sender.service.ts:369-372, 650-652`):
  keep the optimistic `markStreaming` + `markTabStreaming` on send — the user needs immediate
  feedback before the first chunk. The `generating` event then confirms; the revision guard
  makes the double write harmless. `applyTurnState` must accept a `generating` event whose
  revision is 1 for a tab whose `lastTurnStateRevision` is undefined.

### 3.5 Reconciler (`libs/frontend/chat/src/lib/services/chat-store/session-liveness-reconciler.service.ts`)

`probe`: if `result.data.turnState` exists → build a synthetic `TurnStateEvent` and call
`TurnStateApplier.apply(event, tabId)`; else if `isActive` → `liveness.markIdle`. Delete the
`isStreaming → markStreaming/markTabStreaming` branch (Defect 4). Also call
`reconcileRestoredTabs()` after a workspace switch — find where `WorkspaceCoordinatorService`
completes a switch and add the call (same place `loadSessions` is re-run for the new workspace).

### 3.6 UI

- `chat-input.component.ts:423-439`: add `case 'sleeping': return true;`. Stop button keeps
  reading `isTabStreaming` — it is now written only by `applyTurnState` (+ optimistic send).
- `tab-bar.component.ts:91-93`: render the pill for `sleeping` too. Extend
  `AwaitingBackgroundIndicatorComponent` (`libs/frontend/chat-ui/.../awaiting-background-indicator.component.ts`)
  with an optional `crons` input; when `tasks` is empty and `crons` non-empty show
  "Sleeping — N scheduled wakeup(s)" with each `schedule` in the tooltip. No cron parsing.
- `ChatStore.isStreaming` (`chat.store.ts:125-127`) unchanged — it reads `status`, which is
  now backend-driven.

## 4. Verification

- Backend specs (`agent-sdk`): registry reducer table; `ResultMessageTransformer` emits one
  `turn_state` per result with the Stop snapshot; `generating` emitted once per turn even with
  several assistant messages; hooks write snapshots without flipping phase.
- Broadcaster spec: `turn_state` from a `result` lands AFTER the preceding `message_complete`
  in the batch order; error path pushes `idle` before CHAT_ERROR.
- Frontend specs: `applyTurnState` table incl. revision guard and background-partition tab;
  `StreamingHandlerService` no longer re-marks streaming on a post-terminal `agent_progress`;
  `TurnEndHandlerService` no longer touches `status`; reconciler applies `turnState`.
- `npx nx run-many -t typecheck -p @ptah-extension/shared @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/chat-types @ptah-extension/chat-state @ptah-extension/chat-streaming @ptah-extension/chat @ptah-extension/chat-ui`
- `npx nx run-many -t test -p <same list>` — read the `Running target test for N projects` header.
- Manual: (a) plain turn → stop button clears with the last chunk; (b) `run_in_background`
  subagent → pill "awaiting", input enabled, no stop button, agent progress does not re-light;
  (c) `/loop` or `ScheduleWakeup` → "sleeping" pill, woken turn shows `streaming` + stop
  button, ends clean; (d) two sessions in two workspaces, switch mid-turn both ways; (e)
  reload webview with an idle live session → no stop button.
