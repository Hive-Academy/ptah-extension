# Lane report R9p — Delete live budget, gesture observation, empty state

Batch R9p of TASK_2026_629_c0b3 (Orchestra Canvas Rail board), Wave 3, depends R9b + R9i (both COMPLETE).
Executor: opencode lane (this report). Status: IMPLEMENTED — deletions done, rg zero-importer proof clean.

## Files deleted (4)

All under `W\libs\frontend\canvas\src\lib\`, deleted with `rm` (PowerShell `Remove-Item`), not `git rm`:

1. `canvas-live-budget.ts` — exported `CANVAS_LIVE_BUDGET` (const, = 2) and `isAutoCardTile()` (Grid-only live-tile budget)
2. `canvas-live-budget.spec.ts` — its spec (no exports)
3. `canvas-gesture-observation.ts` — exported `readCompleteGestureNodes()` (Grid gesture observation)
4. `canvas-empty-state.component.ts` — exported `CanvasEmptyStateComponent` (Grid-only empty-board state; the R9b Rail
   empty-board trigger — same anchored `ptah-native-popover` as the footer `newSession` — is the replacement)

No other file was created, edited or deleted by this lane. (R9j runs in parallel on its own file set.)

## rg zero-importer proof

Exported symbols were enumerated from the four files before deletion (grep `^export`): `CANVAS_LIVE_BUDGET`,
`isAutoCardTile`, `readCompleteGestureNodes`, `CanvasEmptyStateComponent`; the spec file exported nothing.

One command from W after deletion, covering every basename (without extension) and every exported symbol
(each output line shows which name matched, so per-name results are read off the same output):

```
rg -n "canvas-live-budget|canvas-gesture-observation|canvas-empty-state|CANVAS_LIVE_BUDGET|isAutoCardTile|readCompleteGestureNodes|CanvasEmptyStateComponent" libs apps
```

Per-name results (exit 0, 5 lines total):

| Name | Hits | Result |
| --- | --- | --- |
| `canvas-live-budget` | 0 | clean |
| `canvas-gesture-observation` | 0 | clean |
| `canvas-empty-state` | 5 | all the DOM selector string `ptah-canvas-empty-state` — see table below |
| `CANVAS_LIVE_BUDGET` | 0 | clean |
| `isAutoCardTile` | 0 | clean |
| `readCompleteGestureNodes` | 0 | clean |
| `CanvasEmptyStateComponent` | 0 | clean — R9i already dropped the doomed export from `canvas/src/index.ts` |

All 5 `canvas-empty-state` hits are non-import strings (Playwright locator strings / spec selector strings).
No `import` of any deleted module exists anywhere in `libs` or `apps`; no live import from a kept file; **no blocker**.

| Hit | Owning batch | Kind |
| --- | --- | --- |
| `apps\ptah-electron-e2e\src\specs\canvas\canvas.spec.ts:122` — `page.locator('ptah-canvas-empty-state')` | R9l (rewrites e2e selectors; file also touched by R9x) | locator string |
| `apps\ptah-electron-e2e\src\specs\canvas\canvas.spec.ts:277` — `page.locator('ptah-canvas-empty-state')` | R9l | locator string |
| `apps\ptah-electron-e2e\src\specs\git\hunk-revert-top-layer.spec.ts:196` — `page.locator('ptah-canvas-empty-state')` | none (kept, unowned) | locator string |
| `libs\frontend\canvas\src\lib\orchestra-canvas.rail.spec.ts:299` — `expect(find('ptah-canvas-empty-state')).toBeNull()` | kept (R9b owns it, COMPLETE) | selector string; asserts the element is absent — trivially true now |
| `libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts:906` — string listing `'ptah-canvas-workspace-grid, ptah-canvas-empty-state, ptah-canvas-detail-panel'` | kept | selector string; this exact line is already recorded as risk R11 |

Also confirmed: no component anywhere still declares the `ptah-canvas-empty-state` selector (a kept owner would have
shown a `selector:` hit), so the selector strings above reference only the deleted component.

## Decisions

- D1: Ran the zero-importer proof as one alternation rg command instead of seven per-name runs — equivalent evidence
  (any hit for any name appears in the output with the matched text), fewer tool calls on a shared worktree.
- D2: No spec/typecheck/lint run from this lane. The batch contract says no spec run is required; per A7 and the
  execution rules, Mode 2 runs Wave 3's `rg R9p/R9j`, `FULL(canvas)`, `TC(canvas)`, `LINT(canvas)` after all Wave 3
  writers return. Compile-level proof therefore rests on this rg plus the wave's full canvas suite.
- D3: Kept files were NOT edited even where stale selector strings remain (the three hits in kept/unowned specs):
  they are strings, not imports, so not blockers; `canvas.spec.ts` is R9l's to rewrite; the other two match the
  already-recorded R11 pattern (lean rule 4, recorded for the phase-diff review, not fixed in place).
- D4: Deleted via PowerShell `rm` with comma-separated paths (space-separated positional paths are a PowerShell
  `Remove-Item` parameter-binding error); first attempt failed cleanly with no file removed, second removed all four.

## Risks

- R-p1: `hunk-revert-top-layer.spec.ts:196` (e2e, git spec) still locates the deleted `ptah-canvas-empty-state`
  selector and no R9 batch owns this file. E2e is typecheck/lint only this phase (a locator string passes both) and is
  never run, so it is not a blocker — but the phase-diff review should list it next to R11 as a stale e2e selector.
- R-p2: `orchestra-canvas.rail.spec.ts:299` null assertion is now trivially true (weaker but still green); together
  with `orchestra-canvas.component.spec.ts:906` it extends the R11 stale-selector list by one line.
- R-p3: Shared worktree snapshot: rg ran while R9j was in flight; no R9p name hit any R9j-owned file, and any later
  R9j deletion can only remove hits, not add live importers. Mode 2's post-wave FULL(canvas) is the backstop that
  catches spec-file importers the rg cannot (A7: typecheck does not compile specs).
