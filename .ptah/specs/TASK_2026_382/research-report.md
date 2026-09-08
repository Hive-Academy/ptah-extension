# Research Report - TASK_2026_382

## Question

- Decision this supports: which code path to fix so that a message sent while
  the agent is mid-stream is appended to the transcript at the moment it was
  sent, below the agent's live bubble.
- Question: is the reported bubble produced by the send-branch bypass (H1) or by
  the permission `deny_with_message` path (H2), and which single site appends it?
- Bounds: frontend only. The backend `chat:continue` / SDK queueing semantics
  were read only far enough to date the `turn_state` phases
  (`session-turn-state.registry.ts:228-288`). No runtime reproduction was run —
  every claim below is static, and the four items marked **unverified** name the
  runtime observation that would close them.

## Answer

**H1 is correct. H2 is real but cannot produce a bubble.** The bubble is
appended at exactly one site on the offending path:
`libs/frontend/chat/src/lib/services/message-sender.service.ts:606-609`
(`runContinueConversation`, `setMessages(activeTabId, [...messages, userMessage])`).
The root cause is that the busy predicate at `message-dispatch.service.ts:74-77`
is derived from the **root-turn phase** (`tab.status` + `_streamingTabIds`),
while the visible streaming bubble is derived from **`tab.streamingState`**
(`chat-transcript.component.ts:225-227, 254-280`). Nothing keeps those two in
sync, and every writer that clears the turn flags without clearing
`streamingState` opens a window in which `isStreaming` is `false` while a
streaming tree is still on screen. The same writers also drop the tab's
`AbortController` _without_ aborting it, which is why the user's stream survived
a `send()` that the code comment correctly claims would kill it.

## Evidence

| Claim                                                                                                             | Source                                                                          | Date       | Verified how                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Only three sites append a user bubble to `tab.messages` in the whole frontend                                     | grep `setMessages(\|appendUserMessageAndResetStreaming` over `libs/frontend`    | 2026-09-06 | read the source: `message-sender.service.ts:387`, `message-sender.service.ts:606`, `message-dispatch.service.ts:190`                                         |
| The offending site is the continue path                                                                           | `libs/frontend/chat/src/lib/services/message-sender.service.ts:606-609`         | 2026-09-06 | read the source                                                                                                                                              |
| `message-sender.service.ts:387` is the NEW-conversation path only (`startNewConversation`)                        | `message-sender.service.ts:324-390`                                             | 2026-09-06 | read the source                                                                                                                                              |
| `message-dispatch.service.ts:190` is the blocked-slash-command warning, not a normal send                         | `message-dispatch.service.ts:165-195`                                           | 2026-09-06 | read the source                                                                                                                                              |
| H2's `handlePermissionResponse` mutates NO tab state — only the prompt queue, the decision pulse, and postMessage | `libs/frontend/chat-streaming/src/lib/permission-handler.service.ts:389-419`    | 2026-09-06 | read the whole method; `tabManager` is used only for `activeTabId()` at `:407`                                                                               |
| The queue branch only sets `queuedContent` / `queuedOptions`                                                      | `conversation.service.ts:104-136`                                               | 2026-09-06 | read the source                                                                                                                                              |
| Queued content renders as a chip between the transcript and the input, never as a transcript bubble               | `chat-view.component.html:162-218`, `chat-view.component.ts:774-779`            | 2026-09-06 | read the template                                                                                                                                            |
| `send()` mid-stream DOES abort the in-flight stream — when a controller is tracked                                | `message-sender.service.ts:211-233` → `tab-manager.service.ts:2377-2385`        | 2026-09-06 | read the source: `createAbortController` calls `existing.abort()` on a non-aborted controller, and the `wireAbortDispatch` listener fires a `chat:abort` RPC |
| …and does NOT abort when the controller was already dropped                                                       | `tab-manager.service.ts:2400-2402` (`clearAbortController` deletes, no abort)   | 2026-09-06 | read the source                                                                                                                                              |
| `markTabIdle` drops the controller without aborting                                                               | `tab-manager.service.ts:2321-2328`                                              | 2026-09-06 | read the source                                                                                                                                              |
| `applyTurnState` drops the controller on EVERY non-`generating` phase                                             | `tab-manager.service.ts:1182-1199`                                              | 2026-09-06 | read the source                                                                                                                                              |
| Every phase except `generating` is terminal                                                                       | `libs/shared/src/lib/types/execution/stream-background.ts:233-253`              | 2026-09-06 | read the source                                                                                                                                              |
| `awaiting-background` / `sleeping` are emitted only at the SDK `result` boundary, never mid-`generating`          | `libs/backend/agent-sdk/src/lib/helpers/session-turn-state.registry.ts:228-288` | 2026-09-06 | read the source; `applySnapshot` returns `null` while `phase === 'generating'` (`:268-270`)                                                                  |
| `awaiting-background` deliberately leaves user input enabled                                                      | `libs/frontend/chat-types/src/lib/chat-types.ts:443-448`                        | 2026-09-06 | read the doc comment                                                                                                                                         |
| `applyStatusErrorReset` sets `status:'loaded'` + `currentMessageId:null` and LEAVES `streamingState`              | `tab-manager.service.ts:1613-1618`                                              | 2026-09-06 | read the source                                                                                                                                              |
| A null `currentMessageId` makes `finalizeCurrentMessage` a permanent no-op                                        | `message-finalization.service.ts:63-66`                                         | 2026-09-06 | read the source: early `return` before any `clearStreamingForLoaded`                                                                                         |
| `_streamingTabIds` is documented VISUAL-ONLY and "does not affect … message sending"                              | `tab-manager.service.ts:143-148`                                                | 2026-09-06 | read the source — contradicted by `message-dispatch.service.ts:77`                                                                                           |
| `ExecutionNode.startTime` IS populated for ROOT message nodes                                                     | `message-node.fn.ts:50` (`startTime: startEvent.timestamp`), `node.ts:187`      | 2026-09-06 | read the source; `buildMessageNode` is the root builder and the field is `readonly startTime?: number`                                                       |
| Finalized assistant messages also carry the tree, so they carry the same `startTime`                              | `message-finalization.service.ts:136-140` (`streamingState: tree`)              | 2026-09-06 | read the source                                                                                                                                              |
| `createExecutionChatMessage` mints a fresh `Date.now()` whenever no timestamp is passed                           | `libs/shared/src/lib/types/execution/factories.ts:26-35`                        | 2026-09-06 | read the source — confirms the prompt's warning                                                                                                              |
| `chat-transcript.component.ts` was changed by TASK_2026_381                                                       | commit `9a25208be` (`git show --stat`)                                          | 2026-09-06 | ran it: `chat-transcript.component.ts` +34, plus new `transcript-render-window.ts`, `transcript-slot.directive.ts`, `chat-transcript.component.spec.ts`      |
| The `allMessages` lifecycle ordering now lives at `:306-321`, not `:302`                                          | `chat-transcript.component.ts:306-321`                                          | 2026-09-06 | read the source — line numbers in the prompt predate `9a25208be`                                                                                             |

