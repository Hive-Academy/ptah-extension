# Defect trace — session budget "Continue in new session"

Evidence check for the session-budget handoff flow. Line numbers are from this worktree. Claims below were read in source; nothing here was executed.

`canSend` is the only budget gate. It is called from `ChatSessionService.refuseIfBudgetReached`, and that method is called from `continueSession` only, after the Ptah CLI short-circuit. Every other turn injector calls `sendMessageToSession` and never asks the budget.

## a. Banner appears while the agent is still working

**Root cause:** The banner is bound to `tab.sessionBudget`, and that field is written from the `session:stats` broadcast. That broadcast is started from `onResultStats` inside the SDK `result` handler, before the result's `turn_state` event is yielded, and the callback is not awaited. The frontend installs the budget before it checks whether the tab is still streaming. The banner component shows `tighten`, `handoff`, `limit`, or `rotation` with no turn-phase check. `onTurnEnd` also runs before the stats work and wakes the pump, so a message already held on the SDK queue can start the next turn before the banner is published.

**Evidence:**

1. `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:217-225` — `onTurnEnd` fires on the SDK `result` message, before stats work. `onResultStats` is a separate callback and is skipped when stats validation fails.
2. `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:655-658` — on a result message, `onTurnEnd()` runs first and nothing below may gate it.
3. `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:944-948` — `onResultStats` is invoked later in that same result branch, still before the result is yielded as a stream event (`957-980`).
4. `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1679-1692` — the result-stats wrapper calls `observeBudget` and passes `budget` into the inner callback.
5. `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1739-1742` — `onTurnEnd` is `markTurnEnded`, which wakes a message held during the turn.
6. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:543-556` — `markTurnEnded` clears `turnInFlight` and calls `resolveNext`, so the pump can yield the next queued message.
7. `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:137-146` and `409-420` — the wired callback broadcasts `SESSION_STATS` with `budget` when present. The stream transformer does not `await` that callback.
8. `libs/backend/agent-sdk/src/lib/message-transform/result-message.transformer.ts:12-31` — the `result` message is the turn boundary on the stream and emits exactly one `turn_state`, ordered after the chunks of the turn it closes. That event is yielded after `onResultStats` is invoked.
9. `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:157-160` — for a real turn result, every matching tab gets `installSessionStats(..., stats.budget)` before `streamingHandler.handleSessionStats` (`184`).
10. `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:524-533` and `607-625` — stats are not a turn boundary. While `streamingState` is set (the usual case: `turn_state` lands after this push), the handler stashes footer numbers and returns `null`. It does not clear the busy state.
11. `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:209-211` — `turn_state` is what finalizes the turn, via `TurnStateApplier`.
12. `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:138-152` — the banner is rendered whenever `resolvedSessionBudget()` is set. No streaming or turn-phase input is passed.
13. `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts:263-280` — the visible stage is `rotation`, `tighten`, `handoff`, or `limit`. `limit` is shown even when `dismissedStage` matches. There is no "turn still running" branch.

**Fix direction:**

- Publish the stage the banner reads only after the terminal `turn_state` for that result has been applied, or have the banner ignore a stage while the tab's turn phase is `generating`.
- Do not let `markTurnEnded` yield another prompt until the budget decision for the result that just ended has been applied.
- Keep the stats footer path (`pendingStats`) as it is: it already treats stats as not a turn boundary.

## b. A queued user message is not sent before "Continue in new session"

**Root cause:** The composer queue (`tab.queuedContent`) is not flushed when the budget banner appears. The stats handler installs the budget first, then asks the streaming handler to flush, and that handler returns `null` while `streamingState` is still set. `turn_state`, which actually ends the turn, returns `null` from `processStreamEvent` and never reads `queuedContent`. If a flush does run, `chat:continue` refuses it once `canSend` is false, restores the text onto the old tab, and does not put it in the handoff. "Continue in new session" sends only the backend seed to a new tab.

**Evidence:**

1. `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:157-192` — budget is installed, then `handleSessionStats`. `sendQueuedMessage` runs only when that call returns trimmed `queuedContent`.
2. `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:607-625` — while streaming, the stats handler returns `null`, so the aggregator does not flush.
3. `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:628-634` — the flush return exists only when `streamingState` is already null.
4. `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:209-211` — a `turn_state` event applies the turn and returns `null`. `chat.store.ts:407-410` therefore never sees queued content from the real turn end.
5. `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:428-439` — the other flush is `message_complete` with no `parentToolUseId` and `stopReason !== 'tool_use'`. That event is an assistant-message boundary, earlier than the result that publishes the budget. It is not "send the queue, then show the prompt."
6. `libs/frontend/chat/src/lib/services/chat-store/message-dispatch.service.ts:247-258` — a flush clears the queue, calls `continueExistingSessionForQueueFlush`, and on `SESSION_BUDGET_REACHED` restores the text and does not show the generic failure. The message stays on the old tab.
7. `libs/frontend/chat/src/lib/services/message-sender.service.ts:732-759` — a budget refusal installs the refusal's budget (another banner update) and rolls the optimistic bubble back.
8. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:465-484` and `856-857` — the refusal is `canSend` failing inside `chat:continue`.
9. `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:30-34` — the service itself says a follow-up queued during the crossing turn is released by `onTurnEnd` before `observe` sees the crossing figure. That is the SDK queue (`session.messageQueue`), not `tab.queuedContent`.
10. `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:146-160` — "Continue in new session" takes `write-handoff`'s seed, opens a new tab, and `sendOrQueueMessage`s that seed. It never reads `queuedContent`.
11. `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-handoff-builder.ts:1-18` — the handoff is built from the transcript tail. Composer queue text is not a transcript line, so it is absent from the seed.

