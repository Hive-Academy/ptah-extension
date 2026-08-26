---
id: TASK_2026_315
status: done
type: BUGFIX
title: >-
  Thirteen defects found in one Electron session log — no-workspace guardrails,
  boot ordering, and misreported outcomes
description: >-
  A single dev-session Electron log (`tmp/logs/log.log`, 1177 lines, one boot
  plus two workspace removals) surfaced thirteen distinct defects. The
  load-bearing group is four missing no-workspace guardrails: removing the LAST
  workspace folder makes `SdkAgentAdapter.handleWorkspaceChanged`
  (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:186`) re-resolve auth
  against the global default, refresh an OAuth token and bind a Codex
  translation proxy on 127.0.0.1 that nothing can use and
  `providerProxyPool.disposeForScope` cannot reach; `TasksStore` keeps
  refetching `tasks:board` on every window focus and paints an error banner
  instead of a no-workspace empty state; `http-mcp-server.service.ts`
  unregisters `.mcp.json` from the CURRENT workspace root rather than the path
  it wrote, orphaning a dead-port `ptah` entry in the removed folder and never
  registering the new one; and `memory:stats` with no `workspaceRoot` omits its
  WHERE clause entirely, returning the union across every workspace. Two more
  are lifecycle ordering — a boot-time curator LLM query that runs before
  `bringUpSubsystems` starts MCP, and two IpcBridge messages dropped because no
  window exists yet. The remaining seven are correctness-of-reporting and noise:
  `generate_session_title` handing a raw provider id to the CLI, cron logging
  `run succeeded` for drains that skipped on an exhausted token budget, a worker
  heap 23 percent over its stated budget with no action taken, and four repeated
  ENOENT / diagnostic emissions. Full evidence with log line numbers and code
  citations in `./context.md`.
updated: '2026-08-25T21:29:37.885Z'
---

# Thirteen defects from one Electron session log

Machine-owned metadata carrier. Prose lives in `./context.md`.