## Options

| Option                                                                                                                            | Fit here                                                                                                                                                                                                    | Cost to adopt                                                                                           | Known failure mode                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1 (root, part A)** — stop `applyStatusErrorReset` from stranding a tree: clear `streamingState` (or finalize before resetting) | `tab-manager.service.ts:1613-1618` already nulls `currentMessageId`; leaving `streamingState` behind is the only asymmetry in the file (compare `applyCompactionTimeoutReset:1692-1699`, which clears both) | ~1 line + a spec; `tab-manager.lifecycle.spec.ts` is the natural home                                   | If a chat error is ever non-fatal and the turn resumes, clearing the tree discards partial output that today survives. Finalize-then-reset avoids that but changes the F3 rule that error paths keep "presentation and bookkeeping only" |
| **R2 (root, part B)** — add `streamingState != null` to the busy predicate at `message-dispatch.service.ts:74-77`                 | Directly closes the disagreement between the two sources of truth; the tab object is already resolved at `:62-64`                                                                                           | ~3 lines + spec. Must resolve the tab via `findTabByIdAcrossWorkspaces`, not `tabs()`, to also close W4 | Without R1 this is a TRAP: in the W1 window `streamingState` is stuck forever, so the predicate would queue every future message and the user could never send again. R1 and R2 must land together                                       |
| **D1 (defence in depth)** — order `allMessages` by time in `chat-transcript.component.ts:306-321`                                 | Makes the transcript correct regardless of which dispatch window is open; the memo at `:300-321` already exists to hold the result                                                                          | ~15 lines + spec, in a file `9a25208be` just rewrote — rebase cost is real                              | A naive `msg.timestamp` sort is unstable (see `factories.ts:31`). Must key on `msg.streamingState?.startTime ?? msg.timestamp` and use a stable sort                                                                                     |
| **D2** — leave ordering alone, fix dispatch only                                                                                  | Smallest diff, no contact with TASK_2026_381's files                                                                                                                                                        | Zero extra                                                                                              | Any future writer that clears the turn flags without clearing `streamingState` reopens the identical visual defect                                                                                                                       |

