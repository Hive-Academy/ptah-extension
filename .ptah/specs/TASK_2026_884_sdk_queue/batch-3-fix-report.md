# Batch 3 steer follow-up fix

## Changes

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:906-913`: a resolved `turn/steer` always returns success so `CodexChatPeerQueue` removes the item. A receipt or local turn ID mismatch is logged without message content.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:915-920`: a rejected steer logs a real `Error` through the injected logger and returns the contract's `TURN_CHANGED` failure code. No suppression marker was needed; the catch reports the error. The suppression format was checked in `tools/degradation-audit/check-degradation.ts`.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:225-257`: a mismatched successful receipt removes the item, emits `steered`, logs the mismatch, and does not start a second turn after idle.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:260-289`: a rejected steer logs the original `Error` and leaves the item queued.

## Decisions

- Used `TURN_CHANGED` for a rejected steer because the existing `SteerQueuedFollowUpResult` has no runtime-failure code and the authorized scope excludes its shared contract. The logged error distinguishes the underlying failure. This is reversible if the shared contract later gains a failure code.
- Considered a resolved steer delivered regardless of receipt turn ID. A resolved RPC may already have admitted the text, so retaining the item could deliver it again. This is reversible.

## Checks

- `ptah_get_diagnostics` scoped to both changed files: 0 errors, 0 warnings, clean coverage.
- `npx jest --runInBand -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts`: 1 suite, 112 tests passed.
- No Nx, verify, git, commit, push, or PR command ran.

## Limitations

- Host-level native app-server integration was not run; the behavior is covered at adapter level with the mocked Codex context.
