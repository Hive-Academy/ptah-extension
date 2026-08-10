# Context — no in-editor floating hunk action widget

## Origin

`TASK_2026_173` Batch 9 register, item 15 of 17. Raised in `batch-8b-report.md` §4 D-1. Filed per
NFR-9.

## Finding (from the register)

> No in-editor floating hunk action widget — mouse ergonomics only, flagged rather than rounded up.
> Task 8.5 asked for glyph-margin decorations **plus an overlay widget** anchored at `modifiedStart`.
> 8B built the decorations and the roving-tabindex keyboard toolbar but not the floating button
> cluster, and said so: Monaco's line-anchored primitive is a **content** widget (overlay widgets are
> fixed-position), an interactive one sits in DOM Angular does not manage, and 8B could not run the app
> to verify it — on the write path, in the batch whose whole standard is "prove it or disclose it".
> **Every stated criterion is met without it** (AC1, AC10, AC11, AC14, D3 AC6). What is lost: a mouse
> user clicks the glyph to select, then acts in the header, rather than acting at the hunk.

## Fix

Add a Monaco **content widget** (not overlay widget — content widgets are line-anchored, overlay
widgets are fixed-position, and this needs to track `modifiedStart`) anchored at `modifiedStart`,
rendered through an Angular embedded view and disposed together with the decoration set. **Verify it
in the same Electron smoke test filed as item 12** (`TASK_2026_218`) — that record is building shared
`_electron` infrastructure this item depends on.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 15; `TASK_2026_173/batch-9-dispatch.md` §4.1;
`TASK_2026_173/batch-8b-report.md` §4 D-1; `TASK_2026_218` (the Electron smoke harness this item
verifies against).
