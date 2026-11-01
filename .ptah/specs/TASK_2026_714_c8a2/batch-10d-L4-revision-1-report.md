# Batch 10d.L4 revision 1 report

## Changes

- **Minor 1 — require-idle:** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:587-590` refuses a peer send with coded `busy`/`turn` if the session is busy or any peer entry is reserved or queued. It does not enqueue that send.
- **Minor 2 — start race:** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts:83-104` restores an unadmitted entry to the queue head when `turn()` reports coded `busy`. It retains the original promise and clears a stale idle notification before retrying after the competing turn releases. The next peer cannot overtake it.
- **Minor 3 — Stop:** `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.ts:27-29,42-53,69-76` accepts peers while a recoverable Stop temporarily blocks the turn and preserves already queued peers. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:437-445` clears the transient block before notifying the queue; `codex-chat-adapter.ts:554` passes that notification. Permanent close/abort still rejects pending peers with the existing coded `unavailable` error and logger call (`codex-chat-peer-queue.ts:56-66`).
- **Minor 4 — peer row:** No production change. The existing peer row is emitted with `source: 'complete'`, `role: 'user'`, and `inboundPeer` in `codex-chat-turn-stream.ts:257-269`; the assertion is pinned in `codex-chat-adapter.spec.ts:370-373`.

## Decisions

- Claude's ordinary `sendMessage` appends to `session.messageQueue` during an active turn (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:224-289`), and the pump only shifts queued work when no turn is in flight (`:73-88`). Its `require-idle` path rejects a busy turn or a nonempty queue (`:236-250,269-275,298-316`). The Codex peer path now makes the same admission decision.
- Claude's user interrupt calls `query.interrupt()` and releases the turn claim without ending the session or clearing `messageQueue` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:88-98,103-158`). The Claude spec explicitly verifies that a held entry remains after interrupt (`session-control.service.spec.ts:130-148`). Therefore Codex peers queued before or arriving during a recoverable Stop survive and start after release. If interrupt is refused and the Codex context closes, pending peers are rejected as unavailable (`codex-chat-session-controls.ts:128-142` and `codex-chat-adapter.ts:638-640`).
- The queue's active entry remains owned until both native admission and release. Retrying only a `busy`/`turn` rejection keeps other failures visible and prevents a second peer turn from starting concurrently.

## Specs

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:370-373,410-453` pins the full queued peer row and refusal of `require-idle` while a turn runs or a peer turn is reserved on an otherwise idle session.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-peer-queue.spec.ts:14-109` covers a competing turn taking the latch, FIFO retry without duplication, a stale idle notification before retry, and peers queued before and during a recoverable Stop.

## Not done

- Tests, typecheck, lint, build, verify, Nx, npm, and diagnostics were not run, per the task's hard rules. No real Codex process or network call was started.
- This CLI exposed no skill invocation mechanism or matching invocable runtime skill. Repository skill files and Ptah's skill inventory were inspected; no skill was applied.
- `rg` was unavailable in this shell (`Access is denied`), so targeted PowerShell reads and `Select-String` were used. The edited files and report were inspected for LF line endings and no UTF-8 BOM.
