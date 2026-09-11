---
id: TASK_2026_419_95af
status: in_review
type: BUGFIX
title: Preserve worktree context when resuming sessions
depends_on: []
created: '2026-09-11T01:05:21.280Z'
updated: '2026-09-11T02:02:46.815Z'
description: >-
  Persist and restore the session working directory and resumable subagent
  registry so a session started in a git worktree does not resume against the
  main checkout with lost agent continuity.
executor: backend-developer
estimate: M
labels:
  - performance
relates_to:
  - TASK_2026_410
  - TASK_2026_411
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Persist and restore the session working directory and resumable subagent registry so a session started in a git worktree does not resume against the main checkout with lost agent continuity.

Full context, plan and discussion live in [./context.md](./context.md).
