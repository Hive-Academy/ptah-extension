---
id: TASK_2026_460_0398
status: backlog
type: BUGFIX
title: Stop createChild from resetting createdAt, cost and tokens on an existing record
depends_on: []
created: '2026-09-16T04:00:00.000Z'
updated: '2026-09-16T04:00:00.000Z'
description: >-
  SessionMetadataStore.createChild always writes a fresh record, and the
  internal merge carries over only isChildSession, cliSessions,
  workingDirectory and resumableSdkSubagents. When create() wrote the record
  first, createdAt, totalCost and totalTokens are silently reset.
executor: backend-developer
estimate: S
labels:
  - persistence
  - reliability
relates_to:
  - TASK_2026_452
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

createChild can silently reset a session's createdAt, cost and token totals.

Full context, plan and discussion live in [./context.md](./context.md).
