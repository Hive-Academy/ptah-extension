---
id: TASK_2026_360
status: in_review
type: BUGFIX
title: >-
  Backend-owned session turn state as the single source of truth for streaming
  status
depends_on: []
created: '2026-08-31T00:51:23.075Z'
updated: '2026-08-31T00:52:22.680Z'
description: >-
  Replace the three divergent frontend streaming flags with one backend-owned
  per-session turn state (generating, awaiting-background, sleeping, idle,
  failed) delivered in order with the stream, correct across workspace switches
  and concurrent sessions
estimate: L
labels:
  - streaming
  - chat
  - agent-sdk
  - rpc-handlers
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Replace the three divergent frontend streaming flags with one backend-owned per-session turn state (generating, awaiting-background, sleeping, idle, failed) delivered in order with the stream, correct across workspace switches and concurrent sessions

Full context, plan and discussion live in [./context.md](./context.md).
