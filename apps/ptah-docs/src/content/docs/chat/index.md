---
title: Chat
description: The Ptah chat interface — your command center for working with AI coding agents.
sidebar:
  order: 1
---

# Chat

The Chat view is where you talk to Ptah. It combines a streaming conversation UI with first-class support for multi-file context, agent orchestration, and cost tracking — so you can stay in one place while Ptah coordinates work across providers and sub-agents.

![Chat overview](/screenshots/chat-overview.png)

## What the chat gives you

- **Streaming responses** from whichever provider you have selected (Claude, Copilot, Codex, Gemini, Ollama, OpenRouter, or a custom CLI agent).
- **`@` autocomplete** to attach files, folders, agents, and skills from your workspace as context.
- **Effort levels** (Quick, Balanced, Thorough) that tune latency, cost, and depth in a single click.
- **Autopilot** that watches the conversation and spawns specialist sub-agents when the work calls for it.
- **Live cost and token counters** per message and per session, with accurate pricing pulled from OpenRouter for third-party models.
- **Execution Tree** — a recursive visualization of every sub-agent spawn, tool call, and thinking block in the turn.
- **In-chat model switcher** so you can change providers mid-conversation without losing your thread.

:::tip
You can open the chat from the sidebar, the activity bar icon, or with the command palette entry **Ptah: Focus Chat**.
:::

## Anatomy of a chat session

| Area            | What it does                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------- |
| Composer        | Where you type. Supports `@` mentions, multi-line input, and drag-and-drop file attachments.    |
| Messages        | Streaming assistant output, your messages, and inline tool-call cards.                          |
| Execution Tree  | A collapsible tree showing every sub-agent, tool call, and thinking block for the current turn. |
| Cost bar        | Running totals for the session — tokens in / out, cache hits, and USD cost.                     |
| Model selector  | Switch provider and model without starting a new conversation.                                  |
| Effort selector | Pick Quick, Balanced, or Thorough for the next message.                                         |

## Where to go next

<div class="sl-cards">

- [Sending messages](/chat/sending-messages/) — composing, streaming, and aborting responses.
- [File attachments](/chat/file-attachments/) — the `@` autocomplete and unified suggestions dropdown.
- [Effort levels](/chat/effort-levels/) — when to use Quick, Balanced, or Thorough.
- [Autopilot](/chat/autopilot/) — let Ptah spawn sub-agents automatically.
- [Cost and tokens](/chat/cost-and-tokens/) — understand what each turn costs.
- [Execution Tree](/chat/execution-tree/) — inspect how a response was produced.
- [Switching models](/chat/switching-models/) — change provider mid-conversation.

</div>
