---
id: TASK_2026_676_a876
status: in_review
type: BUGFIX
title: Recompute latestTodoWrite in the resync owner live state
depends_on: []
created: "2026-10-14T20:27:01.878Z"
updated: "2026-10-14T20:27:01.878Z"
description: "After PR 727 and the TASK_2026_629 board merge, the rebuilt owner state copies a stale latestTodoWrite marker, so the compact tile shows unknown todos."
executor: frontend-developer
estimate: XS
labels:
  - follow-up
relates_to:
  - TASK_2026_655_5c1e
  - TASK_2026_629_c0b3
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

After PR 727 and the TASK_2026_629 board merge, the rebuilt owner state copies a stale latestTodoWrite marker, so the compact tile shows unknown todos.

Full context, plan and discussion live in [./context.md](./context.md).