**Fix direction:**

- On the terminal `turn_state`, flush `queuedContent` through `chat:continue` before the banner for that result is allowed to show. If `canSend` would refuse it, still deliver that one already-queued message or copy it into the handoff seed before the user can click Continue.
- `continueInNewSession` should take the source tab's `queuedContent` into the new session (seed prefix or a second prompt) and clear it only after that send is accepted.
- Do not clear `queuedContent` before the continue call returns success.

## c. Budget notifications stack for one session

**Root cause:** One `ChatViewComponent` renders one banner, but more than one chat view is mounted for the same session, and each binds its own banner to the same `sessionBudget`. The main chat view stays in the DOM when the grid is showing (`[class.hidden]`). Each canvas tile mounts another `ChatViewComponent`. `installSessionStats` writes the budget onto every tab `findTabsBySessionId` returns, so every mounted view for that session shows the stage. `limit` cannot be dismissed, and a refused send calls `installSessionBudget` again. There is no session-level "already showing" guard. Inside a single banner, `stage()` returns one stage, so tighten and handoff do not stack in one component; the stack is one banner per mounted view, plus the separate action-error slot above it.

**Evidence:**

1. `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:138-152` — one `ptah-session-budget-banner` per chat view, with no session-dedup key.
2. `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:768-807` — grid and single layouts are both rendered. The single-layout `ptah-chat-view` is hidden with a class, not destroyed, while the grid is visible.
3. `libs/frontend/canvas/src/lib/canvas-tile.component.ts:107-117` and `564-576` — each tile renders its own `ChatViewComponent` with a tile-scoped session context.
4. `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:117-160` — one stats event updates every tab bound to that session id.
5. `libs/frontend/chat-state/src/lib/tab-manager.service.ts:2247-2271` — `installSessionStats` and `installSessionBudget` assign `sessionBudget` on the tab. Neither checks that another view already shows it.
6. `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts:263-280` — dismiss hides `tighten` and `handoff` only while `dismissedStage === stage`. `limit` stays visible. A higher stage replaces the lower one inside that one component; it does not remove banners in other views.
7. `libs/frontend/chat/src/lib/services/session-budget-actions.service.ts:46-48` and `239-241` — the actions service is one per chat view. Its errors go to `ActionBannerService`, a single replacing slot (`action-banner.service.ts:107-116`), rendered above the budget banner (`chat-view.component.html:105-127`). A budget error and a budget banner are two visible notices. Repeated action errors do not stack on themselves.
8. `libs/frontend/chat/src/lib/services/message-sender.service.ts:732-736` — every `SESSION_BUDGET_REACHED` refusal writes `sessionBudget` again, which re-renders every view bound to that tab.

