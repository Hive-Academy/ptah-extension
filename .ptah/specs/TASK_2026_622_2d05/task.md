---
id: TASK_2026_622_2d05
status: backlog
type: BUGFIX
title: Fix the 0xC0000409 fail-fast in SQLite close after sqlite-vec writes (WAL checkpoint)
depends_on: []
created: "2026-10-06T22:30:48.630Z"
updated: '2026-10-12T19:41:51.738Z'
description: "SqliteConnectionService.close() dies with 0xC0000409 inside wal_checkpoint(TRUNCATE) in 50-80% of win32 shutdowns once embeddings were written to vec0 tables. Found by the TASK_2026_619 bench (Batch 4d bisect). Check Electron, and the risk to the user's database."
estimate: M
labels:
  - persistence
  - sqlite-vec
  - crash
  - P1
relates_to:
  - TASK_2026_619_af7f
parent: TASK_2026_635_5ea5
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

SqliteConnectionService.close() dies with 0xC0000409 inside wal_checkpoint(TRUNCATE) in 50-80% of win32 shutdowns once embeddings were written to vec0 tables. Found by the TASK_2026_619 bench (Batch 4d bisect). Check Electron, and the risk to the user's database.

Full context, plan and discussion live in [./context.md](./context.md).
