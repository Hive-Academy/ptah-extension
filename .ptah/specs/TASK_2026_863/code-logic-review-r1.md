# Code Logic Review — `TASK_2026_863` (re-review)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 2        |
| Failure modes found | 2        |

Score 8, not 9–10: the reported rail transition is now on the real Electron delivery path, and reveal still finalizes, but `applyHiddenTurnStateStatus` writes only `status`. The spinner set, terminal reason, background-task snapshot and completion pulse stay stale until the retained `turn_state` is applied. Score is not 5–6: the previous Blocking drop (hidden terminal never applied) and the Serious lane inversion are both gone in the current source, with `file:line` evidence below.

No skill was loaded. The host listed skills; none is assigned for a read-only logic re-review, and none of the catalogue descriptions is the review method. This role's template is the method.

`ptah_code_search_symbols` returned an empty index (`symbolCount: 0`). Symbol lookup fell back to one ripgrep pass. `ptah_get_diagnostics` on the four source files was unavailable again (TypeScript check still running after 45s). Tests were not run here. The fix report's `npm run verify` exit 1 (`spawn EPERM`) is still not evidence that this path holds.

## Decisions

- Reviewed `git diff HEAD` of the seven named files, then the whole functions those hunks sit in, plus the Electron transport and the reveal/resync consumers they call. The previous review's other files (density, card height, `holdText`) were not re-scored.
- Treated "the tile leaves Running" as `railStateValue()` becoming `'done'` (or staying `'running'` while a lane is actually running). `Canvas` groups `'done'` under Finished (`canvas-rail-grouping.util.ts:18`).
- Treated a lane as finished when `session:subagentEnded` or `AGENT_MONITOR_EXITED` has been applied. Both are broadcast outside the stream viewport. A lane that has not received its own completion is still running.

## Five logic questions

### 1. How does this fail silently?

The previous silent success — a hidden turn ends and the tile stays Running — is closed for an `idle` or `failed` `turn_state`. `route` still retains the original event, then pushes one `chat:chunk` with `statusOnly: true` (`chat-stream-delivery-coordinator.service.ts:183-191`). Nothing on the Electron path strips that flag: `IpcBridge.extractStreamEvent` keeps `payload` intact (`ipc-bridge.ts:314-321`), `MessageRouterService.dispatchBatch` forwards each member (`message-router.service.ts:284-304`), and `handleChatChunk` reads `statusOnly` before the flush scheduler (`chat-message-handler.service.ts:548-552`). `StreamFlushScheduler` never sees this chunk, so its hidden-tier drop (`stream-flush-scheduler.service.ts:43-45`) does not apply. `applyHiddenTurnStateStatus` accepts the event when `canApplyTurnState` does and writes `status: 'loaded'` (`tab-manager.service.ts:1962-1964`). `updateTabInternal` publishes that change for a non-active tab in the active workspace (`tab-manager.service.ts:1705-1743`).

What still fails quietly: the same method does not remove the tab from `_streamingTabIds`, does not write `lastTerminalReason`, `pendingBackgroundTasks` or `pendingSessionCrons`, and does not emit a terminal pulse. Callers of `isTabStreaming` keep treating the tab as live until reveal. The rail does not read that set; it reads `tab().status` (`compact-session-card.component.ts:244`, `541-546`).

### 2. What user action produces unexpected behaviour?

Start a turn, switch to another session, let the turn reach `idle` or `failed`. The hidden tile's rail state becomes `'done'` once `status` is `'loaded'`, without focusing it, as long as `laneSummary().counts.running === 0`. A session that already has messages takes the `messages().length > 0` branch even while `streamingState` is still the unrevealed tree (`compact-session-card.component.ts:547-550`). A first turn that never delivered a chunk (`streamingState === null`, `hasLiveSession`, no messages yet) takes the new shortcut on the same lines.

Focusing the tile afterwards still finalizes once. `statusOnly` does not write `lastTurnStateRevision`, so the retained terminal is not a stale replay. `TurnStateApplier.apply` checks revision and phase, not "already loaded" (`turn-state-applier.service.ts:106-125`). It finalizes before `applyTurnState` (`:144-157`). `finalizeCurrentMessage` returns only when `streamingState` or `currentMessageId` is missing (`message-finalization.service.ts:185-188`); it does not return because status is already `'loaded'`. `applyFinalizedTurn`'s microtask bails only while the tab is still in `_streamingTabIds` (`tab-manager.service.ts:2432-2433`). On this path `applyTurnState` removes it synchronously before that microtask (`:1908-1920`), so the retained deltas are not left stuck in `streamingState`.

