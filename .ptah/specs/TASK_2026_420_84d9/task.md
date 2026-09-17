---
id: TASK_2026_420_84d9
status: in_review
type: BUGFIX
title: Split the live assistant bubble at a mid-turn user prompt
description: >-
  A message sent while the agent is working renders below the live assistant
  bubble, but later agent output keeps streaming into that bubble above it.
  The split only appears once the whole round completes.
---

Live transcript does not split the assistant bubble at a user prompt sent mid-turn.
See `context.md` for cause, fix and review history.
