# Batch 13 report — Workspace indexing UI

Implementer: frontend-developer subagent (claude family). Paths are relative to the worktree root.

## Files changed

- MODIFIED `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.ts`: running state, action messages, `INDEXING_FAILED` handling, `lastRun`, `runningOrigin`, `isBusy`.
- MODIFIED `libs/frontend/workspace-indexing/src/lib/workspace-indexing.service.spec.ts`: new describe block "running state, action messages, failed push" (17 cases, counting each `it.each` row).
- MODIFIED `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.ts`: `isBusy`, `actionMessage`, `runningOrigin`, `backgroundOnly`, `lastRunSummary`, plus the `plural` and `formatDuration` helpers.
- MODIFIED `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.html`: busy buttons, background header, last-run line, action message, how-it-works, and fixed error text.
- MODIFIED `libs/frontend/workspace-indexing/src/lib/workspace-indexing.component.spec.ts`: new describe block "busy state, last run, messages" (8 cases).
- MODIFIED `libs/frontend/workspace-indexing/src/index.ts`: also exports `type IndexingActionMessage`, which the Batch 14 banner input uses.

## Acceptance criteria evidence

Task 13.1 (service):
- `_starting` and `_actionMessage`: `workspace-indexing.service.ts:140-141`.
- The fixed refusal sentences: `:89-105`. The joined-background info sentence: `:107-110`. Start and resume refusals use `runStartLike` (`:408`). A start whose status comes back with `running.joinedBackground` sets the joined message.
- `start` (`:354`), `pause` (`:367`), `resume` (`:383`) and `cancel` (`:392`) never reject. Each wraps its RPC call in try/catch and sets a fixed sentence on `!isSuccess()` or on a throw. Transport error text is never shown.
- `uiState` returns `indexing` when `status.running` is set, or when a progress push is below 100, in any state except `paused` (`:193-201`). Until the first push arrives, `processed/total` come from `running`. With neither, the bar is indeterminate (`buildIndexingState`).
- `handledMessageTypes` now includes `INDEXING_FAILED` (`:259`). The handler clears progress and calls `loadStatus` (`:277-282`).
- New exposed signals: `runningOrigin` (`:159`), `lastRun` (`:163`), `isBusy` (`:171`), plus `actionMessage` and `starting`.

Task 13.2 (component):
- The Index now, Re-index (indexed and stale) and Try again buttons are `[disabled]="isBusy()"` with `aria-busy`. While busy, a spinner replaces the icon: html `:83-86`, `:263-266`, `:318-321`, `:375-378`.
- During a background-only run, the indexing block shows the header `Background scan in progress (startup or file changes)` (html `:125`) and an enabled Re-index button that joins the run (html `:162`, `data-testid="indexing-join-background"`).
- `data-testid="last-run-summary"` appears in the indexed, stale and error blocks (html `:251`, `:306`, `:363`). The copy comes from `lastRunSummary` (component `:65`):
  - succeeded: `Last <manual run|background scan> <relative time>: N files, N symbols, N errors, 2h 25m`
  - failed: `Last … <time> failed. See the logs for details.`
  - cancelled: `Last … <time> was cancelled.`
- Action message: `role="alert"` for the error tone (html `:26`) and `role="status"` for the info tone (html `:34`).
- `data-testid="indexing-how-it-works"` holds the plan text verbatim (html `:408`), inside a `<details>` "How this works" disclosure.

## Tests added

- Service spec covers:
  - manual `running` with processed/total produces `indexing`, and `isBusy` is true
  - a background run on an `indexed` row produces an indeterminate `indexing`, and `isBusy` is false
  - a progress push below 100 in `indexed` produces `indexing`; `paused` stays `paused`
  - a joined manual run is busy
  - `lastRun` is exposed
  - each of the 4 refusal reasons gives its exact text and tone
  - a resume refusal gives the same text
  - a joined start gives the info text
  - a failed RPC gives the fixed text and none of the transport text
  - start, pause, cancel and resume never reject on a throw
  - a second start while one is in flight is ignored, and the service is busy meanwhile
  - `indexing:failed` clears progress and reloads the status
  - cancel clears progress
