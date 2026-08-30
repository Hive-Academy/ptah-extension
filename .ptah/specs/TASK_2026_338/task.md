---
id: TASK_2026_338
status: backlog
type: BUGFIX
title: >-
  Nothing shuts down CodeExecutionMCP on any host, and start/stop race on
  unlocked shared fields
description: >-
  `CodeExecutionMCP.stop()`, `dispose()` and `disposeAsync()` are called only
  from inside the class and from its own specs. An exhaustive grep of both hosts
  found no wiring: Electron's `disposeBootRefs`
  (`apps/ptah-electron/src/activation/shutdown.ts:103-144`) never mentions it,
  VS Code's `deactivate()` (`apps/ptah-extension-vscode/src/main.ts:117-189`)
  never mentions it, and `PtahExtension.dispose()`
  (`apps/ptah-extension-vscode/src/core/ptah-extension.ts:189-198`) only iterates
  a disposables array the service is never pushed into. So the MCP HTTP server
  and its `.mcp.json` entry outlive every ordinary shutdown, and the `ptah` entry
  is left advertising a port nothing is listening on until the next launch
  rewrites it. Second, smaller defect in the same lifecycle: `start()` assigns
  `this.server` and `this.port` outside any lock or queue after `startHttpServer`
  resolves, so a `stop()` overlapping a `start()` can read `this.server === null`,
  no-op its teardown, and then have `start()` overwrite `stop()`'s trailing
  null-reset — leaving a live listener the service believes is stopped. Both are
  pre-existing and neither is currently reachable, precisely BECAUSE nothing
  calls stop. They become live together the moment the first one is fixed, which
  is why they are one task.
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