A later `generating` event while the tab stays hidden is still retained and not status-forwarded (`chat-stream-delivery-coordinator.service.ts:186-187` allows only `idle` and `failed`). The composer queue does not start that turn early: the queue flush requires `lastTurnStateRevision === event.revision` after the real applier (`streaming-handler.service.ts:283-291`), which `statusOnly` never sets. A host-started follow-up turn that publishes `generating` without that queue would leave the tile in Finished until reveal or until that turn's own terminal. That publisher was not traced to a concrete gateway call in this pass.

### 3. What input data produces a wrong answer?

- Hidden terminal `turn_state` with `phase: 'idle' | 'failed'`, `retirementOnly` unset, revision greater than `lastTurnStateRevision` (or no revision yet), session id matching the tab. Result: `status: 'loaded'`, rail `'done'` when no lane is running. This is the requested result.
- Same event with `revision <= last` and `allowTerminalHeal: false` (`tab-manager.service.ts:1963`, `2085`). Result: status stays `'streaming'` until reveal, where the full event is applied with heal allowed. This is the revision-floor eviction case. It is not the common path.
- `status: 'loaded'` and `counts.running > 0`. Result: `'running'` (`compact-session-card.component.ts:541-546`). A CLI exit (`agent-events.ts` `AGENT_MONITOR_EXITED`) and a subagent stop (`session-lifecycle-notifier.ts:185-186`, `turn-end-handler.service.ts:177-180`) are not viewport-gated, so a lane that has actually finished does not stay `'running'`.
- `status: 'loaded'`, `hasLiveSession`, `streamingState !== null`, `messages.length === 0`. Result: `'idle'` (Waiting), not Finished. A turn that already appended the user message does not hit this; `messages().length > 0` wins.

### 4. What happens when a dependency fails?

`send` logs and swallows a transport failure (`chat-stream-delivery-coordinator.service.ts:373-381`). The event is already in the tail, so reveal can still deliver it. If the `statusOnly` chunk is the thing that failed, the tile stays Running until reveal. That is the old symptom, and only on a failed send.

Tail overflow still sets `resyncRequired` and clears the tail (`:295-307`), including when the overflowing event is the terminal. `publish` has already given that event to `LiveMessageProjection.observe`, which keeps it as `turnState` and, for `idle`/`failed`, drops open contexts (`live-message-projection.ts:54-67`). `buildSeed` puts that `turnState` back (`:125-129`). Reveal sends `liveSeed`, not the cleared tail (`chat-stream-delivery-coordinator.service.ts:324-339`). The replayer keeps `turn_state` in the seed (`session-history-replayer.service.ts:1020-1047`) and `processStreamEvent` routes it to the applier. Early `'loaded'` does not reject it, because the revision watermark was not moved. Unpersisted text that overflow dropped is the pre-existing resync behaviour; this change does not add a second terminal, so finalization still runs once.

### 5. What is missing that the requirements never mentioned?

`statusOnly` is not a full `applyTurnState`. Spinner membership, terminal reason, cron/task snapshots and the completion pulse wait for reveal. The rail group does not wait.

A hidden `generating` / `awaiting-background` / `sleeping` phase is still not forwarded. `awaiting-background` therefore stays `'streaming'` on the tile, which still reads as Running. That matches "work is not finished". It does not move a follow-up hidden `generating` back to Running after an earlier terminal has already set `'loaded'`.

The handler spec mocks `applyHiddenTurnStateStatus`. The coordinator spec checks the wire payload and the reveal order. Neither drives the real applier and `railStateValue` together. That is a coverage gap, not a second drop on the path that was read.

## Failure modes

### Status-only write leaves the spinner set and terminal metadata behind

- Trigger: a non-visible tab receives `idle` or `failed` through `statusOnly`, and the user does not focus it.
- Symptom: the rail group moves to Finished. `isTabStreaming` stays true. `lastTerminalReason` and the background-task snapshot stay at the pre-terminal values. No terminal pulse is emitted. A failed turn can sit in Finished rather than the error group until reveal, because the error tone reads `terminalReason` and the live summary, which this write does not update.
- Evidence: `tab-manager.service.ts:1962-1964` versus the full write at `:1879-1950`. Rail classification does not read the spinner set (`compact-session-card.component.ts:536-550`).
- Current handling: reveal's original `turn_state` still runs `applyTurnState`, which clears the spinner before `applyFinalizedTurn`'s microtask.
- Recommendation: also clear `_streamingTabIds` for that tab and copy `terminalReason`, `backgroundTasks` and `sessionCrons` in the status-only write. Keep leaving `lastTurnStateRevision` unchanged.

### Revision-floor heal is refused until focus

