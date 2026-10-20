# Batch C2 + C3 report

| File:line | Change |
| --- | --- |
| `libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts:166` | Keyed, dismissible stale strip with Retry; publishes one workspace warning and suppresses its snackbar while the git dock is visible; resolves on recovery or workspace change. |
| `libs/frontend/git-ui/src/lib/services/git-status-unavailable-label.ts:21` | Fixed notice title from the typed unavailable reason. |
| `libs/frontend/git-ui/src/lib/review-shell/review-shell.component.spec.ts:484` | Visible strip and hidden snackbar/Recent cases, including dismiss and recovery. |
| `libs/frontend/core/src/lib/services/back-office-activity.service.ts:60` | Fixed, diagnostic-free failure labels; projects synthesis, embedder, vec, indexing, selected activity failures and degraded startup to NotificationService; resolves confirmed recovery. |
| `libs/frontend/core/src/lib/services/back-office-activity.service.spec.ts:45` | Synthesis, embedder, indexing and progress exclusion specs. |

## Preserved BackOfficeActivityService public API

`handledMessageTypes`, `recent`, `latest`, `isIdle`, `constructor()`, and `handleMessage(message)` remain with their existing signatures. The bounded activity ring, coalescing, idle timer and narration mappers remain in place for the canvas consumer.

## Decisions

- Git warning key is `git-status-unavailable` within the workspace. The dock's visibility signal controls inline snackbar suppression; dismissing the strip leaves Recent intact. Warning snackbars use NotificationService's 10-second warning clock. The first-read unavailable body remains inline.
- Back-office notices contain fixed labels and no raw event summary. All projected notices have no Open action because the incoming events do not identify a reliable session or surface target. Progress and synthesis rate-limit events do not project.
- No Nx, Jest, or TypeScript checks were run, as requested. A scoped `git diff --check` found no whitespace errors.

## Not done

- The Recent row advertises Retry, but the existing shared `ChatAttentionActionDispatcherService` handles only chat-owned actions and cannot dispatch this git key. Wiring bell Retry needs an action-routing change outside the allowed files. The local strip Retry calls `GitStatusService.refresh()`.
- A failure that first occurs while `ReviewShellComponent` is unmounted cannot be projected by this component. A root git-status adapter would require a file outside this batch's scope. Once projected, hiding the dock releases suppression so the warning snackbar can appear.
