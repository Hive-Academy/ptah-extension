---
id: TASK_2026_645_6aaa
status: backlog
type: RESEARCH
title: "Record M-final renderer and main-process memory on the canvas Rail board"
depends_on: []
created: "2026-10-12T23:49:43.200Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  PRs #715 and #730 are on main and no measurement was recorded. Record renderer traces and
  Electron main-process private bytes and handles against the M0 baseline, on the Rail board.
executor: orchestrator
estimate: S
labels:
  - performance
  - chat
  - canvas
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Record the M-final memory measurement in the Electron app on current main, against the M0
baseline of TASK_2026_628_5ab5. Use the M0 scenario: 5-6 sessions that stream at the same time,
with sub-agents and CLI lanes.

- Part A (renderer): a 60 s allocation-sampling profile (with discarded objects), a ~26 s
  Performance trace, `performance.memory` / `process.getBlinkMemoryInfo()` /
  `process.getProcessMemoryInfo()` at start and end, renderer private bytes at 0, 10 and 30 min and
  after a forced GC, and two heap snapshots: before a canvas Rail pane opens and after it closes.
  The detached-tree check looks for a retained Rail pane (`data-testid="canvas-tile"` in
  `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts`). The Grid board and
  its `gridstack-item` tree no longer exist.
- Part B (main process): record Electron main-process private bytes and handle count at 0, 10 and
  30 min. On 2026-10-11 it grew from 634 MB to 1,424 MB in about an hour. If it still grows, open a
  separate BUGFIX task for the root cause.

Pass criteria (confirm the 1.5 GB ceiling with the user): renderer private memory at 30 min below
1.5 GB; a forced GC frees less than 25 %; allocation rate at least 50 % lower than M0; no detached
Rail pane after it closes.

Deliverable: `measurements.md` in this folder with the numbers, the trace file names and a
pass/fail result per criterion.

## Current state (2026-11-07)

- The blockers are merged: TASK_2026_628 (PR #715, `0d892085c`) and TASK_2026_629 (PR #730,
  `c57a9a1e7`, the Rail board replaced the Grid board).
- No measurement was recorded. This folder has no `measurements.md`.
- The baseline files (`Trace-20261011T203430.json`, `Heap-20261011T202717.heapprofile`) were in
  the untracked `tmp/` folder. Check that they still exist before you compare.

Full context, plan and discussion live in [./context.md](./context.md).
