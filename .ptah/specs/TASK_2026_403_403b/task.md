---
id: TASK_2026_403_403b
status: in_review
type: refactoring
title: >-
  Make task ids collision-proof across worktrees and open PRs with a unique suffix
description: >-
  Task folders are allocated as highest local NNN plus one, so every worktree and
  open PR runs its own counter and two branches mint the same TASK_YYYY_NNN. On rebase
  or merge git writes one task.md over the other with no conflict. Keep the sortable
  number and append a short random suffix (TASK_YYYY_NNN_xxxx) so two allocations of
  the same number can never share a folder, and widen the allocator scan to origin/main
  and every worktree so duplicate numbers become rare as well as harmless.
---

See context.md for the evidence (three collisions in one week, one inside the PR that
was opened to fix the previous one) and the touch-point list.
