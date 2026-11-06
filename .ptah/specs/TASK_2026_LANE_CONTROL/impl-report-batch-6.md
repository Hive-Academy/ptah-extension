# Batch 6 implementation report

## Store API

- `previewMessage(agentId: string, delivery: 'queue' | 'now'): Promise<AgentMessagePreview>` calls `agent:previewMessage` through `ClaudeRpcService` and stores the preview.
- `sendMessage(agentId: string, text: string, delivery = 'queue', allowPartialTurnLoss?: boolean): Promise<AgentMessageOutcome>` calls `agent:sendMessage` and merges its receipt.
- `cancelMessage(agentId: string, messageId: string): Promise<AgentDeliveryReceipt>` calls `agent:cancelMessage` and merges its receipt.
- `receipt(agentId, messageId)`, `receipts`, `parentDelivery`, `composerState(agentId)`, `laneCapabilities(agentId)`, `parentDeliveryState(agentId)`, and `receiptLabel(receipt)` expose the projection to Batch 7/9. Receipt storage is capped at 32 per agent and 64 agents. Parent delivery is capped at 16 per agent and 64 agents.
- Spawned cards retain potential capabilities, effective capabilities and effective policy.

## Push wiring

`onMessageReceipt(receipt)` and `onParentDelivery(payload)` merge immutable signals. **The push handler is not wired:** `AgentMonitorMessageHandler` lives outside the allowed Batch 6 file list. Its `handledMessageTypes` and `handleMessage` must add `AGENT_MONITOR_MESSAGE_RECEIPT` and `AGENT_MONITOR_PARENT_DELIVERY` using the existing `MESSAGE_HANDLERS` registration. Without this, backend pushes do not reach these store methods. This remains an unmet requirement.

## Preserved behaviours

- Draft text remains available through `queued`, `unqueue`, `undelivered`, and `takeUndelivered`.
- Enqueue coalesces repeated text, cancelling an accepted backend receipt before replacing it.
- Editing returns text synchronously and requests cancellation of an accepted receipt. Cancellation races are handled when acceptance arrives after edit.
- Failed, expired and interrupted-undelivered receipt text returns to `undelivered`; RPC failures and unsupported outcomes do too.
- Cold resume is delegated to the backend coordinator through `agent:sendMessage`.
- `continueAgent` and `resumeAgentWithMessage` remain in the store for existing callers.

## Proposed Removals

- Renderer idle-status flush was removed. Backend queue accepts messages while a lane is running.
- Renderer `agent:continue` retry and busy handling in the follow-up service were removed. Backend coordinator handles queueing and routing.
- Renderer direct `agent:resumeCliSession` fallback in the follow-up service was removed. Backend coordinator owns cold-resume recovery.
- `followUpResumesInstead` remains exported for existing component compatibility until Batch 7 migrates it.

## Tests and verification

- Store spec covers preview/send/cancel RPC calls and receipt/parent projection bounds. Follow-up spec covers backend queueing, coalescing, editing cancellation and draft recovery.
- Requested verify confirmed “for 2 projects.” Its first typecheck phase failed on `findLast` in `parentDeliveryState`; the code was changed to use a supported array search before the run ended. `chat-streaming` tests passed 34 suites, 837 tests (one skipped). The `chat` Jest phase remained silent for several minutes and was stopped. After the `findLast` fix, direct `ngc --noEmit` passed for both `chat-streaming` and `chat` (the latter with unrelated template warnings). The focused follow-up spec passed 1 suite, 5 tests. The root Jest config was unusable for a direct invocation; the focused run used `libs/frontend/chat/jest.config.ts`.
- Scoped Ptah diagnostics remained unavailable after 45 seconds; the compiler check had not completed.

## Needs for Batch 7/9

- Batch 7: `composerState(agentId)` returns `{ queue?, now?, queueDisabledReason?, nowDisabledReason?, queueHint, nowHint }`; call `previewMessage` for both deliveries before enabling Send/Send now. `laneCapabilities(agentId)` returns `{ potential?, effective?, policy? }`. `receiptLabel(receipt)` maps backend states to design copy.
- Batch 9: `parentDeliveryState(agentId)` returns `{ completion, report }`, each “Waiting for parent” or “Sent to parent”. `parentDelivery()` exposes raw pushed payloads.
- Wire the two new push types in `AgentMonitorMessageHandler` when that file enters an allowed batch. Use its existing `MESSAGE_HANDLERS` registration.

## Decisions

- Kept the synchronous `enqueue`/`unqueue` API for current components while making backend acceptance authoritative. Existing component calls require synchronous draft return; cancellation runs in a serialized operation. Reversible in Batch 7.
- Capped receipt and parent projections per agent and globally to keep a long-lived store bounded. Reversible.

## Limitations

- This lane had no skill-loading tool. The repository's `angular-frontend-patterns` skill file was read directly.
- No browser screenshot was taken because Batch 6 changes no rendered component.
- No git command was run.
