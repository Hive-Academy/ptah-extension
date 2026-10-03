# TASK_2026_599 — fixed text for every unexpected RPC error in the dispatcher

## Why

`libs/backend/vscode-core/src/messaging/rpc-handler.ts` (around lines 229-252) treats `RpcUserError` text as public,
which is correct, but returns `errorObj.message` for **any other** exception. A handler that rethrows a raw error
sends host text (paths, provider responses, possibly echoed credentials) to the webview, the CLI and the logs of
remote clients.

TASK_2026_555 recorded this as follow-up 1 (`TASK_2026_555/batches.md`, options from
`batch-12b-code-logic-review.md`). The user chose **option 1 (per handler)** for that PR, done in Batch 56 for
`ptahCli:list` and `auth:testConnection`. This task is **option 2**, the repo-wide guarantee.

Known raw-error sites outside Settings (follow-up 2): `agent:permissionResponse`, `agent:stop`,
`agent:resumeCliSession` in `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts`.

## Scope

1. Dispatcher: `RpcUserError` keeps its text and `errorCode`; every other exception returns one fixed fallback (for
   example "An unexpected error occurred.") and is logged and captured with its error type only, never its message.
2. Migrate every spec that asserts a raw exception message through the dispatcher (grep the rpc-handlers and
   vscode-core specs; expect many). Where a message must stay public, the handler throws `RpcUserError`.
3. Check every client that shows `error` text (webview, CLI formatter, TUI) still shows something sensible.

## Acceptance criteria

1. A handler that throws `new Error('<secret-like text>')` returns the fixed fallback; the text is in no result, log
   or Sentry event (spec at the dispatcher).
2. All `RpcUserError` paths keep their text and code (spec).
3. Typecheck, lint and tests green for vscode-core, rpc-handlers and every app; CLI E2E green.

## Out of scope

Rewording existing `RpcUserError` texts; the Settings handlers already fixed in TASK_2026_555.
