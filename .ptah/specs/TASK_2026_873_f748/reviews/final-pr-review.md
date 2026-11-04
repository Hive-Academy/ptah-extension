# Final whole-PR logic review — TASK_2026_873_f748

## Verdict

**REJECT** — score **6/10**.

Head `5e955b446` (`git log --oneline main..HEAD`, 24 commits). N1 and N2 from round 2 are closed in the current tree. The unattended pipeline still records poll success and failure on the cron and startup paths. The recovery control those paths advertise does not. `review:refresh` never writes `poll_status`, so a successful Refresh leaves the failed-poll alert up. The same call uses a 5-second renderer timeout while one GitHub GET is allowed 15 seconds, and the store then reports a history-load failure and skips the reload.

Score stays at round 2's 6 because the earlier blocking lease, output-file, and shutdown defects remain closed, and the cross-cutting wiring checked here (boundaries, DI guards, RPC allowlist, migration 0065, host imports) holds. It is not 7–8 because the operator action named on the failed-poll alert still fails to clear that alert, on both a fast success and a slow GitHub response.

No additional skill was loaded. This lane has no skill-loader call beyond the role text already in the prompt. No UI was rendered. Nx, npm, build, serve, and e2e were not run. Orchestrator batch verification was taken as given.

## N1/N2 status

| ID | Status | Evidence |
| --- | --- | --- |
| N1 | Closed | A changed head cancels queued and running attempts with `result_status = 'superseded'` (`libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts:80-81`). `mapRun` maps a legacy `cancelled` row whose `result_status` is null to `superseded` (`libs/backend/review-core/src/lib/persistence/review-query.repository.ts:53`). |
| N2 | Closed | Header Refresh calls `store.refresh()` (`libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts:24`). `refresh()` sends `review:refresh` and then `load()` (`libs/frontend/review-runs-ui/src/lib/review-runs.store.ts:64-73`). The handler runs `discoveryHandler()` (`libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts:82-85`). Settlement of that poll is F1 and F2 below. |

## Findings

### F1. Serious — a successful manual refresh does not clear the failed-poll alert

- File: `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts:82-86`, `apps/ptah-electron/src/activation/review-worker.activation.ts:34-60`, `libs/backend/review-core/src/lib/persistence/review-query.repository.ts:81-88`, `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts:27`
- Scenario: Cron and startup call `recordPoll` around `discoveryHandler()`. `review:refresh` calls `discoveryHandler()` and returns `{ ok: true }` without writing `review_repositories.poll_status`, `poll_error`, or `review_poll_state`. `listRuns` reads those columns for `hive-academy/ptahcode`. The page shows "The last review poll failed… Retry with Refresh" whenever `poll.status === 'failed'`. After a failed startup or cron poll, Refresh can enqueue heads and reload the list while `poll_status` stays `failed`.
- Impact: The alert stays after the retry it names. With the repository disabled, cron returns `review-disabled` before `discover()` (`review-worker.activation.ts:65-68`), so nothing else writes `poll_status = 'succeeded'` and the alert stays until a later successful cron `discover()`.
- Fix: Record the poll outcome on the same path `review:refresh` uses, including failure, then reload. Keep the generic `github-poll-failed` code. Do not persist the raw adapter message.

### F2. Serious — Refresh gives up before one GitHub request is allowed to finish, and the failure is labeled as a history-load error

