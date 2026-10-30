# Review 8r-1

Verdict: REVISE
Score: 5/10
Review family: grok (reviewer) / codex (implementer)

Scope is the uncommitted diff under `codex-app-server`, `chat/streaming`, and `chat/codex-host` (the 11 files named in `batch-8r-1-report.md`). `chat/session/*` was not reviewed as this batch. Tests, typecheck, lint, and diagnostics were not run. The bundled Grok `review` skill is a GitHub/scratch orchestrator and was not executed; this file is the assigned deliverable.

## Defects

1. **Blocker — a bound Codex tab still gets zero transcript error cards.** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:132` and `libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-event-callbacks.ts:164`.

   On a failed terminal the projection wrapper calls `callbacks.error(message, workspaceId)`. The host callback publishes `SESSION_TURN_FAILED` with `error: 'unknown'`, `errorDetails: 'Codex reported a runtime error.'`, `terminalReason: null`, and `cwd` set to `workspaceId`. The same shape is used on the pre-receipt catch at `codex-chat-turn-stream.ts:326`. The thrown `CodexChatAdapterError` sets `webviewReported: true` (`codex-chat-events.ts:305`, `codex-chat-turn-stream.ts:334`), so `chat-stream-broadcaster.service.ts:372` does not also publish `CHAT_ERROR`.

   The renderer does not turn that push into a transcript card. `turn-end-handler.service.ts:263` stamps `lastTerminalReason` (here `null`) and calls `handleChatError({ sessionId, error })` with no `tabId`. `chat-lifecycle.service.ts:202` only `console.error`s `[ChatStore] Chat error:`, drops the queue, and refreshes the sidebar. `settleFailedSessionStart` (`chat-lifecycle.service.ts:273`) requires `tabId`, and `markSessionStartFailed` (`tab-manager.service.ts:1300`) appends the notice only for an unbound tab that is still `streaming` with no `claudeSessionId` and no `streamingState`. A live Codex chat is already bound, which is the gap-3 case. `turn_state` with `phase: 'failed'` clears the spinner (`status: loaded`). The attention rail may upsert `Session failed: {tab title}` from the phase alone; that row is not the transcript error card and does not include the Codex sentence. Live test gap 3 already logged `[ChatStore] Chat error:` and counted 0 cards.

   This is one publication, not two. `message_complete` is skipped when `terminalError` is set (`codex-chat-turn-stream.ts:280`), so the broadcaster does not take the normal-exit `chat:complete`. `forceIdle` is skipped when the phase is already `failed` (`chat-stream-broadcaster.service.ts:345`). The 99a49b4e8 second-card suppression still holds. The remaining miss is the first card.

   Fix, still in the backend translation layer: emit one stream event the existing finalizer already keeps as a single assistant transcript notice (the same shape `markSessionStartFailed` appends for an unbound start). Keep `webviewReported` so `CHAT_ERROR` stays suppressed. Do not put the visible sentence only on `SESSION_TURN_FAILED`. Specs that assert one callback publication do not prove a bound-tab card.

2. **Major — "not ready" is detected by message text, and closed and opening share that sentence.** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:726` matching `libs/backend/codex-runtime/src/lib/codex-context.ts:463`.

   `assertOpen` throws a plain `Error('Codex context is not ready')` when `state` is `'closed'` or `'opening'`. The adapter maps that exact `error.message` to `CodexChatAdapterError('unavailable', 'permission')`. `native-session-controls.ts:192` then deletes the control state, saves the requested level, and returns `{ timing: 'nextTurn', revision: 0 }`. Any other error is rethrown and the level is not saved, so arbitrary failures still surface.

   Exact equality is not a substring scan, but it is message-text matching of an untyped error. A reword of `assertOpen` stops the no-live-session result. A session that is still `'opening'` takes the same branch and persists the level without applying the live toggle. G6 asked for a typed closed/not-ready error only.

   Fix: throw a typed context error from `codex-runtime` (distinct code or class for closed versus opening). Map only the closed code in the adapter. Leave `native-session-controls.ts:192` as the consumer of `unavailable` + `permission`.

