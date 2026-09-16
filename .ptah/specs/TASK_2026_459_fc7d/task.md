---
id: TASK_2026_459_fc7d
status: backlog
type: FEATURE
title: Show the Ptah title for peer sessions started by another workspace window
depends_on:
  - TASK_2026_449
created: '2026-09-16T04:00:00.000Z'
updated: '2026-09-16T04:00:00.000Z'
description: >-
  PeerSessionDirectory joins ptahTitle from SessionMetadataStore, which reads
  the active workspace delegate only, so a row started by another workspace
  window shows the registry name alone. Add a read-only aggregate reader over
  IWorkspaceScopedStateStorage so every workspace open in this process
  contributes a title.
executor: backend-developer
estimate: M
labels:
  - peer-sessions
  - agent-messaging
relates_to:
  - TASK_2026_449
  - TASK_2026_452
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Peer rows from another workspace window carry no Ptah title.

Full context, plan and discussion live in [./context.md](./context.md).
