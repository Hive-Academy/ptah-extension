---
id: TASK_2026_292
status: backlog
type: bugfix
title: "Show whether a tracked CLI agent can accept another turn in ptah_agent_status"
description: >-
  `ptah_agent_message` already continues a finished live agent in place, but
  `ptah_agent_status` does not say whether an agent can take another turn. Add a truthful
  next-turn field and fallback guidance for finished, busy, unsupported and expired agents.
updated: 2026-11-07T00:00:00.000Z
---

# Relay follow-ups need a continuation verb, not a respawn

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

Remaining work:

- Add a next-turn capability to each agent row in `formatAgentStatus`
  (`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts:1920`).
  Derive it from the same checks `continueConversation` uses
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-message-router.service.ts:246`, `:297`).
- Give fallback guidance per case: busy (wait, then message), finished and alive (use
  `ptah_agent_message`), unsupported CLI or expired session (use `resume_session_id` on
  `ptah_agent_spawn`).
- Keep `ptah_agent_message` as the only follow-up verb. Do not add a new continue tool.

## Current state (2026-11-07)

- Done: the message router continues a finished live agent in place
  (`agent-message-router.service.ts:246`).
- Not done: `formatAgentStatus` lists status and the CLI session id but no next-turn field.
- Out of scope: the duplicate-tile symptom from `context.md`. It was seen on the Tribunal page,
  which was removed (`dea55817c`).
