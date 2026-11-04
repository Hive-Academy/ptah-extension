# Final PR review re-check — TASK_2026_873_f748

## Verdict

**APPROVE** — score **8/10**.

Commit `b75c21b63` closes F1 and F2. Cron, startup, and `review:refresh` share `pollAndRecord`. A failed poll stores `github-poll-failed` and leaves `last_poll_at` on the previous success. A disabled repository throws `REVIEW_DISABLED` and writes no poll row. `review:refresh` waits 120 seconds, reloads after failure, and the poll alert's Retry calls `refresh()`.

No new Blocking or Serious defect. The score is above 6 because the two open Serious findings from `final-pr-review.md` are closed in this tree, with the failure cursor checked in SQL. It is not 9 because a client-side `refreshError` flag still forces the failed-poll alert after a reload whose poll status is already `succeeded` (Minor M1).

No additional skill was loaded. This lane has no skill-loader call beyond the role text. Nx, npm, build, serve, and e2e were not run. Orchestrator results on `b75c21b63` were taken as given.

## F1 / F2

| ID | Status | Evidence |
| --- | --- | --- |
| F1 | Closed | `pollAndRecord` checks that the requested repo is enabled, runs discovery for that repo, then `recordPoll(repo, true)`. Any later throw records `recordPoll(repo, false)` and rethrows (`libs/backend/review-core/src/lib/review-orchestrator.service.ts:54-66`). Disabled settings throw `ReviewPollDisabledError` before that try (`:56-57`). `recordPoll` writes `repo_id` as `owner/name` lowercased, sets `poll_status` / `poll_error` to `github-poll-failed` on failure, and updates `last_poll_at` and `last_success_at` only when `ok` is true (`libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts:37-52`). Cron and startup call this path for the enabled repository (`apps/ptah-electron/src/activation/review-worker.activation.ts:22-31` and `:36-39`). `review:refresh` parses `repo` and calls `pollAndRecord(repo)` (`libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts:83-86`). `ReviewPollDisabledError` becomes `REVIEW_DISABLED` (`:37`, `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts:14`). The handler does not touch SQLite. |
| F2 | Closed | Refresh uses `REVIEW_REFRESH_TIMEOUT_MS` (120_000). Other review methods keep 5_000 (`libs/frontend/review-runs-ui/src/lib/review-runs.store.ts:9` and `:156-157`). On failure the store sets `refreshError` and still calls `load()` (`:78-81`). It does not set the history `error` / `offline` state itself. The alert shows for a failed poll or `refreshError`, and its button calls `store.refresh()` (`libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts:27`). The history Retry at `:31` still calls `load()`, which matches a list failure. |

## New findings

No Blocking or Serious findings.

### M1. Minor — `refreshError` keeps the failed-poll alert after a reload that already shows success

- File: `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts:78-81`, `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts:27`
- The catch sets `refreshError` and then reloads. The alert is `poll.status === 'failed' || refreshError`. A reload whose poll status is `succeeded` still shows "The last review poll failed" until a later `refresh()` returns ok and clears the flag at `:70`. The store spec locks this in (`review-runs.store.spec.ts:68-72`).

## Notes

- Failure does not move the success cursor. `last_poll_at = CASE WHEN ? THEN ? ELSE last_poll_at END` binds `Number(ok)` (`sqlite-review.repository.ts:44-46`). The repository spec records success, failure, then success and expects `getLastPollAt` unchanged across the failure (`sqlite-review.repository.spec.ts:27-40`). `review_poll_state.last_success_at` uses the same `ok` flag (`sqlite-review.repository.ts:49-52`).
- The poll row is the repository passed into `pollAndRecord`. Under D40 that identity is only `Hive-Academy/PtahCode`, and `listRuns` still reads `hive-academy/ptahcode`. The RPC spec expects `pollAndRecord` to be called with `params.repo` (`review-rpc.handlers.spec.ts:51-54`).
- A disabled refresh records nothing (`review-orchestrator.service.ts:56-57`, spec `:82-88`). Startup with no enabled repository calls `startupPoll(Date.now())`, which reconciles and returns before discovery (`review-worker.activation.ts:40`, `review-orchestrator.service.ts:75-78`). That does not write a false failed poll.
- Startup still logs a generic `Error` and drops the caught value (`review-worker.activation.ts:41-42`). When the throw came from `pollAndRecord`, the poll row is already written. A throw from `getSettings` or `getLastPollAt` has no poll write. That matches the previous choice not to log adapter text.
- `pollAndRecord` does not take the drain abort signal. Dispose still aborts only the queue drain (`review-worker.activation.ts:58-64`). An in-flight poll can finish its `recordPoll` during shutdown, as the old worker `discover()` could.
- `discoveryHandler()` still runs discovery without `recordPoll` (`review-orchestrator.service.ts:70-72`). Production cron and Refresh do not call it. `tools/review-eval/replay-runner.ts:58` still does. Replay is outside the operator poll alert.

## Decisions

- **M1 stays Minor.** Options: reopen F2 as Serious, or treat the sticky flag as a conservative client alert. Evidence: the fix design says a refresh failure keeps the failed-poll alert and reloads; the flag implements that alert, and a later successful `refresh()` clears it. It does not skip the poll write or point Retry at `load()`. Reversible by clearing `refreshError` when the reloaded poll status is `succeeded`.
