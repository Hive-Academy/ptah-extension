---
id: TASK_2026_277
status: backlog
type: feature
title: >-
  Gateway inbound survives an Electron restart mid-turn
description: >-
  ConversationQueue and ConversationTurnTracker are in-memory, so a Discord
  or Telegram message whose agent turn was running when Electron quit is
  gone: no reply, no error, and nothing on the next boot knows it existed.
  Persist a per-inbound turn state on gateway_messages and, on
  GatewayChatBridge.start(), tell the sender their request was interrupted
  and ask them to resend. Do NOT auto-replay: a half-finished turn may
  already have written files or run commands, and running it twice is
  worse than losing it. Replay stays an explicit opt-in if ever wanted.
---

# Gateway inbound survives restart

Machine-owned metadata carrier. Prose lives in `./context.md`.
