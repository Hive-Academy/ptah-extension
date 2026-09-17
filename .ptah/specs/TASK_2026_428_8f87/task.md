---
id: TASK_2026_428_8f87
status: backlog
type: refactoring
title: One focus-trap primitive for the nine daisyUI modal dialogs
description: >-
  Nine components drive a dialog with the daisyUI `modal modal-open` class and
  declare `aria-modal="true"`, but none traps focus, so Tab leaves the dialog
  while the markup promises a screen-reader user that it cannot. Give them one
  shared primitive that traps and restores focus without `showModal()`, which
  this repository rejects for Electron dialogs.
created: 2026-09-12
---

# One focus-trap primitive for the nine daisyUI modal dialogs

Raised by the CodeRabbit review of pull request #500, which flagged
`BulkRebaseConfirmComponent` for declaring `aria-modal="true"` without native
modality. The finding is correct, but the component is not the right scope: the
gap belongs to all nine dialogs, and fixing one alone would make it behave
unlike its eight siblings.

See `context.md` for the measurement and the constraint that shapes the fix.
