---
id: TASK_2026_573_e2bf
status: backlog
type: BUGFIX
title: 'Close quarantine test gaps on node:sqlite and pin restore'
depends_on: []
created: '2026-09-26T20:53:55.778Z'
updated: '2026-09-26T20:53:55.778Z'
description: 'New real-SQLite quarantine specs ran only on better-sqlite3 (node:sqlite fallback unverified); add a spec that an unpin on a quarantined pinned row keeps pinned=1 after restore'
labels:
  - memory-curator
relates_to:
  - TASK_2026_563_2939
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

New real-SQLite quarantine specs ran only on better-sqlite3 (node:sqlite fallback unverified); add a spec that an unpin on a quarantined pinned row keeps pinned=1 after restore

Full context, plan and discussion live in [./context.md](./context.md).
