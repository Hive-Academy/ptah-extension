---
id: TASK_2026_271
status: in_review
type: bugfix
title: >-
  Messaging gateway reliability — stop turning failures into silence
description: >-
  Discord/Telegram/Slack turns look flaky because every failure class ends in
  silence: flushOutbound swallows send/edit errors so a finished reply vanishes;
  the Discord client registers no error/shardDisconnect/invalidated handlers so
  `running` stays true while the bot is offline; gateway sessions at the default
  'ask' level cannot route permission prompts (gw-* tabId is not a UUID) so every
  Write/Bash/network/MCP call stalls 60s and auto-denies with no ack; initial
  login failure has no retry; editMessage on a deleted message has no fallback;
  a resume-then-fallback appends two generations into one buffer; and none of
  these reach the Gateway tab status. Close the silent-drop class, not one bug.
---

# Messaging gateway reliability

Machine-owned metadata carrier. Prose lives in `./context.md`.
