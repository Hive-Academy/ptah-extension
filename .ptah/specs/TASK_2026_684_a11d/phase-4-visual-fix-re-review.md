# Phase 4 visual-fix re-review — TASK_2026_684_a11d

Commit: `a75dc30e2cc3611efd470cadcb962cda2b677fa3` · Round: 2 of 2 · Reviewer family: codex · Implementer family: claude

## Prior item

**FIXED — initial focus outside the dialog.** The editor now has `tabindex="-1"` and `role="dialog"` (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.component.ts:183-192`). The row's `(opened)` handler focuses that editor (`:140-148`). The shared popover calls `floating.focus()` **before** `opened.emit()` (`libs/frontend/ui/src/lib/native/popover/native-popover.component.ts:202-229`), so the dialog receives final opening focus. Shift+Tab from the dialog wraps to the last enabled control (`libs/frontend/chat/src/lib/settings/providers/decision-model-row.popover.ts:43-57`); Tab from the dialog is left to the browser to advance to its first control (`:52-57`; `decision-model-row.component.ts:194-218`). Escape still emits `closed` from the popover (`native-popover.component.ts:293-302`), and the row closes and refocuses its trigger (`decision-model-row.component.ts:611-619`).

## New defects

None.

## Five logic questions

1. **Silent failure:** An `opened` event with no editor would do nothing because of optional chaining (`decision-model-row.component.ts:147`); the editor is rendered by the same `editing()` condition as the popover panel (`:140-148,180-193`), and the shared popover emits only after that panel exists (`native-popover.component.ts:208-229`).
2. **Unexpected user action:** Shift+Tab immediately after opening now wraps from the dialog to the last enabled control (`decision-model-row.popover.ts:48-57`); Escape from the dialog bubbles to the popover close handler (`native-popover.component.ts:77-79,293-302`).
3. **Wrong answer from input:** The change introduces no data transformation; the changed template binds only focus and `tabindex` (`decision-model-row.component.ts:147,188`).
4. **Dependency failure:** If positioning rejects or times out, the shared popover shows the panel and still focuses it before emitting `opened` (`native-popover.component.ts:218-229,237-269`); the dialog focus handoff therefore still runs.
5. **Unstated case:** The prior gap was initial screen-reader focus inside the dialog; `role="dialog"`, its label, and programmatic focus now coincide (`decision-model-row.component.ts:147,183-192`).

## Verification and score

**8/10.** The prior minor finding is addressed in the actual open ordering, and the changed specs cover the event handoff, Shift+Tab and Escape (`decision-model-row.component.spec.ts:727-758`; `decision-model-row.popover.spec.ts:83-91`). This is above 5–6 because no logic gap remains in the reviewed focus paths, and below 9–10 because the component specs manually emit `opened` and do not establish browser Tab order after a real positioned open (`decision-model-row.component.spec.ts:733-751`). Read-only review of the commit and shared popover; no tests or builds were run. Scoped `ptah_get_diagnostics` was unavailable after its 45-second TypeScript check.

Verdict: APPROVED
