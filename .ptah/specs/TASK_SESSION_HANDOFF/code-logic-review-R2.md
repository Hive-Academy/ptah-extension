Verdict: REVISE
Score: 4/10

## Previous findings

| Finding | Status | Current evidence |
|---|---|---|
| 1 — Snapshot/bind/delivery split | Resolved | `child-chat-session-host.adapter.ts:93-132` and `134-147` separate successor creation from FIFO delivery. The coordinator only delivers after a successful bind. |
| 2 — Stream exit leaves held operation | Resolved | `chat-stream-broadcaster.service.ts:341,401` routes exits through `handoverCoordinator.sourceEnded` before teardown. |
| 3 — State broadcast replay/RPC | Resolved | `session-handover-rpc.handlers.ts:60-63,130-138` adds a `getHandoverState` RPC and serializes revisioned broadcasts. |
| 4 — Child parent/lease inheritance | Deferred | Marked as deferred for Batch D. |

## New findings

1. **blocking** — `session-handover-coordinator.service.ts:469-487` (sourceEnded vs closing race)
   **Defect:** If `sourceEnded` is called (e.g., source stream crashes) while `complete` is asynchronous in `starting-successor` or `successor-confirmed`, it transitions the operation to `failed` and restores the FIFO. The `complete` workflow continues concurrently, delivers the same inputs to the successor, and overwrites the state to `closing`/`closed`.
   **Failure scenario:** A stream aborts while the UI is binding the successor. `sourceEnded` restores the inputs, but `complete` still delivers them to the replacement tab. The state machine flips from `failed` to `closed`, violating exactly-once delivery.
   **Exact fix:** Check the operation's phase in `complete` after every asynchronous `await` (e.g., after `startSuccessorSession`). If the phase is `failed` or `cancelled`, return immediately without delivering inputs or transitioning further.

2. **blocking** — `session-handover-coordinator.service.ts:193-212` (auto re-arm loops after cancel)
   **Defect:** A cancelled or failed `budget-auto` operation becomes `isRestartable`. On the next turn terminal, if `atHandoffStage` is still true, `armAtTerminal` drops the old operation, creates a new `budget-auto` operation, and triggers `startAutomatic` immediately.
   **Failure scenario:** The budget reaches the handoff stage and an automatic handover starts. The user cancels it. After the user's next message finishes, the automatic handover fires again instantly. The user is trapped in an automatic handover loop until the budget limit is reached.
   **Exact fix:** Add an `autoTriggered: boolean` flag to the session record or coordinator. Set it when a `budget-auto` operation is created, and do not recreate another `budget-auto` operation if it is already true, deferring to `atBlockingLimit`.

3. **major** — `session-handover-coordinator.service.ts:517-532` (lostInputs content exposure)
   **Defect:** When held inputs cannot be restored, the snapshot populates `lostInputCount` and a static string instructing the user to "Copy them back". The actual content of the lost messages is never exposed to the UI.
   **Failure scenario:** A handover and restore both fail. The user is told to copy their messages back, but they cannot see what they typed because the UI state lacks the text, resulting in permanent loss of those prompts.
   **Exact fix:** Include an array of the lost message strings in `SessionHandoverState` (e.g., `lostInputTexts: string[]`), capping each string to a reasonable size (e.g., 1000 chars) to prevent payload bloat, so the UI can render them for copying.

4. **minor** — `session-handover-coordinator.service.ts:410-434` (capture of agent's final text)
   **Defect:** `requestAgentHandoff` extracts text only from the *last* assistant message (`at(-1)`). If the agent disobeys instructions and calls a tool after writing text, the final assistant message will be a tool call with empty text. `latest.content.trim()` is falsy, and the generated text is discarded.
   **Failure scenario:** The agent generates a helpful handoff summary but ends by calling a file tool. The coordinator sees the empty final message, discards the handoff, and falls back to the deterministic builder.
   **Exact fix:** Filter the history for all assistant messages after `previousId`, and concatenate their `content` strings, rather than only looking at the last one.

## Five logic questions

1. **Silent failure:** Concurrent `complete` delivers inputs to the successor after `sourceEnded` restored them to the source (finding 1).
2. **Unexpected action:** Cancelling an automatic handover causes it to instantly re-arm on the next message (finding 2).
3. **Wrong answer:** `requestAgentHandoff` loses the handoff text if the agent finishes the turn with a tool call (finding 4).
4. **Dependency/process failure:** Restoring held inputs fails, but the UI cannot display the lost text to the user (finding 3).
5. **Missing requirement:** Race condition handling between asynchronous `complete` and synchronous `sourceEnded` (finding 1).

## Scope and evidence

Reviewed `session-handover-coordinator.service.ts`, `session-lifecycle-manager.ts`, `session-stream-pump.service.ts`, `session-control.service.ts`, `child-chat-session-host.adapter.ts`, `chat-stream-broadcaster.service.ts`, `session-handover-rpc.handlers.ts`, and `chat-session.service.ts` for exactly-once delivery, lifecycle exit races, queue admission, and budget re-arming. Verified previous fixes in adapter bind logic, stream abort hooks, and RPC handlers. Did not run automated tests or builds.
