---
id: TASK_2026_382
status: in_review
type: BUGFIX
title: >-
  Mid-stream sends bypass the queue: reconcile the busy predicate with
  streamingState and stop chat errors stranding an unfinalizable tree
depends_on:
  - TASK_2026_381
created: '2026-09-06T03:10:00.000Z'
updated: '2026-09-06T03:10:00.000Z'
description: >-
  A message sent while the agent is streaming renders above the streaming
  bubble instead of below it, and reaches the agent mid-turn instead of being
  queued. The busy predicate in MessageDispatchService is derived from the
  root-turn phase (tab.status + _streamingTabIds) while the visible streaming
  bubble is derived from tab.streamingState. Nothing keeps the two in sync.
  applyStatusErrorReset nulls currentMessageId but leaves streamingState
  populated, which makes finalizeCurrentMessage a permanent no-op and pins the
  stranded tree to the bottom of the transcript forever.
executor: frontend-developer
estimate: M
labels:
  - bug
  - chat
  - streaming
  - ordering
relates_to:
  - TASK_2026_360
  - TASK_2026_381
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Two sources of truth disagree about whether a tab is busy. Reconcile them, and
stop the error path from stranding a tree that can never be finalized.

Evidence and options live in [./research-report.md](./research-report.md).
