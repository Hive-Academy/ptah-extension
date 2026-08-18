---
id: TASK_2026_294
status: in_review
type: bugfix
title: >-
  Hold a follow-up message until the turn ends instead of handing it to the SDK queue
description: >-
  A follow-up sent while a turn is generating is pushed straight into the live
  SDK input stream. The SDK logs `queue-operation: enqueue`, then
  `queue-operation: remove`, writes the text as a `queued_command` attachment,
  and never materialises it as a user turn — the model never sees it. Measured
  on this machine: 180 removed queue items, 0 delivered; 58 of them
  human-authored prompts since 2026-08-01. Fix is in `SessionStreamPump`: yield
  at most one queued message per turn and hold the rest until the turn's
  `result` arrives.
---

# Follow-up messages are dropped when sent mid-turn

`SessionStreamPump.createUserMessageStream` yields a queued message the moment
`sendMessage` pushes it, including while a turn is still generating. The SDK
treats a prompt arriving mid-turn as a _queued command_: it enqueues, removes,
and records it as a transcript attachment that never becomes a user message.

The pump now gates on a per-session `turnInFlight` flag: it yields exactly one
message per turn and parks until the turn's `result` message clears the flag.
