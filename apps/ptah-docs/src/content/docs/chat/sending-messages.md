---
title: Sending messages
description: Compose prompts, stream responses, and stop a response.
sidebar:
  order: 2
---

# Sending messages

The composer at the bottom of the chat is a multi-line input. The response streams as soon as the provider starts to send output.

## Compose a prompt

- Press **Enter** to send the message.
- Press **Shift + Enter** to add a new line.
- Type `@` to attach a file or folder. Refer to [File attachments](/chat/file-attachments/).
- Type `/` to select a slash command or prompt.
- Paste or drop an image to attach it.

## Streaming responses

The response shows these items as they arrive:

1. **Thinking blocks**, for models that send them.
2. **Tool calls**, with the tool name, the input, and the result.
3. **Assistant text**, with Markdown rendered as it streams.

Sub-agents that the turn starts show in the [Execution Tree](/chat/execution-tree/).

## Stop a response

Click **Stop generating** to stop the current turn. The output that the model sent before you stopped stays in the transcript.

## Branch a conversation

Hover over a message and click **Branch conversation from here**. PtahCode makes a new session from that point. The original session does not change.
