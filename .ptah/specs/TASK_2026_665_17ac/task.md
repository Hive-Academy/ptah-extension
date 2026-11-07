---
id: TASK_2026_665_17ac
status: backlog
type: BUGFIX
title: Stop ptah_session_send echoing raw thrown messages
depends_on: []
created: "2026-10-14T17:08:12.052Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  ptah_session_send (and the other non-handoff session tools) copy a raw thrown error message into
  the warn log line and the MCP reply. Return a fixed, safe text plus the error kind.
estimate: XS
labels:
  - follow-up
  - privacy
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

When a session tool throws, `failureText` in
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/session-tool-handlers.ts:471-480`
sanitizes the message only for `ptah_session_handoff`. Every other session tool, including
`ptah_session_send`, returns `errorText(error)` (`:460`), the raw thrown message. That text goes
into the warn log (`:520`) and the MCP reply (`:523`). The message to a child session can carry
prompt text.

Expected: the reply carries a fixed, user-safe text plus an allowlisted error kind (as the handoff
branch does with `safeErrorKind`), and the log keeps ids and the error kind only. Keep specific
known messages (for example a fixed "unavailable" text) when they are prompt-free. Decide whether
the fix covers only `ptah_session_send` or every session tool. Add specs. Verify with
`npm run verify -- -p @ptah-extension/vscode-lm-tools`.

## Current state (2026-11-07)

- Partly done: the handoff tool already returns only a fixed text or
  `unexpected error (<kind>)` (`session-tool-handlers.ts:471-480`).
- Left: the doc comment at `:469` still says "The other session tools keep the thrown message",
  and the code does so.

Full context, plan and discussion live in [./context.md](./context.md).
