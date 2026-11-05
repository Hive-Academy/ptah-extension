# CodeRabbit fixes for PR #943

## Finding 1: large NTFS file IDs

- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.ts:353`: verification now uses `BigIntStats`, bigint `stat` calls, bigint identity checks, and a numeric size for existing caps and comparisons. Missing or zero identities still fail closed.
- `libs/backend/rpc-handlers/src/lib/handlers/file-view-rpc.handlers.spec.ts:169`: identity fakes use bigint values and cover matching inode values above `Number.MAX_SAFE_INTEGER` for text and binary previews, plus zero and unavailable identities.

## Finding 2: dashboard mentions

- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.ts:46`: visual noun matching now requires an output verb or the existing subject-link rule. The code exclusions remain in the classifier.
- `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-ui-hint.spec.ts:149`: added the three requested compact dashboard cases.

## Finding 3: missing workspace root

- `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-file-viewer.component.ts:58`: the file RPC omits `workspaceRoot` when empty or unavailable.
- `libs/frontend/chat/src/lib/services/file-link-router.service.ts:117`: the router carries an unknown root as `undefined`. `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-file-item.ts:8` makes the field optional, and `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts:184` handles it when generating a file key. `libs/frontend/chat/src/lib/services/display-window/display-window-wire.ts:277` accepts an omitted root in the detached-window wire schema. The backend `display-window-rpc.handlers.ts` accepts a generic JSON state object, so it has no file-specific root schema to change.
- `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-file-viewer.component.spec.ts:38`: added RPC assertions for both `undefined` and empty-string roots.

## Verification

- Reviewed changed source and spec locations with targeted `rg` searches.
- `ptah_get_diagnostics` was attempted twice for the changed projects, but its TypeScript compiler check was still running after 45 seconds each time and returned unchecked coverage. No type-check result is claimed.
- Jest, Nx, npm, and Node were not run because process spawn was prohibited for this task.

## Decisions

- Kept the dock's empty string as an internal key input while preserving `undefined` on the file item and wire payload. This follows the existing key helper's string contract, requires no new public API, and is reversible.
