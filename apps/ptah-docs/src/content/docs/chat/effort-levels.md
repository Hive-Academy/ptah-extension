---
title: Effort levels
description: Set how much the model reasons before it replies.
sidebar:
  order: 4
---

# Effort levels

The effort selector in the composer sets the reasoning effort of the model. More effort gives deeper answers, but responses are slower and use more tokens.

## The levels

| Level       | Description                          |
| ----------- | ------------------------------------ |
| **Default** | SDK default reasoning effort.        |
| **Low**     | Faster responses, less reasoning.    |
| **Medium**  | Balanced speed and reasoning.        |
| **High**    | More thorough reasoning.             |
| **X-High**  | Extra-deep reasoning (Opus tier).    |
| **Max**     | Maximum reasoning depth (Opus tier). |

## How the setting applies

- The selected level stays until you change it. PtahCode saves it for the active provider.
- A change applies to the live session at once.
- In a canvas tile, the selector sets the level for that tile only.

:::tip
Higher levels use more tokens. Examine the [cost and token counts](/chat/cost-and-tokens/) when you use them.
:::
