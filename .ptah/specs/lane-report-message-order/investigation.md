# Lane report / lane completion: broken chat order. Root-cause investigation

Read-only investigation of `main` at `D:/projects/ptah-extension`. No code changed, nothing run.

## Summary

- Both `<agent-report>` and `<agent-lane-completed>` go into the parent through
  `IAgentAdapter.sendMessageToSession(..., { origin: { kind: 'peer' } })`. The backend queues the
  message on the parent's **existing** SDK input stream. If a turn is running, the message is held
  and sent at the next `result`. Each pushed message then starts a **new SDK turn** with the
  parent as the author.
- In the live webview, the frontend **never adds that injected user turn to `tab.messages`**. The
  execution-tree builder skips user roots, and finalization skips every user root that is not an
  optimistic bubble the frontend sent itself. So each reply to a lane report shows up as a bare
  assistant bubble under the user's last prompt. Turn grouping, change-set and test anchors, and
  the "final answer" of the turn are all computed over the wrong turn. This is proven by code.
- The JSONL transcript does contain those turns. Any history reload (resync of a hidden tab, tab
  re-open, restart) suddenly adds them as **plain user bubbles**, with no peer label, between the
  replies. So the same conversation looks different live and after a reload. This is proven by
  code. A hidden-tab resync after a long lane-reply turn is the most likely trigger and needs a
  live trial.
- Two smaller defects make it worse. The peer echo stamps its uuid on the wrong optimistic bubble.
  A queued user message is released at the peer echo's `message_complete`, which puts the user's
  prompt above the reply to the lane report.

## Backend injection path

1. **Envelope build**
   - `<agent-report agent-id agent cli>`:
     `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:387-401`.
     Delivered at `:339-347`.
   - `<agent-lane-completed agent-id agent cli status verdict>`:
     `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-envelope.ts:42-77`.
     Delivered at `lane-completion-notifier.service.ts:206-217`, once per `agentId:completedAt`
     (`:162-167`).
   - Both pass `origin: { kind: 'peer', from: 'ptah-agent:<id>', name: '<cli> · <label>' }` and no
     `admission`. That means the default rule applies: a message that arrives mid-turn is held.
   - Both check `isSessionActive(parent)` first and return a refusal if it is false. Nothing is
     queued for later.
2. **Adapter**
   - `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1620-1638` calls
     `notifyActivity(sessionId,'user')` and then `sessionLifecycle.sendMessage(...)`.
   - `session-lifecycle-manager.ts:713-732` forwards to `SessionStreamPump.sendMessage`.
3. **Queueing**
   - `helpers/session-lifecycle/session-stream-pump.service.ts:174-236` builds an `SDKUserMessage`
     with `SdkMessageFactory.createUserMessage`: a new `uuid` (MessageId), `parent_tool_use_id:
     null` and `origin` (`sdk-message-factory.ts:136-149`).
   - It pushes the message onto `session.messageQueue`. The log line is
     `Message held for … turn in flight` when a turn is active (`:231-235`).
   - The iterator yields one message per turn and claims `turnInFlight` before each yield
     (`:82-93`). `markTurnEnded` on the turn's `result` clears it.
   - So the order is always: previous turn `result` → `turn_state` terminal → peer message
     consumed → new turn. Several pushes (2 lanes × report + completion = up to 4) become 4
     consecutive turns, in arrival order, mixed with any message the user typed.
   - The input stream is the same long-lived `query()`, also on resume (`streamInput`,
     `session-query-executor.service.ts:1191-1229`). No new query is created and no tab id changes.
4. **Echo to the webview**
   - The webview only learns that the turn exists if the CLI echoes it.
     `--replay-user-messages` is added **only when file checkpointing is enabled**
     (`helpers/sdk-query-options-builder.ts:1471-1473`).
   - With the echo, `sdk-message-transformer.ts:161-180` sends a peer replay to
     `UserMessageTransformer` with `inboundPeer: { label }`. Without the echo, the webview gets
     nothing for the peer turn.
   - `message-transform/user-message.transformer.ts:129-166` emits `message_start` (role `user`,
     `messageId = uuid`, `inboundPeer`, `timestamp: Date.now()`, `source: 'complete'`), then
     `text_delta` and `message_complete`. The `message_complete` has no `stopReason`.
   - After that come the normal assistant events. `turn_state: generating` is sent on the first
     root assistant `message_start` (`stream-event.transformer.ts:192`), and a terminal
     `turn_state` follows on `result`.
   - All of these go to the parent's tab through the normal chunk stream and
     `ChatStreamDeliveryCoordinator`.
