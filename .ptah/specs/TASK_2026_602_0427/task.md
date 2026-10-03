---
id: TASK_2026_602_0427
status: backlog
type: BUGFIX
title: Handle an unreadable key in the setup wizard and drop stale check verdicts
depends_on: []
created: "2026-10-03T12:10:01.948Z"
updated: "2026-10-03T12:10:01.948Z"
description: "The setup wizard treats a keyUnreadable connection as \"no stored credential\"; the original caller of auth:checkConnection can still receive the old key's verdict after a key change."
executor: frontend-developer
estimate: S
labels:
  - settings
  - providers
relates_to:
  - TASK_2026_555
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

The setup wizard treats a keyUnreadable connection as "no stored credential"; the original caller of auth:checkConnection can still receive the old key's verdict after a key change.

Full context, plan and discussion live in [./context.md](./context.md).
