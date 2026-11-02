# Batch 8r-5 revision 1

## Root cause and response contract

The Codex host's `publish` awaits the whole broadcast loop. On a failed turn, the stream yields the user echo, assistant notice, and terminal `failed` turn state, then rejects; the broadcaster catches that rejection and finishes. A normal Codex completion also finishes the loop. In both cases `sendMessageToSession` can therefore resolve after the terminal chunk has already put the tab into `loaded`. The old `chat:continue` reply `{ success: true, sessionId, enqueued: true }` made `MessageSenderService` mark the tab `streaming` again. An extra catch-path `idle` chunk cannot fix the ordering because it too is flushed before that RPC reply.

The existing successful `settled: true` contract skips the renderer's re-arm and marks the tab loaded. Its `removeUserPromptBoundary` removes only the provisional boundary in streaming state. The visible user bubble is in the tab's message list, while the Codex user echo uses an event ID different from the client message ID (`codex-chat-turn-stream.ts:250-260`); the boundary removal does not remove the real echo or assistant reply. For the failed turn, the notice and terminal `failed` state have already been delivered, so the same successful settled reply avoids a second error and retains the notice. `CHAT_ERROR` remains suppressed for a webview-reported Codex failure. This is the same settled response shape used by completed slash commands.

## Files changed

- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1254-1260,1290-1312,1965-1978`: for a resumed Codex turn delivered by `chat:continue`, await its broadcaster loop and report `settled: true` when it ends before the reply. For a live native follow-up, capture the native admission signal while no stream is attached and before sending, then return `settled: true` only if neither session nor tab has an attached stream after the awaited send. An attached stream retains the existing `enqueued: true` reply.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-codex-resume-once.spec.ts:51-146,229-309`: model the native thread between turns and its stream ending before the RPC reply; assert the reply for failed, completed, still-running Claude, and ended-resume cases. The ended-resume case gates the broadcast with deferred promises and checks that the RPC does not reply before it finishes.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts:611-620`: update the existing live-native follow-up expectation to the settled reply because its mocked send resolves with no attached broadcaster loop.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.spec.ts:1054-1100`: retain the four-event failed-notice sequence but assert one terminal `failed` state, no redundant `idle`, no second error card, and no completion card.
- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:216`: describe the existing `settled` field for any request that finished before its RPC reply, including a streamed Codex turn.
- `.ptah/specs/TASK_2026_714_c8a2/batch-8r-5-revise-1.md`: this handoff.

The earlier change to `chat-stream-broadcaster.service.ts` was removed. Its original catch still forces `idle` when there is no `failed` terminal, which covers unreported stream errors and aborted generating turns. When a `failed` terminal already exists, it is sufficient to settle the turn, and an additional idle event is unnecessary. No MCP code was changed.

## Why Claude is unchanged

The native follow-up check uses `SessionRuntimeRouter.acceptsFollowUpWithoutStream` only when neither session nor tab has an attached stream before send. Claude's long-lived loop is attached, so its native admission is not consulted and the existing `{ success: true, sessionId, enqueued: true }` result remains. The `promptDelivered` branch and the awaited resume broadcaster are reached only by the Codex `chat:continue` resume path; Claude resume still starts its loop without awaiting it. The broadcaster source is back to its original behavior, including Claude error handling.

## Specs and old-code behavior

- Failed Codex follow-up (`chat-continue-codex-resume-once.spec.ts:229`): requires `settled: true` after the mocked awaited native stream ends. The old service returns `enqueued: true`, so it fails.
- Completed Codex follow-up (`:244`): requires the same settled reply after a completed native stream. The old service returns `enqueued: true`, so it fails.
- Claude attached loop (`:259`): requires `enqueued: true`. This control passes on the old service and guards against changing Claude.
- Codex resume with prompt and attachment-only resume (`:164,186`): both require `settled: true` after the resumed stream ends. The old service returns `{ success: true, sessionId }`, so they fail.
- Ended Codex resume (`:274`): requires `settled: true` when the resumed stream has finished before the reply. The old service returns `{ success: true, sessionId }`, so it fails.
- Existing live-native follow-up (`chat-session.native.spec.ts:611`): requires `settled: true` after its mocked send resolves without an attached loop. The old service returns `enqueued: true`, so it fails.
- Four-event failure broadcast (`chat-stream-broadcaster.service.spec.ts:1054`): requires the existing failed terminal with no extra idle or duplicate notice. It passes on the original broadcaster and would fail the previous batch's extra-idle change. The RPC-result specs cover the re-arm defect that this broadcaster spec alone cannot detect.

## Coordinator verification

Run the `@ptah-extension/rpc-handlers` test and typecheck targets, with the focused session and broadcaster specs included, and the `@ptah-extension/shared` typecheck target for the contract comment change. Per lane rules, I did not run tests, Nx, typecheck, lint, builds, diagnostics, or runtime verification. I also left the concurrent edits in `codex-runtime.spec.ts` and `codex-chat-host-ports.resume-permission.spec.ts` untouched. No matching backend coding skill was invocable through this CLI; I checked the installed Codex skill directory and Ptah skill inventory.
