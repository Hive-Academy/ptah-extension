---
status: backlog
type: BUGFIX
title: Make spawned-agent lifecycle reporting honest about not-found and stuck agents
updated: 2026-11-07T00:00:00.000Z
description: >-
  Completed agents are now retained and restored, and lane completion is pushed. Two items
  remain: the "Agent not found" text still asserts a cause it does not know, and a silent,
  idle agent is still reported as `running` until the inactivity timeout stops it.
---

Observed on 2026-09-12 while orchestrating TASK_2026_402_a5c7 and a CI fix on
pull request #494. Six spawns, six agents that finished their work correctly,
and three different ways the lifecycle reporting was wrong about it.

None of these defects lost work. Every agent wrote its files and its report to
disk. What they cost was trust in the tool that reports status, and in one case
twenty minutes of a blocked caller.

**The orchestrator's workaround is already in place and is the reason this is
worth fixing: it stopped calling `ptah_agent_status` and started reading the
worktree instead.** A status tool nobody trusts is worse than no status tool,
because it still gets called by anything that does not know better.

Evidence and acceptance criteria are in `context.md`.

## Description

Remaining work:

1. Not-found text: `noSuchAgentMessage`
   (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1655-1662`)
   still says the id "was never persisted, or ... older than the retention window" and advises
   a re-spawn. State only what is known, and point to the worktree or report file before a
   re-spawn. Keep the `Agent not found: <id>` prefix; callers match on it.
2. Stuck signal: surface an agent that produces no output and uses no CPU for a bounded period
   in `ptah_agent_status` (`formatAgentStatus`,
   `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1920`),
   instead of plain `running`. Today only the inactivity watchdog acts, after
   `DEFAULT_INACTIVITY_TIMEOUT` (60 min, `agent-process-manager-helpers.ts:51`).
3. Defect 2 (a finished agent never reaching `completed`): re-check per CLI adapter. The Cursor
   case is TASK_2026_424_b6bf. If an adapter cannot detect completion, say so in status.

## Current state (2026-11-07)

- Done: completed records stay for `COMPLETED_AGENT_TTL` (30 min,
  `agent-process-manager-helpers.ts:54`), and restored agents survive a host restart.
- Done: lane completion is pushed to the parent session (TASK_2026_515, PR #555), so callers no
  longer need to poll.
- Not done: items 1 and 2. The jest handle leak behind Defect 3 is TASK_2026_427_f669 and is out
  of scope here.
