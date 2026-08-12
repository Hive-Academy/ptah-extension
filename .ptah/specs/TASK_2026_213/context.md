# Context — pre-existing right-pane self-echo in `updateSplitContent`

## Origin

`TASK_2026_173` Batch 9 register, item 7 of 17. Raised in Batch 7 report §9.4 + review Failure Mode 4.
Filed per NFR-9 — removing this inside Batch 7 would have been a read-path change that batch's own
AC5 forbade.

## Finding (from the register)

> Pre-existing right-pane self-echo. `updateSplitContent`'s first line still sets `splitFileContent`
> from the right pane's own `contentChanged` — the same self-referential shape as Task 7.2's hazard,
> just un-debounced and pre-existing. Confirmed by diff as byte-identical to `HEAD`; masked today by
> last-write-wins signal semantics. Removing it inside Batch 7 would have been a read-path change AC5
> forbade.

## Fix (explicitly NOT a one-liner, per the register)

> Drop that line and let the right pane's `[content]` read the shared tab record when one exists,
> falling back to `splitFileContent` only for the no-tab case — which requires the two new §1.2 panel
> guards to be re-pointed in the same change, so this is genuinely a batch of its own, not a one-liner.

Do not attempt this as an isolated single-line deletion; the guard re-pointing is load-bearing.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 7; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-7-report.md` §9.4 + review Failure Mode 4.
