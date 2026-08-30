---
id: TASK_2026_185
status: done
type: FEATURE
title: C5 bulk label add and remove across a selection
description: >-
  The designated P2 cut from TASK_2026_181, deferred by decision rather than
  lapse. Adds bulk label add/remove over a multi-task selection, reusing the
  write funnel, chunked loop, cancellation, confirmation and three-group summary
  that TASK_2026_181 built and verified. Two batches - backend (13) then
  frontend (14) - and the Phase 8 gate is asserted on the PAIR, not on either
  half. Also owns the one dangling contract field TASK_2026_181 shipped -
  TasksBulkResultItem.noop has no producer, and this task must either give it
  one or delete it.
assignee: null
depends_on:
  - TASK_2026_181
executor: null
claim: null
created: 2026-08-05T00:00:00.000Z
updated: '2026-08-25T21:11:45.433Z'
---

## Description

Machine-owned metadata carrier. Prose lives in `./context.md`.
