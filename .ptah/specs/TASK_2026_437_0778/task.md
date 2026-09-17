---
id: TASK_2026_437_0778
status: done
type: BUGFIX
title: Keep the Electron main process responsive under heavy file-system and process load
depends_on: []
created: '2026-09-14T13:30:00.000Z'
updated: '2026-09-14T13:30:00.000Z'
description: >-
  An agent removing 10 worktrees in one Bash command froze the whole Electron
  app, including two other live sessions and three canvas tiles. Neither the git
  watcher nor the file-index watcher ignores agent worktree folders, git status
  runs overlap, and heavy work shares the single main event loop. Find every
  path by which long or heavy work reaches the main process, and isolate it so
  long-running node processes cannot degrade the app.
executor: software-architect
estimate: L
labels:
  - performance
  - reliability
relates_to:
  - TASK_2026_411
  - TASK_2026_430
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

Electron main event loop froze during a bulk worktree delete; isolate heavy work from the main process.

Full context, plan and discussion live in [./context.md](./context.md).
