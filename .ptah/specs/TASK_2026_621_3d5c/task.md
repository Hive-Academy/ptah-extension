---
id: TASK_2026_621_3d5c
status: in_review
type: BUGFIX
title: >-
  Stop retention from deleting unprocessed observations and find why extraction
  stopped
depends_on: []
created: '2026-10-06T19:57:15.833Z'
updated: '2026-10-06T22:07:12.451Z'
description: >-
  Extraction stopped 2026-09-24..10-01; 59,614 observations unprocessed;
  retention deletes unprocessed rows at 14 days (first deletions ~2026-10-08).
  Make retention never delete unprocessed rows, and find and fix the root cause
  of the stop.
estimate: M
labels:
  - memory-curator
relates_to:
  - TASK_2026_620_a13e
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Extraction stopped 2026-09-24..10-01; 59,614 observations unprocessed; retention deletes unprocessed rows at 14 days (first deletions ~2026-10-08). Make retention never delete unprocessed rows, and find and fix the root cause of the stop.

Full context, plan and discussion live in [./context.md](./context.md).
