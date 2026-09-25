---
id: TASK_2026_557_9dbc
status: backlog
type: BUGFIX
title: Stop orphaned rival-CLI probes from holding the Electron app open on quit
depends_on: []
created: "2026-09-25T17:00:00.000Z"
updated: "2026-09-25T17:00:00.000Z"
description: "A rival-CLI registration probe still running at quit keeps the inherited stdio pipe open, so Playwright's electronApp.close() waits up to ~28 s with slow CLIs on PATH."
estimate: S
labels:
  - e2e
  - electron
relates_to:
  - TASK_2026_556_d12d
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

A rival-CLI registration probe still running at quit keeps the inherited stdio pipe open, so Playwright's electronApp.close() waits up to ~28 s with slow CLIs on PATH.

Full context, plan and discussion live in [./context.md](./context.md).
