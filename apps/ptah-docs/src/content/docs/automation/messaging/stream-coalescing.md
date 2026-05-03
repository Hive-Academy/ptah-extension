---
title: Stream Coalescing
description: Why your chat won't flap when the agent streams a long reply.
---

# Stream Coalescing

LLM replies stream one token at a time. Edit-per-token is murder for chat apps — you'd hit rate limits in seconds and the conversation would shimmer like a stock ticker. The **StreamCoalescer** batches token deltas into a small number of message edits.

## How it works

```text
Agent emits token deltas
        ↓
Coalescer accumulates       → flush window: gateway.coalesceMs (default 800ms)
                              cap: ≤3 edits per ~250ms burst
        ↓
Platform message edit       → user sees the reply grow in chunks
        ↓
Final-message flush         → immediate; the closing edit happens with no delay
```

## Defaults

| Knob                 | Default | What it does                                                                 |
| -------------------- | ------- | ---------------------------------------------------------------------------- |
| `gateway.coalesceMs` | `800`   | Time window per coalesced edit. Lower = more edits, more rate-limit risk     |
| Per-burst edit cap   | `3`     | Hard ceiling per ~250ms — keeps you under Telegram/Slack/Discord rate limits |

## Tuning

- **Slow chats**: bump `coalesceMs` to `1500` for less flicker on fast generations
- **Latency-sensitive**: drop to `400` to feel snappier (still safe under platform limits)
- **Final flush** is always immediate regardless of `coalesceMs` — once the agent says it's done, you see the final message right away

:::note
The per-burst cap is a hardcoded safety floor. Even if `coalesceMs` is set very low, the coalescer won't issue more than 3 edits per ~250ms — the rate-limit budget on every supported platform is well above that.
:::
