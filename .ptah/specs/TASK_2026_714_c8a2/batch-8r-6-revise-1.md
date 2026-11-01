# Batch 8r-6 revise 1

## Fixes

1. **Running resume prompt:** `chat-session.service.ts:1252-1260` returns `{ success: true, sessionId }` while a resumed Codex turn is running. Resume does not forward `clientMessageId`; omitting `enqueued` makes `message-sender.service.ts:877-879` retire the pending prompt. An already ended resume still returns `settled: true`. The resumed-turn assertion at `chat-continue-codex-resume-once.spec.ts:458-483` now expects the plain success payload and awaits its `setImmediate` sentinel in `finally`.

2. **Refused turn/start:** `codex-chat-turn-stream.ts:353-398` still yields the existing failure notice and failed turn state, then marks a chat consumer's pre-admission failure as `ended`. `codex-chat-admission.ts:4-70` waits for the publisher to finish before resolving that admission. This makes `chat-session.service.ts:1302-1309` observe a detached stream and return `{ success: true, sessionId, settled: true }`. The renderer keeps the user bubble and displays the single streamed notice, then leaves the tab idle. This retains the prior UI outcome without a frontend Codex branch. A rejected publisher still rejects the admission; gateway consumers and interrupted pre-admission turns retain their rejection path. The accepted `turn/start` path still resolves immediately while publishing continues.

## User-visible timing

| Timing | RPC reply | Renderer outcome |
| --- | --- | --- |
| Chat `turn/start` refused before admission, notice published | `success: true`, `settled: true` | User bubble retained; one notice card; idle. No delivery-failure bubble. |
| Process killed after admission | The send has already succeeded with `enqueued: true` | Failed terminal turn state settles the tab; one notice; no second `chat:error`. |
| Turn ended before the reply | `success: true`, `settled: true` | Stream remains settled and tab idle. |
| Live turn still running | `success: true`, `enqueued: true` | Streaming stays armed until terminal turn state. |
| Resumed turn still running | `success: true`, no `enqueued` flag | Streaming is armed and the pending prompt is retired immediately. |

Claude's follow-up path is unchanged: `nativeFollowUp` is gated by `acceptsFollowUpWithoutStream` in `chat-session.service.ts:1290-1293`, and the Codex-only resumed `promptDelivered` path remains separate.

## Specs

- `codex-chat-adapter.spec.ts:333-353` now checks that a broadcaster which consumes a `turn/start` refusal paints one notice before the send resolves. It fails with the prior rejected admission.
- `chat-continue-codex-resume-once.spec.ts:180-353` uses the real adapter for a refused live follow-up, checks the `settled` RPC reply, one failure notice, one failed turn state, and no extra chat error. The current pre-revision code returns `CODEX_RUNTIME_FAILED`, so this case fails there. The existing open-stream case still checks `enqueued` while publishing continues.
- `chat-continue-codex-resume-once.spec.ts:458-483` checks the running resume's plain success payload and drains its sentinel timer in `finally`.

No tests, lint, typecheck, build, Nx command, or diagnostics were run, as the lane rules prohibit them. The coordinator should verify the changed `agent-sdk` and `rpc-handlers` projects and the Electron, gateway, and CLI consumers listed in the batch 8r-6 report.
