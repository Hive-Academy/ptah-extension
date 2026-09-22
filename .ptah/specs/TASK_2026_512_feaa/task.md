---
id: TASK_2026_512_feaa
status: done
type: bugfix
title: Notification Center labels every finished session "Failed"
description: >-
  `terminalReason` is read from the `Stop` hook payload, where the SDK has never
  put it. It is always null, so the Notification Center's success test
  (`phase === 'idle' && terminalReason === 'completed'`) is structurally
  unreachable and every completion card renders "Failed". Fix the source, then
  add a recap line and a session link to the card.
---

Root cause and evidence are in `context.md`. The two lanes and their file
boundaries are in `batches.md`.
