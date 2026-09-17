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
