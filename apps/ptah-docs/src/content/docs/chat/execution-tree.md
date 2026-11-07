---
title: Execution Tree
description: See the sub-agents, tool calls, and thinking blocks of each turn.
sidebar:
  order: 7
---

# Execution Tree

The Execution Tree shows what happened during a turn. Each assistant message renders as a tree of nodes in the transcript.

![Execution Tree for a complex turn](/screenshots/chat-execution-tree.png)

## Node types

| Node         | Meaning                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| **Message**  | A user message or an assistant message.                                                |
| **Text**     | Markdown text from the model.                                                          |
| **Thinking** | A reasoning block, for providers that send one.                                        |
| **Tool**     | One tool call, such as Read, Write, Bash, or an MCP tool, with its input and result.   |
| **Agent**    | A sub-agent that the turn started. It contains its own tree.                           |
| **System**   | A system message, such as the session start or the turn result.                        |

## Nested agents

A sub-agent can start its own sub-agents. The tree shows each one inside its parent. Collapse a branch to hide it.

:::tip
Open the tree to see which files the agent read, or which sub-agent used the most tokens.
:::
