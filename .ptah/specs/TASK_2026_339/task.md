---
id: TASK_2026_339
status: backlog
type: BUGFIX
title: >-
  Two resume paths tell the session MCP is running without ever registering it
description: >-
  `chat:resume --activate` and `ensureSessionActiveForRewind` both resume a
  session with `mcpServerRunning: true` while never calling
  `ensureRegisteredForSubagents()` at all. The flag is derived from the HTTP
  port being live, which says the server is listening — it says nothing about
  whether a `ptah` entry exists in that workspace's `.mcp.json`, which is what a
  subagent actually reads. TASK_2026_332 fixed the same class of assumption on
  the five paths that DO register: they now consume a typed
  `McpSubagentRegistration` result and set the flag from it, so a lock timeout or
  a write failure degrades the flag honestly instead of resolving silently. These
  two paths were left because they were out of that task's scope and because
  fixing them is a different question — they never register, so there is no
  result to consume, and the right answer might be to register on those paths
  too rather than to report `false`. That is the decision this task exists to
  make. Note `autoResumeIfInactive`'s new `mcpRegisteredForSubagents` parameter
  defaults to `true` precisely to avoid silently downgrading these two callers,
  so the optimistic answer is currently deliberate and documented rather than
  accidental.
relates_to:
  - TASK_2026_332
labels:
  - rpc-handlers
  - vscode-lm-tools
  - mcp
executor: backend-developer
estimate: S
---

# Two resume paths assert mcpServerRunning without registering

Machine-owned metadata carrier. Prose lives in `./context.md`.
