---
id: TASK_2026_628_5ab5
status: done
type: BUGFIX
title: "Cut renderer memory churn from streaming, sub-agent trees and CLI agent output"
depends_on: []
created: "2026-10-11T16:55:05.656Z"
updated: "2026-10-12T23:49:43.200Z"
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
  - TASK_2026_629_c0b3
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The Electron renderer reaches 5.5 GB private with ~6 sessions, but live heap is 157 MB and a forced GC frees ~2.6 GB: per-stream-event allocation churn, plus a small detached canvas-tile leak. Evidence and plan in context.md.

Shipped in PR #715 (merge 0d892085c). Hot spot 7 (the detached canvas-tile leak) moved to TASK_2026_629_c0b3. The combined M-final measurement and the main-process growth moved to TASK_2026_645_6aaa.

Full context, plan and discussion live in [./context.md](./context.md).
