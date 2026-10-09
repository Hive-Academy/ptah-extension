# Session handoff fix round 2

## Fixed

- 1 -> Successor start receives only the seed; after its bind acknowledgement the coordinator detaches the final held FIFO, publishes that detached state, then transfers the batch through one runtime queue operation. A start/bind/delivery failure restores the still-owned batch before the source is closed. `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:351`, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:329`, `libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:134`.
- 2 -> Token-matched stream exits and lifecycle end paths notify `sourceEnded` before record teardown. Held inputs are restored when possible; otherwise the terminal state carries a lost-input count/message. Closing is a successful terminal path and repeated teardown notifications are harmless. `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:341`, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:673`, `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:470`.
- 3 -> Handover state is retained, revision-gated before broadcast, and available on the validated state-read RPC for late webviews. `libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.ts:34`, `libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.schema.ts:49`.
- 4 -> Terminal budget handoff stage automatically arms a `budget-auto` operation and starts it without confirmation; a cancelled operation does not re-arm until blocking limit creates the normal confirmation flow. `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:506`, `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:194`.
- 5 -> Replaced the coordinator compact command with an owned plain-Markdown handoff request. Its final assistant response is used when available; empty, timed-out, or failed owned turns fall back to deterministic handoff facts. `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:109`, `libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:408`, `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-stream-pump.service.ts:308`.
- 6 -> The successor first receives the built seed, then the detached FIFO batch. `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:792`, `libs/backend/cli-agent-runtime/src/lib/session-children/child-chat-session-host.port.ts:77`.

## Contract changes for the frontend

- `SessionHandoverReason` adds `budget-auto`; `compacting` is removed from the handover phase union in favor of `writing-handoff`.
- State may carry `lostInputCount` and `lostInputsMessage` when recovery is impossible.
- Added `session:getHandoverState` with `{ sourceSessionId }` params and optional `{ state }` result. The RPC remains revision-safe alongside broadcast state.
- Minimal frontend compile fix: `libs/frontend/chat/src/lib/components/molecules/notifications/session-budget-banner.component.ts` now renders only `writing-handoff` for this workflow.

## Not fixed

- No known in-scope gaps. The editor diagnostics service did not return a scoped result within its 45-second availability window; project typechecks below passed.

## Tests

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-handoff libs/backend/agent-sdk/src/lib/helpers/session-lifecycle libs/backend/agent-sdk/src/lib/helpers/session-budget libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts libs/backend/agent-sdk/src/lib/di --coverage=false --maxWorkers=2` -> 21 suites, 689 tests passed (warning: a Jest worker was force-exited after completion).
- `npx jest -c libs/backend/rpc-handlers/jest.config.ts libs/backend/rpc-handlers/src/lib/handlers/session-handover-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/handlers/session-budget-rpc.handlers.spec.ts libs/backend/rpc-handlers/src/lib/rpc-allowlist.spec.ts libs/backend/rpc-handlers/src/lib/chat --coverage=false --maxWorkers=2` -> 25 suites, 371 tests passed.
- `npx nx typecheck agent-sdk --parallel=1` -> passed.
- `npx nx typecheck rpc-handlers --parallel=1` -> passed.
- `npx nx typecheck shared --parallel=1` -> passed.
- `npx nx typecheck cli-agent-runtime --parallel=1` -> passed.
- `npx nx typecheck @ptah-extension/chat --parallel=1` -> passed (pre-existing Angular optional-chain warning only).
