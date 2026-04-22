---
title: Sending messages
description: Compose prompts, stream responses, and abort long-running turns.
sidebar:
  order: 2
---

# Sending messages

The composer at the bottom of the chat is a multi-line input with support for Markdown, fenced code blocks, and `@` mentions. Ptah streams the response token-by-token as soon as the provider starts producing output.

## Composing a prompt

- **Enter** sends the message.
- **Shift + Enter** inserts a newline.
- **Ctrl/Cmd + Enter** also sends — useful when you want to use Enter for newlines exclusively.
- Paste images, files, or folders directly into the composer. Files are attached as context; images are sent inline to providers that support vision.

:::tip
Use fenced code blocks (triple backticks) when pasting snippets. Ptah preserves language hints and syntax-highlights them in the transcript.
:::

## Streaming responses

Responses stream in real time. You will see:

1. **Thinking blocks** (for reasoning-capable models like Claude Sonnet/Opus and GPT-5 family) render as collapsed cards at the top of the response.
2. **Tool calls** render as inline cards with the tool name, arguments, and result.
3. **Assistant text** streams below, with Markdown rendered progressively.

Sub-agents spawned during the turn appear in the [Execution Tree](/chat/execution-tree/) on the right.

## Stopping a response

Click **Stop** (or press **Esc**) to abort the current turn. Ptah:

- Cancels the in-flight provider request.
- Cleans up any pending tool calls so you don't end up with orphaned `tool_use` blocks on the next turn.
- Preserves partial output — you keep whatever the model produced before you stopped.

:::caution
If you abort while a sub-agent is running, the sub-agent is asked to wrap up cleanly before the parent turn ends. This can take a second or two. Hitting Stop a second time forces immediate termination.
:::

## Resuming a conversation

Every message you send is checkpointed. Closing and reopening Ptah restores the full transcript, including the Execution Tree. Use **New chat** to start a fresh session, or **Fork** on any assistant message to branch the conversation from that point.
