---
id: TASK_2026_623_3492
status: in_progress
type: FEATURE
title: Agent-controlled display panel with composable DaisyUI surfaces
description: >-
  A side display panel (like the agent monitor panel) that the coding agent opens and updates through
  ptah-ui display fences, rendering responsive row/col/grid/card layouts with polished stats, progress,
  badges, avatars and accordions. Adds a $agents host source, moves the turn summary into the panel as
  expandable stat cards, polishes command and file previews, and folds TASK_2026_610 PR D (note).
depends_on: [TASK_2026_610_6a10]
created: 2026-10-09T00:00:00.000Z
updated: 2026-10-09T00:00:00.000Z
---

## Description

Successor to TASK_2026_610_6a10 PR D. The agent gets a "room" for rich UI: a display panel beside the
chat that it controls through `ptah-ui display` fences (no new coding-profile tool). Layout containers
(row, col, grid, card, section) and DaisyUI-backed atoms (stat with trend and sparkline, progress,
badge, avatar, accordion, note). Host sources include a new `$agents` (subagents with status, tokens,
cost). The host-built turn summary moves into the panel as expandable stat cards. Command and file
previews get the same visual pass. Electron only.
