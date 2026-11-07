---
id: TASK_2026_428_8f87
status: backlog
type: refactoring
title: Give the remaining daisyUI modal dialogs one shared focus trap
description: >-
  About nine dialogs that use the daisyUI `modal modal-open` class still do not trap focus. Move them
  to one shared primitive: `NativeModalComponent` (`showModal()`) from `libs/frontend/ui`, or a
  shared copy of the marketplace `ModalFocusTrap`.
created: 2026-09-12
updated: 2026-11-07T00:00:00.000Z
---

# One focus-trap primitive for the nine daisyUI modal dialogs

Raised by the CodeRabbit review of pull request #500, which flagged
`BulkRebaseConfirmComponent` for declaring `aria-modal="true"` without native
modality. The finding is correct, but the component is not the right scope: the
gap belongs to all nine dialogs, and fixing one alone would make it behave
unlike its eight siblings.

See `context.md` for the measurement and the constraint that shapes the fix.

## Description

Remaining work:

- Pick the shared primitive. Two now exist:
  - `NativeModalComponent` (`libs/frontend/ui/src/lib/native/modal/native-modal.component.ts`),
    a real `<dialog>` opened with `showModal()`, with a Tab wrap and focus restore.
  - `ModalFocusTrap` (`libs/frontend/marketplace/src/lib/kept-items-repair-prompt.component.ts:265`),
    used by `kept-items-repair-prompt` and `external-consent-dialog`. If chosen, move it to
    `libs/frontend/ui`.
- Move these dialogs, which use `modal modal-open` with no trap, to the chosen primitive:
  - `libs/frontend/chat/.../peer-session-send/peer-session-send-dialog.component.ts`
  - `libs/frontend/chat/.../session-organization-editor/session-organization-editor.component.ts`
  - `libs/frontend/chat/.../previous-sessions/previous-sessions-modal.component.html` and
    `previous-sessions-load-state.component.ts`
  - `libs/frontend/marketplace/src/lib/harness/harness-repair-dialog.component.ts`
  - `libs/frontend/memory-curator-ui/src/lib/components/corpus-build-dialog.component.ts`
  - `libs/frontend/skill-synthesis-ui/src/lib/components/clones/skill-clones-view.component.ts`
  - `libs/frontend/tasks-ui/src/lib/components/task-create-dialog.component.ts` and
    `task-maintenance-dialog.component.ts`
- Add a keyboard spec per dialog (Tab wraps, focus returns to the opener).

## Current state (2026-11-07)

- The `showModal()` constraint in `context.md` is out of date. The repo now ships
  `NativeModalComponent` and uses `showModal()` in 12 frontend files, including
  `bulk-rebase-confirm.component.ts`, the dialog that raised this task.
- Already trapped: `bulk-rebase-confirm`, `external-consent-dialog`, `kept-items-repair-prompt`,
  `update-dialog`, `skill-selection-card`.
- The list of open files above comes from a grep for `modal modal-open` on 2026-11-07; confirm each
  is a real dialog before you change it.
