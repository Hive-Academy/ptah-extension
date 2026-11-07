---
id: TASK_2026_339
status: backlog
type: BUGFIX
title: >-
  Register MCP for subagents on the two resume paths that only assume it
updated: 2026-11-07T00:00:00.000Z
description: >-
  `chat:resume` with `activate: true` and `ensureSessionActiveForRewind` resume a session with
  `mcpServerRunning: true` but never call `ensureRegisteredForSubagents()`. Decide whether they
  register (and report the real result) or report `false`, then remove the optimistic default.
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

## Description

The `mcpServerRunning` flag comes from the HTTP port being live. It says nothing about whether
a `ptah` entry exists in the workspace `.mcp.json`, which is what a subagent reads. All paths
are in `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`. Remaining work:

- Decide for both callers: register on the path (preferred, gives a real
  `McpSubagentRegistration` result) or pass `false`.
  - `chat:resume` with `params.activate === true` (:2164, calls `autoResumeIfInactive` at :2185).
  - `ensureSessionActiveForRewind` (:2451, calls `autoResumeIfInactive` at :2484).
- Then remove the `mcpRegisteredForSubagents = true` default of `autoResumeIfInactive`
  (:2549-2563) so every caller passes a real value.
- Specs: a failed or timed-out registration degrades the flag on both paths.

## Current state (2026-11-07)

- Not fixed. The comment at :2555-2561 still says the two callers "never call
  `ensureRegisteredForSubagents` at all".
- Done earlier (TASK_2026_332): the `chat:continue` path registers and passes the real result
  (:1756-1760, :1818).
- The `--activate` wording in the old description is the `activate: true` RPC param, not a CLI
  flag.
