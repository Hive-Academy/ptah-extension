---
id: TASK_2026_468_a0e4
status: backlog
type: REFACTORING
title: Finish per-tile perf sampling and re-measure AC 2 on the current perf harness
description: >-
  Port the per-tile replay-point sampling (sampleState) to the current Electron perf harness,
  then capture the cold, production and warm measurements under an idle peer hold.
depends_on: []
created: 2026-09-17T00:00:00.000Z
updated: 2026-11-07T00:00:00.000Z
---

## Description

1. Port M2-a from the parked `b18-e2e-harness.patch`: take a DOM sample at each tile's own replay
   point (`sampleState`) in
   `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts` and its support
   files. The patch no longer applies, so port it by hand. Then review it (logic and style).
2. Re-measure under a peer hold on an idle machine: 3 cold dev runs, 1 production run, 1 warm
   1-tile run. Prove AC 2 per tile and confirm AC-11 (no long task over 200 ms, total blocked at
   most 1,500 ms). Do not loosen the budgets.
3. Optional follow-ups listed in `context.md` (M2-d outlier, B9 Jest target for perf helpers, B10
   `bubble-fade-enter` assertion, the declined PR #524 CodeRabbit comments) stay here unless split
   out. The chat spec typecheck gate is in `TASK_2026_605_3772`.

## Current state (2026-11-07)

- Done on main: `assertScrollSanity` in the warm test
  (`tile-open-longtask-budget.perf.spec.ts:17,373`) and "measurement unusable" diagnostics before
  exits (`:217-233`).
- Not done: no `sampleState` exists under `apps/ptah-electron-e2e/src`.
- `git apply --check` of `b18-e2e-harness.patch` fails on current main: it targets
  `apps/ptah-electron-e2e/CLAUDE.md` (gone) and `perf-page-capture.ts:229` no longer matches.
- No record of the idle-machine re-measure.
