# Batch 17F report

## Changes

- `libs/shared/src/lib/types/execution/stream.ts:288-300`: added documented `IdleCompactionNotice` and used it on `CompactionCompleteEvent`.
- `libs/frontend/chat-state/src/lib/conversation-registry.service.ts:13-16,45,284,420-431`: used the shared type and clear the idle notice when a later compaction invalidates the marker.
- `libs/frontend/chat-state/src/lib/conversation-registry.service.spec.ts:66-87`: regression case for a later compaction that starts and fails, including persisted marker state.
- `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:38-40,140` and `streaming-handler.service.ts:17-19,208,418`: used the shared type in event results.
- `libs/frontend/chat/src/lib/services/chat-store/compaction-lifecycle.service.ts:3-5,364,757`: used the shared type at both lifecycle boundaries.
- `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts:1-4,27,111`: used the shared type and gave the label a stable test selector.
- `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.spec.ts:39-42,59,105-144`: typed the test fixture, selected the label by test ID, moved the `manual` assertion into the idle test, and pinned the combined idle sentence and token line.

## Verification

- Prettier `--write` on the eight changed `.ts` files: exit 0.
- chat-state Jest: `Test Suites: 1 passed, 1 total`; `Tests: 46 passed, 46 total`.
- chat-ui Jest: `Test Suites: 1 passed, 1 total`; `Tests: 13 passed, 13 total`.
- chat-streaming Jest (accumulator core and three streaming handler specs): `Test Suites: 4 passed, 4 total`; `Tests: 106 passed, 106 total`.
- chat Jest: `Test Suites: 1 passed, 1 total`; `Tests: 70 passed, 70 total`.
- `nx typecheck` shared: `EXIT=0`; chat-state: `EXIT=0`; chat-ui: `EXIT=0`; chat-streaming: `EXIT=0`; chat: `EXIT=0`; agent-sdk: `EXIT=0` (all with `NX_NO_CLOUD=true`, `--parallel=1`).
- ESLint on the eight changed `.ts` files: `EXIT=0`, no diagnostics.
- `ptah_get_diagnostics` after edits reported TypeScript check unavailable after 45 seconds; the six scoped Nx typechecks above completed successfully.

## Decisions

- No shared barrel edit: `libs/shared/src/lib/types/execution/index.ts:6` already exports `stream.ts`, and `libs/shared/src/index.ts:9` exports execution.
- Kept the exact idle sentence and token reduction line together, per decisions.md row 14; the new chip test pins both.
- Left backend `IdleBoundaryNotice` unchanged, as assigned.

## Not done

None of the assigned changes or required checks remain. The scoped Ptah diagnostics result was unavailable; Nx typechecks supplied compiler verification.
