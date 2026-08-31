---
id: TASK_2026_363
status: done
type: BUGFIX
title: >-
  No-activity watchdog kills idle sessions and long subagent generations
depends_on: []
created: '2026-08-31T03:20:00.000Z'
updated: '2026-08-31T03:20:00.000Z'
description: >-
  The 180 s NoActivityWatchdog (TASK_2026_190) counts only parent-stream SDK
  messages. It aborts every session 180 s after a turn result while the user
  is idle, and aborts a session whose subagent takes more than 3 minutes to
  compose one message (a large Write). Hold the watchdog while no turn is in
  flight and for the lifetime of every registered subagent, and bound the
  subagent:send-message RPC so it cannot hang for the whole window.
estimate: M
labels:
  - agent-sdk
  - watchdog
  - subagents
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

No-activity watchdog kills idle sessions and long subagent generations.

Full context, plan and discussion live in [./context.md](./context.md).
