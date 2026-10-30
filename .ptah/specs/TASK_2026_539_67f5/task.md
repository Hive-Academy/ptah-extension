---
id: TASK_2026_539_67f5
status: backlog
type: FEATURE
title: "Route host dashboard surface updates into coding sessions and release them on close"
depends_on:
  - TASK_2026_494_ca38
created: "2026-10-01T00:00:00.000Z"
updated: "2026-10-30T03:38:08.921Z"
description: "The coding chat already renders ptah-ui blocks (PR #649) and the display panel renders ptah-surface-renderer. Claim coding-session routing ids on SurfaceUpdateInbox, publish SURFACE_UPDATED dashboards through the chat display dock, and add a surface:release RPC that frees host surface state on session close."
estimate: L
relates_to:
  - TASK_2026_490_583c
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Mount surfaces pushed through MESSAGE_TYPES.SURFACE_UPDATED inside coding-chat tabs (Revision 4 sequence C, charts in the coding chat), claim chat-tab routing ids on the generic SurfaceUpdateInbox, and add surface:release on chat-tab close.

Full context, plan and discussion live in [./context.md](./context.md).