- File: `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts:69-76`, `libs/frontend/core/src/lib/services/claude-rpc.service.ts:23` and `:173-185`, `libs/backend/review-github/src/lib/github-review.adapter.ts:96-98`, `libs/backend/review-core/src/lib/stages/discovery-stage.runner.ts:20-38`, `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts:30-31`
- Scenario: Every review RPC, including `review:refresh`, passes `timeout: 5_000`. `ClaudeRpcService` resolves a failed `RpcResult` when that timer fires and leaves the host call running. The default for other methods is 30 seconds. `GithubReviewAdapter.request` aborts one GET at 15 seconds and retries HTTP 5xx. Discovery then calls `baseConfig` once per open pull. The store treats `!result.ok` and any throw the same: it sets `offline` or `error` and does not call `load()`. The error alert says "Review history could not be loaded" and its Retry button calls `load()`, which only repeats `review:listRuns` and `review:listRepositories`. The `catch` stores no poll error.
- Impact: A slow but still in-budget GitHub poll, the case the retry exists for, is shown as a history failure. The server can still finish discovery. The screen does not reload, and F1 leaves the poll row unchanged. The inline Retry does not start another poll. Header Refresh can be clicked again and hits the same 5-second budget.
- Fix: Give `review:refresh` a timeout above one discovery pass (GitHub's 15-second attempt budget plus the per-pull base-config reads). On failure, keep the failed-poll alert and point Retry at `refresh()`. A visible state change is already there. The gap is the wrong action and the budget.

## Notes

- D40 is single-repository. `RepositorySettingsSchema` is the literal `Hive-Academy` / `PtahCode` and `OperatorSettingsSchema.repositories` is `max(1)` (`libs/backend/review-contracts/src/lib/review-config.schema.ts:67-80`). `refresh()` sends `repositories()[0]`, then settings, then that same default (`review-runs.store.ts:68-70`). The handler parses `repo` and ignores it. Discovery always uses `REVIEW_REPO` (`discovery-stage.runner.ts:8` and `:24`). Polling the first repository matches P1. Multi-repo mapping stays P2. This is not a finding.
- The empty `catch` in `refresh()` does change `state`, so the failure is visible. It is F2's mis-label, not a fully swallowed error. Sibling catches in the same store set `error` or a fixed sentence and also omit a logger. The frontend lib has no injected logger. Raw `result.error` should stay off the page.
- Module tags match the decisions: `review-contracts` `scope:shared,type:util`, `review-core` `scope:extension,type:feature`, `review-github` `scope:extension,type:data-access`, `review-runs-ui` `scope:webview,type:feature,platform:angular`, `review-eval` `type:tool`. No `review-*` lib imports `electron` or `vscode`. No deep `@ptah-extension/*/src/` import in the review libs, rpc-handlers, or the Electron review services. `apps/ptah-electron/tsconfig.build.json` maps `review-contracts`, `review-core`, and `review-github`. `nx.json` includes those projects plus `review-runs-ui` and `tools/review-eval` on the Jest and ESLint plugins.
- DI: `registerReviewCore` and `registerReviewGithubServices` run from `phase-2-libraries.ts`. `expected-resolvable.ts` lists `ReviewRpcHandlers` and the review tokens. `ReviewRpcHandlers.METHODS` matches the manifest `review` entry and `RPC_METHOD_NAMES` (`rpc.types.ts:3758-3767`). `ALLOWED_METHOD_PREFIXES` contains `review:`. `review:verifyBot`, `review:replaceBotToken`, and `review:removeBotToken` stay on the contract schema and are excluded from `ReviewP1RpcMethod`, so they are not callable. No handler is missing for a registered method.
- Migration `0065_ptah_review` is version 65, uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`, and is registered once in `migrations/index.ts`.
- No `any`, `@ts-ignore`, `as unknown as`, or `console.*` in `review-contracts`, `review-core`, `review-github`, `review-runs-ui`, or `apps/ptah-electron/src/services/review`. Review RPC `safe()` replaces adapter failures with `RpcUserError` and does not log the caught value. Poll rows store `github-poll-failed`, not the exception text.
- `review-runs-ui/eslint.config.mjs` turns off `@angular-eslint/prefer-on-push-component-change-detection`. The page component still sets `ChangeDetectionStrategy.OnPush`. Left as a convention note. D25 asked new libs not to add a local ESLint config. That is outside this logic verdict.
- CLI and VS Code do not start the review worker. D3 limits P1 to Electron. Not a finding.

## Decisions

- **D40 first-repository refresh is in contract.** Options: flag it as a multi-repo bug, or accept it for P1. Evidence: `decisions.md` D40, `OperatorSettingsSchema.repositories.max(1)`, and `REVIEW_REPO`. Reversible when P2 widens the schema and the handler must honor the passed repo.
