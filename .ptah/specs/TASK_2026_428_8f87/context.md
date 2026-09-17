# Context — TASK_2026_428_8f87

## Where this came from

The CodeRabbit review of pull request #500 (TASK_2026_426_8d43) flagged
`BulkRebaseConfirmComponent`:

> `BulkRebaseConfirmComponent` only renders a styled `<dialog>` and emits
> `cancelled` from the Cancel button. It does not set `open`, call
> `showModal()`, handle `cancel`, or manage focus. Therefore,
> `aria-modal="true"` does not create native modality, focus trapping, Escape
> cancellation, or focus restoration. Use Angular CDK Dialog, or implement the
> complete lifecycle around `showModal()`.

It labelled the finding Major and a Heavy lift.

Three of its five specifics were already fixed in pull request #500 before this
task was filed. Measured in
`libs/frontend/skill-synthesis-ui/src/lib/components/clones/bulk-rebase-confirm.component.ts`:

- Escape emits `cancelled` (`:48`).
- The backdrop emits `cancelled` (`:91`).
- Focus starts on Cancel, the safe control (`:136`), and returns to the opener
  on destroy (`:139-142`).

**One gap is real and survives: there is no focus trap.** Tab can leave the
dialog while `aria-modal="true"` tells a screen-reader user it cannot. That is
a promise the markup does not keep.

## Why the scope is nine components, not one

Measured 2026-09-12 — every component driving a dialog with the daisyUI
`modal modal-open` class:

- `libs/frontend/chat/src/lib/update-dialog/update-dialog.component.ts`
- `libs/frontend/marketplace/src/lib/external-consent-dialog.component.ts`
- `libs/frontend/marketplace/src/lib/harness/harness-repair-dialog.component.ts`
- `libs/frontend/memory-curator-ui/src/lib/components/corpus-build-dialog.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/clones/bulk-rebase-confirm.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`
- `libs/frontend/skill-synthesis-ui/src/lib/components/suggestions/skill-suggestions-view.component.ts`
- `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts`

None of them traps focus. Fixing one alone makes that dialog behave unlike its
eight siblings, which is worse than nine behaving the same way: a keyboard user
learns one behaviour and meets another.

## The constraint that shapes the fix

`showModal()` is NOT available as the answer. The decision is documented at
`libs/frontend/chat/src/lib/update-dialog/update-dialog.component.ts:26-28`:

> The daisyUI `modal-open` class drives visibility rather than
> `HTMLDialogElement.showModal()`, matching `ptah-confirmation-dialog`. That
> keeps the dialog out of the browser top layer, where it would compete with
> the native file-ops dialogs the Electron e2e specs guard.

So the primitive must trap and restore focus **without** entering the top layer.
Angular CDK's `FocusTrap` and `A11yModule` do exactly this and need no native
dialog lifecycle. `libs/frontend/ui` still carries legacy CDK, so the dependency
is not new.

A second constraint on verification: jsdom implements no dialog lifecycle, which
is why the pull request #500 lane could not test a `showModal()` migration. A
CDK-based trap is testable in jsdom, because it works on ordinary focusable
elements. Confirm that before committing to the approach.

## Suggested shape, not a decision

One directive or component in `libs/frontend/ui` that the nine dialogs adopt,
owning: the focus trap, the initial focus target (the SAFE control, as
`bulk-rebase-confirm` already does), and focus restoration on destroy. The nine
then delete their own hand-rolled halves.

The architect should decide whether a directive on the existing `<dialog>`
markup beats a wrapper component. A directive is likely less invasive, because
every one of the nine already has its own `modal-box` content and testids that
`apps/ptah-electron-e2e` binds.

## Out of scope

- Migrating to `showModal()` or to the browser top layer.
- Changing any dialog's visual design or its `data-testid` attributes, which the
  Electron e2e specs bind.
- Reworking `libs/frontend/ui`'s legacy CDK usage beyond what this needs.

## Acceptance sketch

- Tab and Shift+Tab cycle within an open dialog and cannot reach the page behind
  it, for all nine.
- Initial focus lands on the safe control, and focus returns to the opener on
  dismissal.
- No dialog enters the browser top layer.
- The Electron e2e dialog specs still pass unchanged.
