# Context — empty-state `role="list"` ownership violation (confirmed)

## Origin

`TASK_2026_173` Batch 9 register, item 5 of 17. Raised by Batch 6 review, Failure Mode 1 / Issue 2.
Filed per NFR-9 — deliberately not fixed even though the fix is a genuine one-liner. This is one of
three items the Batch 9 dispatch explicitly names as "you will be tempted to fix — the file-not-fix
rule binds hardest here." **Do not fix it here.**

## Finding (from the register)

> Empty-state `role="list"` ownership violation — CONFIRMED DEFECT, known one-line fix. When a
> source-control section has zero files, `SourceControlPanelComponent` renders a plain `<div>` ("No
> staged changes" / "No changes") inside the `role="list"` region
> (`source-control-panel.component.ts:141-144, 201-204`). **Not hypothetical**: Batch 6's report called
> it an inspection-only risk because its axe run used a populated fixture, but the reviewer ran
> `axe-core` over the exact empty-state markup and reproduced a **live critical
> `aria-required-children` violation on both branches, today**. It hits the common case — most working
> trees have nothing staged. Genuinely pre-existing and untouched by Batch 6 (confirmed: the
> empty-state lines fall outside every hunk in that diff), so correctly excluded there.

## Fix

Give the empty-state message `role="listitem"`. One line per section (staged / unstaged), no visual
change. Location: `libs/frontend/editor/src/lib/source-control/source-control-panel.component.ts:141-144`
and `:201-204`.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 5; `TASK_2026_173/batch-9-dispatch.md` §4.4;
`TASK_2026_173/batch-6-report.md` review Failure Mode 1 / Issue 2;
`libs/frontend/editor/src/lib/source-control/source-control-panel.component.ts`.
