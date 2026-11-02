# Batch 8o-3 — GAP-E

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-event-translator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-event-translator.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-events.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\cli-agent-runtime\src\lib\cli-agents\cli-adapters\codex\codex-lane-events.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\gateway-chat-bridge\src\lib\codex-gateway-adapter.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\gateway-chat-bridge\src\lib\codex-gateway-adapter.spec.ts`

## Changes and specs

1. A completed `agentMessage` with `delivery: 'async'` and valid nonempty questions becomes `userInputAsync`, with item id, text, titles and optional choices. A plain final answer remains `textFinal`; `sleep` yields no event. The existing item parser accepts both fields; local validation narrows the question shape without changing the pinned schema. `codex-event-translator.spec.ts` pins all three cases. For streamed deltas, an `item/started` that identifies async delivery suppresses later deltas for that item; no async deltas occurred in the recorded rollout. A delta that arrives before its identifying start item cannot be retracted; that protocol ordering is a remaining limit.
2. For chat only, the runtime maps the questions to the existing `requestUserInput` port with stable `itemId:index` question IDs, empty headers and option descriptions, and the active turn's abort signal. The port presents Claude's AskUserQuestion card. The answer is sent once through the existing serialized, guarded `turn/steer` path using `User has answered your questions: "<title>"="<answer>". You can now continue with the user's answers in mind.` Gateway and lane contexts never call the port. `codex-runtime.spec.ts` covers the mapped request, steer wording, turn end, interrupt, and both non-chat consumers.
3. Chat projection ignores `userInputAsync` because its card is already presented. It also ignores mid-turn `error` events, including retries and unsupported blocks. A failed terminal still calls `callbacks.error` once. `codex-chat-events.spec.ts` pins this behavior. `codex-chat-turn-stream.ts` was read: runtime closure synthesizes a failed terminal, and exhaustion without terminal throws a stream failure, so a dying process does not silently hang.
4. Lane and gateway projections render `userInputAsync.text` as ordinary answer text. Their respective `codex-lane-events.spec.ts` and `codex-gateway-adapter.spec.ts` pin this.

## Risks handled

- Late answer: an aborted or ended turn never starts a new turn; the same-turn steer guard refuses it and logs a coded warning without answer text. A rejected steer is also logged without answer text.
- Abort, Stop, interrupt and close: the request uses the active turn controller signal, which those paths abort; terminal completion aborts it too.
- Hang: a failed terminal is emitted when the process closes, and the chat turn stream handles exhaustion as a failure.

## Decisions

- Reused D18's `requestUserInput` port and D19's guarded same-turn steer. No second question transport or frontend branch was added.
- Kept the pinned schema and validator unchanged because they already accept `delivery` and `questions`.
- Followed the explicit batch instruction for late answers: no new turn is started after the original turn has ended. The composer remains available for a later user message.
- Tests, builds, lint and typecheck were not run, per the task's verification restriction. The coordinator owns verification.

## Fix round

- **Verify failure (first `userInputAsync`):** `CodexChatEvents.map` now consumes a card-only event without opening an assistant `message_start`. A later visible event opens the message. `codex-chat-events.spec.ts` checks card-only `[]` followed by `message_start` and `text_delta` for a text fallback.
- **Serious 1 (follow-up rejection):** `codexFollowUpRejected` now calls the existing guarded `error()` once, producing the Claude-shaped `Codex reported a runtime error.` CHAT_ERROR. Retryable `turnError`, `unsupportedItem`, and `unsupportedNotification` remain silent pending the terminal. The error spec checks both a follow-up rejection and a later failed terminal produce one error callback total.
- **Serious 2 (missing question):** chat runtime emits `userInputAsync` with `presentation: 'card'` only when the live-turn request port is invoked. Missing port, inactive state, turn mismatch, an already aborted signal, or a synchronous port failure use `presentation: 'text'`; the chat projection renders that text through the ordinary `textFinal` path as Claude `text_delta`. If native text is empty, the question titles provide the text. Warnings contain a code and cause, not question or answer text. `codex-runtime.spec.ts` checks the no-port fallback; `codex-chat-events.spec.ts` checks its stream output.
- **Moderate 4 (late async marker):** the translator tracks visible agent-message deltas. If `item/started` lacked `delivery` but completion declares async, it marks the item for text presentation. The runtime does not open a card, and `CodexChatEvents` uses its existing prefix-diff text handling to add only the remaining text. `codex-event-translator.spec.ts` and `codex-runtime.spec.ts` check this case. When delivery is present at start, deltas remain suppressed and completion can open one card.
- **Moderate 5 (duplicate completion):** a per-active-turn item-id set prevents a replay from opening another card or steering another answer. It is cleared at terminal. `codex-runtime.spec.ts` checks one request and one steer for two completions.
- **Minor 6 (dismissal):** an undefined or empty answer map logs `codex-user-input-undelivered` with cause `dismissed` and sends no steer. `codex-runtime.spec.ts` checks this without logging answer text.
- **Minor 7 (spec gaps):** added the started-without-delivery, duplicate completion, no-port text, and two-question quoting specs. The multi-question steer uses JSON string quoting for each title and answer, so quotes and newlines remain unambiguous in one Claude-style answer sentence.
- **Moderate 3 (live risk, open):** a native turn that ends immediately after the async item aborts the card at once. This behavior remains unchanged as requested. The live test must determine whether Codex keeps the turn open long enough for an answer; if it does not, a product decision is needed for the cancelled-card case.

### Fix-round files written

- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-event-translator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-event-translator.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\.ptah\specs\TASK_2026_714_c8a2\batch-8o-3-report.md`

No verification, tests, builds, lint, typecheck, diagnostics, commit, or push were run. The coordinator owns verification.

## Verify fix

- `codex-chat-events.ts` leaves the assistant stream unopened for a first, silent `error` event. `codex-chat-events.spec.ts` now places that error first and checks that it produces no stream events; the existing failed-terminal check still guards a single error callback.
- The text fallback uses one `text_delta` for `Choose one`; it does not call the complete-content callback. The spec checks the delta, absence of that callback, and an empty result on duplicate presentation.
- `codex-runtime.spec.ts` now supplies the pinned protocol's required `startedAtMs` in the `item/started` frame. Without it, the process rejected the frame and the iterator yielded a failure terminal before the visible delta. The spec continues to require `textDelta` followed by `userInputAsync` with `presentation: 'text'` and no card request.
- `codex-runtime.ts` logs `turn-ended` when the card request resolves after its turn signal was aborted, before classifying missing answers as `dismissed`. No answer text is logged.
- Files written in this verify fix: `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.ts`, `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\agent-sdk\src\lib\codex-app-server\codex-chat-events.spec.ts`, `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.ts`, `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration\libs\backend\codex-runtime\src\lib\codex-runtime.spec.ts`, and this report.
- Verification was not run, per the coordinator restriction.
