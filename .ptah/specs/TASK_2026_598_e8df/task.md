---
id: TASK_2026_598_e8df
status: backlog
type: BUGFIX
title: Confirm before a stored-key change ends running chat sessions
depends_on: []
created: "2026-10-03T12:09:56.581Z"
updated: "2026-10-03T12:09:56.581Z"
description: "ConfigWatcher ends every live session on any ptah.auth.* secret write (Replace/Delete key, Cursor credential, Ptah instance key) without a confirm; decide confirm vs. in-place refresh and implement it."
executor: backend-developer
estimate: M
labels:
  - settings
  - providers
  - needs-decision
relates_to:
  - TASK_2026_555
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

ConfigWatcher ends every live session on any ptah.auth.* secret write (Replace/Delete key, Cursor credential, Ptah instance key) without a confirm; decide confirm vs. in-place refresh and implement it.

Full context, plan and discussion live in [./context.md](./context.md).
