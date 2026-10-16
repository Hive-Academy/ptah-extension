# Phase E round 7 fix report

## Files changed

- `libs/frontend/command-center/src/lib/model/session-coordinator.ts` — guard send completion against a changed tab/workspace binding and refuse sends when the workspace changes while opening.
- `libs/frontend/command-center/src/lib/model/session-coordinator.spec.ts` — cover deferred success, failure, exception, normal success, and workspace change while opening.
- `libs/frontend/command-center/src/lib/components/command-session-controls.component.ts` — retain submitted text until the page confirms success and expose conditional `clearDraft`.
- `libs/frontend/command-center/src/lib/components/command-session-controls.component.spec.ts` — verify submit retains the draft and clearing requires a matching trimmed draft.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts` — await `sendCommand` and clear only the matching draft on success; retain it on refusal or rejection.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts` — verify the page clears after success and retains text after refusal.

## Send before and after

Before: after `sender.send` settled, the coordinator wrote the old tab ID into the store using the store's current workspace, even if workspace rebinding had occurred. Failure paths could also show an error for the old binding. After: the coordinator captures the tab ID and workspace for the send, then checks both before any completion-time store write or failure toast. A completed successful send still returns `true` when its binding has moved; it leaves the current store untouched. A failed send returns `false` without changing the newer binding. If the active workspace changes during `openOrResume`, the coordinator refuses before calling the sender and shows the fixed switching toast.

## Controls and page

Submitting emits trimmed text without clearing the draft. The page awaits the controller result and calls `clearDraft(text)` only for `true`. `clearDraft` checks the current trimmed draft so later typing survives. A refused or rejected send retains the text; the controller owns failure reporting.

## Verification

`npx jest -c libs/frontend/command-center/jest.config.ts <three changed spec files> --coverage=false --maxWorkers=2`

Result: `Test Suites: 3 passed, 3 total`; `Tests: 41 passed, 41 total`.

`git diff --check` found no whitespace errors.

## Decisions

- Kept the existing top-of-send stale-workspace guard and fixed switching toast.
- Left Tribunal Confirm and other send paths outside this bounded fix.
- Did not edit the controller or unrelated review findings.

## Anything not done

No build, workspace-wide check, or e2e run, per the verification limit. Pre-existing changes in `batches.md`, `future-enhancements.md`, and untracked `HANDOFF.md` were left untouched.
