# Phase 1 report — delivery protocol and host coordinator

## What was built

- Added the versioned `chat:setStreamViewport` RPC contract. It accepts protocol v2
  `focusedTabId` and `visibleTabIds`, and reports the accepted protocol version. A
  caller which never sends this RPC remains in legacy v1 delivery mode.
- Added the typed, non-batch `chat:streamSnapshot` message and its Zod boundary
  schema. Snapshots carry the tab/session identifiers, a contiguous sequence range,
  ordered stream events, and the explicit `resyncRequired` overflow form.
- Added `ChatStreamDeliveryCoordinator` at the `WebviewManager` broadcaster boundary.
  It owns viewport state, monotonically ordered per-tab sequences, a bounded
  event-and-byte hidden tail, reveal snapshots, overflow-to-resync, and deferred
  terminal delivery. Hidden tabs receive no per-chunk sends. A terminal is sent only
  after its current batch, and a hidden terminal follows the reveal snapshot.
- Registered the coordinator with the existing `Symbol.for` chat DI token pattern and
  routed `ChatStreamBroadcaster` through it when registered. Its existing
  `StreamBatchBuffer` behavior remains the legacy fallback.
- Added the `chat:setStreamViewport` handler and strict external Zod validation:
  protocol version 2, UUID tab IDs, at most 128 visible IDs, and no duplicates.
- Exercised the existing host adapters rather than introducing host-specific
  dependencies into the coordinator: VS Code uses `postMessage`, Electron keeps the
  `to-renderer` IPC envelope, and the CLI adapter keeps its current event names.
  The common `WebviewManager` port remains the boundary used by all three.

## Files changed

- `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
- `libs/shared/src/lib/types/rpc/rpc.types.ts`
- `libs/shared/src/lib/types/messages/message-constants.ts`
- `libs/shared/src/lib/types/messages/payload-map.ts`
- `libs/shared/src/lib/types/messages/batch.ts`
- `libs/shared/src/lib/types/messages/schemas.ts`
- `libs/shared/src/lib/types/rpc/host-source-registry.baseline.ts`
- `libs/shared/src/lib/types/rpc/rpc-chat.types.spec.ts`
- `libs/shared/src/lib/types/messages/chat-stream-snapshot.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/tokens.ts`
- `libs/backend/rpc-handlers/src/lib/chat/di.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/index.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts`
- `libs/backend/vscode-core/src/api-wrappers/webview-manager.spec.ts`
- `apps/ptah-electron/src/ipc/ipc-bridge.batching.spec.ts`

## Contract changes

- New RPC: `chat:setStreamViewport`.
  - request: `{ protocolVersion: 2, focusedTabId?: UUID, visibleTabIds: UUID[] }`
  - response: `{ acceptedProtocolVersion: 1 | 2 }`
- New host-to-webview message: `chat:streamSnapshot`; it is intentionally not a
  `BATCH` member so reveal state has one typed, ordered recovery envelope.
- Existing v1 clients which omit the viewport RPC preserve current batch delivery.
- CLI transport event names are unchanged.

## Tests added or extended

- Coordinator coverage: legacy batch delivery, hidden suppression, ordered reveal
  snapshot, bounded-tail overflow/resync, and terminal ordering; the existing
  `StreamBatchBuffer` coverage remains the max-queue assertion.
- Shared contract coverage: v2 RPC literal and valid/invalid snapshot payloads.
- Handler coverage: schema rejection and v1 accepted-version fallback.
- Host-adapter coverage: VS Code `postMessage` snapshot delivery and Electron
  `to-renderer` forwarding. Existing CLI adapter contract coverage was run to confirm
  unchanged event names.

## Checks run

All commands were scoped to changed projects/files and used the requested worker
limits where applicable.

- `npx nx typecheck @ptah-extension/shared --parallel=1` — passed.
- `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1` — passed (including
  the final coordinator lifecycle cleanup).
- `npx nx typecheck @ptah-extension/vscode-core --parallel=1` — passed.
- `npx nx typecheck ptah-electron --parallel=1` — passed.
- `npx nx lint @ptah-extension/shared` — passed; 5 pre-existing warnings.
- `npx nx lint @ptah-extension/rpc-handlers` — passed; 50 pre-existing warnings,
  no errors.
- `npx nx lint @ptah-extension/vscode-core` — passed; 15 pre-existing warnings,
  no errors.
- `npx nx lint ptah-electron` — passed; 17 pre-existing warnings, no errors.
- Shared focused Jest command — passed: 3 suites, 10 tests.
- RPC-handler schema/coordinator/buffer Jest command — passed: 4 suites, 131 tests.
- RPC-handler coordinator/broadcaster final Jest command — passed: 2 suites, 38 tests.
- VS Code focused Jest command — passed: 1 suite, 25 tests.
- Electron focused Jest command — passed: 2 suites, 19 tests.
- CLI adapter focused Jest command — passed: 1 suite, 10 tests.

The scoped editor diagnostic service did not complete its TypeScript check within its
45-second service limit. It reported the coordinator file as unchecked; the explicit
Nx typecheck above passed. Nx Cloud reporting was disabled by the repository account
but did not affect any target result.

## Deviations

None from D1–D3 or the Phase 1 contracts.

## Decisions

- The coordinator treats the absence of a v2 viewport declaration as a visible,
  legacy delivery session. This is the required back-compatibility path for existing
  webviews and is the Phase 1 focused/default producer behavior without prematurely
  implementing the Phase 2 webview scheduler.
- `host-source-registry.baseline.ts` was extended with the approved new RPC and
  message names because the plan explicitly introduces them; this keeps the registry
  contract gate aligned with the protocol rather than suppressing it.
- A visible terminal clears the coordinator's retained state after the batch and
  terminal have been delivered. A hidden terminal remains retained only until its
  reveal snapshot has been delivered, preventing stale per-tab state.

## Remaining work

- Phase 2 webview viewport controller, tier scheduler, and snapshot consumer.
- Phases 3–6 performance instrumentation, rollout gates, and the phase-6 zoneless
  fallback flag. No zoneless work was introduced in Phase 1.
