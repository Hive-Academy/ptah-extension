# Batch 9c-1b-sdk report

Worktree: `D:\projects\ptah-extension\.claude-worktrees\codex-runtime-integration`

## Changes

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter-error.ts:1-35`: moved the adapter error, code type, and type guard into a leaf module. Added a provider-neutral `webviewReported` marker and structural guard. The code union already contained `runtime-failed`.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:44,768-783`: imports the leaf error. Its existing `failure()` skips only `cancelled`; a `runtime-failed` terminal therefore logs as a real failure and returns the same marked error.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts:6,156-183,305-310`: divergent text, including a correction to empty, emits one complete-source `text_delta` on the existing block. Removed the redundant text `callbacks.content` call. A failed terminal rejects settlement with marked `runtime-failed`; an interrupted terminal still rejects with `cancelled`.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:18-21,344-359`: catches only the expected detached interrupted settlement, then calls `settleTurn()` and returns without cleanup failure or context close.
- `libs/backend/agent-sdk/src/index.ts:161-173`: preserves the public error guard and code type exports, and exports the moved error class and webview marker guard from the public alias.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:58,314-381`: keeps failure flush, forced idle, error logging, and Sentry capture; suppresses only the duplicate `CHAT_ERROR` when the thrown error says the webview was already notified. Interrupted cancellations retain their existing abort path.

## Specs updated

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.spec.ts:37-50,310-366,371-492`: checks failure code and marker, interrupted cancellation, no duplicate text callback, empty correction, and no block allocation for empty final-only text.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:365-397,526-565,570-603`: checks generator rejection before `message_complete`, failure logging, detached interrupted drain without cleanup failure or context close, and pending approval cleanup after rejected terminals.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:17-24,233-244`: imports the leaf error and expects failed/interrupted native turns to reject while leaving completed-turn metadata untouched.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.spec.ts:85-86,174,1054-1082`: a generic marked `Error` flushes chunks, forces idle, logs and reaches Sentry, with no second `CHAT_ERROR`.

## F1 trace

`CodexChatEvents.map()` returns the complete-source correction (`codex-chat-events.ts:166-176`). `streamCodexChatTurn()` yields each mapped event (`codex-chat-turn-stream.ts:241-257`). `ChatStreamBroadcaster` consumes that stream and publishes each event as `CHAT_CHUNK` (`chat-stream-broadcaster.service.ts:176-186,208-263`). The delivery coordinator routes visible events to that same chunk payload (`chat-stream-delivery-coordinator.service.ts:117-136,164-178`); its hidden-tail coalescer does not merge complete-source deltas (`stream-delta-coalescer.ts:8-10`). The frontend accumulator replaces the text block with `event.delta`, including `''`, for complete-source events (`accumulator-core.service.ts:301-329`). Thus the text callback was redundant on the native webview path. The reasoning callback remains.

## Verification and risks

- No tests, lint, typecheck, build, diagnostics, or other verification command ran, per the task rule. The coordinator must run the focused checks.
- The gateway's complete-source text reconciliation is outside this SDK lane and must be checked with its separate batch. This lane did not edit `libs/backend/gateway-chat-bridge/**` or MCP wiring.
- Skill invocation/read was unavailable in this CLI. Ptah skill inventory exposed only `impeccable` and `typesafe-ai`; neither was available through a skill invocation tool for this backend task. `rg.exe` returned access denied, so read-only text searches used PowerShell `Select-String`.
- Other lanes had concurrent uncommitted changes in this worktree. This batch preserved those edits.
