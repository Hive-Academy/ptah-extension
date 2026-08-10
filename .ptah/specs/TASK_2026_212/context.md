# Context — `closeSplit`'s leftover `stopPropagation()`

## Origin

`TASK_2026_173` Batch 9 register, item 6 of 17. Raised in Batch 7 report §9.1. This is one of three
items the Batch 9 dispatch explicitly names as "you will be tempted to fix — the file-not-fix rule
binds hardest here" (the other two are item 5, `TASK_2026_211`, and item 13, `TASK_2026_219`).
**Deliberately not fixed here, even though it is a one-liner ten lines from where Batch 7 worked.**

## Finding (from the register)

> `closeSplit`'s `stopPropagation()` — the last live `stopPropagation()` in
> `editor-panel.component.ts`, held out of both Batch 6's and Batch 7's scope by explicit instruction
> and confirmed untouched across both rounds (reviewer verified it sits outside every diff hunk). It
> reads as an obvious leftover ten lines from where Batch 7 worked, which is exactly why it needs a
> record rather than an opportunistic fix.

## Fix

Delete the `event.stopPropagation()` line and drop the now-unused `MouseEvent` parameter from
`closeSplit` in `libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts` — the close
button is already a sibling of the pane container after Batch 6's de-nesting, so nothing depends on
the suppression.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 6; `TASK_2026_173/batch-9-dispatch.md` §4.4;
`TASK_2026_173/batch-7-report.md` §9.1;
`libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts`.
