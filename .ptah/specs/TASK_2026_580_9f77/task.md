---
id: TASK_2026_580_9f77
status: backlog
type: FEATURE
title: 'Organize sessions: priority, workflow status, worktree and PR links, and links to tasks'
depends_on: []
estimate: L
created: '2026-09-30T14:06:07.000Z'
updated: '2026-09-30T14:06:07.000Z'
description: 'Sessions carry only a name, timestamps and a working directory, and the list sorts by last activity with client-side search over loaded pages. Add a SQLite-backed organization record per session (priority, workflow status, pin, worktree, branch, PR links) and a session-task link table, with server-side filter and sort, automatic capture from worktree hooks, gh pr create and board starts, and session links on task cards'
labels:
  - sessions
  - tasks
relates_to:
  - TASK_2026_471_c054
  - TASK_2026_419_95af
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Sessions carry only a name, timestamps and a working directory, and the list sorts by last activity with client-side search over loaded pages. Add a SQLite-backed organization record per session (priority, workflow status, pin, worktree, branch, PR links) and a session-task link table, with server-side filter and sort, automatic capture from worktree hooks, gh pr create and board starts, and session links on task cards

Full context, plan and discussion live in [./context.md](./context.md).
