# Context — delete-confirm / name-input modals lack accessible dialog shape

## Origin

`TASK_2026_173` Batch 9 register, item 10 of 17. Raised in Batch 7 report §9.3 + Round 2 filing 6.
Filed per NFR-9 — fixing this inside Batch 7 would have blurred that batch's save-semantics diff.

## Finding (from the register)

> The delete-confirm and name-input modals (`editor-panel.component.ts:443-500`) have no `role`, no
> `aria-modal`, no focus management, and clickable `modal-backdrop` divs. Batch 7's new save-conflict
> dialog does none of that, which leaves this one file with **one accessible modal and two inaccessible
> ones** — an inconsistency that will read as an oversight rather than a scope boundary. Left alone
> deliberately: fixing them inside Batch 7 would have blurred the save-semantics diff.

## Fix

Apply the exact shape the conflict dialog now uses (built during TASK_2026_173 Batch 7) to both
modals: `role="alertdialog"` + `aria-modal` + `aria-labelledby`/`aria-describedby`, the same two-way Tab
focus-trap toggle on the container, and `closeSaveConflict`-style capture-before-open focus restore
guarded on `isConnected`.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 10; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-7-report.md` §9.3 + Round 2 filing 6;
`libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:443-500`.
