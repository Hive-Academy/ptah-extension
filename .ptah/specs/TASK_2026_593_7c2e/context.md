# TASK_2026_593 — one global notification system

## Why

The user (2026-10-02, during TASK_2026_576 cutover): "one thing i don't like in our git experience is how we show this
sticky notifications rather using a more advanced toaster or unify all of our notification, even the ones that shows
only on the chat tiles page with a proper global notification system with dismissable buttons and everything".

Two examples from screenshots:

- Review shell / git dock: a full-width strip under the header — "Git status is unavailable (git timed out) — showing
  the last known changes." It cannot be dismissed and pushes the content down.
- Chat tiles page (canvas): a line under the top tabs — "• Skill synthesis paused by its rate limit". It only shows
  on that page.

## What exists today (starting points, verify before designing)

- `libs/frontend/notification-center/` — `NotificationCenterStore` and `NotificationCenterComponent` with completion
  and pending (question/permission) rows, classification `success | error`, and a sound service. It is a history
  panel, not a toast surface.
- `libs/frontend/core/src/lib/services/back-office-activity.service.ts` — narrates back-office work (curation,
  skill synthesis progress/paused); rendered by `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` only.
- `libs/frontend/chat/src/lib/services/action-banner.service.ts` — shared inline banner for branch/rewind/editor
  actions, scoped by `tabId`.
- `libs/frontend/chat/src/lib/components/molecules/notifications/voice-provider-error-toast.component.ts` and
  `voice-provider-error.service.ts` — a one-off toast.
- git-ui inline notices: the review shell notice slot (stale status via `statusUnavailableLabel`,
  `libs/frontend/git-ui/src/lib/services/git-status-unavailable-label.ts`), plus per-surface `role="alert"` /
  `role="status"` lines in the commit composer, task view, conflict banner and history timeline (TASK_2026_576 P5).
- About 111 components use `role="alert"` or `role="status"`; not all are notices (many are form errors that should
  stay inline).

## Scope

1. A global `NotificationService` (frontend core or the notification-center lib — respect the boundary lattice:
   features import it, it imports nothing feature-level) with: severity (info, success, warning, error), title,
   optional body, actions (buttons with callbacks, e.g. Retry, Open, Undo), dismiss, auto-dismiss timeout per
   severity (errors stay until dismissed), de-duplication by key (e.g. `git-status:<workspace>` updates in place
   instead of stacking), scope (global, workspace, tab/session), and a programmatic `resolve(key)` when the condition
   clears (git status reachable again).
2. A toast host mounted once in each shell (Electron shell, VS Code webview, and the chat tiles/canvas page) using
   `libs/frontend/ui` Native* primitives (Floating-UI), stacked bottom-right, keyboard reachable, `aria-live` polite
   for info/success and assertive only for errors, reduced-motion aware, AA contrast in dark and light (no alpha
   base-content classes).
3. History: every toast is also recorded in the notification center (bell), so a dismissed or auto-hidden notice is
   still findable; unread count.
4. Migration (keep behaviour, change surface): git stale-status notice → keyed warning toast with Retry; skill
   synthesis paused → keyed info toast visible on every page, not only the tiles page; `ActionBannerService` callers
   → toasts with actions where the banner is transient; voice provider error toast → the new host. Leave real inline
   form/field errors and the conflict banner (a persistent workflow surface) inline — list each decision.
5. Settings: per-category mute (e.g. back-office activity) if cheap.

## Out of scope

- OS-level notifications (Electron `Notification`) beyond what exists.
- Backend changes, except new push types if a notice has no event today (list them).

## Acceptance

- No sticky, non-dismissable notice strip remains in the git surfaces or the canvas header, except the documented
  persistent workflow surfaces.
- The same notice raised twice shows once (updated), and clears itself when its condition resolves.
- Toasts work in Electron, the VS Code webview and the canvas page; axe has no critical/serious issues, dark and light.
- Unit specs for the service (dedupe, resolve, timeouts, scope) and e2e for one git notice and one back-office notice.

## Notes

- Start after TASK_2026_576 cutover merges (the review shell notice slot and P5 surfaces are the main consumers).
- Full orchestration flow: PM → designer (toast + center states, prototype) → architect → batches.

## Scope expansion 2026-10-19 (user request, supersedes conflicting lines above)

User (2026-10-19, with a screenshot of the bell panel full of "Finished - task 697 ..." rows):
"for the notification bar that also has the new session and clear all buttons, i think we have a
task to streamline and unify our notifications into small snackbars and only show important details
like when an ask user questions is active or a permissions request, currently it shows finishes
tasks and no way i can clear the all notifications, so we need to rethink that as well initially i
wanted to show important informations for the user and have it in a place that doesn't cause
distractions and basically have it specially with things that require user attention and do it as
system information not just in app notification".

Decisions the user took (AskUserQuestion, 2026-10-19):

- **Finished-turn notifications: remove them entirely.** Only attention items appear (permission
  requests, ask-user questions, failures and other items that need the user). Finished turns show
  only in the session list. (Removal approved by the user.)
- Runs in parallel with TASK_2026_702_594d (Chat start screen) in separate worktrees.

Added scope:

1. **Attention-first model.** Snackbars are small and stay out of the way. Permission requests and
   ask-user questions show a snackbar that stays until handled, with actions (Allow / Deny /
   Answer / Open session). Failures show a snackbar.
2. **System (OS) notifications** for attention items (this reverses "Out of scope: OS-level
   notifications"). Electron: `Notification` when the window is not focused; a click focuses the
   window and opens the session. VS Code: `window.show*Message` with an action. Settings toggle.
3. **Bell panel:** a "Needs you" section first; a **Clear all** action; no finished-turn rows.
4. **One attention place:** reconcile the canvas "All clear / N need you" chip
   (`canvas-needs-you-queue.component.ts`) with the bell (both read the same pending requests).
5. Sound/announcer behaviour follows the attention model (no burst for finished turns).

Facts (orchestrator investigation 2026-10-19, verify): ledger
`libs/frontend/notification-center/src/lib/notification-ledger.service.ts` (cap 75, 350 ms merge,
completion entries from `TabManagerService.terminalTurnPulses()` at :170-182, pending rows computed
from `PermissionHandlerService` at :140-151); no clear-all (only `markAllRead` :203 and
`dismissCompletion` :211); no Electron `Notification` use anywhere; Electron
`showInformationMessage` is a modal `dialog.showMessageBox`
(`libs/backend/platform-electron/src/implementations/electron-user-interaction.ts:144-168`).
Mounted in `electron-shell.component.ts:301` and `app-shell.component.html:370`.

Worktree: `.claude-worktrees/attention-notifications`, branch `feat/attention-notifications`.
Orchestrator session: `ptah-ptah-extension-task-612-follow-up-s-e16b410000xs42qjcizfr0i`.
Lanes: codex (confirmed room); grok AT LIMIT. Approval mode: lane-review for Gates 1 and 2,
**user** for Gate 1.7 (visual).
