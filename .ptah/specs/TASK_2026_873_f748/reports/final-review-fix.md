# Final PR review fixes

| Finding | Confirmed? | Fix (files) | Regression spec |
| --- | --- | --- | --- |
| F1: manual Refresh leaves failed poll state | Yes | `ReviewOrchestratorService.pollAndRecord` and `SqliteReviewRepository.recordPoll` share the cron, startup, and Refresh path; typed disabled error added in `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts` | `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.spec.ts` verifies failure code, unchanged cursor, and recovery; orchestrator and RPC specs cover disabled and failed Refresh. |
| F2: Refresh times out early and reports history failure | Yes | `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts` gives Refresh 120 seconds, reloads after failure or timeout, and exposes a generic refresh error; `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts` gives failed-poll Retry the refresh action | `libs/frontend/review-runs-ui/src/lib/review-runs.store.spec.ts` covers long timeout, failed result, timeout and reload; `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.spec.ts` checks both Retry actions. |

## Decisions

- Manual Refresh on a disabled or unconfigured repository returns `REVIEW_DISABLED` and records no poll. Options were to reject or record nothing while returning success. The cron path skips disabled repositories, and reporting success without a poll would mislead the operator. This is reversible.
- A 120-second Refresh timeout covers multiple 15-second GitHub request attempts and per-pull base configuration reads. Read RPCs retain 5 seconds. This is reversible.
- Refresh failure surfaces a fixed UI alert and reloads list state because a timed-out host poll can still finish. Raw adapter errors are never shown or persisted. This is reversible.

## Verification

Scoped `ptah_get_diagnostics` was run on edited TypeScript files. It returned unavailable because the TypeScript check exceeded 45 seconds on each of three attempts. Nx/npm execution was prohibited by D26; the orchestrator must run the regression specs and `npm run verify`.

## Files changed

- `libs/backend/review-core/src/lib/persistence/record-review-poll.ts`
- `libs/backend/review-core/src/index.ts`
- `apps/ptah-electron/src/activation/review-worker.activation.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.spec.ts`
- `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`
- `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts`
- `libs/frontend/review-runs-ui/src/lib/review-runs.store.spec.ts`
- `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts`
- `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.spec.ts`
- `.ptah/specs/TASK_2026_873_f748/reports/final-review-fix.md`

## Follow-up: verify failures

| Item | Cause | Fix | Files |
| --- | --- | --- | --- |
| Electron DI smoke | RPC handler injected an unregistered SQLite token and wrote poll tables directly. | RPC now calls `ReviewOrchestratorService.pollAndRecord(repo)`. The orchestrator validates enabled settings and owns discovery and recording; `SqliteReviewRepository` owns SQL. Cron and startup use the same path. | `review-rpc.handlers.ts`, `review-orchestrator.service.ts`, `review-repository.interface.ts`, `sqlite-review.repository.ts`, `discovery-stage.runner.ts`, `review-worker.activation.ts`, `index.ts` |
| Store lint | Catch binding was unused. | Bare catch sets the visible fixed refresh error and reloads state. | `review-runs.store.ts` |
| Page spec | Retry button text differed from assertion. | Button now says “Retry with Refresh” and has an accessible label; spec selector matches. | `review-runs-page.component.ts`, `review-runs-page.component.spec.ts` |

### Decisions

- The repository identity comes from the refresh RPC request or enabled settings entry. Discovery accepts that identity. Disabled or absent settings fail before recording. This is reversible.
- Poll persistence remains on the review repository port. A failed discovery writes only `github-poll-failed`; the last success cursor stays unchanged. This is reversible.

### Follow-up files changed

- `apps/ptah-electron/src/activation/review-worker.activation.ts`
- `apps/ptah-electron/src/activation/review-worker.activation.spec.ts`
- `libs/backend/review-core/src/index.ts`
- `libs/backend/review-core/src/lib/review-orchestrator.service.ts`
- `libs/backend/review-core/src/lib/review-orchestrator.service.spec.ts`
- `libs/backend/review-core/src/lib/persistence/review-repository.interface.ts`
- `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.ts`
- `libs/backend/review-core/src/lib/persistence/sqlite-review.repository.spec.ts`
- `libs/backend/review-core/src/lib/persistence/record-review-poll.ts` (removed)
- `libs/backend/review-core/src/lib/stages/discovery-stage.runner.ts`
- `libs/backend/review-core/src/lib/stages/lens-stage.runner.spec.ts`
- `libs/backend/review-core/src/lib/testing/dry-run-fixture.spec.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.ts`
- `libs/backend/rpc-handlers/src/lib/handlers/review-rpc.handlers.spec.ts`
- `libs/frontend/review-runs-ui/src/lib/review-runs.store.ts`
- `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.ts`
- `libs/frontend/review-runs-ui/src/lib/components/review-runs-page.component.spec.ts`
- `.ptah/specs/TASK_2026_873_f748/reports/final-review-fix.md`


### Follow-up verification

Scoped ptah_get_diagnostics was invoked for the changed source files twice. Both calls returned unavailable after the 45-second TypeScript check timeout, so compiler and scoped Jest results remain for the orchestrator to verify. Nx/npm were prohibited by D26.

