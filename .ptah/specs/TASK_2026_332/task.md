---
id: TASK_2026_332
status: done
type: BUGFIX
title: >-
  CodeExecutionMCP workspace re-pointing has no operation queue, and the
  .mcp.json lock writes anyway after its timeout
description: >-
  TASK_2026_318 put every CodeExecutionMCP `.mcp.json` write inside
  `withMcpConfigLock` and its cross-vendor review confirmed no unlocked writer
  remains. Two adjacent defects that the per-file lock cannot reach were found
  in the same review. First, workspace re-pointing became asynchronous and
  fire-and-forget with no operation-level queue
  (`http-mcp-server.service.ts:101-110`, `:201-210`, `:318-319`, `:343-372`):
  rapid A to B to C workspace changes can make two operations both capture A and
  then independently write B and C, stranding a live `ptah` entry in B, and a
  `stop()` arriving right after a switch can finish unregistering A while an
  outstanding event writes B back with a dead port. The per-file lock does not
  help, because the racing writes target different files. Second,
  `mcp-config-lock.ts:48-70` and `file-lock.ts:187-215` return `UNLOCKED` after
  two seconds of cross-process contention and then run the mutation anyway, so a
  slow Electron and VS Code overlap reintroduces exactly the lost update
  TASK_2026_318 removed. The timeout is a deliberate liveness bound, so the fix
  is a decision about what to do when it expires, not a longer timeout.
relates_to:
  - TASK_2026_318
labels:
  - harness-sync
  - vscode-lm-tools
  - concurrency
executor: backend-developer
estimate: S
---

# CodeExecutionMCP re-pointing race and the unlocked-after-timeout write

Machine-owned metadata carrier. Prose lives in `./context.md`.