5. **History**
   - The CLI writes the injected turn to JSONL as an ordinary `user` record.
   - `helpers/history/session-replay.service.ts:135-223` replays it as a user `message_start`
     through `HistoryEventFactory.createMessageStart` (`history-event-factory.ts:65-83`). That
     method has **no `inboundPeer` parameter**, so the peer label is lost on reload.
   - `isSkillOrMetaContent` does not filter `<agent-report>` or `<agent-lane-completed>`, so the
     turns do appear.

## Frontend ordering path

- **Event intake**
  - `chat-streaming/.../streaming-handler.service.ts:409-538` (`processEventForTab`). If the tab
    has no `streamingState`, it creates one (`:442-453`), so an idle tab gets a new state on the
    peer `message_start`.
  - For every live user `message_start` it calls
    `tabManager.reconcileUserMessageNativeUuid(tabId, messageId)` (`:463-472`).
- **Accumulation**
  - `accumulator-core.service.ts:253-299`: `message_start` pushes the messageId onto
    `state.messageEventIds` in insertion order and sets `state.currentMessageId`. The peer
    `inboundPeer` field is stored on the event.
- **Live tree**
  - `execution-tree-builder.service.ts:405-414`: a root whose role is `user` is "never a node.
    The prompt renders from `messages`". It only breaks the assistant merge.
- **Live view merge**
  - `chat/.../services/stream-presentation-store.service.ts:158-235` and `:293-321` (and the
    copy at `chat-transcript.component.ts:110-142`) merge `tab.messages` with the streaming trees.
  - The merge is linear on `orderKey = streamingState.startTime ?? timestamp`. It is a merge, not
    a sort. Streaming trees are always assistant messages.
- **Finalize**
  - On a terminal `turn_state` (`turn-state-applier.service.ts:115-134`),
    `message-finalization.service.ts:173-…` builds trees and creates **assistant** messages only.
  - `placeFinalizedTrees` (`:57-118`) uses user roots only as anchors when
    `promptById.get(messageId)` matches an **existing** user message id (the frontend's optimistic
    bubble or boundary).
  - Any other user root is skipped (`:70-77`). The doc comment `:36-43` says so: "Any other user
    root, such as the SDK's echo of a prompt, is skipped."
  - With no anchor, new assistant messages are appended (`:82-83`).
- **History**
  - `HistoryMessageBuilder` (`history-message-builder.service.ts:196-246`) is the only place that
    creates a user `ExecutionChatMessage` from a stream event. It keeps `inboundPeer`. It is only
    used by `finalizeSessionHistory` (history replay or resync).
  - The only spec for the peer label is `message-finalization.service.spec.ts:991-1044`, and it
    only covers `finalizeSessionHistory`.
- **Turn grouping**
  - `chat/.../transcript/transcript-turns.ts:85-126`: a turn is a user message plus every
    assistant message up to the next user message, and it ends at the last assistant message.
    Change-set cards, test rows, turn summaries and declutter folding all build on this.
- **Reload and resync**
  - A hidden tab keeps only a tail of 256 events / 512 KB
    (`rpc-handlers/.../chat-stream-delivery-coordinator.service.ts:29-30`). Past that it sets
    `resyncRequired` (`:286-297`).
  - On reveal, the webview calls `ChatStore.resyncStream`, which runs
    `sessionLoader.switchSession(..., { reason: 'resync', liveSeed })` (`chat.store.ts:231-248`,
    `chat-message-handler.service.ts:588-622`). That rebuilds `tab.messages` from JSONL and
    re-seeds the live part (`session-history-replayer.service.ts:420-560`).

## Root-cause hypotheses (ranked)

### H1. Injected peer turns are never added to the live transcript (proven by code, primary)

A peer `message_start` is a user root that is neither a tree node
(`execution-tree-builder.service.ts:411-414`) nor an existing optimistic message, so
`placeFinalizedTrees` drops it (`message-finalization.service.ts:70-77`). Finalize only creates
`role: 'assistant'` messages. The live path has no other writer of user messages
(`grep "role: 'user'"`: only the send path, the history builder and lane transcripts). The
`inboundPeer` rendering in `message-bubble.component.html:198-223` is reachable **only** after a
history reload.

Event sequence (parent idle after spawning 2 lanes):

