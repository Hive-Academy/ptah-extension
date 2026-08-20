# Context — pointer capture hardening for editor-panel resize handles

## Origin

`TASK_2026_173` Batch 9 register, item 3 of 17. Carried over from Batch 4's review, Failure Mode 3.
Filed per NFR-9 — deliberately not fixed; the reviewer explicitly ruled no action was needed for
correctness, so this is opportunistic hardening only.

## Finding (from the register)

> Pointer capture on the three editor-panel resize handles, carried over from Batch 4's review. Would
> make the double-`mousedown` drag re-entry structurally impossible rather than merely benign. Batch
> 4's reviewer ruled **no action needed** there — the post-refactor code is strictly safer than the
> pre-refactor behaviour, which registered two racing listener quartets — so this is a hardening
> improvement, not a defect fix.

The three handlers referenced are the sidebar, terminal and split-divider drag handlers in
`libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`, unified under the shared
`startDragTracking<T>` helper by Task 4.3 of that task (see `TASK_2026_173/measurements.md` §M4 "AFTER
(2)").

## Fix

Use `element.setPointerCapture(event.pointerId)` on `pointerdown` (switching the three handlers from
`mousedown`/`mousemove`/`mouseup` to their `pointerdown`/`pointermove`/`pointerup` equivalents, or
layering capture onto the existing mouse-event handlers via the underlying pointer event) and release
capture in the existing teardown path (`cancelDragFrame` + `applyLatest` + `cleanupListeners`, per
`TASK_2026_178`'s reference implementation). This structurally prevents two simultaneous drags on the
same handle rather than relying on the current listener design's benign-but-racy behaviour.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 3; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-4-report.md`; `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`.