- Component spec covers:
  - Re-index is disabled with a spinner while a start is in flight
  - a manual run shows the manual header and no join button
  - a background-only run shows its header, an enabled Re-index and "10 of 40 files"
  - the manual last-run summary text is exact
  - a failed background summary uses the fixed sentence, and the raw error is absent
  - a cancelled summary in the stale block
  - a refusal renders `role="alert"` and an info message renders `role="status"`
  - the how-it-works text is verbatim

## Verify

Command, run from the worktree root with `TMPDIR=/var/tmp/b878`:
`npm run verify -- -p @ptah-extension/workspace-indexing,ptah-extension-webview` (N=2)

Lint and typecheck: `NX 4 tasks: 3 succeeded, 1 failed`, so 2 projects × 2 targets ran.
- `✖ nx run ptah-extension-webview:lint` fails only with the known pre-existing "Static imports of lazy-loaded libraries are forbidden" errors. They are in unchanged app files (`app.config.ts:16`, `app.routes.ts:2`, `app.ts:13`, …), and the same failure happens on main.
- `workspace-indexing:lint`, `workspace-indexing:typecheck` and `ptah-extension-webview:typecheck` passed.

Test: `NX 2 tasks: 2 succeeded` (workspace-indexing and webview).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| `paused` is excluded from the "progress < 100 means indexing" rule | follow the plan literally ("in any state") / exclude paused | A paused run's last progress push is below 100 by definition, so the literal rule would hide the Resume view | yes |
| `cancel` clears the last progress event | keep / clear | No push follows a cancel. A stale progress event below 100 would otherwise pin the UI in `indexing` | yes |
| Re-index is offered inside the indexing block during a background-only run | none / add a join button | The plan says the buttons "stay enabled (a click joins)". Any run sets `state:'indexing'`, so the indexed and stale blocks, and their buttons, are not rendered during a run | yes |
| The error block shows fixed text in place of `status.errorMessage` | keep raw / fixed text | The brief says never render raw backend error text. `indexing-control.service.ts:583-584` persists raw `error.message` as `last_error`. "Copy error details" still copies the raw detail on request, so no capability is lost | yes |
| Pause and cancel failure sentences (`Could not pause/cancel indexing. See the logs.`) | — | The plan names fixed sentences only for start refusals. These two follow the same form | yes |
| The duration format is `Xh Ym` / `Xm Ys` / `Xs`, with plain integers | — | Matches the plan's example `2h 25m` and `3806 files` | yes |

## Proposed removals

None.

## Review round 1 fixes (commit a29242802)
- Finding 1: `loadStatus` returns `Promise<boolean>` and `tryLoadStatus` never rejects. After an
  accepted start or resume with a failed status read, the panel shows "Indexing started, but its
  status could not be read. Reopen this view to check it."
- Finding 3: after an `indexing:failed` push with a failed status read, the stale `running`
  snapshot is dropped, an `indexing` state becomes `error`, and "Indexing failed. See the logs."
  shows. The panel is no longer busy.
- Tests: workspace-indexing.service.spec.ts covers both paths. Scoped tests passed.

## Review round 2 fix (uncommitted at writing; see code-logic-review-phase-ui-r1.md new finding 1)
- `statusGeneration` is bumped by every successful status read, user action (start, resume,
  pause, cancel) and workspace change. `refreshAfterFailure` captures it before its read and
  applies the fallback only if it is still current, so an older failed-push read that rejects
  after a newer start loads no longer clears the new run or overwrites its message.
- Regression test: "an older failed-push reload that rejects after a newer start loads leaves
  the new run alone" (deferred getStatus).

## Bounded correction (after round 2, code-logic-review-phase-ui-r2.md new finding 1)
- The single counter is split. `statusGeneration` (successful status read, workspace change)
  decides whether the stale `running` view is dropped. `actionGeneration` (start, resume, pause,
  cancel) decides only whether "Indexing failed. See the logs." may replace the action message.
  A failed Start no longer suppresses the stale-view recovery, and its own error sentence stays.
- Regression test: "a failed start during a pending failed-push reload still drops the stale run
  and keeps the start error". Independent review: code-logic-review-phase-ui-bounded.md.
