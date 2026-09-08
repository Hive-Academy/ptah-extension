# Degradation triage — `libs/backend/vscode-core`

Task 12.1, TASK_2026_383. Worktree `.claude-worktrees/task-383`, branch
`task/383-degradation-audit`. 17 flagged sites, all inside
`libs/backend/vscode-core/src`.

## Site table

| #   | file:line (pre-edit)                              | label                          | reason                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `src/api-wrappers/file-system-manager.ts:363`     | legitimate optional capability | Watcher disposal is best-effort teardown; `false` leaves the watcher tracked rather than dropping a live handle.                                                                                                                                       |
| 2   | `src/api-wrappers/output-manager.ts:189`          | legitimate optional capability | `channel.clear()` is a cosmetic UI action; `false` means the channel content was left as it was.                                                                                                                                                       |
| 3   | `src/api-wrappers/output-manager.ts:213`          | legitimate optional capability | `channel.show()` is presentation only; `false` means the panel was not focused, writes still work.                                                                                                                                                     |
| 4   | `src/api-wrappers/output-manager.ts:236`          | legitimate optional capability | `channel.hide()` is presentation only; `false` means the panel stayed visible.                                                                                                                                                                         |
| 5   | `src/api-wrappers/output-manager.ts:301`          | legitimate optional capability | Channel disposal is best-effort; `false` keeps channel + metrics tracked instead of forgetting a live handle.                                                                                                                                          |
| 6   | `src/api-wrappers/output-manager.ts:318`          | legitimate optional capability | Bulk teardown at deactivation; the `return` skips one channel's callback so the remaining channels are still disposed.                                                                                                                                 |
| 7   | `src/api-wrappers/status-bar-manager.ts:184`      | legitimate optional capability | Status bar text is decorative; the failure is counted in the item's error metrics and `false` reports a partial update.                                                                                                                                |
| 8   | `src/api-wrappers/status-bar-manager.ts:213`      | legitimate optional capability | `item.show()` is decorative; `false` means the item stayed hidden and the visibility metric was untouched.                                                                                                                                             |
| 9   | `src/api-wrappers/status-bar-manager.ts:240`      | legitimate optional capability | `item.hide()` is decorative; `false` means the item stayed visible.                                                                                                                                                                                    |
| 10  | `src/api-wrappers/status-bar-manager.ts:324`      | legitimate optional capability | Item disposal is best-effort teardown; `false` keeps item + metrics tracked.                                                                                                                                                                           |
| 11  | `src/error-handling/error-handler.ts:75`          | legitimate optional capability | `handleAsyncError` IS the reporting path — the catch calls `handleError`, which logs with context and (by default) shows a user notification. Only the caller's result is optional; `undefined` is the documented boundary contract.                   |
| 12  | `src/error-handling/error-handler.ts:345`         | legitimate optional capability | `JSON.stringify` of a non-`Error` throwable is a formatting nicety; a cyclic value degrades to `'Unknown error object'` while the enclosing `handleError` still logs and surfaces the failure.                                                         |
| 13  | `src/logging/logger.ts:30`                        | legitimate optional capability | Rendering one log argument; a cyclic value degrades to `'[Unserializable]'` so the log line is still written.                                                                                                                                          |
| 14  | `src/logging/logger.ts:98`                        | legitimate optional capability | `detectDevelopmentMode` is an env probe; `false` selects the production log level and console defaults — the safe side.                                                                                                                                |
| 15  | `src/services/git-info.service.ts:2269`           | legitimate optional capability | `isGitRepo` is the probe asking whether git is usable here; `false` is the correct answer for a missing git binary or a non-repo path.                                                                                                                 |
| 16  | `src/services/workspace-context-manager.ts:27`    | legitimate optional capability | `pathExists` — existence is the question being asked; an inaccessible path legitimately answers `false`.                                                                                                                                               |
| 17  | `src/validation/message-validator.service.ts:569` | legitimate optional capability | `safeValidateMessage` is the non-throwing type probe used only by `validateUnknownMessage:592` to test a candidate message type; `null` means "not this type". The throwing `validateMessage` remains the path that surfaces real validation failures. |

## Split

| label                          | count |
| ------------------------------ | ----- |
| legitimate optional capability | 17    |
| reported                       | 0     |
| defect                         | 0     |
| test-only                      | 0     |

## Defects

None. Every flagged site in this lib is one of three shapes:

1. A **VS Code API wrapper** for a decorative or teardown operation
   (output channel, status bar item, file watcher) whose `boolean` return is
   already the caller's success signal — sites 1–10.
2. A **formatting or environment fallback** inside the logging/error path
   itself, where throwing would destroy the diagnostic it was asked to render
   — sites 11–14.
3. A **predicate probe** whose whole purpose is to answer a yes/no question, so
   the failure IS the answer — sites 15–17.

No site was found where the catch hides a failure a user or a test would
otherwise see, so nothing is escalated from this lane.

Note on the `reported` label: no site here routes through
`src/logging/degradation-reporter.ts`. Site 11 comes closest — it logs with
context and raises a user notification via `ErrorHandler.handleError` — but it
emits no stable degradation code, so it is labelled `optional-capability` with
the reporting behaviour named in the marker rather than claimed as `reported`.

## Audit line

```
libs/backend/vscode-core: 0 ok (baseline 17) — directory not found by this scan; run --update-baseline to prune
```

`0` unsuppressed sites, matching `0` recorded defects. Zero `bare-suppression`
and zero `orphaned-suppression` in this lib. The "directory not found" note is
the tool's stale-baseline hint (`check-degradation.ts:831` — a directory with
zero violations is absent from the counts map); the orchestrator prunes it with
`--update-baseline` at reconcile.

Verified: `npx nx run degradation-audit:lint` from the worktree root, and
`git diff -U0 -- libs/backend/vscode-core` filtered to non-comment lines is
empty — the change set is comment lines only.
