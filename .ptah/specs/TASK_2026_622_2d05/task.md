---
id: TASK_2026_622_2d05
status: backlog
type: BUGFIX
title: Fix the 0xC0000409 fail-fast in SQLite close after sqlite-vec writes (WAL checkpoint)
depends_on: []
created: "2026-10-06T22:30:48.630Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  SqliteConnectionService.close() dies with 0xC0000409 inside wal_checkpoint(TRUNCATE) in 50-80% of
  win32 bench shutdowns after vec0 writes. Check Electron, the database risk, and fix the close path.
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

## Description

The TASK_2026_619 bench (Batch 4d bisect, win32, Node v24) found that the process exits with
`0xC0000409` (fail-fast) on graceful shutdown in 50-80% of runs, inside
`wal_checkpoint(TRUNCATE)` in `SqliteConnectionService.close()`. The necessary conditions are
vectors written to `vec0` tables, then a WAL checkpoint at close. A standalone better-sqlite3 plus
sqlite-vec script did not reproduce it (0 of 20).

Answer and fix:

1. Does the Electron app crash the same way on quit after vector writes?
2. Data safety: is it only a lost checkpoint (the WAL replays at next open), or a sign of memory
   corruption in sqlite-vec? Run `PRAGMA integrity_check` on databases after crashed shutdowns.
3. The root cause in the sqlite-vec / better-sqlite3 versions, and the fix (version, close order,
   checkpoint mode, finalizing statements before close).
4. The boot-time crash at about 1.7 s, seen once in the no-embedder variant.

Reproduce with the `tools/mcp-bench` host: boot it on the corpus, make one
`ptah_code_search_symbols` call, end stdin. `PTAH_BENCH_BISECT=trace` prints the markers.

## Current state (2026-11-07)

- Not fixed. `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:524-541`
  still runs `wal_checkpoint(TRUNCATE)` (`:528`) before `database.close()`.
- No fix commit touched the close path since the report. The bisect flags are still in
  `tools/mcp-bench/src/transport/bench-host-boot.ts:190-203`.
- The bench host was a CLI-container host. The CLI app was removed (PR #892), so the Electron check
  (question 1) is now the main user-facing question.
- The source report is `../TASK_2026_619_af7f/batch-4d-executor-report.md` ("Task 4d.1").

Full context, plan and discussion live in [./context.md](./context.md).
