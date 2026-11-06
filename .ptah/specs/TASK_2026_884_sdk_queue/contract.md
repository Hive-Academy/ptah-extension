# TASK_2026_884 — fixed contract (coordinator, overrides implementation-plan.md where they differ)

## Scope cuts for this round
- NO edit of a queued item (`chat:queued-edit` dropped).
- NO restart recovery record (follow-up task). Session end / app exit fails held items.

## Provider contract — ALREADY WRITTEN, frozen (do not edit; ask the coordinator)
- `libs/shared/src/lib/types/follow-up-queue.types.ts`: `QueuedFollowUpState`,
  `QueuedFollowUpStateChange`, `QueuedFollowUpSnapshot`, `SteerQueuedFollowUpResult`,
  `FollowUpQueueOperations` (`onQueuedFollowUpState`, `withdrawQueuedFollowUp`,
  `listQueuedFollowUps`, `steerQueuedFollowUp`, all optional).
- `IAgentAdapter extends IAIProvider, FollowUpQueueOperations` (`agent-adapter.types.ts`).
- `AIMessageOptions.queueIntent?: 'next-turn'` (`ai-provider.types.ts`); requires `clientMessageId`.
  `sendMessageToSession` resolves when the message is ACCEPTED (held or admitted). The
  adapter emits `queued` when it holds it, `delivered` when a turn takes it, `withdrawn`,
  `failed` (session ended / replaced / admission error, safe reason), `steered` (Codex).

## RPC / push contract — batch 1 implements, batch 4 consumes (exact names)
In `libs/shared/src/lib/types/rpc/rpc-chat.types.ts` + `RpcMethodMap` in `rpc.types.ts`:
- `chat:continue` params: add `queueIntent?: 'next-turn'` (then `clientMessageId` is required,
  Zod-enforced). Result: add `queueState?: 'queued' | 'admitted'`, `queuedMessageId?: string`.
- `chat:queued-list` `{ sessionId, tabId }` → `{ items: QueuedFollowUpSnapshot[] }` (FIFO).
- `chat:queued-withdraw` `{ sessionId, tabId, clientMessageId }` → `{ withdrawn: boolean }`.
- `chat:queued-steer` `{ sessionId, tabId, clientMessageId }` → `SteerQueuedFollowUpResult`.
- `chat:abort` result: add `withdrawn?: QueuedFollowUpSnapshot[]` — items withdrawn by Stop,
  FIFO order, withdrawn BEFORE the interrupt. A raced, already-claimed item is not in it.
- Push message `MESSAGE_TYPES.CHAT_QUEUED_MESSAGE_STATE = 'chat:queued-message-state'`,
  payload `ChatQueuedMessageStateEvent { sessionId, tabId, clientMessageId, state:
  QueuedFollowUpState, reason?: string }`. Sent for every tab regardless of the stream
  viewport (hidden tabs included). It never releases or flushes anything in the renderer.

## Ownership (one owner per file, specs included)
- Coordinator (frozen): the three shared files above + `libs/shared/src/index.ts`.
- Batch 1 RPC (Claude subagent): rpc-chat.types.ts, rpc.types.ts, message-type constants,
  `libs/backend/rpc-handlers/**` (chat-rpc handlers/schema, chat-session.service, a new
  follow-up coordinator + token, broadcaster/delivery coordinator), DI registrations and
  guards under `apps/ptah-electron/src/di/**` (+ VS Code/CLI composition if registration needed).
- Batch 2 Claude runtime (Codex lane): `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/**`,
  `helpers/session-lifecycle-manager.ts`, `sdk-agent-adapter.ts`.
- Batch 3 Codex chat (Codex lane): `libs/backend/agent-sdk/src/lib/codex-app-server/**`
  (peer queue, chat adapter, `routing-agent-adapter.ts` delegation + listener fan-in from
  both adapters), `libs/backend/codex-runtime/src/lib/codex-context.ts` only if steer needs it.
- Batch 4 renderer (Claude subagent): `libs/frontend/**` files listed in implementation-plan.md.
