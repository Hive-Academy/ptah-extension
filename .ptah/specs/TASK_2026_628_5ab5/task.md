---
id: TASK_2026_628_5ab5
status: backlog
type: BUGFIX
title: "Cut renderer memory churn from streaming, sub-agent trees and CLI agent output"
depends_on: []
created: "2026-10-11T16:55:05.656Z"
updated: "2026-10-11T16:55:05.656Z"
description: "The Electron renderer reaches 5.5 GB private with ~6 sessions, but live heap is 157 MB and a forced GC frees ~2.6 GB: per-stream-event allocation churn, plus a small detached canvas-tile leak. Evidence and plan in context.md."
executor: frontend-developer
estimate: L
labels:
  - chat
  - streaming
  - performance
  - canvas
relates_to:
  - TASK_2026_STREAMING_ARCH
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The Electron renderer reaches 5.5 GB private with ~6 sessions, but live heap is 157 MB and a forced GC frees ~2.6 GB: per-stream-event allocation churn, plus a small detached canvas-tile leak. Evidence and plan in context.md.

Full context, plan and discussion live in [./context.md](./context.md).
