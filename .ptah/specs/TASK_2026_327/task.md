---
id: TASK_2026_327
status: in_review
type: BUGFIX
title: >-
  Bound the renderer tree caches and make tab restore and the agent monitor cap
  safe
depends_on: []
created: '2026-08-26T02:25:23.628Z'
updated: '2026-08-27T16:47:49.159Z'
description: >-
  nodesById and fingerprintsById grow without bound past the event cap; the
  workspace-scoped tab loader keeps phantom statuses and stale queuedContent;
  the 2000-event monitor cap blanks message bodies and tool inputs;
  flushUpdatesSync is unscoped dead code; the render-throttle destroy spec is
  weak; eventsByMessage keeps a stale object after backfill.
executor: frontend-developer
estimate: M
labels:
  - regression-review
  - chat-streaming
relates_to:
  - TASK_2026_323
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

nodesById and fingerprintsById grow without bound past the event cap; the workspace-scoped tab loader keeps phantom statuses and stale queuedContent; the 2000-event monitor cap blanks message bodies and tool inputs; flushUpdatesSync is unscoped dead code; the render-throttle destroy spec is weak; eventsByMessage keeps a stale object after backfill.

Full context, plan and discussion live in [./context.md](./context.md).
