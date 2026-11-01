# Batch 8r-6 — G9 Codex follow-up admission

## Admission point and decision

`sendMessageToSession` now resolves when `startTurn` returns its accepted `turn/start` receipt and the session records `turnId` (`codex-chat-turn-stream.ts:151-160`). This is the earliest point at which a native turn exists and a `turn/start` rejection is known. The host broadcaster has attached its stream before it pulls that receipt (`chat-stream-broadcaster.service.ts:153,206-207`). The publisher keeps draining in the background. Its completion handler observes late rejections and logs them through the injected `Logger` (`codex-chat-admission.ts:35-53`).

Before the receipt, busy/unavailable checks, message option validation, publisher failures, and `startTurn` refusals still reject the send. The stream reports a `startTurn` failure to the admission promise even when the host broadcaster consumes the stream exception (`codex-chat-turn-stream.ts:384-394`). `publish` also reports a publisher rejection before its `finally` awaits `iterator.return()` (`codex-chat-adapter.ts:490-502`). The fallback for a publisher that exits without consuming the turn is a typed `runtime-failed` admission rejection.

The running native follow-up now reaches `continueSession` as `{ success: true, sessionId, enqueued: true }`; a turn that finished before that reply reaches the existing pre/post `nativeFollowUp` streaming checks and returns `settled: true` (`chat-session.service.ts:1290-1309`). The resumed native-turn branch also returns `enqueued: true` while its stream is attached, or `settled: true` after exit (`chat-session.service.ts:1254-1259`). Its old awaited-publish comment was corrected.

## Files changed

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-admission.ts:1-54` — small admission promise and observed background publisher; keeps the adapter's new logic outside its already large class.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:483-502,527-549,549-579` — optional admission signal threaded through `publish`/`turn`; only `sendMessageToSession` waits for admission. `iterator.return()` remains in `finally` on every publisher path.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:106,151-160,384-394` — signal acceptance after the receipt; signal a typed pre-admission rejection after the existing failure notice and terminal state path.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1254-1259,1290-1309` — explicit `enqueued` for a running resumed turn and corrected live-follow-up comment; retain the 8r-5 settled check.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:259-392` — wait for publication in the old event-collection case; add open-stream, swallowed pre-admission refusal, and late publisher rejection specs. Other assumptions that awaited a complete send now wait for the native session to become idle (`:815,1176-1189,1818`).
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:452-466` — wait for complete publication before inspecting final turn-state events.
- `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-codex-resume-once.spec.ts:180-315,384-386,426-468` — integrate a real Codex adapter with a held native stream and assert the RPC replies `enqueued` before release; update the resumed-running expectation and fast-settlement comment.

## Publish callers and host consumers

| Caller | Resulting behavior |
| --- | --- |
| `CodexChatAdapter.sendMessageToSession` (`codex-chat-adapter.ts:549-579`) | Await `turn/start` admission only. A pre-admission error rejects; the publisher continues, with late rejections observed and logged. |
| Approval replacement `post` (`codex-chat-adapter.ts:464-471`) | Still awaits the original `publish` for the whole turn. Active-turn replacement still calls `steer`. |
| Initial `open` and `resumeSession` (`codex-chat-adapter.ts:212-245,290-293`) | Return an `AsyncIterable`; their consumer owns draining. They never call the private `publish`. |
| Host `ports.publish` (`codex-chat-host-ports.ts:447-448`) | Still returns the full `streamEventsToWebview` promise. The broadcaster's event, notice, terminal, and cleanup behavior is unchanged. |
| Gateway (`gateway-chat-bridge.ts:793-800,847`) | Uses `resumeSession`/`startChatSession` streams and retains whole-turn stream consumption; it does not call live send. |
| CLI/lane callers (`agent-report-router.service.ts:341,502`, `chat-ptah-cli.service.ts:277`, `peer-session-messenger.service.ts:128`) | `sendMessageToSession` is an acceptance/dispatch operation; none reads a turn result from its resolved value. `origin` options used by lane reports remain rejected by Codex option validation. Their stream-consuming paths keep full-turn behavior. |

Claude is unchanged: no Claude adapter, RPC contract, renderer, or frontend transport was edited. The 8r-5 `nativeFollowUp` check applies only when the native router accepts a streamless follow-up. Claude still uses its long-lived attached loop and returns the existing `enqueued` reply.

## G3 and regression specs

For a process kill after admission, the RPC has already replied `enqueued`. The native stream still yields one failure notice and a terminal `failed` turn state; the unchanged broadcaster suppresses its second `chat:error` for `webviewReported`. The renderer's terminal turn-state path settles the tab. If the turn has exited before the reply, `settled: true` prevents the renderer from re-arming it. No `forceIdle` or MCP behavior was changed. This follows the root-cause and settled-reply analysis in `review-8r-5.md` and `review-8r-5-revise-1.md`.

The adapter open-stream spec fails on the old awaited code because its race returns `held` while the stream is gated. The swallowed-refusal spec fails on the old code because the broadcaster consumes the thrown stream error and the old send resolves. The late-failure spec fails on the old code because send does not resolve before release, and after release the old send rejects rather than logging a detached publisher failure. The RPC spec uses the real adapter, so the old awaited send holds `chat:continue` until the gate releases; its race returns `held` rather than `enqueued`. Every gate, publisher, reply, and immediate tick is released or awaited before these specs end.

## Coordinator verification

Lane rules prohibited running tests, lint, typecheck, builds, Nx, npm, diagnostics, or any verification target. No such command was run. The coordinator should verify the changed `@ptah-extension/agent-sdk` and `@ptah-extension/rpc-handlers` projects, then dependent `@ptah-extension/gateway-chat-bridge`, `@ptah-extension/cli-agent-runtime`, `@ptah-extension/cli-engine`, `ptah-electron`, `ptah-cli`, `ptah-tui`, and `ptah-extension-vscode` as appropriate for their available test/typecheck/lint targets. In particular, run the two changed Jest specs in agent-sdk and the changed Codex continue spec in rpc-handlers.

The local `agent-lanes` skill was read and followed for this lane report. This CLI exposed no dedicated skill invocation tool; skill discovery used the workspace's `SKILL.md` file. Ptah workspace analysis, AST, search, and dependency tools were available and used for read-only inspection. No diagnostics tool was called.
