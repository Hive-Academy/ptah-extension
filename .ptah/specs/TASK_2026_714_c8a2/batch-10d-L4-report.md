# Batch 10d.L4 report

## Changes

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts:5-101` adds a bounded, per-session FIFO for peer messages. Each send settles at native turn admission; the next message starts only when the prior turn releases. Session closure or a blocked release rejects waiting messages with `unavailable` and logs each rejection through the injected logger. A full queue refuses with coded `busy`.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:554,586-604,638-640` routes peer-origin sends through the queue, preserves their `inboundPeer` label, keeps non-peer busy sends on the existing refusal path, and rejects pending peers on close.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:106,436-446` notifies the queue only after the native turn releases its busy latch, including the pre-release blocked state.

## Decisions

- Claude's `SdkAgentAdapter.sendMessageToSession` delegates to `SessionLifecycleManager` (`sdk-agent-adapter.ts:1806-1827`). Its stream pump appends a message to `session.messageQueue` even while `turnInFlight` (`helpers/session-lifecycle/session-stream-pump.service.ts:224-289`), then shifts one FIFO item only when no turn is in flight (`:73-88`). An explicit `require-idle` admission is refused instead (`:236-252,269-275,298-316`). Native Codex now follows the ordinary peer-send behavior.
- Codex's `publishUntilAdmitted` resolves at `CodexChatAdmission.accepted()` after the `turn/start` receipt and observes late publisher failures (`codex-chat-admission.ts:24-69`; `codex-chat-turn-stream.ts:155-163`). Queue advancement must wait for turn release separately; admission alone would start two turns concurrently.
- The protocol includes `turn/steer` (`codex-runtime/src/lib/protocol/codex-app-server-protocol.schema.json:26550-26591`), which targets an expected active turn ID. It cannot produce the separate next-turn peer row required here. The backend FIFO therefore uses `turn/start` for each peer message.
- User-typed messages during a busy turn still receive the existing coded `busy` refusal. The queue applies only to peer-origin messages. A user send in the narrow interval reserved for a queued peer turn also receives `busy`, preserving FIFO order.

## Specs

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:340-464` adds cases for a busy-turn peer message and its peer row, two queued messages in order, closure rejection plus logger call, and full-queue refusal. The adapter-level cases exercise the notifier's `sendMessageToSession` boundary; no notifier-specific spec was needed.

## Not done

- Tests, typecheck, lint, build, verify, Nx, npm and diagnostics were not run, as the task explicitly prohibits them. No real Codex process or network call was started.
- No invocable matching skill was available through this CLI's listed tools. Ptah skill search returned no local matching skill; marketplace entries were not invocable.
