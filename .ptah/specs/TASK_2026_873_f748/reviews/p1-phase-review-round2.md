# P1 phase logic review — round 2 — TASK_2026_873_f748

## Verdict

**REJECT** — score **6/10**.

Commit `a4db38ed6` closes B1–B3, S1–S6, and M1–M3 in the current tree. Two defects in that same fix still break the runs screen: a superseded attempt is stored without `result_status`, and `listRuns` throws on that row; the new poll-failure alert tells the operator to Refresh, and Refresh does not poll GitHub. No Blocking item from round 1 is still open. APPROVE needs no open Serious finding, so this round does not approve.

Score is above round 1 (4/10) because a real attempt now has its own 30-minute window, reads `out/lane-output.json`, and abort reaches the drain before SQLite close. It is not 7–8 because those two list/poll faults are on the path an operator hits after the first new SHA.

No skill loader is available in this lane. No UI was rendered. Orchestrator test results were taken as given and not re-run.

## Prior findings

| ID | Status | Evidence |
| --- | --- | --- |
| B1 | Closed | `review-orchestrator.service.ts:25-26` and `:68` give the claim `REVIEW_ATTEMPT_WINDOW_MS` (30 min) and do not pass the drain deadline into `process`. Heartbeat renewal is `:81-82`. Context arms `AbortSignal.timeout` from that deadline (`context-stage.runner.ts:73-78`). Deadline-only triage or all-deadline lenses return before publication (`review-orchestrator.service.ts:99-106`). |
| B2 | Closed | Gateway `spawn` returns `void` (`review-lane-gateway.ts:37-60`). Runner reads `lane-output.json` after exit (`review-lane.runner.ts:91-95`). `readOutput` realpath-checks `out/` (`review-lane-files.ts:34-42`). Triage requires the three headings (`review-lane.runner.ts:96-101`). |
| B3 | Closed | `dispose` aborts `drainController` (`review-worker.activation.ts:90-104`). `process` skips `release` and stage failure writes when that signal is aborted (`review-orchestrator.service.ts:120-123` and `:163-165`). Shutdown still awaits `awaitStopped` before `sqliteConnection.close()` (`shutdown.ts:330-347`). Dispose itself remains earlier (`shutdown.ts:241`), which is what aborts the drain. |
| S1 | Closed | Rediscovery activates the head before the dedupe return (`sqlite-review.repository.ts:73-89`). `failed`, `cancelled`, and `interrupted` are not treated as the current automatic attempt, so a new row is inserted. `reconcileExpiredLeases` sets an expired active attempt back to `queued` (`:137-140`) and cancels only what is still `running` (`:141-142`). `stage()` no longer refuses an interrupted stage (`review-orchestrator.service.ts:144-152`). |
| S2 | Closed | `acquire` takes `laneCapPerPr` and enforces it (`review-lane-admission.service.ts:29-35`). The runner loads operator settings and passes the cap (`review-lane.runner.ts:71-72`). Verification builds one candidate list and one `lanes.run` (`verification-stage.runner.ts:20-38`). Batch parser rejects a bad family and duplicate ids (`review-output.parser.ts:19-25`). |
| S3 | Closed | Context derives exports, passes them to `build`, and puts callers in `fileContent` (`context-stage.runner.ts:39-47` and `:92-102`). `defaultChecks` scopes ESLint and the degradation audit to changed `src` files (`:50-59`). Electron `baseConfig` reads `.ptah-review.yaml` from the base SHA via `git` argv, then Zod (`electron-review-environment.ts:30-35` and `:64-81`). |
| S4 | Closed | Drafts call `recordDraft` and are not queued (`discovery-stage.runner.ts:31-33`, `sqlite-review.repository.ts:45-63`). `recordPoll(false)` keeps `last_poll_at` and writes `poll_status` / `review_poll_state` (`review-worker.activation.ts:34-50` and `:83-85`). `listRuns` returns that poll (`review-query.repository.ts:81-89`). The page shows a failed-poll alert (`review-runs-page.component.ts:27`). The alert's retry action is a new defect (N2), not this recording gap. |
| S5 | Closed | `review:retryHead` returns `attemptId` (`review-rpc.handlers.ts:78-80`, schema `:67-74`). A partial lens is stored as `outcome: 'partial'` with `errorSummary` (`lens-stage.runner.ts:47-49`). Query maps `outcome === 'partial'` to status `partial` (`review-query.repository.ts:45`). |
| S6 | Closed | Verifier candidates go through `fenceReviewInput` (`verification-stage.runner.ts:27-38`). Publication reads `redactionSecrets` and refuses verified findings and both artifacts if a supplied secret survives (`publication-stage.runner.ts:32-48`, `review-artifact.writer.ts:45-47` and `:118-141`). Electron does not implement `redactionSecrets`; pattern redaction still runs. That residual is the port's empty default, not the old hardcoded skip of the check. |
| M1 | Closed | Worktree add/remove must be the exact `--detach` / `--force` forms, `src` basename, and an attempt directory under `attemptsRoot` (`review-command-runner.ts:57-72`). Output cap sets `timedOut` (`:102-105`). |
| M2 | Closed | Settings read is nullable (`review-rpc.schema.ts:21-23`). The store keeps `hasToken`, a draft, and `saveSettings` via `review:updateSettings` (`review-runs.store.ts:85-112`). The drawer edits logins, poll, and lane cap and does not send a token. |
| M3 | Closed | Header has a pause checkbox bound to `setPublicationPause` and a Lucide refresh control with an accessible name (`review-runs-page.component.ts:18-24`). Failed pause sets `pauseError` and does not change `settings` (`review-runs.store.ts:114-125`). Not re-rendered in a browser. |

