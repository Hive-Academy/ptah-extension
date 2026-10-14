# Context
Source: TASK_2026_655_handoff/HANDOFF.md follow-up 1 (found in the PR 724 review).
- `libs/backend/vscode-core/src/.../webview-manager.ts` and
  `libs/backend/rpc-handlers/src/.../chat-stream-broadcaster.service.ts` log raw `error.message` text
  into logs that every session shares. Raw text can carry prompt or file content.
- Expected: log ids, error type/code only (pattern: `subagent-handoff-delivery.ts` `errorType()`).
- Verify: scoped `nx test` for vscode-core and rpc-handlers only.
