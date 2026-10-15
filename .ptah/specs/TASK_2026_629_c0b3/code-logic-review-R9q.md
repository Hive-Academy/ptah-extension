# Code Logic Review - R9q (remove dead gridUpdates metric)

Review family: Claude (implementer: opencode)
Task: TASK_2026_629_c0b3, Wave 3 | Reviewed: `git diff` of the two files on HEAD ca4021597
Score: 8/10 | Verdict: APPROVED

## Scope examined
- `libs/frontend/canvas/src/lib/canvas-render-metrics.service.ts`: `gridUpdates` removed from the `CanvasRenderMetrics` interface and from `EMPTY_METRICS`. Nothing else changed.
- `libs/frontend/canvas/src/lib/canvas-render-metrics.service.spec.ts`: saturation test re-pointed from `gridUpdates` to `applyChecks`.
- Checks run: `rg gridUpdates` over the whole worktree excluding `node_modules`, `.ptah`, `dist` (0 hits); `rg` for every consumer of `CanvasRenderMetrics*`; `npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` (rv-W3): green. `canvas-rail` source is unchanged (git status shows no `canvas-rail` entries).

## Verdict on the contract
- The metric was written only by Grid code that R9i already deleted. No producer remains and no consumer read the key by name. The remaining readers are `canvas-rail-board.component.ts:191,195` (`focusSwaps`, `railShifts`) and a comment at `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:163`.
- `snapshot()` returns the object, so removing a key cannot break a caller that did not name it. The service is component-scoped and its counters are never persisted or serialised, so no stored shape is affected.
- `CanvasRenderMetric = keyof CanvasRenderMetrics` narrows with the interface, so any stale `increment('gridUpdates')` would fail typecheck. None does.

## Is the re-pointed test still meaningful?
Yes for what it tests. It checks the service contract: `increment` accumulates, saturates at `Number.MAX_SAFE_INTEGER`, ignores `NaN`, and bumps `version()` (`canvas-render-metrics.service.ts:48-58`). That logic is generic across keys, and `applyChecks` is a valid key, so the assertion still fails if the clamp or the non-finite guard breaks. The spec's `it.each(['focusSwaps','liveViewMounts','railShifts'])` already covers the live keys, so coverage of the real metrics is intact.

## Five logic questions
1. Silent failure: none. The type system rejects stale writers.
2. User action: none; diagnostic counters, no UI.
3. Wrong-answer input: `increment` guards non-finite and non-positive amounts and clamps at the safe-integer limit; the re-pointed test exercises those guards.
4. Dependency failure: not applicable.
5. Missing: see finding 1.

## Findings

### 1. [Minor] The "dead metric" cleanup is incomplete: ten of thirteen metrics have no production writer
- File: `canvas-render-metrics.service.ts:4-18`. Production `increment(...)` calls exist only for `liveViewMounts` and `focusSwaps` (`canvas-focus-area.component.ts:98-99`) and `railShifts` (`canvas-rail-board.component.ts:301`). `creationOptionWrites`, `layoutComputations`, `applyChecks`, `applyPasses`, `releasedNodes`, `geometryDrift`, `changeCallbacks`, `acceptedGestures`, `rejectedGestures`, `cancelledGestures` are never written outside specs. They were Grid/Gridstack counters.
- Consequence for the test: the new target `applyChecks` is itself a dead counter, so the test reads as if `applyChecks` mattered. This is a readability issue only; the second test (`layoutComputations`, `:19`) has the same property.
- Scope: the contract names only `gridUpdates`, and later batches (R9m deletes grid release, so `releasedNodes` is a likely candidate) may still touch some of these. Do not widen R9q.
- Fix: add a follow-up line to R9m/R9k (or the phase-diff review) to prune the remaining Grid-only keys. Optionally re-point the saturation test to a live key (`railShifts`) now; that costs one line and keeps the example on a live metric.

### 2. [Minor] e2e reference to the service is a comment only
- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:150-175` still drives `gridstack-item` and `ptah-canvas-workspace-grid:visible` to prove the retained-instance counters. R9l owns this file. No metric key is named, so R9q causes no new break. Flagged so R9l's rewrite keeps the retained-instance proof on a Rail key (`focusSwaps`/`railShifts`).

## Residual uncertainty
- I did not run Jest (barred); the writer reported the metrics spec green. The diff is two deleted lines in the source and a four-line rename in the spec, so the risk is minimal.
