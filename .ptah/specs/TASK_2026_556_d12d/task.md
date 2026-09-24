---
id: TASK_2026_556_d12d
status: backlog
type: BUGFIX
title: Fix the intermittent Electron start-up hang after IpcBridge IPC listeners initialized
depends_on: []
created: "2026-09-24T10:56:51.718Z"
updated: "2026-09-24T10:56:51.718Z"
description: "Boot intermittently stops after `[IpcBridge] IPC listeners initialized` and never reaches wire-runtime.ts:328; the window stays on preparing-workspace.html and e2e launches time out."
estimate: M
labels:
  - e2e
relates_to:
  - TASK_2026_550_9a28
  - TASK_2026_389
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Boot intermittently stops after `[IpcBridge] IPC listeners initialized` and never reaches wire-runtime.ts:328; the window stays on preparing-workspace.html and e2e launches time out.

Full context, plan and discussion live in [./context.md](./context.md).