1. `messages = [U1 "do X, spawn Glm + codex", A1 "spawned, waiting…"]`, then a terminal
   `turn_state` and finalize.
2. Glm calls `ptah_agent_report`. Backend: queue → yield → CLI replay → `message_start(user,
   uuid=R1, inboundPeer)` → new `streamingState` with `messageEventIds=[R1]`.
3. `A_R1` streams. The live view shows `[U1, A1, A_R1]`. No R1 bubble.
4. Terminal `turn_state` → finalize. R1 is skipped and `A_R1` is appended:
   `[U1, A1, A_R1]`.
5. The Glm `<agent-lane-completed>`, then codex report and codex completion repeat this:
   `[U1, A1, A_R1, A_C1, A_R2, A_C2]`.
6. `groupTurns` treats all of it as **one turn of U1**. The turn's "end message", change-set card,
   test row and summary move to `A_C2`. Folding hides A1 to A_C1 as intermediate steps of U1. To
   the user the conversation looks rearranged and replies seem to come from nowhere.

### H2. A reload or resync adds the peer turns back as plain user bubbles (proven by code, trigger needs a live trial)

The JSONL has `[U1, A1, R1, A_R1, C1, A_C1, …]`. `session-replay.service.ts:194-203` sends R1 and
C1 as user `message_start` **without `inboundPeer`** (`history-event-factory.ts:65-83`). After any
reload, every lane envelope appears as a user-authored bubble (raw `<agent-report …>` XML styled as
the human) between the replies. Turn grouping changes completely. Live and reloaded views
disagree, which reads as "the history broke".

The most likely in-session trigger: the user watches lane tiles or another canvas tile, so the
parent tab is hidden. A lane-reply turn with a few tool calls goes over 256 events / 512 KB, which
sets `resyncRequired` (`chat-stream-delivery-coordinator.service.ts:286-297`). Revealing the tab
then runs `switchSession(reason:'resync', liveSeed)`, a full rebuild from JSONL merged with a live
seed and `resyncOwnerPredecessors` (`session-history-replayer.service.ts:420-560`). If a turn is
still streaming when that happens, part of the conversation comes from JSONL (with the peer
bubbles) and part from the live seed (without them). The splice uses
`resyncOwnerPredecessors` / `placeFinalizedTrees` `:95-117`, which is exactly the code most likely
to mis-place messages. The exact reorder needs a trial.

### H3. A queued user prompt is released at the peer echo's `message_complete` (proven by code, conditional)

`streaming-handler.service.ts:508-519` returns `queuedContent` on **any** root `message_complete`
whose `stopReason !== 'tool_use'`. The user-echo `message_complete` from
`user-message.transformer.ts:157-165` has no `stopReason` at all.

Sequence:

1. The user types P while the parent is streaming, so P goes to `queuedContent`.
2. The parent turn ends and the queued R1 is consumed.
3. The R1 echo's `message_complete` releases P at the **start** of the R1 turn.
4. The optimistic P bubble and its boundary land before `A_R1`. The backend holds P until R1's
   turn ends.
5. Finalize anchors on P and places `A_R1` after P.

Visible result: `[…, P, A_R1, A_P]`. The reply to the lane report sits under the user's prompt as
if it answered P. It also explains replies that "jump" relative to what the user typed while the
lanes were reporting.

### H4. The peer echo stamps its uuid on the wrong optimistic bubble (proven by code, low visual impact)

`streaming-handler.service.ts:463-472` calls `reconcileUserMessageNativeUuid` for every live user
`message_start`, peers included. That method stamps the **oldest** user message without
`nativeUuid` whose id is not a uuid (`tab-manager.service.ts:2315-2332`). If any optimistic bubble
is still unstamped (P queued behind R1 as in H3, a failed send, or checkpointing toggled), R1's
uuid lands on it.

Effects:

- "Branch from here" and rewind on that bubble anchor on the lane report's transcript line
  (`chat-view.component.ts:1429-1432`).
- P's real echo can no longer stamp P.

Ordering is not affected directly, because `placeFinalizedTrees` never anchors through
`nativeUuid`.

### H5. With file checkpointing off, the webview gets no event at all for the peer turn (proven by code, config-dependent)

Without `--replay-user-messages` (`sdk-query-options-builder.ts:1471-1473`) no echo is emitted.
The frontend sees assistant events with no preceding user root. Same visible symptom as H1, plus
H2 on reload.

### Ruled out or unlikely

