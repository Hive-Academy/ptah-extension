---
id: TASK_2026_586_2b3e
status: in_progress
type: BUGFIX
title: 'Thoth activity feed correctness: newest-first, real event ids, grouping, no overlapping summary, tile refresh'
depends_on: []
created: "2026-10-01T00:00:00.000Z"
updated: "2026-10-01T00:00:00.000Z"
description: 'Phase 4 of the Thoth rework. The activity feed shows the oldest end of the newest window, tracks rows by timestamp+kind, repeats one analyze-run per session per drain tick, mounts two overlapping summaries, and the shell tiles load once and freeze.'
estimate: M
parent: TASK_2026_439_1310
labels:
  - TASK_2026_439_1310
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Phase 4 of the Thoth rework. The activity feed shows the oldest end of the newest window, tracks rows by timestamp+kind, repeats one analyze-run per session per drain tick, mounts two overlapping summaries, and the shell tiles load once and freeze.

Full context, plan and discussion live in [./context.md](./context.md).
