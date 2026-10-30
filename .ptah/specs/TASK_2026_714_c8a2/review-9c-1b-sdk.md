Verdict: REVISE
Score: 6/10

Batch 9c-1b fixes the attached failure classification, the empty correction, the duplicate text callback, and the detached interrupt. A detached native `failed` terminal still misses `settleTurn`, and the new lifecycle case that asserts that settlement fails on this code.

No tests, lint, typecheck, diagnostics, or builds ran. Ptah file-search tools were not connected, so this review used the workspace search and file reads. Skill discovery for this backend review was not required beyond the task contract.

## F5 — Leaf error and public exports

`CodexChatAdapterError`, `CodexChatAdapterErrorCode`, and `isCodexChatAdapterError` live in `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter-error.ts:1-28`. The adapter, events, and turn stream import that leaf. Events no longer value-import the adapter, so the old adapter → turn stream → events → adapter cycle is gone.

The barrel still exports the class, the code type, and `isCodexChatAdapterError` from `libs/backend/agent-sdk/src/index.ts:168-173`, and adds `isWebviewReportedError`. Every other lib or app hit is a barrel import: `gateway-chat-bridge.ts`, `chat-session.service.ts`, `chat-slash-command-router.service.ts`, and the rpc-handlers specs. No `libs/` or `apps/` file deep-imports the class from `codex-chat-adapter.ts`. The constructor still accepts `(code, operation)` and an optional third argument, so existing `new CodexChatAdapterError(code, operation)` call sites stay valid.

## F2 — Attached failed and interrupted turns

A `failed` terminal, or any terminal that carries `error`, rejects with `runtime-failed` and `webviewReported: true` at `codex-chat-events.ts:304-307`. An `interrupted` terminal with no `error` rejects with `cancelled` and leaves `webviewReported` unset at `codex-chat-events.ts:308-309`. `map()` still returns `message_complete`, then `settled()` throws after the callbacks (`codex-chat-events.ts:55-60`). `streamCodexChatTurn` awaits `settled()` before it yields the mapped events (`codex-chat-turn-stream.ts:241-257`), so neither terminal yields `message_complete`. The broadcaster catch is the only `CHAT_COMPLETE` publisher (`chat-stream-broadcaster.service.ts:305-312`), and that catch does not send it.

`CodexChatAdapter.failure` returns an existing `CodexChatAdapterError` unchanged and logs unless the code is `cancelled` (`codex-chat-adapter.ts:768-783`). The thrown object that reaches the broadcaster is still the marked instance. Its message is `Codex chat turn: runtime-failed`, which does not match the abort substrings.

The broadcaster still flushes, logs the real `Error`, captures Sentry, and `forceIdle`s with no abort reason (`chat-stream-broadcaster.service.ts:315-350`). It publishes `CHAT_ERROR` only when the error is neither a user abort nor webview-reported (`chat-stream-broadcaster.service.ts:371-381`). The native card is the existing callback at `codex-chat-event-callbacks.ts:72-78` and `codex-chat-events.ts:339-343`. One card, then idle, and no `CHAT_COMPLETE`. That is the same visible end state as a Claude stream throw: `StreamTransformer` rethrows (`stream-transformer.ts:1161-1203`) and this same broadcaster catch force-idles and publishes the single error card.

An interrupted terminal has no callback card. The broadcaster treats `Codex chat turn: cancelled` as a user abort, logs info, skips Sentry, force-idles with `aborted_streaming`, and publishes no `CHAT_ERROR`. That matches the Claude user-stop branch in the same catch (`chat-stream-broadcaster.service.ts:323-332` and the abort spec at `chat-stream-broadcaster.service.spec.ts:1113-1130`).

On an attached turn the generator `finally` runs `settleTurn()` after the result callback has set `terminalStatus` (`codex-chat-turn-stream.ts:90-103`, `140-142`, `273-276`). A failed status records `{ error: 'unknown', terminalReason: null }` and settles phase `failed`. The broadcaster then `forceIdle`s that same session to phase `idle` with `terminalReason: null`, which is the chunk the webview sees. An interrupted status settles `aborted_streaming`, and the broadcaster force-idles with the same reason. `completedTurn` runs only for a completed result with no error (`codex-chat-turn-stream.ts:143-159`). The generator `finally` calls `sink.endTurn` for both terminals (`codex-chat-turn-stream.ts:277`). The lifecycle spec locks the registry, the failure log, the missing message count, and pending-approval cancel/dismiss (`codex-chat-turn-lifecycle.spec.ts:361-397`, `569-610`; `codex-chat-adapter.spec.ts:233-244`).

`isWebviewReportedError` (`codex-chat-adapter-error.ts:31-35`) is precise. It requires `instanceof Error`, an own or inherited `webviewReported` property, and `=== true`. A plain `Error`, a non-error, a `CodexChatAdapterError` whose marker is `undefined` (every `cancelled` turn), and any other value such as `"true"` or `1` fail the guard. The marker is assigned only for the failed terminal settlement.

