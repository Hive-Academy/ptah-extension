---
id: TASK_2026_664_0ec1
status: backlog
type: BUGFIX
title: Stop raw error text in shared session logs
depends_on: []
created: "2026-10-14T17:08:11.937Z"
updated: "2026-10-14T17:08:11.937Z"
description: webview-manager.ts and chat-stream-broadcaster.service.ts write raw error messages into logs shared by every session.
estimate: S
labels:
  - follow-up
  - privacy
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

webview-manager.ts and chat-stream-broadcaster.service.ts write raw error messages into logs shared by every session.

Full context, plan and discussion live in [./context.md](./context.md).
