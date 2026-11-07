---
id: TASK_2026_539_67f5
status: backlog
type: FEATURE
title: Route host dashboard surface updates into coding sessions and release them on close
depends_on:
  - TASK_2026_494_ca38
created: "2026-10-01T00:00:00.000Z"
updated: 2026-11-07T00:00:00.000Z
description: >-
  Claim coding-session routing ids on SurfaceUpdateInbox, show SURFACE_UPDATED dashboards in the
  chat display panel, and add a surface:release RPC that frees host surface state on session close.
estimate: L
relates_to:
  - TASK_2026_490_583c
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Mount surfaces pushed through `MESSAGE_TYPES.SURFACE_UPDATED` inside coding-chat tabs (Revision 4
sequence C, charts in the coding chat). Claim chat-tab routing ids on the generic
`SurfaceUpdateInbox` (`libs/frontend/chat-routing/src/lib/surface-update-inbox.service.ts`), and
release them on chat-tab close. Add a `surface:release` RPC (shared params, registry, `.strict()`
schema, handler, a `SurfaceStateService` operation that respects the operation ledger and pending
submits, and tests). Keep the renderer out of the initial chunk set. Only the Electron host needs
host tests now; the VS Code and CLI hosts are removed (PR #892).

## Current state (2026-11-07)

- Done: ptah-ui blocks in the Electron coding chat (PR #649, TASK_2026_610). The display panel renders
  surfaces through `ptah-surface-renderer`
  (`libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts:136,278`).
- Open: only the Apps page claims routing ids on the inbox
  (`libs/frontend/mcp-apps-page/src/lib/services/apps-conversation-claims.ts`).
- Open: `libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts:108-112` has `read`,
  `change`, `select`, `action` and `operation`, but no `surface:release`.
- The display-window work (TASK_2026_853_3401) is `done`, so the planning can start on the current
  display panel.

Full history in [./context.md](./context.md).
