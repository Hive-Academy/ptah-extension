---
id: TASK_2026_664_0ec1
status: backlog
type: BUGFIX
title: Stop raw error text in shared session logs
depends_on: []
created: "2026-10-14T17:08:11.937Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  chat-stream-broadcaster.service.ts writes raw error messages into logs that every session shares.
  Log ids and the error kind only.
estimate: S
labels:
  - follow-up
  - privacy
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Raw error text can carry prompt or file content. The Electron main-process log is shared by every
session, so it must keep ids and the error kind only. Replace the raw text at these sites in
`libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`:

- `:179-183` chat batch delivery failure (`error.message`).
- `:289-292` child session metadata save failure (`err.message`).
- `:367-370` flat-event stream error (passes the whole `Error` to `logger.error`; decide whether
  Sentry capture at `:371` may keep it).
- `:390-394` zero-event start or resume failure (`Original error: ${errorMessage}`).

Use an allowlisted error kind, for example `safeErrorKind` as used in
`libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:173`, or
`errorType()` in `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-handoff-delivery.ts:74`.
Add specs. Verify with `npm run verify -- -p @ptah-extension/rpc-handlers`.

## Current state (2026-11-07)

- Not started. The four sites above still log raw text.
- Dropped: `libs/backend/vscode-core/src/api-wrappers/webview-manager.ts`. That class served the
  removed VS Code host (PR #892). Electron registers its own adapter as `TOKENS.WEBVIEW_MANAGER`
  (`apps/ptah-electron/src/activation/bootstrap.ts:580`), and that adapter logs only `error.name`
  (`apps/ptah-electron/src/ipc/webview-manager-adapter.ts:65,107`).

Full context, plan and discussion live in [./context.md](./context.md).
