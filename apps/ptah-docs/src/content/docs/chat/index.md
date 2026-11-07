---
title: Chat
description: The PtahCode chat view, where you work with AI coding agents.
sidebar:
  order: 1
---

# Chat

The chat view is where you talk to the agent. It streams responses, shows each tool call and sub-agent inline, and keeps the session cost and token counts in view.

![Chat overview](/screenshots/chat-overview.png)

## What the chat gives you

- **Streaming responses** from the provider and model that you select.
- **`@` autocomplete** to attach workspace files and folders, and **`/`** to run slash commands.
- **Image attachments** by paste or drag and drop.
- **Effort selector** to set the reasoning effort of the model.
- **Autopilot** (approval mode) to control which actions the agent can do without a prompt.
- **Token and cost counts** for the session.
- **Execution Tree** that shows the sub-agents, tool calls, and thinking blocks of each turn.

## Composer controls

| Control         | What it does                                                      |
| --------------- | ----------------------------------------------------------------- |
| Message input   | Type the prompt. Supports `@` file mentions and `/` commands.     |
| Model selector  | Selects the model for the session.                                |
| Effort selector | Selects the reasoning effort.                                     |
| Approval chip   | Opens the Autopilot settings. It shows the current approval mode. |
| MCP chip        | Shows the MCP servers that the session can reach.                 |
| Send / Stop     | Sends the message, or stops the current response.                 |

## Where to go next

- [Sending messages](/chat/sending-messages/)
- [File attachments](/chat/file-attachments/)
- [Effort levels](/chat/effort-levels/)
- [Autopilot](/chat/autopilot/)
- [Cost and tokens](/chat/cost-and-tokens/)
- [Execution Tree](/chat/execution-tree/)
- [Switching models](/chat/switching-models/)