- Trigger: the tab's `lastTurnStateRevision` is ahead of a restarted backend counter, and the hidden terminal's revision is `<=` that watermark.
- Symptom: `canApplyTurnState(..., false)` returns false (`tab-manager.service.ts:2080-2085`). Status stays `'streaming'` and the tile stays Running until focus. Reveal applies the same event with heal enabled, so it does not stick after the user opens the session.
- Evidence: `applyHiddenTurnStateStatus` passes `allowTerminalHeal: false` at `tab-manager.service.ts:1963`. The flag exists so an unordered probe cannot idle a live turn (`:2020-2027`). This event is the ordered terminal; the retained copy is what finalizes.
- Current handling: the common monotonic revision is accepted. Only the floor-eviction terminal waits.
- Recommendation: pass `allowTerminalHeal: true` for this ordered status write, or accept the terminal phase when the tab is still `'streaming'` or `'resuming'`. Do not advance `lastTurnStateRevision` in either case.

## Blocking issues

None. The previous Blocking issue does not remain.

Hidden terminal delivery, traced for Electron:

1. `ChatStreamDeliveryCoordinator.route` retains the event, then `buffer.push` of `CHAT_CHUNK` with `{ tabId, sessionId, event, statusOnly: true }` for `turn_state` where `!retirementOnly` and phase is `idle` or `failed` (`chat-stream-delivery-coordinator.service.ts:183-191`).
2. `StreamBatchBuffer` forwards that payload as a bare chunk or as a `BATCH` member (`stream-batch-buffer.ts:184-192`). No schema drops `statusOnly`.
3. `ElectronWebviewManagerAdapter.broadcastMessage` calls `IpcBridge.sendToRenderer` with the same object (`webview-manager-adapter.ts:103-109`). `extractStreamEvent` copies `payload` through (`ipc-bridge.ts:314-321`, `347-360`).
4. The renderer router dispatches `chat:chunk` or each batch member to `ChatMessageHandler` (`message-router.service.ts:276-304`).
5. `handleChatChunk` returns after `applyHiddenTurnStateStatus` and does not enqueue (`chat-message-handler.service.ts:548-552`). There is no Zod parse on this cast.
6. `canApplyTurnState` rejects a foreign session id and a revision that is not newer, with heal disabled. A first terminal, and any later terminal with a higher revision, passes (`tab-manager.service.ts:2058-2085`). `updateTabInternal` writes `status: 'loaded'` on the active-workspace signal (`:1705-1743`).
7. `railStateValue` returns `'done'` when that status is not `'streaming'` or `'resuming'` and no lane count is running (`compact-session-card.component.ts:541-550`).

## Serious issues

None. The previous Serious issue does not remain, and the lane fix does not bring the old bug back.

`railStateValue` returns `'running'` when `counts.running > 0` before it considers `'done'` (`compact-session-card.component.ts:541-546`). A loaded parent with a live lane stays Running. The card spec sets a running lane, then sets `status: 'loaded'`, and expects `'running'` (`compact-session-card.component.spec.ts` new test). That spec assigns status by hand; the delivery proof is the coordinator and handler, not this spec.

Lane rows do not stay `'running'` after the lane itself has finished. CLI exit is `AGENT_MONITOR_EXITED` via `broadcastMessage` (`libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:210`). Subagent stop is `session:subagentEnded` via `SessionLifecycleNotifier` (`session-lifecycle-notifier.ts:185-186`), and `handleSubagentEnded` calls `agentMonitor.onSubagentEnded` (`turn-end-handler.service.ts:177-180`). Neither message goes through `route`'s hidden tail. A parent that is `'loaded'` and whose lanes have taken those paths falls through to `'done'`.

## Moderate and minor issues

- Moderate. Status-only omits the spinner set and terminal metadata. See the first failure mode. `tab-manager.service.ts:1962-1964`.
- Moderate. Ordered terminal heal is disabled on the status-only call. See the second failure mode. `tab-manager.service.ts:1963`.
- Minor. No test applies a hidden terminal through `TurnStateApplier` and then reads `railStateValue`. The handler spec asserts the mock (`chat-message-handler.service.spec.ts` new test). The coordinator spec asserts `statusOnly` and that reveal's snapshot is `[text_delta, terminal]` (`chat-stream-delivery-coordinator.service.spec.ts` new test).

Checked and not filed:

