# Review 8r-5 coordinator correction

Verdict: REVISE

Score: 8/10

Review family: independent read-only review

## Defects

1. `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-codex-resume-once.spec.ts:277-280` (severity: moderate). `finishBroadcast` has the inferred type `() => undefined`. The assigned closure `() => resolve()` returns `void`. Under strict TypeScript, `void` is not assignable to `undefined`, so this spec does not type-check. Declare the variable as `() => void` and use an empty body, or assign the resolver directly.

2. `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-codex-resume-once.spec.ts:281-295` (severity: moderate). The still-running spec deadlocks on the held-reply regression that it must detect. If `continueSession` again awaits `streamEventsToWebview`, the service waits for `finished` while the test waits for the service. The `finally` block cannot run until that await finishes. Jest therefore reports a timeout instead of the reply mismatch, and the unresolved test leaves the broadcast and continue promises pending. Release the deferred broadcast through cleanup that also runs after a timed-out test, and make the non-waiting assertion terminate without relying on that release order.

## Production checks

### Resume timing and settled replies

The resume path is back to its pre-batch fire-and-forget timing at `chat-session.service.ts:1965-1972`. The committed version also called `streamEventsToWebview` without `await`.

The broadcaster adds the session id synchronously at `chat-stream-broadcaster.service.ts:153`. Its first await is the asynchronous iteration at `chat-stream-broadcaster.service.ts:207`. A just-started resumed turn therefore reads `isStreaming(sessionId) === true` when `continueSession` later checks it.

The reply selection at `chat-session.service.ts:1254-1260` is correct for the two intended cases:

- A running resumed turn returns `{ success: true, sessionId }`. The renderer arms streaming and the terminal chunk settles it.
- A turn whose broadcaster has exited returns `{ success: true, sessionId, settled: true }`. The renderer does not re-arm the ended turn.

The resume broadcaster is keyed by the real session id at `chat-session.service.ts:1967-1971`, so the prompt-delivered branch checks the correct key.

### G3 on the live path

G3 remains fixed for a process kill during a live Codex `chat:continue`.

- `nativeFollowUp` is captured before the send at `chat-session.service.ts:1290-1293`.
- Codex `sendMessageToSession` awaits `publish` at `codex-chat-adapter.ts:545-567`.
- `publish` awaits the broadcaster at `codex-chat-adapter.ts:483-497` and `codex-chat-host-ports.ts:447-448`.
- The broadcaster consumes the reported failure without rethrowing at `chat-stream-broadcaster.service.ts:315-383`.
- The broadcaster deletes the streaming id before its promise resolves at `chat-stream-broadcaster.service.ts:393-395`.
- The post-send check then returns `settled: true` at `chat-session.service.ts:1304-1310`.

The renderer therefore does not re-arm the tab after the Codex failure notice and terminal failed state.

### Remaining live-path timeout exposure

The live-path exposure is pre-existing. `git show HEAD:libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts` already contains the same `await this.sdkAdapter.sendMessageToSession(...)`; it is unchanged at current `chat-session.service.ts:1294-1298`.

The exact remaining consequence applies to a live native Codex turn that runs for more than 120 seconds:

1. `chat:continue` uses the admission timeout at `claude-rpc.service.ts:150-154`. The budget is 90 seconds plus 30 seconds at `rpc-chat.types.ts:33-48`.
2. The renderer deletes the pending call and returns `RPC timeout: chat:continue` at `claude-rpc.service.ts:173-184`. The later host reply is dropped.
3. `message-sender.service.ts:849-865` rolls back the prompt boundary and marks the tab loaded while the host turn continues.
4. `message-dispatch.service.ts:250-251,418-429` appends an assistant bubble with `Message delivery failed. RPC timeout: chat:continue`.

This is a false delivery failure, not cancellation of the Codex turn. The correction intentionally leaves this separate gap unchanged.

### Claude behavior

Claude remains unchanged. `promptDelivered` is restricted to Codex at `chat-session.service.ts:1974-1977`. The live native settled branch also requires no attached stream and router admission at `chat-session.service.ts:1290-1293`. Claude keeps its broadcast loop attached and returns the existing `enqueued: true` reply at `chat-session.service.ts:1311`.

## Spec notes

- The exact reply assertions distinguish running, ended, and Claude replies. The ended-resume spec fails on the old non-settled resume reply.
- The passing implementation resolves the deferred broadcast in `finally`. Defect 2 concerns cleanup when the held-reply regression prevents that block from running.
- The new specs contain no explicit `any`, `as unknown as`, `ts-ignore`, readonly mock assignment, private bracket access, or real timers.
- No production defect was found in the coordinator correction itself.

## Verification limit

Per lane rules, I did not run tests, typecheck, lint, builds, Nx, or diagnostics. The TypeScript finding is from static type analysis of the shown expressions.