- **Mid-stream interleaving of the injected text into a running assistant message.** Ruled out:
  the pump gate allows one message per turn (`session-stream-pump.service.ts:14-19, 82-93`).
- **A new `query()` or tab id per injection.** Ruled out: same input stream.
- **Message-id collisions.** Unlikely: user uuids come from `MessageId.create()`, and assistant ids
  come from the API.

## Reproduction plan

1. In Electron, open DevTools for the webview and keep the main-process log visible. File
   checkpointing should be on (the default), and H5 needs a second run with it off.
2. Ask the parent: "Spawn two lanes with ptah_agent_spawn (glm via ptah-cli, codex). Each lane:
   write a one-line file under `.ptah/tmp/`, call `ptah_agent_report` once, then exit. Then wait."
3. **Run A (H1, H4):** keep the parent tab visible and wait for 2 reports and 2 completions.
   - Record the transcript live, then reload the session (close and re-open the tab), and compare.
   - Expected: live view has no envelope bubbles. After reload there are 4 user-looking bubbles
     with raw XML and no peer label.
4. **Run B (H2):** same task, but switch to a lane tile or another tab while the lanes report. Ask
   the parent to answer each report with a few tool calls (e.g., read 3 files) so each turn goes
   over 256 events.
   - Switch back and look for `snapshotOverflowResyncs` / `requestedResyncs` in the coordinator
     metrics and for a `switchSession` with `reason:'resync'` (`[SessionHistoryReplayer]` logs).
   - Screenshot before and after the reveal.
5. **Run C (H3):** while the parent is streaming its reply to the first report, type a message.
   Check where the bubble lands relative to the reply, and confirm with a breakpoint at
   `streaming-handler.service.ts:515` that `queuedContent` is released on the **user**
   `message_complete`.
6. **What to capture**
   - Main log: `[SessionLifecycle] Message held for … turn in flight`,
     `[AgentReportRouter] …delivered`, `[LaneCompletionNotifier] Completion signal delivered`,
     `[SdkMessageTransformer] Rendering inbound peer message` (debug).
   - Webview: chat-stream events (`message_start` role/messageId/inboundPeer, `turn_state`
     phase/revision, `chat:stream-snapshot` with `resyncRequired`).
   - The `tab.messages` ids and roles plus `streamingState.messageEventIds` before and after each
     terminal `turn_state`, and before and after a reload.

## Suggested fix direction (no code)

- Treat an injected peer user root as a real transcript message in the live path. When a live
  user `message_start` with `inboundPeer` (or any user root that matches no optimistic bubble and
  is not the echo of the frontend's own prompt) arrives, insert a user message with its uuid as
  id, its `inboundPeer` and its event timestamp. Insert it at that root's position (finalize, or
  an immediate `messages` write at `message_start`) so `groupTurns` starts a new turn there.
  Distinguish "echo of my own prompt" from "foreign turn" by `inboundPeer` (and, for H5, by the
  missing echo).
- Do not call `reconcileUserMessageNativeUuid` for `inboundPeer` starts. Consider stamping the
  newest unstamped bubble rather than the oldest.
- Release `queuedContent` only on an **assistant** root `message_complete` (or on the terminal
  `turn_state`), not on a user echo.
- Keep the peer origin in history: read `origin` from the JSONL record if the CLI writes it.
  Otherwise use a sidecar or envelope rule (`<agent-report|agent-lane-completed …>` from a known
  agent id) so a reload renders the same peer bubble as the live view.
- Consider making `replay-user-messages` independent of file checkpointing, or emit a backend-side
  synthetic peer `message_start` when the pump yields a non-human-origin message. Then the webview
  always learns about the turn.
- Add a regression spec: peer `message_start` → assistant turn → terminal `turn_state` →
  `tab.messages` contains the peer bubble in order, and `groupTurns` yields one turn per injection.
  Also a reload-parity spec that compares live finalize with history replay.

## Open questions

- Does the Claude CLI persist `origin` on the JSONL user record for streamed-in messages? If so,
  the history reader can restore `inboundPeer` directly.
- Was file checkpointing on in the user's session? It decides whether H1 or H5 applies; both look
  the same live.
- Was the parent tab hidden (canvas, lane tile focused) when the reports arrived? That decides
  whether H2's resync rebuild ran mid-session.
- Did the user type anything while the lanes were reporting? That decides H3 and H4.
- Does the declutter branch's turn folding (built on `groupTurns`) hide the reply bubbles as
  "intermediate" steps of the original turn? If so, it makes H1 much more visible on that branch.
