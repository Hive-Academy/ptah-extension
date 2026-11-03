# Context: combined M-final memory measurement and main-process growth

## Why this task exists

TASK_2026_628_5ab5 (renderer memory and CPU churn) merged in PR #715
(`0d892085c`). Its M-final measurement was deferred until TASK_2026_629_c0b3
(canvas layout, which also owns hot spot 7, the detached canvas-tile leak)
merges, so that one recording covers both tasks. This task holds that
measurement. It also holds the main-process growth that 628 kept out of scope.

Blocked on: TASK_2026_629_c0b3 merged to `main`.

## Part A: combined M-final measurement

The plan is `../TASK_2026_628_5ab5/implementation-plan.md` (section
"R1. Measurement gates"). Baseline evidence is in
`../TASK_2026_628_5ab5/context.md`.

Scenario: the same as M0. Run 5–6 sessions that stream at the same time, with
sub-agents and CLI lanes, on a `main` build that contains 628 and 629.

Record:

1. A 60 s Memory "Allocation sampling" profile with "Include objects discarded
   by major/minor GC" selected.
2. A ~26 s Performance trace with Memory, CSS selector stats and advanced
   rendering instrumentation selected.
3. `performance.memory`, `process.getBlinkMemoryInfo()` and
   `await process.getProcessMemoryInfo()` at the start and at the end.
4. Renderer private bytes (`Win32_Process`) at 0, 10 and 30 min, then again
   after a forced GC.
5. Two heap snapshots: before a canvas tile opens and after it closes (the
   629 hot spot 7 check).

Baseline files (in `tmp/`, not committed): `Trace-20261011T203430.json` and
`Heap-20261011T202717.heapprofile` (the latter recorded without discarded
objects, so the allocation-rate comparison needs care).

Pass criteria (from 628 `context.md` Acceptance):

- Renderer private memory at 30 min stays below 1.5 GB (proposed ceiling,
  confirm with the user).
- A forced GC frees less than 25% of renderer private memory.
- The allocation rate in the 60 s sampling profile is at least 50% lower than M0.
- No detached `ptah-canvas-tile` or `gridstack-item` tree after a tile closes.

Deliverable: `measurements.md` in this folder with the numbers, the trace file
names and the pass/fail result for each criterion.

## Part B: main-process growth

On 2026-10-11 the Electron main process grew from 634 MB to 1,424 MB private
in about an hour (628 `context.md`, Measurements, item 4). This matches an
earlier main-process handle-leak observation. 628 kept it out of scope.

During the Part A recording, also record main-process private bytes and handle
count (`Win32_Process`) at 0, 10 and 30 min. If the main process still grows,
record the numbers here and open a separate BUGFIX task for the root cause.
If it stays flat, close this part with the numbers.

## Triage 2026-10-30 (premise audit)

Verdict: PARTIAL (lane grok, verified by Claude).

- #730 (c57a9a1e7) replaced the Grid board with the Rail board; the `ptah-canvas-tile` / gridstack-item tree this task's hot-spot-7 check names is gone (only stale comments mention gridstack, e.g. `main:libs/frontend/chat/src/lib/components/templates/app-shell.component.ts:94`).
- The Rail board keeps a pane marked `data-testid="canvas-tile"` (`libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.*`).
- No measurements.md exists in this folder.
