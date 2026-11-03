# Review fix report — TASK_2026_863

## Changes

- Blocking hidden turn completion: `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts:183-192` now sends a small `statusOnly` terminal `turn_state` envelope for hidden tabs. It retains the original event and text in the hidden tail, so reveal replays content before the normal terminal finalization. The shared coordinator broadcasts through `WebviewManager`; Electron and VS Code use this same path, but neither rendered transport was exercised here.
- Frontend status: `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:540-553` handles `statusOnly` before scheduler queuing. `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1953-1965` validates tab ownership/revision and writes `loaded` without advancing the revision. The original terminal event can therefore be accepted by `TurnStateApplier` on reveal and finalize content once in stream order. This status-only path does not run message finalization early.
- Serious classifier defect: `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:536-551` gives a running lane precedence over a loaded parent. The empty-message live-session shortcut now requires `streamingState === null`.

## Tests

- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.spec.ts`: hidden text remains retained, terminal status is delivered, and reveal contains ordered text plus terminal event.
- `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts`: hidden terminal status bypasses normal content scheduling.
- `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.spec.ts`: loaded parent with a running lane remains Running.
- The requested full frontend integration test using the real scheduler and applier was not added. The handler test mocks the tab manager, so this path still needs integration coverage.

## Verification

Command: `npm run verify -- -p @ptah-extension/rpc-handlers,@ptah-extension/chat,@ptah-extension/chat-state,@ptah-extension/canvas,@ptah-extension/chat-ui`

Result: exit 1. After waiting 95 seconds for the memory lock, Nx plugin loading failed with `spawn EPERM` for core, eslint, and Jest plugins. Scoped `ptah_get_diagnostics` was unavailable twice because its TypeScript check exceeded 45 seconds. No test result was produced.

## Decisions

- Kept the full hidden terminal event in the tail and sent only status immediately. Evidence: `TurnStateApplier` finalizes the message before setting status; doing that before retained text arrives could lose the ordered finalization. Reversible.
- The review's moderate blank card band and unsampled summary walk do not change turn status or lose data, so they were left for a visual/performance pass. The unused `holdText` input remains.

## Remaining risk

A hidden-tail overflow switches reveal to resync. Status reaches the rail immediately, but this change does not add a dedicated terminal finalization event to the resync seed. The resync path needs an integration check for final message content. The new status-only payload is handled before stream scheduler queuing; a future transport that drops this optional flag would restore the original bug.