---
id: TASK_2026_318
status: backlog
type: BUGFIX
title: >-
  CodeExecutionMCP is a second, unlocked writer on .mcp.json, and TASK_2026_315
  widened the window it can fire in
description: >-
  `harness-sync` documents the rule this breaks in its own design note: "Never
  add a SECOND writer to an MCP config file... A module that hand-rolls its own
  read-modify-write on a file this lib also writes will lose an entry — not
  corrupt it, lose it, silently." `CodeExecutionMCP` does exactly that. Its
  `registerInMcpJson` and `unregisterFromMcpJson`
  (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`)
  perform raw `fs.readFileSync` / `fs.writeFileSync` on `{ws}/.mcp.json`
  outside `withMcpConfigLock`. It is safe today only by coincidence — the two
  writers happen to run sequentially at boot, and `"ptah"` is a key the
  reconciler never inspects. TASK_2026_315's A3 fix (commit `3cfba7b`) made the
  window wider and that should be stated plainly: before it,
  `ensureRegisteredForSubagents` was one-shot at boot; A3 added a
  `workspaceFoldersSubscription` (`http-mcp-server.service.ts:97-100`) so the
  second workspace actually receives an entry, which was the correct fix for a
  real defect. But `propagateHarness()` (`apps/ptah-electron/src/activation/wire-runtime.ts:499`)
  fires on that same `onDidChangeWorkspaceFolders` event and is not awaited, so
  both writers can now be triggered by one event where previously they could
  not. Nothing has been observed failing — a lost update needs the two to
  interleave mid-write on a key the reconciler would then have to care about —
  but this is structurally the forbidden pattern and it is now closer to
  firing. Fix by routing the `CodeExecutionMCP` writes through
  `withMcpConfigLock`, or by giving `.mcp.json` a single owner. Surfaced by
  TASK_2026_315 batch 7 while tracing a different question (F8); recorded there
  as F12.
---

# CodeExecutionMCP writes .mcp.json outside the harness-sync lock

Machine-owned metadata carrier. Prose lives in `./context.md`.
