# Review 8r-5

Verdict: REVISE

Score: 4/10

Review family: grok (implementer: codex)

## Root cause assessment

`failed` is a settling phase. `TabManagerService.applyTurnState` maps both `idle` and `failed` to `status: 'loaded'`, removes the tab from the spinner set, and clears the abort controller (`tab-manager.service.ts:1896-1917`). `TurnStateApplier` finalizes the in-flight message before that write (`turn-state-applier.service.ts:127-157`). `isTerminalTurnPhase` includes `failed`, so a bound tab also accepts a stale `failed` revision through the terminal heal (`tab-manager.service.ts:2064-2070`). Claude uses the same applier. Nothing here ignores `failed` only for Codex.

The live transcript matches that path, not a dropped `failed` event. The assistant notice is a finalized message. The empty skeleton renders only when `streamingCount === 0` and `isStreaming` (`chat-transcript.component.html:164-180`). `isStreaming` is `status === 'streaming' || status === 'resuming'` (`chat-transcript.component.ts:456-458`). `streamingCount` is the live tree length (`chat-transcript.component.ts:584-598`). A notice that is still in `streamingState` would hide that skeleton. The observed skeleton means the notice was finalized and the tab was then put back on `streaming`.

That re-arm is `chat:continue` success handling. Codex `publish` awaits `streamEventsToWebview` (`codex-chat-host-ports.ts:447-448`). The broadcaster catches the rejection and does not rethrow, so `sendMessageToSession` resolves. `continueSession` then returns `{ success: true, sessionId, enqueued: true }` (`chat-session.service.ts:1286-1292`). The log line `RPC: chat:continue success` is that return, after the four events. The renderer then always does this when the payload is not `settled: true` (`message-sender.service.ts:877-882`):

- `sessionManager.setStatus('streaming')`
- `tabManager.markStreaming`
- `tabManager.markTabStreaming`

`markStreaming` sets `status: 'streaming'` (`tab-manager.service.ts:1786-1794`). Stop and the disabled Send both follow `isTabBusyGenerating` / `inputEnabled` from that status (`chat-input.component.ts:684-724`). `handleChatError` does not settle the tab (`chat-lifecycle.service.ts:190-196`); the `[ChatStore] Chat error` line is the `session:turnFailed` presentation from the Codex callback, which arrived while `deps.close` was still in progress (`codex-chat-turn-stream.ts:364-379`).

The `failed` chunk is yielded before that close. Its frame can run during the close, finalize the notice, and set `loaded`. The RPC reply is later and calls `markStreaming` with no further chunk in the pre-fix run. The tab stays on the skeleton. The same re-arm does not stick on a normal Codex exit when the terminal `turn_state` is still queued on the focused-tab `requestAnimationFrame` (`stream-flush-scheduler.service.ts:36-38`, `60-77`) at the moment the reply runs, so that frame applies `loaded` after `markStreaming`.

The new `forceIdle` is flushed in the catch, still inside the awaited broadcaster, still before `continueSession` returns (`chat-stream-broadcaster.service.ts:349-360`, clear in `finally` at `472-473`). It uses the same session and tab and a newer revision. It releases the tab only when that chunk is still unapplied when `markStreaming` runs, and a later frame applies it. `finally` awaits `settle`, `endSessionIfTokenMatches`, and the session-ended broadcast (`chat-stream-broadcaster.service.ts:399-486`). Any of those can yield long enough for the focused frame to apply the idle first. `markStreaming` then sticks again. This is the same hole as the early `failed` event, moved later. It is not a mis-addressed `failed` (same `tabId` / `sessionId`). It is a second terminal event racing a success handler that treats a finished Codex turn as an in-flight enqueue.

Claude is unchanged. `isWebviewReportedError` is true only for an `Error` whose `webviewReported` property is `true` (`codex-chat-adapter-error.ts:31-35`). The only production throw that sets it is the non-interrupt Codex wrap (`codex-chat-turn-stream.ts:383-387`). A Claude rejection still takes the old `phase !== 'failed'` branch. A Claude `sendMessageToSession` returns while its broadcast loop is still the consumer, so `enqueued: true` plus `markStreaming` is the live-turn signal. Codex publish is the loop, and it has already exited.

## Defects

1. `chat-stream-broadcaster.service.ts:349-358` (severity: high). The catch now pushes `forceIdle` for every `webviewReported` rejection, including when the registry is already `failed`, and flushes it before `streamEventsToWebview` resolves. `continueSession` still returns `enqueued: true` after that await (`chat-session.service.ts:1286-1292`), and `runContinueConversation` then sets the tab back to `streaming` (`message-sender.service.ts:877-882`). Failure: process kill mid-`chat:continue`, as in `app-run2.log:1135-1187`. The notice finalizes, the idle is painted during `finally`, then the success reply shows the empty skeleton, Stop, and a disabled Send. The 35s R3 stuck state is this re-arm. The new chunk does not remove it. The translation-layer signal that already skips the re-arm is `settled: true` (`message-sender.service.ts:867-875`). This batch does not return it.

2. `chat-stream-broadcaster.service.spec.ts:1054-1102` (severity: moderate). The new spec fails on the old broadcaster: with the registry already `failed`, the old catch emits no second `turn_state`, so the length-5 and `phase: 'idle'` expectations fail. It still goes green while G3 remains. It never asserts the `chat:continue` payload, and the harness does not run `markStreaming` after the stream resolves. A fifth chunk is not the composer gate.

## Notes

- Ordering when the idle does get applied: one catch-path `forceIdle`, then `finally` sees `idle` rather than `generating` and does not push another (`chat-stream-broadcaster.service.ts:395-397`). User abort is unchanged. A cancel throw does not set `webviewReported`, so a `failed` registry still skips the catch idle, and a non-failed abort still passes `aborted_streaming`. The flag and an abort substring do not occur together on the current Codex errors.
- Same session and tab: the yielded `failed` event and `pushTurnState` both use the stream session id (`chat-stream-broadcaster.service.ts:201-205`, `349-358`). The registry `clear` stays after that flush (`472-473`). The idle snapshot is already built, so the clear does not rewrite it.
- If both terminal chunks apply in one frame after the re-arm, `failed` emits the error pulse while status is still `streaming`, then `idle` sees `loaded` and does not emit a second pulse (`tab-manager.service.ts:1869-1876`). Liveness moves from `markFailed` to `markIdle` when the second event is accepted (`turn-state-applier.service.ts:279-283`). The transcript notice is unchanged because `CHAT_ERROR` stays suppressed for `webviewReported`.
- The report's "Next turn after the fix" (`batch-8r-5-report.md`, `tab-manager.service.ts:1851-1912` and `chat-session.service.ts:1918-1956`) describes the idle write and a later resume. It does not account for `message-sender.service.ts:877-882`. Send stays disabled while that re-arm holds. The resume lines are not reached from the composer.
- Spec style at the new test: no `any`, `as unknown as`, `ts-ignore`, `eslint-disable`, `console`, readonly mock assignment, or bracket access to privates. `chunk['event']` matches the existing payload helper. `Object.defineProperty(..., 'webviewReported')` satisfies `isWebviewReportedError`. The pre-existing `as unknown as` at `chat-stream-broadcaster.service.spec.ts:1214` is outside this edit.
- No skill was loaded. `ptah_*` search returned no connected `ptah` server (only `tasks`). Reads used the workspace search and file tools.