Options NOT examined: changing the backend `turn_state` phase derivation, and
giving `tab.messages` a server-assigned sequence number. Both would work; neither
was investigated.

## Disagreements

- **Does `send()` abort the in-flight stream?** The comment at
  `message-dispatch.service.ts:71-73` says yes; the user observes the stream
  continuing. Both are right. `createAbortController`
  (`tab-manager.service.ts:2377-2385`) aborts an existing controller — but only
  if one is still tracked, and `clearAbortController`
  (`:2400-2402`) is called without aborting by `markTabIdle` (`:2321-2328`) and
  by `applyTurnState` on every non-`generating` phase (`:1195-1199`). What
  decides it here: the same events that clear the controller are the events that
  clear `status` / `_streamingTabIds`. The absence of an abort is therefore not
  evidence against H1 — it is a **second symptom of the same window**, and it is
  what rules out a live `generating` turn as the trigger.
- **Is `_streamingTabIds` allowed to gate sends?** `tab-manager.service.ts:143-148`
  says VISUAL-ONLY, "does not affect … message sending"; `message-dispatch.service.ts:77`
  reads it for exactly that, and `:67-73` explains why deliberately (TASK_2026_360-era
  self-heal). What decides it here: the usage is newer and load-bearing; **the
  doc comment is stale and should be corrected in the same change**, not the
  usage.
- **Which window actually fired for this user?** Two candidates fit all four
  observations (see Local consequences W1 and W2). Nothing static separates
  them — **unverified**, settled by one log line (see Unknowns).

## Local consequences

The offending path, keystroke to bubble:

1. `chat-input.component.ts:1212-1234` — `handleSend()` calls
   `chatStore.sendOrQueueMessage(content, { tabId: this._sessionContext?.() ?? undefined })`.
   In the single-panel webview there is no session context, so `tabId` is
   `undefined` and dispatch falls back to the active tab.