## F1 — Complete-source text reaches the webview

`textFinal` no longer calls `callbacks.content` for text. Reasoning finals still do (`codex-chat-events.ts:194-210`). A divergent text final returns one `text_delta` with `source: 'complete'` and `delta` set to the full final (`codex-chat-events.ts:166-176`). That event is not a terminal, so `settled()` resolves and `streamCodexChatTurn` yields it before the later terminal rejection.

`ChatStreamBroadcaster` publishes each yielded event as `CHAT_CHUNK` (`chat-stream-broadcaster.service.ts:169-186`, `264-270`). `StreamDeltaCoalescer.key` ignores every event whose `source` is not `'stream'` (`stream-delta-coalescer.ts:9-18`), so a complete-source delta is not merged into the streamed prefix and is not dropped. A visible tab’s delivery route pushes that same event (`chat-stream-delivery-coordinator.service.ts:164-180`). The accumulator replaces the block when `source` is `complete` or `history`, including when `delta` is `''` (`accumulator-core.service.ts:318-323`, `855-862`). The message builder reads that string back as the block content (`message-node.fn.ts:144-149`). The text callback was redundant on this path. The content callback also returns immediately for empty text (`codex-chat-event-callbacks.ts:85`), so it cannot clear a block; the stream event is the path that can.

The gateway still appends deltas and ignores `source`. That reconciliation is the separate gateway batch and is not scored here.

## F3 — Empty correction

When streamed text is non-empty and the final does not start with it, the projection emits `text_delta` / `source: 'complete'` / `delta: ''` on `block()` for that same item (`codex-chat-events.ts:156-176`, `329-336`). `block()` returns the index already stored for the streamed delta. An empty final with no streamed text takes the suffix branch because every string starts with `''`, the suffix is empty, and no block index is allocated (`codex-chat-events.ts:178-188`). The next real text block is still index 0. Specs: `codex-chat-events.spec.ts:446-494`.

## F4 — Detached interrupt, and the failed-terminal miss

The drain catch settles only an `interrupted` terminal whose rejection is `CodexChatAdapterError` with code `cancelled` (`codex-chat-turn-stream.ts:344-358`). That path calls `settleTurn()`, sets the drain-local `terminal` flag, and returns. The cleanup log and `deps.close` do not run. `settleTurn` for `interrupted` is phase `idle` with `aborted_streaming`. Any other rejection is rethrown into the log-and-close catch (`codex-chat-turn-stream.ts:368-380`). The predicate does not swallow an unrelated failure.

A detached `failed` terminal is the expected projection rejection, and this code treats it as a drain fault. See finding 1.

## Specs

The events specs lock `runtime-failed` plus the marker, `cancelled` for interrupt, no text `content` callback, longer and shorter replacement, empty replacement on block 0, no block for empty final-only text, and the unchanged prefix suffix (`codex-chat-events.spec.ts:302-534`). Those assertions fail on the 9c-1 code, which rejected with `cancelled` and emitted no empty correction.

The attached lifecycle cases fail on the old generator because `settled()` used to resolve and the iterator used to yield `message_complete` (`codex-chat-turn-lifecycle.spec.ts:361-397`). The broadcaster case fails on the old catch because a non-abort `Error` used to publish `CHAT_ERROR` (`chat-stream-broadcaster.service.spec.ts:1054-1081`).

Changed production and spec lines in this batch have no `any`, `as unknown as`, `@ts-ignore`, or `eslint-disable`. `expect.any(Error)` in the lifecycle spec is Jest’s matcher. The new cases do not assign readonly mock fields. The detached test’s `setImmediate` is awaited; this file does not turn on fake timers. The pre-existing `as unknown as` casts in `chat-stream-broadcaster.service.spec.ts` are outside the new case.

## Findings

1. **Serious — A detached `failed` terminal never records the failure, and the new spec fails on this code.** `drainInterruptedTurn` maps the terminal and `projection.settled()` throws `runtime-failed` before the `message_complete` check at `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:344-363`. The catch accepts only `interrupted` + `cancelled`, then rethrows. The outer catch logs `detached turn cleanup` and closes the context at `codex-chat-turn-stream.ts:368-380`. The drain-local `terminal` flag stays false, so `finally` force-idles with `aborted_streaming` at `codex-chat-turn-stream.ts:381-382`. The registry therefore ends `idle` / `aborted_streaming`, and the context is closed. The attached failed path does the opposite: `settleTurn()` records phase `failed` and does not close. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:547-554` expects phase `failed` and `terminalReason: null` for this case, so that `it.each` row fails. Fix: in that same catch, when the event is a `failed` terminal and `isCodexChatAdapterError(error)` with `error.code === 'runtime-failed'`, call `settleTurn()`, set the drain `terminal` flag, and return. Do not log and do not call `deps.close`. Re-throw every other error so an unexpected drain failure still logs, closes, and force-idles.
