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

## Update 2026-08-11 — the target shape changed, and the scope is wider than filed

`TASK_2026_227` (commit `6a4cce435`) rebuilt the save-conflict dialog this task was told to copy.
It is no longer a positioned `<div class="modal modal-open z-50">`; it is a native `<dialog>`
opened with `showModal()`. Copy the **new** shape, not the one described above.

The reason matters here, because it means these two modals have a second, unfiled defect:

- `z-index` only resolves among the siblings of the nearest ancestor that establishes a stacking
  context. `editor-panel.component.ts` sits inside **two** — its own `isolation: isolate` wrapper
  (added so Monaco could not swallow the terminal resize handle) and the gridstack tile that hosts
  the panel in the Electron layout. No value of `z-50` written inside either can climb out.
- Verified consequence for the revert dialog before it was fixed: the canvas panel painted over it
  and the canvas empty-state text intercepted pointer events on both buttons. `showModal()` puts the
  element in the browser's top layer, which is painted after the whole document and is therefore
  outside every stacking context by construction rather than by out-bidding one.

`TASK_2026_227`'s closing report confirms **both modals in this task still carry that defect** —
`editor-panel.component.ts:463` (delete-confirm) and `:490` (new-file / rename input). The
delete-confirm one is destructive, so the same "a mouse user cannot answer a destroy confirmation"
failure applies to it. That is a correctness bug, not only an accessibility gap, and it raises this
task above the MODERATE severity the carrier records.

Implementation notes carried over from `6a4cce435`, all of which cost real debugging there:

- Call `close()` **before** `@if` unmounts the node. An element removed while still `open` skips its
  close steps and focus is never handed back. Check for second paths that null the signal directly —
  the revert dialog had one on tab change, reachable without a click via an RPC-opened file.
- Bind `(cancel)`. `showModal()` gives the UA its own Escape route that does not pass through a
  keydown listener at all; without this the element closes while the component still believes it is
  open.
- Keep focus restore last. `close()` restores synchronously to whatever `showModal()` remembered,
  which is not necessarily the control that opened the dialog.
- Drop `modal-open`. daisyUI's `.modal:not(dialog:not(.modal-open))` would re-apply the wrapper scrim
  on top of `::backdrop`. This is not cosmetic.
- Do **not** add `<form method="dialog">`. That is daisyUI's click-to-close idiom and must not exist
  on the delete-confirm dialog. daisyUI already sets `.modal-backdrop { z-index: -1 }`, so an inert
  `aria-hidden` backdrop div cannot intercept the buttons.

Verify by mouse in a live Electron host. jsdom has no layout, no compositing and no hit-testing, so
every spec for these modals will pass whether or not the fix works — that is exactly why this went
unnoticed. See `apps/ptah-electron-e2e/src/specs/editor/hunk-revert-top-layer.spec.ts` for the
established pattern, including the `elementFromPoint` assertion that proves the collision is really
being exercised.

## Source

`TASK_2026_173/tasks.md` Task 9.3 register item 10; `TASK_2026_173/batch-9-dispatch.md` §4;
`TASK_2026_173/batch-7-report.md` §9.3 + Round 2 filing 6;
`libs/frontend/editor/src/lib/editor-panel/editor-panel.component.ts:443-500`.
