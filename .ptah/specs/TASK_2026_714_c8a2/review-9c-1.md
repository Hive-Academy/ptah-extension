Verdict: REVISE
Score: 4/10

Batch 9c-1 makes a failed native terminal reach the gateway catch. It does not deliver the corrected gateway text. It also records a real failure as a user cancellation.

## Q1 — Failure and interrupt paths

The Electron webview ends the turn. A failed terminal calls the native error callback once at `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts:293-308`. `settled()` then throws before the generator yields `message_complete` at `codex-chat-events.ts:55-60` and `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:248-260`. The broadcaster flushes pending chunks and forces idle at `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:314-350`.

The failed turn gets one error card. The callback publishes it at `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.ts:72-78,164`. The broadcaster suppresses its second card because the message contains `cancelled` at `chat-stream-broadcaster.service.ts:321-326,370-381`. An interrupted terminal has no callback card and gets no broadcaster card. This matches the visible Claude failure and stop outcomes. The normal Electron stop path also throws `cancelled` earlier at `codex-chat-turn-stream.ts:221-235`.

The `cancelled` label for a real failure is not acceptable. The broadcaster logs a user abort, skips Sentry, and uses `aborted_streaming` at `chat-stream-broadcaster.service.ts:328-348`. The adapter also skips its failure log at `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:793-808`. The gateway records `agent turn failed (Codex chat turn: cancelled)` at `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:644-655,720-725`. Use `runtime-failed` for a failed terminal. Add a separate `webviewReported` flag so the broadcaster can suppress only the duplicate card. Keep `cancelled` for an interrupted terminal.

The gateway now sends its generic failure reply and records a failed outcome. Any partial body still drains during the final seal at `gateway-chat-bridge.ts:692-725`. This matches the existing Claude mid-stream failure contract, whose spec expects both a drain and an error at `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.spec.ts:1113-1140`.

There is no gateway user-stop path to compare. The gateway cancellation flag belongs to its watchdog at `gateway-chat-bridge.ts:237-245,661-690`. A non-watchdog Claude abort reaches the same generic catch. The current native interrupted behavior therefore matches the existing thrown-abort path. A future gateway stop command should use the cancellation path instead of a generic failure.

## Q2 — Corrected final text

The webview receives the corrected text twice. `callbacks.content` publishes one complete-source delta at `codex-chat-event-callbacks.ts:80-93`. The mapped stream event supplies the second at `codex-chat-events.ts:166-185`. This is visually harmless because the accumulator sets the block for `complete` and `history` sources at `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:301-329`. It does not append either copy. The duplicate transport and state updates are unnecessary.

The gateway result is wrong. `pumpStream` appends every nonempty delta and ignores `source` at `gateway-chat-bridge.ts:1094-1096`. A correction from `old` to `corrected answer` therefore seals `oldcorrected answer`. A correction from `hello world` to `hi` seals `hello worldhi`.

Claude can supply both forms for one block. The stream transformer emits streamed text at `libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts:461-477`. The complete assistant transformer emits the full block with `source: 'complete'` at `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:136-149`. The main loop transforms both SDK message kinds at `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:1095-1114`. The gateway enables partial messages at `gateway-chat-bridge.ts:979-986`. The current gateway has no reconciliation for either provider.

The coalescer cannot replace text through its public API. It only appends at `libs/backend/messaging-gateway/src/lib/stream-coalescer.ts:108-149`. Its body is cumulative at `stream-coalescer.ts:63-80`. The bridge uses `complete` mode at `libs/backend/messaging-gateway/src/lib/outbound-delivery.service.ts:210-219`, so nothing flushes before the seal.

The minimal fix belongs in `gateway-chat-bridge.ts`. Accumulate text in `pumpStream` by `(messageId, blockIndex)`. Append stream deltas to that block. Replace the block for `complete` and `history`, including an empty replacement. Append the joined body to the gateway once when the stream exits. Do this in `finally` only when `cancellation.cancelled` is false. This preserves partial text on a normal failure and preserves the watchdog no-touch rule. It also avoids a messaging-gateway API change. Remove the redundant text `callbacks.content` call in `codex-chat-events.ts` after the stream event carries the correction.

