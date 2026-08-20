# Context — no "these panes disagree" affordance after save-conflict Cancel

## Origin

`TASK_2026_173` Batch 9 register, item 8 of 17. Raised in Batch 7 report §10.4 + review Failure Mode 3
/ Ruling 1. Filed per NFR-9.

## Finding (from the register)

> No dedicated "these panes disagree" affordance. After Cancel on the save-conflict dialog the two
> panes knowingly hold different content, and the only cue is the generic tab-strip dirty dot —
> ambiguous between "this pane has unsaved edits" and "the other pane disagrees with what you are
> looking at". Not data loss: Cancel writes nothing, and the predicate is unchanged by Cancel so **any
> subsequent save re-prompts**. AC1's wording is disjunctive ("reflects it **or** is visibly marked
> diverged"), so this is defensible as shipped — the reviewer and executor independently reached the
> same ruling — but it is defensible, not unambiguous.

## Fix

Add a `badge badge-warning` "Diverged" chip to the split pane's header bar, shown when
`hasUnabsorbedPeerEdit(splitFilePath(), splitFileContent())` is true.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 8; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-7-report.md` §10.4 + review Failure Mode 3 / Ruling 1.