**Fix direction:**

- Render the budget banner once per session id, on the focused surface only. Hidden and unfocused views should not mount it.
- Ignore a budget assign whose `sessionId` and `revision` match what that surface already shows.
- Keep a single action-error slot; do not add a second budget toast on refusal. The banner is the refusal UI (`message-dispatch.service.ts:201-202`).

## d. Lane completions, agent reports, and `ptah_session_send` start turns past the limit

**Root cause:** The budget pause is implemented only on `chat:continue` for a non-CLI session. `sendMessageToSession` forwards to `SessionStreamPump.sendMessage`, which enqueues onto `session.messageQueue` and, when the session is idle, the pump yields it as the next turn. That path never calls `canSend`. `markTurnEnded` runs before `observe`, so a message held during the crossing turn is yielded before the limit exists. Later `<agent-lane-completed>`, `<agent-report>`, and `ptah_session_send` deliveries are new admissions through the same ungated send. The budget service comment treats "crossing turn plus one held follow-up" as accepted overshoot; the injectors are not limited to that one follow-up.

**Evidence:**

1. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:163-180` and `459-484` — `canSend` refuses the next `chat:continue` except exact `/compact` and `/clear`.
2. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:852-857` and `971-974` — the gate runs, then `sendMessageToSession`. The Ptah CLI branch returns at `852-855`, before the gate.
3. `libs/backend/rpc-handlers/src/lib/chat/ptah-cli/chat-ptah-cli.service.ts:262-274` — a Ptah CLI continue sends with `sendMessageToSession` and does not call `canSend`.
4. `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1370-1387` — `sendMessageToSession` notifies activity and calls `sessionLifecycle.sendMessage`. No budget call.
5. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:14-19` and `82-91` — the pump yields one queued message per turn and claims `turnInFlight` before the yield. The yield is the turn start.
6. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:198-257` — absent admission, a mid-turn send is pushed and held until `turnInFlight` is false. `require-idle` refuses instead of queueing (`219-221`, `266-284`). Neither branch calls `canSend`.
7. `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:225-247` — `canSend` is fail-open with no figure and when `enabled` is false. `blocked` is `stage === 'limit' && blockAtLimit` (`session-budget-stage.ts:309`).
8. `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:30-34` — documented overshoot: `onTurnEnd` releases the held follow-up before `observe` sees the crossing figure.
9. `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:328-338` — `<agent-lane-completed>` is `sendMessageToSession` on the parent, origin `peer`, no admission, so it starts a turn when idle and is held until turn end when busy.
10. `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:446-453` — a session child's completion uses the same send.
11. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:339-347` — `<agent-report>` for a CLI lane uses the same send.
12. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:492-508` — a child session's `ptah_agent_report` uses the same send. A dead parent is counted and not queued (`464-473`); a live parent always gets a new turn input.
13. `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:563-607` — `ptah_session_send` calls `sendMessageToSession`. `if-idle` uses `admission: 'require-idle'` (no queue). `steer` interrupts a busy turn and then sends. `queue` (the default) holds while `generating` and otherwise starts a turn. No `canSend`.
14. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:527-556` — `markTurnEnded` wakes the pump with no budget check, and it runs from the result branch before `observe` (defect a, items 2 and 5).

**Fix direction:**

- Call `canSend` inside `SessionStreamPump.sendMessage` before the push, for every origin, and return a refusal the injector can surface. Do not drop the payload.
- At `markTurnEnded`, if the session is now blocked, leave `messageQueue` held and surface it to the banner instead of yielding it.
- Exempt only the prompts `BUDGET_EXEMPT_PROMPTS` already names. Peer, lane, report, and session-send traffic is not those prompts.

## e. `ptah_session_start` from a child: `depth-exceeded`

**Root cause:** Depth is not a stored number. A start is refused when the caller id, or its resolved SDK id, is already a row in `SessionChildRegistry`. The parent link is two ids on that in-memory row: the caller's session id at start, and the caller's SDK id when one is already resolved. Closing the parent does not stop the child. Completions that cannot be pushed are held on the child and returned on the parent's next `ptah_session_*` call. Reports to a dead parent are counted and discarded.

**Evidence:**

1. `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:248-278` — `guardStart` refuses with `depth-exceeded` and the text "a child session cannot start child sessions (depth is limited to 1)" when `registry.isChild(caller)` or `registry.isChild(callerSdkId)`.
2. `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.port.ts:109-111` — `depth-exceeded` is a `SessionSpawnRefusalCode`. The detail string is built only at the refuse site above.
3. `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts:182-191` — `isChild` is `get(id) !== undefined`. It is true for a live or ended child. A child the user resumes from its tab is still a child. A record dropped by `pruneEnded` is no longer a child.
4. `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts:20-21` and `300-318` — ended history is capped at `SESSION_CHILD_ENDED_HISTORY_SIZE` (20). Past that, the oldest ended child is deleted and is not depth-guarded. The comment says a durable link is out of this registry (TASK_2026_580).
5. `libs/backend/cli-agent-runtime/src/lib/session-children/session-child.registry.ts:1-7` — the link is in memory for the process. Nothing here writes SQLite.
6. `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:350-372` — the row stores `parentSessionId: guard.caller` (the live caller id `ptah_session_start` attributed) and `parentSdkSessionId` from `sdkIdOf(caller)` when that resolves. `childSessionId` is a new `SessionId`.
7. `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:1095-1129` — a later send/status/read/stop is owned when the caller matches `parentSessionId` or `parentSdkSessionId`, comparing both the caller id and `sdkIdOf(caller)`.
8. `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:881-894` — the organization record stores the parent SDK id (`parentSdkSessionId`, else `sdkIdOf(parentSessionId)`), never the parent tab id alone.
9. `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts:419-443` and `session-spawner.service.ts:1019-1088` — completion delivery tries `parentSessionId` then `parentSdkSessionId` and pushes only to an id `isSessionActive`. If none is active, the envelope is stored as `heldCompletion` (latest settle replaces an older one). It is not pushed into a closed parent.
10. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:410-440` — every `ptah_session_*` reply appends `takeHeldCompletions()` for the caller. `session-spawner.service.ts:767-792` returns those envelopes and clears them, matching parent tab id or parent SDK id. A parent reopened under a new tab id with the same SDK id still receives them (`childrenOf` checks both).
11. `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts:413-473` — a child report to a parent that is not live increments `reportsRefused` and is not queued. The comment says a report is point-in-time and must not be replayed.
12. `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:907-945` — `onSessionEnd` handles the child's own session ending: a grace timer, then `markEnded` and `releaseBudget`. It does not subscribe to the parent closing.
13. `libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:795-812` and `1328-1348` — live children are stopped only on host `dispose` (`host-shutdown`). `releaseBudget` runs when that child ends, under the child tab id and its SDK id. Parent close does not call it.
14. No `parent-closed` or `childrenOf` stop path exists under `libs/backend/cli-agent-runtime/src/lib/session-children/`. A child whose parent session has ended keeps its worktree, runtime timer, and chat session until the child ends, the runtime cap fires, `ptah_session_stop` runs, or the host disposes.