## New findings

### N1. Serious — a new SHA cancels the old attempt without `result_status`, and the runs list then throws

- File: `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts:80-81`, `libs/backend/review-core/src/lib/persistence/review-query.repository.ts:53-54`
- Scenario: `enqueue` on a changed head sets matching attempts to `state = 'cancelled'` and does not set `result_status`. `recordDraft` in the same file does set `result_status = 'superseded'` (`:61-62`). `mapRun` does `result_status ?? state`. A null result with state `cancelled` hits `throw new Error('Review result status unavailable')` before any run is returned. `listRuns` and `getRun` both use `mapRun`, so one superseded row fails the whole history RPC.
- Impact: The first push that replaces an active head makes Review runs fail to load. Discovery itself still queues the new SHA.
- Fix: Set `result_status = 'superseded'` on that cancel, matching `recordDraft` and `reconcileExpiredLeases` (`:141-142`).

### N2. Serious — "Retry with Refresh" does not poll

- File: `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts:24` and `:27`, `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts:44-55`
- Scenario: The failed-poll alert says to retry with Refresh. That button calls `store.load()`, which only repeats `review:listRuns` and `review:listRepositories`. `review:refresh` exists on the host (`review-rpc.handlers.ts:82-85`) and is not in the store's method union (`review-runs.store.ts:130`).
- Impact: After a GitHub poll failure the banner stays, `last_poll_at` stays put, and the operator cannot start the retry the screen offers.
- Fix: Point that action at `review:refresh`, then reload the list. Keep the header Reload on `load()` if it is only meant to refetch SQLite.

## Notes

- Abort settlement is ordered: dispose aborts the drain signal, in-flight heartbeats are collected and awaited (`review-orchestrator.service.ts:78-88` and `:121-122`), and repository release is skipped when the signal is already aborted. The 5s shutdown budget can still expire while `getPull` / `getDiff` run, because those GitHub calls do not take the signal. The next SQLite write is then skipped. Residual, not a reopen of B3.
- `release()`'s false return is still ignored when the signal is not aborted (`review-orchestrator.service.ts:123`). A lost lease is requeued on the next startup by S1's reconcile, so this is not an open S1.
- Export detection only matches `export <kind> Name` added lines (`context-stage.runner.ts:43`). Re-exports of the form `export { name }` are not caller-searched. The stage is no longer hard-wired empty.
- `child.kill()` on abort is not a process-tree kill (`review-command-runner.ts:89-90`). The command promise still settles when the direct child closes.
- Round-1 helper notes under `reviews/_lane-*.md` were not used as evidence.
