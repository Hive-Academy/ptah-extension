---
id: TASK_2026_534_lane_console
status: in_progress
type: feature
title: Resizable wire console and multi-lane agents panel
description: >-
  Bring the compact session wire stream to parity with the variant-4 prototype,
  make its recap/stream split resizable and responsive, and give the agents
  panel a side-by-side multi-CLI lane layout with resizable columns.
  Follow-up to TASK_2026_512_feaa and TASK_2026_531_compact.
---

# TASK_2026_534 — Resizable wire console and multi-lane agents panel

Worktree: `.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66`
Branch: `feat/task-2026-534-resizable-lane-console`

## User request (2026-09-23)

1. The prototype
   (`.ptah/specs/TASK_2026_512_feaa/prototypes/variant-4-wire-console.html`)
   has better-looking tool rows and descriptions in the right pane than the
   shipped compact card. Close that gap.
2. Make the recap / wire stream split resizable and responsive.
3. Do the same for the Agents panel, with a different mindset: it must hold
   more than one CLI agent at a time. Resizable, and responsive from within.

## Shared contract (already in the worktree)

`SplitHandleComponent` — `libs/frontend/chat-ui/src/lib/atoms/split-handle.component.ts`,
exported from `@ptah-extension/chat-ui`. Stateless drag handle:
inputs `orientation` (`'vertical'` column divider | `'horizontal'` row divider),
`size` (px of the pane BEFORE the handle), `min`, `max`, `label`;
outputs `sizeChange(number)`, `sizeCommit()`, `reset()` (double-click).
Keyboard: arrows step 16px, Home/End jump to min/max, Escape cancels a drag.

## Lanes

- Lane A — compact wire console: `libs/frontend/chat-ui/src/lib/molecules/compact-session/**`.
- Lane B — multi-lane agents panel: `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel*`,
  new files under `libs/frontend/chat/src/lib/components/organisms/agent-monitor/`,
  `libs/frontend/chat/src/lib/services/panel-resize.service*`.