**Fix direction:**

- If a child must not outlive its parent, add an explicit parent-end subscription that stops or detaches children. Today that behavior does not exist; do not infer it.
- Depth stays a registry membership test. A stored integer would drift from `isChild`. Any persistence work has to keep ended children in that test or the depth rule changes when `pruneEnded` drops them.
- `ptah_session_start` from a child should keep returning `depth-exceeded`. A handoff session is a new top-level session, not a child of the blocked one, or this refusal fires again.

## Turn sources

A "turn" here means a prompt yielded by `SessionStreamPump` into the SDK user-message stream (`session-stream-pump.service.ts:82-91`). `chat:resume` reads history and does not send (`chat-session.service.ts:997-1029`); it is not a row.

| Source | Where it starts a turn | Current budget gate | Can it be held in a queue today? |
| --- | --- | --- | --- |
| User composer, resume-agent prompts, agent-feedback text, and the handoff seed via `sendOrQueueMessage` | `message-dispatch.service.ts:200` then `message-sender.service.ts:711` `chat:continue`, or a new-tab `chat:start` when the tab has no session. `continueSession` sends at `chat-session.service.ts:971`. | Yes, but only the `chat:continue` path, and only after the Ptah CLI short-circuit (`chat-session.service.ts:852-857`). `startSession` (`510`) does not call `canSend`. | Yes. While the tab is busy, `message-dispatch.service.ts:183-198` stores `queuedContent`. The SDK pump also holds a send that arrives with `turnInFlight` (`session-stream-pump.service.ts:247-257`). |
| Frontend queue flush | `message-dispatch.service.ts:229-252`, triggered from `chat.store.ts:407-410` (message_complete path) or `session-stats-aggregator.service.ts:188-192` (stats after streaming ended). | Yes. Same `chat:continue` gate. A refusal restores the queue (`message-dispatch.service.ts:254-258`). | The flush itself is the drain. It does not run on `turn_state` (`streaming-handler.service.ts:209-211`). |
| `<agent-lane-completed>` for a CLI lane | `lane-completion-notifier.service.ts:329` `sendMessageToSession`. | No. | Yes while `turnInFlight`. Released by `markTurnEnded` with no budget check (`session-registry.service.ts:543-556`). |
| `<agent-lane-completed>` for a `ptah_session_start` child | `lane-completion-notifier.service.ts:447`. | No. | Same pump hold. If the parent is not active, the envelope is held on the child record instead (`session-spawner.service.ts:1074-1078`), not on the pump. |
| `<agent-report>` from a CLI lane | `agent-report-router.service.ts:341`. | No. | Same pump hold. Duplicate and burst limits refuse before the send (`325-337`); those refusals are not a queue. |
| `<agent-report>` from a child session | `agent-report-router.service.ts:502`. | No. | Same pump hold when the parent is active. A dead parent is `reportsRefused` and dropped (`464-473`), not queued. |
| `ptah_session_send` | `session-spawner.service.ts:573`, `580`, `593`, `600`. | No. | `queue` (default): yes while generating (`598-607`). `if-idle`: no, `require-idle` throws (`572-576`, pump `266-284`). `steer` while busy: interrupts, then sends (`578-596`), not queued. |
| Peer relay (`PeerSessionMessenger`) | `peer-session-messenger.service.ts:128` into the sending session. | No. | Yes. No admission is passed, so the pump holds it mid-turn. |
| Surface submit | `surface-submit-turn.service.ts:298` with `admission: 'require-idle'`. | No. | No. Busy or a non-empty pump queue is refused before send (`250-256` and pump `279`). |
| Ptah CLI `chat:continue` | `chat-ptah-cli.service.ts:274`, reached from `chat-session.service.ts:852` before the budget gate. | No. | Yes. Default admission, so the pump holds it mid-turn. |
| Message already on `session.messageQueue` when the result arrives | `session-registry.service.ts:551-554` wakes the pump; `session-stream-pump.service.ts:82-91` yields it. | No. `onTurnEnd` runs before `observe` (`stream-transformer.ts:655-658`, `sdk-agent-adapter.ts:1739-1742`). | It is already the held queue. The yield is unconditional. |