2. `chat.store.ts:214-218` → `message-dispatch.service.ts:53`.
3. `message-dispatch.service.ts:61-77` — `status` comes from `activeTabStatus()`
   (`tab-manager.service.ts:290-294`, i.e. the active tab's `status` field);
   `isStreaming` is `status === 'streaming' || 'resuming' || isTabStreaming(id)`.
   **In the defect window all three are false.**
4. `message-dispatch.service.ts:92` — `messageSender.send()`.
5. `message-sender.service.ts:306-311` — the tab has a `claudeSessionId`, so
   `continueConversation`.
6. `message-sender.service.ts:465-467` → `wireAbortDispatch` →
   `tab-manager.service.ts:2377-2385`. No controller is tracked, so **nothing is
   aborted** and the in-flight stream survives.
7. `message-sender.service.ts:596-597` — `setStatus('resuming')` + `markResuming`.
8. **`message-sender.service.ts:606-609` — the user bubble is appended to
   `tab.messages`.** This is the site asked for in deliverable 2.
9. `message-sender.service.ts:617` — `chat:continue` fires immediately, which is
   the "acts immediately, mid-turn" the user reported.
10. `chat-transcript.component.ts:306-321` — `allMessages` concatenates
    `finalized` then `streaming`, so the new bubble renders **above** the still-live
    tree from `tab.streamingState` (`:225-227`, `:254-280`).

The windows that make step 3 false while step 10 still has a live tree:

- **W1 — chat error.** `completion-handler.service.ts:64-67` calls
  `applyStatusErrorReset(tab.id)` then `markTabIdle(tab.id)`.
  `applyStatusErrorReset` (`tab-manager.service.ts:1613-1618`) sets
  `status:'loaded'` and `currentMessageId:null` but leaves `streamingState`
  populated; `markTabIdle` clears the spinner and the controller. Because
  `currentMessageId` is now null, `finalizeCurrentMessage`
  (`message-finalization.service.ts:63-66`) early-returns forever, so that tree
  can **never** be finalized — the streaming bubble is permanently pinned to the
  bottom of the transcript and every subsequent user message renders above it.
  This is the only candidate that is _persistent_ rather than momentary, which
  fits a user who can reproduce it. **Unverified**: whether a `chat:error`
  actually preceded the report.
- **W2 — terminal `turn_state` with background work.**
  `session-turn-state.registry.ts:235-241` emits `awaiting-background` when the
  SDK `result` reports in-flight background tasks. `tab-manager.service.ts:1173-1199`
  then sets `status:'awaiting-background'`, removes the tab from
  `_streamingTabIds` and clears the controller — and `chat-types.ts:443-448` says
  user input is _deliberately_ left enabled here. Finalization runs, but the
  subagents keep emitting; the next `message_start`
  (`accumulator-core.service.ts:269`) builds a fresh `streamingState`, so a new
  streaming bubble is on screen while the tab is still non-streaming. Same three
  symptoms. **Unverified**: whether the user's session had background tasks.
- **W3 — compaction.** `compaction-lifecycle.service.ts:136-151` and `:386-393`
  reach `markTabIdle` + `status:'loaded'`. `applyCompactionTimeoutReset`
  (`tab-manager.service.ts:1692-1699`) _does_ clear `streamingState`, so this
  window produces the immediate-send and no-abort symptoms but **not** the
  bubble-above-bubble one. Secondary.
- **W4 — the `tabId` fallback the prompt flagged.** `message-dispatch.service.ts:61-66`:
  when `options.tabId` is supplied but `tabs().find(...)` misses, `status` silently
  becomes another tab's. Reachable, because `tabs()` is the **active-workspace**
  signal while `findTabByIdAcrossWorkspaces` exists precisely for the rest — so a
  canvas tile or a background-workspace tab misses. `messageSender.send` then
  falls back again (`message-sender.service.ts:301-304`) and appends the bubble
  to the **active** tab, i.e. the wrong transcript. Independent bug, worth fixing
  in the same edit.

For D1, the sort key is settled: `ExecutionNode.startTime` is populated for ROOT
message nodes (`message-node.fn.ts:50`, from `startEvent.timestamp`) and
finalized assistant messages keep the tree (`message-finalization.service.ts:136-140`),
so finalized and streaming assistant messages compare on the same clock. User
bubbles have `streamingState: null` and fall back to their own `timestamp`
(`factories.ts:31`, minted once at creation and then carried in the array, so
stable). Key: `msg.streamingState?.startTime ?? msg.timestamp`, stable sort,
memo preserved.

## Unknowns

- **Which window fired.** Nothing static separates W1 from W2. Smallest
  experiment: log `{ status, isTabStreaming, hasStreamingState: !!tab?.streamingState,
hasAbortController: !!tabManager.getAbortSignal(id) }` at
  `message-dispatch.service.ts:74` and reproduce once. W1 shows
  `status:'loaded'` + a live `streamingState`; W2 shows
  `status:'awaiting-background'`.
- **Whether a `chat:error` preceded the report.** Search the devtools console for
  `[CompletionHandlerService] Chat error`. Its presence makes W1 the answer and
  makes R1 mandatory rather than defensive.
- **Which clock stamps `FlatStreamEvent.timestamp`.** `startTime` is copied from
  it (`message-node.fn.ts:50`) and would be compared against a webview-minted
  `Date.now()` on user bubbles. Both are same-machine in the VS Code webview and
  in Electron, so skew should be zero, but I did not trace the producer. If the
  gateway or CLI ever stamps events on another host, D1's sort key needs an
  explicit normalization. Settled by reading the one backend site that constructs
  `message_start`.
- **Blast radius / ownership.** The fix touches
  `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts`,
  `libs/frontend/chat-state/src/lib/tab-manager.service.ts` (`applyStatusErrorReset`
  plus the stale `VISUAL-ONLY` comment at `:143-148`), and — for D1 only —
  `libs/frontend/chat/src/lib/components/organisms/transcript/chat-transcript.component.ts`,
  with specs in `message-dispatch.service.spec.ts`, `tab-manager.lifecycle.spec.ts`
  and `chat-transcript.component.spec.ts`.
  **TASK_2026_380 owns none of them** — its inventory lists `libs/frontend/chat-ui/src/index.ts`,
  `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` and
  `electron-shell.component.ts` as its only `libs/frontend/chat*` files. (Note:
  that plan is not at the path given in the brief; it is at
  `D:\projects\ptah-extension\.claude-worktrees\electron-cold-start-380\.ptah\specs\TASK_2026_380\implementation-plan.md`,
  lines 1600-1712.)
  **TASK_2026_381 (`9a25208be`) just rewrote the transcript component** (+34 lines)
  and added `transcript-render-window.ts`, `transcript-slot.directive.ts` and a
  new `chat-transcript.component.spec.ts` — D1 lands on top of that and should be
  sequenced after it, not concurrently.
