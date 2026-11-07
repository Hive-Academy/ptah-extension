---
id: TASK_2026_423_bc0d
status: backlog
type: BUGFIX
title: Codex long-lived PowerShell child survives the codex.exe kill on Windows
updated: 2026-11-07T00:00:00.000Z
description: >-
  On Windows, `codex.exe` starts a long-lived `powershell.exe` child (the Rust command-safety
  AST parser). Ptah now owns the Codex app-server process but kills only `codex.exe`. Measure
  whether the PowerShell child outlives it, and if so kill the process tree.
---

Follow-up from TASK_2026_421. See `context.md`.

## Description

The Codex lane no longer runs through `@openai/codex-sdk`. It runs a Ptah-owned app-server
process (`libs/backend/codex-runtime/src/lib/codex-app-server-process.ts`), so Ptah knows the
child pid. Remaining work:

1. Measure on Windows: after `CodexAppServerProcess.close()` (:633), does the `powershell.exe`
   child outlive `codex.exe`? The forced kill is `this.child?.kill('SIGKILL')` (:679), which on
   Windows ends only the direct child.
2. If yes: kill the process tree for the known pid with the shared `killProcessTree` helper
   that `libs/backend/cli-agent-runtime` already uses
   (`agent-process-manager.service.ts`). Follow the rule that tree kills await a known pid.
3. Add a spec that `close()` requests a tree kill on Windows.

## Current state (2026-11-07)

- The SDK `CodexExec.run` path named in `context.md` is no longer used: no Ptah source imports
  `@openai/codex-sdk` (it is still listed in `package.json:92`). The Codex binary is located
  without the SDK (`a51a470ad`).
- `codex-app-server-process.ts` has no tree kill. No measurement on the app-server path exists.
