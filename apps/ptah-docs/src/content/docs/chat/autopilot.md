---
title: Autopilot
description: Let Ptah spawn specialist sub-agents automatically based on conversation context.
sidebar:
  order: 5
---

# Autopilot

Autopilot lets the main chat agent decide, in real time, whether a subtask should be handed to a specialist sub-agent instead of answered directly. It is the same mechanism the `/orchestrate` workflow uses — exposed as a toggle in the chat header so you get it on every turn.

![Autopilot toggle in the chat header](/screenshots/chat-autopilot-toggle.png)

## How it works

When Autopilot is on:

1. The main agent sees the full catalog of available agents — built-in specialists, `.claude/agents/` entries, and any detected CLI agents (ptah-cli, Gemini, Codex, Copilot).
2. As the conversation progresses, the agent can call `ptah_agent_spawn` to delegate a well-scoped subtask.
3. Sub-agents run in parallel (up to three concurrent by default), stream their output into the [Execution Tree](/chat/execution-tree/), and report back.
4. The main agent integrates the results and continues the conversation.

When Autopilot is off, the main agent answers everything itself. Tool calls still happen, but no sub-agents are spawned.

## When Autopilot shines

- **Multi-file features** — a frontend agent, a backend agent, and a test agent can work in parallel.
- **Cross-cutting refactors** — one agent per package or layer.
- **Research tasks** — spawn two or three readers at once to explore different areas of the codebase concurrently.

## When to turn it off

- **Short, conversational turns** where the overhead of a sub-agent isn't worth it.
- **Tight-budget work** — each sub-agent has its own context and adds to the session cost.
- **Deterministic flows** where you want the main agent to stay in control end-to-end.

## Selection priority

When Autopilot picks a CLI agent to run a subtask, it uses this priority:

`ptah-cli > gemini > codex > copilot`

You can disable specific CLIs from the agent orchestration settings (`agentOrchestration.disabledClis` in `~/.ptah/settings.json`), which removes them from Autopilot's candidate pool.

:::tip
The [Execution Tree](/chat/execution-tree/) is the single best way to understand what Autopilot actually did. Open it for any turn to see every spawn, the prompt it was given, and the tokens it consumed.
:::