`/compact` and `/clear` are the only prompts that pass a blocked session (`chat-session.service.ts:174-177`). Any other slash command on `chat:continue` is refused with the budget.

## Budget-flow capabilities today

Preserve these. They are what the banner and the gate already do.

- Settings keys, bounds, and defaults live in `SESSION_BUDGET_SETTINGS` (`libs/shared/src/lib/types/session-budget.types.ts:192-280`): `enabled` default true, `unit` `tokens`, `tokens` default 50_000_000 (min 1_000_000, max 2_000_000_000), `usd` default 30, `fallbackWeightedTokens` default 9_000_000, `tightenPercent` default 50, `handoffPercent` default 80, `handoffAfterCompactions` default 3, `tightenWindowTokens` default null, `blockAtLimit` default true. Tighten must be below handoff or both are read as defaults (`286-290`).
- Stages are `unknown`, `normal`, `tighten`, `handoff`, `limit` (`session-budget-stage.ts:37-43`). The banner shows from `tighten` up, plus a rotation advisory (`session-budget-banner.component.ts:19-20`, `263-280`).
- `blocked` is only `limit` and only when `blockAtLimit` is on (`session-budget-stage.ts:309`). No figure, a disabled budget, or a thrown config read fails open (`session-budget.service.ts:235-247`).
- State is in memory, keyed by the SDK session id, and released on session end (`session-budget.service.ts:16-19`, `287-295`). It is not persisted. A restart recomputes from the resume snapshot (`observeLoaded`, `206-210`). Compactions, extensions, and dismissals reset.
- `observe` is synchronous and its state rides the result-stats broadcast (`session-budget.service.ts:21-24`, `sdk-callbacks.ts:418-420`). Stage actions (window, handoff write) run after `observe` returns, once per stage entry (`session-budget.service.ts:492-509`).
- Tighten lowers auto-compact only when `tightenWindowTokens` is set. Otherwise the window reason is `disabled` (`session-budget.service.ts:528-540`). The banner offers "Restore auto-compact" only when `window.applied` (`session-budget-banner.component.ts:131-139`).
- Handoff is a deterministic transcript-tail document, no model call, caps in `SESSION_HANDOFF_LIMITS` (`session-handoff-builder.ts:38-62`): document 8_000 chars, seed 8_200, tail read 4 MB. The webview must send the seed as-is (`session-budget.types.ts:312-316`).
- Banner buttons (`session-budget-banner.component.ts:103-181`): rotation "Rotate session" and "Keep this session"; tighten "OK" and conditional "Restore auto-compact"; handoff "Start new session from handoff", "Preview handoff" / "Hide handoff", "Keep working"; limit "Continue in new session", preview, "Allow 20% more". Limit copy says new messages pause after the current turn and one queued message may still run (`398-400`).
- Dismiss stores `dismissedStage` (`session-budget.service.ts:670-673`). The banner hides that stage until a higher one (`session-budget-banner.component.ts:276-279`). Limit has no dismiss.
- "Allow 20% more" increments `extensions` and re-evaluates with the stage reset (`session-budget.service.ts:682-713`). Each extension adds 20% of the configured limit (`session-budget-stage.ts:34-35`, `58-62`). It is refused unless the stage is `limit`.
- Preview loads `preview-handoff` into a `<pre>` (`session-budget-actions.service.ts:134-143`, banner `204-212`). A failed preview shows "Try again". Write errors and transcript read failures are separate lines (`315-328`).
- "Continue in new session" is `write-handoff`, then `createTab`, then `sendOrQueueMessage(seed)` (`session-budget-actions.service.ts:150-160`). "Rotate session" uses `preview-handoff` and prefills the new composer without sending (`167-172`).
- RPC `session:budgetAction` is registered for every host. A host without the budget service returns `{ success: false, error: 'unavailable' }` (`session-budget-rpc.handlers.ts:56-65`).
- `/compact` and `/clear` still pass a blocked session. The match is the trimmed prompt exactly (`chat-session.service.ts:174-177`).
- Turning `sessionBudget.enabled` off clears `sessionBudget` on every open tab without waiting for the next snapshot (`tab-manager.service.ts:2274-2291`).
- The stats chip shows the same budget beside TOKENS or COST (`session-stats-summary.component.ts:142-148`). That chip is not the handoff prompt.
- Child-session budget entries are released when the child ends, under tab id and SDK id (`session-spawner.service.ts:1328-1348`). Stopping the parent chat does not release the parent's budget: `interruptSession` keeps it so Stop does not clear extensions (`sdk-agent-adapter.ts:1479-1485`).

## Unknowns

- Whether a single-layout session (no canvas tile) still shows two banners. The main view is the only `ptah-chat-view` in `app-shell.component.html`. Stacking is demonstrated for grid-plus-hidden-main and for several tabs bound to one session id. A single mounted view has one banner element.
- The exact webview ordering of the async `SESSION_STATS` broadcast versus the `turn_state` chunk on a live socket. The producer order is fixed (`onResultStats` invoked, not awaited, then the result event is yielded). Which message the webview applies first was not timed.
- `takeHeldCompletions` marks the held completion delivered when it returns it (`session-spawner.service.ts:780-786`) even if the tool reply later fails to reach the model. That is outside the five defects.
