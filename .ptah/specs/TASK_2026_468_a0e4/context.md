# Context - TASK_2026_468_a0e4

Follow-up of TASK_2026_453_1eb4 (PR #524). User decision 2026-09-17: reduce TASK_2026_453 scope.
The e2e harness follow-ups and the AC 2 per-tile re-measure were stopped and parked here; they are
not part of PR #524. TASK_2026_453 records AC 2 as "verified mid-replay for the last-marked tile per
run; not proven for post-marker tiles".

## Purpose

1. Apply and verify the parked patch `b18-e2e-harness.patch` (moved here from
   `TASK_2026_453_1eb4/followups/`; `git apply --check` passed on `7ee1d35cb`). Lane report:
   `b18-e2e-codex-report.md`. The patch was never reviewed and never run. It covers:
   - M2-a: per-tile DOM sample at each tile's own replay point (`sampleState`).
   - M2-b: `assertScrollSanity` in the warm 1-tile perf test.
   - M2-c: whole-macrotask sampler field (the lane found the Batch 14 claim was correct).
   - B14: write diagnostics before every "measurement unusable" exit.
2. Logic + style review of the patch.
3. Targeted re-measure under a peer hold on an idle machine: 3 cold dev runs, 1 production run,
   1 warm 1-tile run. Prove AC 2 per tile and confirm AC-11 (no long task > 200 ms; total blocked
   <= 1,500 ms; budget never loosened).

## Other follow-ups

- M2-d: cold dev 1 wall-time outlier (3,813 ms between final marker and window close, wall
  5,070 ms). Diagnose if it recurs.
- 248 pre-existing type errors in `@ptah-extension/chat` spec files
  (`tsc --noEmit -p libs/frontend/chat/tsconfig.spec.json`); no gate type-checks spec files.
- B9: Jest target for the e2e perf helpers (`bucketByTime`, `findRendererMainThread`,
  `summarizeTraceEvents`, `perf-diagnostics.ts`). Needs an `apps/ptah-electron-e2e/project.json`
  target + `nx reset`, or moving the pure helpers to a lib with a Jest target.
- B10: rendered-class assertion for `bubble-fade-enter` in `message-bubble.component.spec.ts`.
  TASK_2026_453 Task 18.2 found jsdom never exposes the transient `animate.enter` class; Angular
  animation test helpers were not tried — try them first.

## Declined CodeRabbit comments from PR #524 (need an Electron e2e/perf run)

Triage and links: `TASK_2026_453_1eb4/pr-524-coderabbit-report.md`. Keep the 200 ms / 1,500 ms
budgets and the 2 px anchor limit unchanged.

- Add absolute deadlines to both mutation-settlement waits in
  `apps/ptah-electron-e2e/src/specs/chat/tile-load-older-history.spec.ts` (~:201, ~:451-470).
- Stop trace capture at the measurement boundary before diagnostic page work
  (`perf-measurement-report.ts` ~:198).
- Drain queued long-task records with `PerformanceObserver.takeRecords()` before disconnecting
  (`perf-page-capture.ts` ~:86).
- Match the tile that contains the generated marker, not a descendant that cannot contain it
  (`perf-session-fixture.ts` ~:467); prove it against the real rendered tile DOM.

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: Apply the per-tile sampleState replay point from the parked harness patch and run the idle-machine AC 2 re-measure. The other parked items (chat spec typecheck gate, Jest target for perf helpers, bubble-fade-enter) were not shown done.
- Evidence on main: main:apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts calls assertScrollSanity and writes '[AC-11 perf] measurement unusable' before several exits. git grep sampleState under apps/ptah-electron-e2e on main is empty, so the per-tile DOM sample at each tile's own replay point is not there. No in-tree record of the 3 cold + 1 production + 1 warm re-measure under a peer hold.

## Triage 2026-10-30 (premise audit)

Verdict: PARTIAL (lane codex, verified by Claude).

- Already on main: `assertScrollSanity` and warm one-tile coverage in `main:apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:373,509`.
- Missing: no `sampleState` anywhere under `apps/` on main; the AC 2 per-tile re-measure is not recorded.
- The chat spec typecheck follow-up is owned by TASK_2026_605_3772.
- The parked patch was written against the pre-#730 canvas Grid board; re-check its tile selectors against the Rail board (`libs/frontend/canvas/src/lib/canvas-rail/`) before applying.
