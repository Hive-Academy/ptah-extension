---
title: Cost and tokens
description: Token and cost tracking for chat sessions.
sidebar:
  order: 6
---

# Cost and tokens

PtahCode counts the tokens of each turn and shows the session totals and cost.

![Cost summary card at the top of the chat](/screenshots/chat-cost-bar.png)

## What PtahCode counts

- Input tokens and output tokens.
- Cache reads and cache creation, for providers that support prompt caching. Cache reads cost less than fresh input tokens.
- The cost of each model in the session.

The session statistics count lane runs separately from the session totals.

## Where the price comes from

- PtahCode gets OpenRouter prices from the OpenRouter model registry.
- For a subscription provider, such as Kimi Code, the plan covers the cost. PtahCode still counts the tokens.

## MCP chip

The **MCP** chip in the composer shows how many MCP servers the session can reach. Click it to see each server and its status. A server that needs authorization has an **Authorize** button.

Refer to [Connectors](/marketplace/connectors/#the-mcp-chip-in-chat) for more information.
