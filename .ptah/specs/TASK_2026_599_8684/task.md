---
id: TASK_2026_599_8684
status: backlog
type: REFACTORING
title: Return fixed text for every unexpected RPC error in the dispatcher
depends_on: []
created: "2026-10-03T12:09:56.822Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  rpc-handler.ts forwards errorObj.message for any exception that is not an RpcUserError. Return a
  fixed fallback text, migrate the specs that assert raw text, and clear the agent RPC raw-error sites.
executor: backend-developer
estimate: L
labels:
  - rpc
  - security
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

The RPC dispatcher treats `RpcUserError` text as public, which is correct, but it also returns
`errorObj.message` for every other exception. A handler that rethrows a raw error sends host text
(paths, provider responses, possibly echoed credentials) to the renderer and the logs.

1. Dispatcher: `RpcUserError` keeps its text and `errorCode`. Every other exception returns one
   fixed fallback (for example "An unexpected error occurred.") and is logged and captured with its
   error type only, never its message.
2. Migrate every spec that asserts a raw exception message through the dispatcher (rpc-handlers
   and vscode-core specs). Where a message must stay public, the handler throws `RpcUserError`.
3. Check that the Electron renderer still shows a sensible text where it displays `error`.

Acceptance: a dispatcher spec proves that `new Error('<secret-like text>')` returns the fallback
and the text is in no result, log or Sentry event; a spec proves that `RpcUserError` paths keep
their text and code.

## Current state (2026-11-07)

- Not fixed. `libs/backend/vscode-core/src/messaging/rpc-handler.ts:229` passes `RpcUserError`
  through, and `:255` returns `error: errorObj.message` for any other error.
- Known raw-error sites: `agent:permissionResponse`, `agent:stop`, `agent:resumeCliSession` in
  `libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:386-390`.
- Already done per handler in TASK_2026_555: `ptahCli:list` and `auth:testConnection`.
- The CLI formatter and the TUI client are gone (PR #892). Only the Electron renderer is a client.

Full context, plan and discussion live in [./context.md](./context.md).
