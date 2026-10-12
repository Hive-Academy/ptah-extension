---
id: TASK_2026_444_1078
status: cancelled
type: FEATURE
title: Show memory storage and retention in the TUI MemoryPanel
description: >-
  Follow-up from TASK_2026_440_834c. apps/ptah-tui/src/components/thoth/MemoryPanel.tsx consumes MemoryDiagnosticsResult and compiles with the new storage field, but does not render it, so TUI users get no DB size, reclaimable bytes or retention status.
depends_on: [ TASK_2026_440_834c ]
created: 2026-09-15T16:10:00.000Z
updated: '2026-10-12T19:41:51.738Z'
duplicates:
  - TASK_2026_641_bf2b
---

## Description

Render `storage` (DB bytes, queue bytes, stuck age, last and next retention run) in the TUI
MemoryPanel. Source: `TASK_2026_440_834c/batches.md` batch 4 follow-up and
`code-logic-review-batch-4.md`.