An empty divergent final remains a separate defect. `codex-chat-events.ts:166-168` emits nothing, so both consumers retain the stale prefix. Emit an empty complete-source delta when a nonempty streamed block corrects to empty.

## Q3 — Circular value import

The cycle is `codex-chat-adapter.ts:1-4` → `codex-chat-turn-stream.ts:20-24` → `codex-chat-events.ts:6` → `codex-chat-adapter.ts`. It is safe under the current CommonJS and Jest initialization because the class is constructed only when a terminal arrives. Module initialization has finished by then. I found no immediate module-init failure.

The dependency direction is still fragile. Move `CodexChatAdapterError` and its type guard to a leaf module such as `codex-chat-adapter-error.ts`. Update the adapter, events, turn-stream, and affected spec imports when the failure-classification fix lands.

## Q4 — Specs

The new specs assert the projection behavior. The failed and interrupted cases fail on old code because old `settled()` resolves. The longer and shorter divergence cases fail on old code because old `map()` returns no replacement delta. The prefix-extension case protects the unchanged suffix behavior. Evidence is at `codex-chat-events.spec.ts:310-489`.

The specs also lock in the wrong `cancelled` classification at `codex-chat-events.spec.ts:336-340,361-365`. They assert a returned `message_complete`, but they do not prove that the real generator suppresses it. They do not cover the broadcaster, gateway failure reply, gateway body, duplicate webview delivery, empty correction, or detached drain. Add stream-level and gateway integration specs for those paths.

The changed specs contain no `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable`. They assign no readonly mock properties and create no real timers. The existing deferred callback promise is released at `codex-chat-events.spec.ts:39-58`.

No tests, lint, typecheck, diagnostics, or builds ran, as instructed.

## Findings

1. **Serious — The gateway seals obsolete text plus the corrected final.** `codex-chat-events.ts:177-185` emits the full replacement, while `gateway-chat-bridge.ts:1094-1096` appends it after the streamed prefix. Requirement 2 remains unmet. Fix `gateway-chat-bridge.ts` with per-`(messageId, blockIndex)` reconciliation and one final append as described in Q2. Add divergence, shorter-text, multi-message, and Claude complete-after-stream cases to `gateway-chat-bridge.spec.ts`. Remove the duplicate text callback in `codex-chat-events.ts` and update `codex-chat-events.spec.ts`.

2. **Serious — A native runtime failure is misclassified as a user abort.** `codex-chat-events.ts:313-320` creates `CodexChatAdapterError('cancelled', 'turn')` for `failed`. This suppresses Sentry and failure logging and corrupts the gateway outcome reason. Use `runtime-failed` plus a distinct `webviewReported` flag. Touch `codex-chat-adapter.ts`, `codex-chat-events.ts`, `chat-stream-broadcaster.service.ts`, and their specs. Keep one webview card and record a genuine failure.

3. **Serious — A correction to empty text keeps the old answer.** `codex-chat-events.ts:166-168` returns no event, and `gateway-chat-bridge.ts:1094` also ignores empty deltas. Emit a complete-source empty replacement for an existing nonempty block in `codex-chat-events.ts`. Process empty replacements in `pumpStream`. Add empty-final cases to `codex-chat-events.spec.ts` and `gateway-chat-bridge.spec.ts`.

4. **Medium — Expected detached interrupts now take the cleanup-failure path.** `drainInterruptedTurn` requests an interrupt at `codex-chat-turn-stream.ts:321-324`. The new rejection from `projection.settled()` at `codex-chat-turn-stream.ts:341-342` sends the expected interrupted terminal into the catch, which logs a failure and closes the context at `codex-chat-turn-stream.ts:351-365`. Catch the expected interrupted settlement around the mapped terminal, await its callbacks, call `settleTurn()`, and return cleanly. Touch `codex-chat-turn-stream.ts` and `codex-chat-turn-lifecycle.spec.ts`.

5. **Low — The new value import creates an avoidable module cycle.** `codex-chat-events.ts:6` imports the adapter that transitively imports events. It is deferred-use safe today, but the error class belongs in a leaf module. Move it during finding 2 and update the adapter, turn-stream, events, and spec imports.
