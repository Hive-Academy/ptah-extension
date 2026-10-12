---
id: TASK_2026_626_7b3e
status: done
type: BUGFIX
title: Show live session stats while a turn runs
description: >-
  The session stats header stays empty until the SDK result message ends the
  turn, so long orchestration turns with subagents show no tokens or cost.
  Publish provisional stats during the turn on a throttled session:stats-live
  channel; SESSION_STATS stays the completion signal.
depends_on: []
created: 2026-10-11T00:00:00.000Z
updated: '2026-10-12T18:26:17.216Z'
---

## Description

`session:stats` is broadcast only from the SDK `result` message
(`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:861`, `:945`), which the SDK emits once
at the end of a turn. While the main agent works and spawns subagents, the header shows nothing.

Fix: accumulate per-assistant-message usage (main loop and subagents) during the run, publish a
provisional snapshot on a new throttled `session:stats-live` message, and let the `result` message
replace the estimate with the authoritative cumulative value. `SESSION_STATS` must keep its role as
the authoritative end-of-turn signal in the frontend.
