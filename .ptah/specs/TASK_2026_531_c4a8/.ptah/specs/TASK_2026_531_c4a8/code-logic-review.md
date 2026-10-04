# Code logic review — TASK_2026_531_c4a8 (contract-path copy)

The full review, written by the opencode lane, is the canonical file at
`.ptah/specs/TASK_2026_531_c4a8/code-logic-review.md` (task folder root).
This file repeats its verdict for the session-contract deliverable path.

Reviewer: opencode CLI lane. Implementer: codex CLI lane. Both lanes were
pinned by the user; this is a same-side (CLI), different-family review.

## Round 1 — 6/10, FAIL

1. BLOCKING: the e2e read `data-canvas-rejected-gestures` and
   `data-canvas-change-callbacks`, but the component host never rendered them
   (not even in `acb791814`). `metric()` returned -1, so the assertions were
   vacuous or always red.
2. MODERATE: a re-measure skipped mid-gesture was retried only on cancel, not
   on the commit path.
3. MINOR: `ngOnDestroy` → `cancelGesture(false)` could still write geometry
   during teardown.
4. MINOR: `max-lines` warning (728 > 700) on the grid component.

Diagnosis verified as sound against `gridstack.js`: `dragstop` and `change`
fire synchronously (`:2635` → `:2640` → `:1691`); a mid-gesture `load()`
re-baselines the engine via `saveInitial` (`:1693`), so the drop reports no
dirty node and the gesture is cancelled.

## Round 2 — 8/10, PASS_WITH_NOTES

All four findings FIXED, each with a regression test: host bindings added
(`canvas-workspace-grid.component.ts:104-105`), single `settleGesture` release
path for every gesture exit, teardown clears state without writes, helpers
extracted to `canvas-gesture-observation.ts` and `canvas-layout-intent.ts`
(lint clean). No new findings.

## Only Linux CI e2e can confirm

1. The real two-leg drag commits (`['0','0','6']`, commits +1, rejected unchanged).
2. Which failure mode the original CI failure was (rejected vs swallowed).
3. Whether a mid-drag scrollbar crosses the 3→2 column capacity boundary.
4. Attribute and poll timing under Electron change detection, and the rest of the test.
5. ResizeObserver re-observe on a real renderer.
6. That the Windows harness boot failure is environmental.
