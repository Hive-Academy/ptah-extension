---
id: TASK_2026_338
status: backlog
type: BUGFIX
title: >-
  Stop CodeExecutionMCP on Electron shutdown and serialize its start and stop
updated: 2026-11-07T00:00:00.000Z
description: >-
  Electron never calls `CodeExecutionMCP.stop()` or `disposeAsync()`, so the MCP HTTP server
  and its `.mcp.json` entry outlive shutdown. Wire the stop into `disposeBootRefs`, and fix the
  start/stop race on `this.server` / `this.port`, which becomes reachable once stop is wired.
relates_to:
  - TASK_2026_332
  - TASK_2026_318
labels:
  - vscode-lm-tools
  - lifecycle
  - shutdown
executor: backend-developer
estimate: M
---

# CodeExecutionMCP is never shut down, and start/stop can race

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

The class is in `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`.
Remaining work:

1. Shutdown: call `disposeAsync()` (:875) with a bounded budget from `disposeBootRefs`
   (`apps/ptah-electron/src/activation/shutdown.ts:583`). Remove or rewrite the `ptah` entry in
   `.mcp.json` so it does not advertise a dead port.
2. Race: `start()` (:445) assigns `this.server` and `this.port` (:490-491) after an `await`
   with no lock, and `stop()` (:735) resets them (:750-751). Serialize start and stop (one
   promise chain or a lifecycle mutex) so an overlapping stop cannot leave a live listener.
3. Specs for both: stop during start, and shutdown that tears the server down.

## Current state (2026-11-07)

- Not fixed. Electron starts the server through `startCodeExecutionMcp`
  (`libs/backend/vscode-core/src/services/subsystem-bringup.ts:67`, called from
  `apps/ptah-electron/src/activation/wire-runtime.ts:448`), but `disposeBootRefs` stops only the
  Codex sign-in, the messaging gateway and persistence.
- The VS Code host paths in `context.md` (`apps/ptah-extension-vscode/src/main.ts`,
  `ptah-extension.ts`) were removed in `1cee6fafe`. Electron is the only host to wire.
- The line numbers in `context.md` for `shutdown.ts:103-144` are out of date.
