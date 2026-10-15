# R9 item 10 — switching baseline (10 Rail focus swaps)

Measured 2026-10-14 by the orchestrator, before the R9 plan.

- Build: Electron renderer from `1908f240e` (before the main merge), `dist/apps/ptah-electron`.
- App: `.ptah/tmp/final-run/launch.mjs "D:\projects\ptah-final-run-ws"`, 1600x967 viewport, Anubis light theme,
  side panels open, board switched from Grid to Rail, 4 rail cards (S1, S2, S4, "can you generate html stats"), all
  idle (`done`), focus area in Full view.
- Script: `.ptah/tmp/final-run/s-switch.mjs` (`TAG=baseline`, `SWAPS=10`, `SETTLE=1200`). It clicks the cards in
  rotation. Per swap it records: CDP `Performance.getMetrics` deltas (Task/Script/RecalcStyle/Layout duration, Nodes),
  `PerformanceObserver` long tasks (> 50 ms) and layout shifts, and the elements added under
  `ptah-canvas-focus-area` (MutationObserver). Raw JSON: `%TEMP%\629-switch-baseline.json`; Chrome trace:
  `%TEMP%\629-switch-baseline-trace.json` (36 MB, not in the task folder).
- Re-run on the R9 build with `TAG=after-r9` and the same 4 sessions for the before/after comparison.

## Summary

| Metric (per swap) | Median | Max |
|---|---|---|
| Main-thread task time (`TaskDuration`) | 422 ms | 514 ms |
| Script | 107 ms | 257 ms |
| Recalc style | 85 ms | 128 ms |
| Layout | 18 ms | 40 ms |
| Longest long task | 124 ms | 289 ms |
| Elements added under the focus area | 7,657 | 16,921 |

- Swaps with at least one long task > 50 ms: **10 / 10**.
- Layout shift (CLS, sum over 10 swaps): 0. `data-canvas-rail-shifts`: 0. `data-canvas-live-views`: 1 (BL rule kept).
- `data-canvas-focus-swaps` went 0 → 10.

## Per swap

| # | Card | Long tasks | Longest (ms) | Elements added | Layout ms | Style ms | Script ms | Task ms | DOM nodes delta |
|---|---|---|---|---|---|---|---|---|---|
| 0 | …2adf9a | 2 | 123 | 4,937 | 22 | 95 | 126 | 442 | +128 |
| 1 | …4062da | 2 | 187 | 16,771 | 40 | 128 | 146 | 514 | +3,982 |
| 2 | …3393a5 | 1 | 289 | 5,381 | 15 | 78 | 257 | 491 | +1,931 |
| 3 | …f14d3d | 1 | 124 | 7,657 | 26 | 69 | 89 | 351 | +2,358 |
| 4 | …2adf9a | 1 | 124 | 5,098 | 12 | 85 | 107 | 422 | −8,044 (GC) |
| 5 | …4062da | 1 | 133 | 16,921 | 21 | 91 | 83 | 351 | +3,876 |
| 6 | …3393a5 | 1 | 105 | 5,381 | 13 | 75 | 87 | 316 | +1,925 |
| 7 | …f14d3d | 1 | 90 | 7,807 | 16 | 71 | 59 | 307 | +2,250 |
| 8 | …2adf9a | 1 | 89 | 5,098 | 10 | 62 | 67 | 275 | +1,823 |
| 9 | …4062da | 2 | 156 | 16,921 | 18 | 128 | 108 | 445 | +3,878 |

## Reading

- Every swap rebuilds the whole transcript: the elements added equal the full DOM of the target session's transcript
  (≈ 5k-17k elements), also when that session was focused two swaps before. Nothing is retained.
- The cost scales with the transcript size (the …4062da session is the largest: 16.9k elements, the slowest swaps).
- Layout is small. Script (component creation, markdown) and style recalculation dominate.
- Rail cards do not shift (CLS 0), so the "harsh" feel is the 90-290 ms main-thread block plus the full repaint,
  not a layout jump.
- Acceptance target from handoff-6 §2 item 10: no long task > 50 ms on a switch for a typical transcript, CLS 0,
  focused card stays in view, F5 draft restore passes, BL heap 0 detached nodes.