- Reveal does not skip the retained terminal. Revision is unchanged, so `acceptsTurnState` still returns true for a higher revision (`tab-manager.service.ts:2068-2079`). Finalization is not gated on status (`message-finalization.service.ts:185-188`).
- The same terminal is not finalized twice by `statusOnly`. That branch never calls `TurnStateApplier`.
- Resync still carries the terminal inside `liveSeed` (`live-message-projection.ts:54-56`, `125-129`; `session-history-replayer.service.ts:1027`). Early `'loaded'` does not make `canApplyTurnState` reject it.
- `retirementOnly` and non-terminal phases are not status-forwarded (`chat-stream-delivery-coordinator.service.ts:186-187`).
- The empty-message `'done'` shortcut requires `streamingState === null` and is evaluated only after the lane check (`compact-session-card.component.ts:541-550`). It does not classify a running lane as Finished.

## Data flow

1. User sends on tab A. `markStreaming` sets `status: 'streaming'` and `hasLiveSession: true` (`tab-manager.service.ts:1787-1795`). Rail emits `'running'`. OK.
2. User focuses tab B. A is not in `visibleTabIds`. `route` takes the hidden branch. OK for content suppression.
3. A's terminal `idle`/`failed` is retained, then pushed as `statusOnly` (`chat-stream-delivery-coordinator.service.ts:183-191`). OK.
4. Electron IPC and the batch unwrap keep the payload (`ipc-bridge.ts:314-321`, `message-router.service.ts:284-304`). OK.
5. `handleChatChunk` applies status and returns (`chat-message-handler.service.ts:548-552`). The hidden scheduler queue is not used. OK.
6. `applyHiddenTurnStateStatus` writes `loaded` without the revision (`tab-manager.service.ts:1962-1964`). Rail can emit `'done'`. Gap: spinner set and terminal metadata unchanged.
7. User focuses A. `reveal` flushes the tail, or `liveSeed` when `resyncRequired` (`:324-339`). The original terminal is in that list, after retained deltas, or alone in the seed after an idle projection clear. OK.
8. `TurnStateApplier` finalizes, then `applyTurnState` records the revision and clears the spinner (`turn-state-applier.service.ts:144-157`). One finalization. OK.
9. A running lane still forces `'running'` until its own exit or `session:subagentEnded` (`compact-session-card.component.ts:541-546`). OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| A hidden tab reaches `status: 'loaded'` when its turn ends, on the Electron path | COMPLETE | Coordinator → IPC → `ChatMessageHandler` → `applyHiddenTurnStateStatus`. No viewport filter, Zod strip, or scheduler drop on `statusOnly`. Heal-disabled stale revisions still wait for reveal. |
| Reveal finalizes the message once from retained deltas plus the original terminal | COMPLETE | Revision watermark is not moved by the status write, so the later `turn_state` is accepted and finalized. Resync seed includes the projection's `turnState`. |
| A running lane stays Running; a finished lane does not pin the tile in Running | COMPLETE | Lane count is checked before `'done'`. Lane completion is `AGENT_MONITOR_EXITED` / `session:subagentEnded`, outside the hidden tail. |
| No new Blocking or Serious defect in this delta | COMPLETE | Two moderate leftovers: partial status write, and heal disabled until focus. |

Implicit requirements not addressed: spinner and terminal-reason readers do not move with the rail. A host-started hidden `generating` after this status write is not forwarded.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Hidden `idle`/`failed`, monotonic revision | YES | `statusOnly` → `loaded` → rail `'done'` if no running lane | Spinner set lags |
| Hidden terminal, revision `<=` last | NO until focus | Heal disabled on the status write; reveal heals | Stays Running until open |
| Reveal after status-only | YES | Same event, revision not yet stored, applier finalizes once | |
| Tail overflow resync | YES | Seed keeps `turnState`; replayer does not drop it | Open-message text still depends on history, as before |
| Loaded parent, running lane | YES | `'running'` before the done return | |
| Lane completed via hook or CLI exit | YES | Those broadcasts ignore the viewport | |
| Loaded, empty messages, `streamingState === null`, live session | YES | New shortcut returns `'done'` | |
| Loaded, empty messages, `streamingState !== null` | YES | Falls through to `'idle'` unless messages exist | Waiting, not Finished, until the tree is cleared |
| `retirementOnly` or `generating` while hidden | YES | Not status-forwarded | A later hidden `generating` does not return the tile to Running |
| `statusOnly` transport send throws | YES | Logged; tail still holds the event for reveal | Tile waits for focus |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: surfaces that read `_streamingTabIds` or `lastTerminalReason` still see an in-flight turn after the rail has moved that session to Finished, until the user opens it.
- What a robust implementation would add: clear the spinner set and copy terminal reason and task snapshots in `applyHiddenTurnStateStatus`, without writing `lastTurnStateRevision`; allow the ordered terminal heal on that call; one test that runs the real applier on a hidden terminal and expects `railStateValue()` `'done'` with `streamingState` still set, then applies the retained snapshot and expects a single finalize.