3. **Major — failure settlement waits with no timeout on the error-presentation promise.** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts:55` and `codex-chat-turn-stream.ts:272` and `:326`.

   `settled()` awaits `Promise.all` of tracked callbacks, then throws `streamFailure`. On a failed terminal that await runs before the failed `turn_state` yield. If `publishTerminal` / `broadcastMessage` never settles, the generator never yields the failed phase, never throws, and never reaches `close()`. `session.busy` stays true and the sessions-map entry stays. `interruptSession` (`codex-chat-adapter.ts:654`) only returns immediately when the entry is gone or not busy; an interrupt does not resolve the callback promise, so Stop does not unblock the generator. The gateway `for await` does not throw, so `gateway-chat-bridge.ts:613` does not send the failure reply until the turn watchdog. On the pre-receipt catch the `turn_state` is yielded first, then the same unbounded `await` sits in front of `close()`.

   The host `safe()` swallows a rejection, so a throwing callback does not replace `streamFailure`. It still awaits. There is no timer on `pending`.

   Fix: do not hold the failed `turn_state`, `close()`, or the generator throw on an unbounded callback. Race the presentation with a timeout, or publish it without awaiting it before retirement. `close()` is already idempotent (`codex-chat-adapter.ts:613`) once it is reached: the map entry is deleted first and a second close reuses `session.closing`.

## Verified

**G2 follow-up echo does not create a second user bubble.** After `startTurn` receipt, one user `message_start` is yielded (`codex-chat-turn-stream.ts:217`): `messageId` and `clientMessageId` are the client id (`msg_${Date.now()}_…`), `source: 'complete'`, no `text_delta`, no user `message_complete`. `clientMessageId` is parsed with `z.string().min(1)`, stripped before `prepareProfile` (`codex-chat-adapter.ts:252`), and is not copied onto `startTurn` input. Unknown send-option keys throw. `consumedClientMessageId` is attached on the success `turn_state` (`:302`), the failed-terminal `turn_state` (`:286`), and the pre-receipt catch `turn_state` (`:320`) whenever the id is defined and `settleTurn` returns a snapshot.

The renderer reconciles that echo. `acknowledgeUserPrompt` no-ops because the client id is not a line UUID and `message.id` already equals `clientMessageId`. `queuedPrompts.remove` still runs. Inbound-peer bubbles are minted only on a root `message_complete`, which this echo does not emit. The execution-tree builder does not turn a `role: 'user'` root into an assistant node. An empty final tree does not mint an assistant card. A duplicate `message_start` for the same `messageId` does not push `messageEventIds` a second time.

The echo `messageId` is the client id. Claude's echo `messageId` is the transcript uuid, and history reload reads Claude JSONL (`msg.uuid`). This event is not persisted, and `nativeUuid` is never stamped. There is no second bubble today. A later Codex history path that replays a different user-item id beside the retained `msg_*` bubble would diverge. No `retirementOnly` prompt-only event was added; consumption rides the terminal `turn_state` above.

**G3 terminals and gateway, aside from defect 1 and defect 3.** Failed and interrupted terminals skip `message_complete` and then throw, so a clean generator return is not what publishes `chat:complete`. An interrupt throw is `cancelled` without `webviewReported`; the broadcaster treats `cancelled` as a user abort (`chat-stream-broadcaster.service.ts:323`) and does not publish `CHAT_ERROR`. `forceIdle` still runs because the interrupted phase is idle, which is an extra idle `turn_state`, not a second card. Before any yield, `eventCount === 0` also calls `endSession`; after the user echo, retirement is the stream `close()`. `endSessionIfTokenMatches` still returns false, so a normal turn end does not close the native thread. Stop after `close()` has deleted the map entry is a no-op (`interruptSession` returns at `codex-chat-adapter.ts:655`). Stop during the hang in defect 3 is not.

Gateway turns use the same adapter. `tryFallbackStart` returns immediately for a native Codex binding (`gateway-chat-bridge.ts:955`). A throw from the generator leaves `pumpStream` and the turn catch sends one generic failure reply (`:621`). `message_complete` is not a gateway flush. That reply is delayed for the whole callback await in defect 3, then the watchdog sends it.

**G6 consumer.** Only `unavailable` + `operation === 'permission'` persists the level and returns revision 0. Other errors rethrow. The producer is defect 2. `failure()` still logs the unavailable error at error level before the controls treat it as a successful persist.

**Standards in the added lines.** No new `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable` in the production files of this diff. Added spec lines use `expect.any(Error)` and `Object.defineProperty` for the readonly `webviewReported` mock. Specs that load tsyringe already start with `import 'reflect-metadata'`. No new real timer. Pre-existing `as unknown as`, `eslint-disable`, and `setTimeout` in those specs are outside the added lines. `AgentSessionStartConfig` does not declare `clientMessageId`; the start path uses `'clientMessageId' in config`. Typecheck was not run. The abort listener is removed in the stream `finally`. The map entry leaks only when `close()` never runs (defect 3).

**Frontend was read and not changed.** Claude behaviour is untouched by this diff. MCP is not stripped. No second proxy was added.
