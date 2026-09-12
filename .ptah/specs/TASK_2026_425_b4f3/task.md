---
id: TASK_2026_425_b4f3
status: backlog
type: BUGFIX
title: No regression guard for rewind while a prompt boundary is live
description: >-
  TASK_2026_420 anchors a mid-turn prompt through a user message_start
  boundary in the live streaming state. Nothing tests a rewind or fork that
  removes or replaces that user message while the boundary is still live.
---

Follow-up from TASK_2026_420 (code-logic review M2). See `context.md`.
