# Lane report R9q — remove dead `gridUpdates` metric

Batch R9q of TASK_2026_629_c0b3 (Orchestra Canvas Rail board). Dependency R9i (deletion of
`canvas-workspace-grid`, commit df3b88e8d) is COMPLETE, so `gridUpdates` had no remaining producer.

## Change (file:line)

`W\libs\frontend\canvas\src\lib\canvas-render-metrics.service.ts`
- `CanvasRenderMetrics` interface: removed `readonly gridUpdates: number;` (was line 8).
- `EMPTY_METRICS`: removed `gridUpdates: 0,` (was line 27).
- All other metrics, `increment`, `publish`, `snapshot`, `version` unchanged.

`W\libs\frontend\canvas\src\lib\canvas-render-metrics.service.spec.ts`
- Test "counts locally and saturates instead of overflowing" (lines 9-12): re-pointed the three
  `increment('gridUpdates', ...)` calls (2 / MAX_SAFE_INTEGER / NaN) and the snapshot assertion to
  the existing `applyChecks` metric. Test kept, not deleted — it covers increment, saturation and
  NaN rejection generically.
- Tests "can count a computation without publishing..." and the `it.each` saturation test unchanged.

No other file modified. `canvas-rail.component.ts` and `canvas-rail.component.spec.ts` untouched
(verified below).

## rg result

`rg -n "gridUpdates" libs apps` from W (after the edits): **0 hits** (rg exit 1 = no matches).
Pre-check also confirmed `canvas-rail.component.ts` / its spec had no `gridUpdates` reference, so
the STOP condition never triggered. No `.ptah/` hits observed either.

## Spec result

Command (machine-wide lock runner, from W):

```
node .ptah/tmp/check-run.mjs R9q -- npx nx test @ptah-extension/canvas --testFile=canvas-render-metrics.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
```

Result: exit 0 — `Test Suites: 1 passed, 1 total`, `Tests: 5 passed, 5 total`,
`NX Successfully ran target test for project @ptah-extension/canvas`.

## Decisions

- The first spec test exercised generic behaviour (local count, saturation at MAX_SAFE_INTEGER,
  NaN rejection, version bump) through the dead key; deleting it would lose that coverage, so it
  was re-pointed to `applyChecks`, a metric owned by this service and unused in the other tests.
- `it.each(['focusSwaps', 'liveViewMounts', 'railShifts'])` left as-is: it already covers
  saturation on remaining metrics and never referenced `gridUpdates`.
- No type or runtime consumer of `gridUpdates` remained anywhere in `libs`/`apps` (rg), so the
  removal is behaviour-preserving for every other metric; `increment(metric, ...)` is keyed by
  `keyof CanvasRenderMetrics`, which now excludes the dead name at compile time.
