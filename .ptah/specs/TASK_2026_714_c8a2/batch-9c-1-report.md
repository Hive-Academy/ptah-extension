# Batch 9c-1 — Codex terminal failure and divergent final text

Worktree: `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`

Scope kept to `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts` and `codex-chat-events.spec.ts`. `gateway-chat-bridge.ts` and `libs/shared` were not edited. Tests, lint, and typecheck were not run (coordinator verifies).

## Claude contract evidence

A Claude turn fails the gateway only when the stream iterator throws. `StreamTransformer` logs the SDK error and rethrows it (`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:1161-1203`). An in-band `error` stream event is logged and dropped (`libs/backend/agent-sdk/src/lib/message-transform/stream-event.transformer.ts:102-109`). A result with `is_error` does not throw by itself.

The gateway pump (`libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:1075-1115`) appends only `text_delta` (`:1100-1102`) and treats a normal end as success. `message_complete` carries no text and is not a flush (`:1086-1089`). Zero events throw (`:1111-1112`). Any other throw lands in `runTurn`'s catch (`:628-673`): native Codex does not fall back to a new session (`:1134-1136`), and the user-facing reply is `Ptah could not complete this request. Please try again.` (`:669-672`).

A full-text replacement is a `text_delta` whose `delta` is the whole block and whose `source` is `'complete'` (`libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:136-149`). `FlatStreamEvent` has no replace event (`libs/shared/src/lib/types/execution/stream.ts:124-128`). The webview accumulator sets that block instead of appending (`libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:318-323`), so a shorter final replaces the streamed text. The gateway coalescer only appends (`libs/backend/messaging-gateway/src/lib/stream-coalescer.ts:138-139`) and never reads `source`.

The webview error card for a native turn is `callbacks.error` → one `CHAT_ERROR` (`libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.ts:72-78`). The chat broadcaster publishes a second `CHAT_ERROR` when the generator throws, unless the message looks like a user abort (`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:314-381`, the `'cancelled'` check at `:321-326`). `CodexChatAdapter.failure` rethrows a `CodexChatAdapterError` unchanged and rewrites every other error to `Codex chat turn: runtime-failed` (`libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:793-808`). The turn generator awaits `projection.settled()` before it yields mapped events (`codex-chat-turn-stream.ts:238-249`).

## Changes

`codex-chat-events.ts`

- `:54-60` — `settled()` still waits for callbacks, then rejects with the terminal failure. The generator's `await projection.settled()` therefore throws before `message_complete` is yielded, which is what makes the gateway catch run.
- `:155-194` — When `textFinal` does not start with the streamed prefix and the final is non-empty, the projection still calls `callbacks.content` with the full text and also yields one `text_delta` with `source: 'complete'` and `delta` set to that full text (longer or shorter). A final that extends the prefix still yields only the suffix with `source: 'stream'`. An empty divergent final still yields nothing and does not allocate a block index.
- `:292-320` — A `failed` terminal, a terminal that carries `error`, and an `interrupted` terminal still notify callbacks as before (`error()` only when `failed`, one result callback), still return `message_complete` from `map()`, and then arm `streamFailure`. The rejection is `new CodexChatAdapterError('cancelled', 'turn')` (`Codex chat turn: cancelled`). That class survives `failure()` and matches the broadcaster's user-abort spelling, so the broadcaster does not publish a second `CHAT_ERROR` on top of the callback card. A completed terminal with no error still settles cleanly.

`map()` itself does not throw. Callers that only inspect the returned array still see `message_complete`. The stream consumer throws because the generator awaits `settled()` first.

## Specs

`codex-chat-events.spec.ts`

- `:42` — the existing divergent-final case now expects the complete-source delta instead of `[]`.
- `:310` — failed terminal: one `callbacks.error`, result status `failed` with the partial text, `settled()` rejects `CodexChatAdapterError` / `Codex chat turn: cancelled`, and `error()` is not called again.
- `:344` — interrupted terminal: no `callbacks.error`, result status `interrupted`, same rejection.
- `:369` — divergent longer final (`old` → `corrected answer`): one complete-source delta, content callback, completed result text is the final, `settled()` resolves.
- `:413` — divergent shorter final (`hello world` → `hi`): delta is `hi`, result text is `hi`.
- `:451` — success path unchanged: `hel` + final `hello` yields suffix `lo` with `source: 'stream'`, no content callback, completed result `hello`, `settled()` resolves.

## Left for the gateway

No gateway edit was required for the failure signal. A failed or interrupted native turn now rejects the generator, and the existing catch at `gateway-chat-bridge.ts:628-673` sends the same generic reply as a Claude throw.

Divergent final text still needs a gateway change before the sealed reply is the authoritative text. `pumpStream` (`:1100-1102`) appends every `text_delta` and ignores `source`. After this batch the sealed body is the obsolete prefix plus the full final, until `pumpStream` does what the accumulator does: on `text_delta` with `source` `'complete'` or `'history'`, replace the text stored for that `blockIndex`, then join blocks in index order. Do not append `event.delta` in that case. An empty final still emits no event, so a correction to `''` leaves the streamed prefix in the gateway buffer.

## Risks

- The rejection code is `cancelled` so the Electron broadcaster will not add a second error card. It will also log the turn as a user abort and skip Sentry (`chat-stream-broadcaster.service.ts:328-340`). The callback card for a failed terminal is unchanged (`Codex reported a runtime error.`). An interrupted terminal still has no callback card. `CHAT_COMPLETE` is no longer sent for these terminals, because `message_complete` is not yielded. The adapter `finally` still settles the turn: the result callback sets `terminal` before `settled()` rejects (`codex-chat-turn-stream.ts:137-139` and `:270-273`).
- Gateway turn-failure logs and `recordTurnOutcome` will say `Codex chat turn: cancelled` even when the native status was `failed`. The user-facing gateway text stays the generic failure reply.
- A detached drain (`codex-chat-turn-stream.ts:341-347`) awaits `settled()` too. A failed or interrupted terminal there now rejects into the drain catch, which logs and closes the context.
- `codex-chat-events.ts` value-imports `CodexChatAdapterError` from `codex-chat-adapter.ts`. The adapter already value-imports the turn stream, which value-imports these events. The class is only constructed when a terminal arrives, after module init.
- Jest was not run.
