# Context — flaky perf assertion, "perf M2 scaling — directory indicator lookup (B3 AC2)"

## Origin

`TASK_2026_173` Batch 9 register, item 11 of 17. Raised in Batch 7 report Round 2 §"One flake worth
naming" + reviewer, both rounds. Filed per NFR-9 — the flaky test lives in Batch 3's work, unrelated
to anything Batch 7 touched.

## Finding (from the register)

> Flaky perf assertion in CI — `perf M2 scaling — directory indicator lookup (B3 AC2)`. Failed once
> during Batch 7 with `Expected: < 3 / Received: 23.89` and passed on three subsequent runs; the
> reviewer hit the identical flake independently in Round 1 while running a different experiment, which
> is what raises it from "one bad run" to a real CI liability. It is a wall-clock threshold measuring
> GC/timing noise on a shared runner, in Batch 3's work, unrelated to anything Batch 7 touched — so it
> is filed, not fixed. **It matters because a test that fails at random trains everyone to re-run
> rather than read the failure, which is precisely how a genuine B3 regression would get waved
> through.**

The relevant scaling harness is `libs/frontend/editor/src/lib/file-tree/perf-m2-indicator-scaling.spec.ts`
(see `TASK_2026_173/measurements.md` §M2 "Scaling evidence").

## Fix

Replace the absolute millisecond bound with the scaling-ratio assertion the AC actually cares about
(time at N vs. time at 10N stays sub-linear — the spec already computes this ratio for its own
reporting, e.g. "growth on 10x files"), so the test measures the O(1)/flat-scaling claim rather than
the runner's mood.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 11; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-7-report.md` Round 2 §"One flake worth naming";
`libs/frontend/editor/src/lib/file-tree/perf-m2-indicator-scaling.spec.ts`.
