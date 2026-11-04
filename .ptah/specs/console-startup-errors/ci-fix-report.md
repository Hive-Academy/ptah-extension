# PR #936 CI fix report

## webview-e2e root cause

`libs/frontend/webview-e2e-harness/src/lib/scenarios/boot/boot-progress.e2e.spec.ts:129-153` sends `boot:readinessChanged` immediately after `page.goto` and expects a database headline. On main, `apps/ptah-extension-webview/src/main.ts:1-14` statically imports Angular, App, config, and core, then starts bootstrap synchronously. The branch awaits Zone selection and dynamic imports before bootstrap (`main.ts:28-38`). A push during that gap has no `BootStatusService` message handler; the initial readiness pull is deliberately unanswered by this harness (`boot-progress.e2e.spec.ts:22-32`). The observed CI failure was this test on the first run and retry. The requested full `gh run view 41895320677 --log-failed` output could not be read: GitHub CLI requires `gh auth login` or `GH_TOKEN` in this environment; the public Actions page also says “Sign in to view logs.” Thus the specific locator timeout text remains unverified.

## Fix

`apps/ptah-extension-webview/src/main.ts:14-42` now captures early `boot:readinessChanged` and `boot:progress` events before the first async import and replays them, in order, after Angular bootstrap installs handlers. The listener is removed on success and error. The normal path remains zoneless; the fallback still loads Zone.js before Angular imports. The e2e test was not changed because an early host push is a product requirement.

## CodeRabbit items

- `opencode.source.ts:33`: The signal query previously excluded invalid JSON, and filtering in the page loop skipped malformed assistant records. `sources/opencode.source.ts:38-76` now pages invalid JSON candidates, counts them incrementally, and sends schema-invalid JSON to the existing malformed counter. `sources/cold-start-budget.spec.ts:54-78` inserts 256 bad rows followed by a valid assistant row and checks the malformed count and valid contribution.
- `opencode.source.ts:48`: The cursor previously depended on data validation, allowing a repeated page. `sources/opencode.source.ts:45-60` advances on independently validated rowid, stops a stalled page, and avoids caching a stalled projection. The same 257-row regression test verifies progress beyond a full malformed page.
- `usage-summary.service.ts:68`: The `groups.size >= MAX_FACTS` break discarded later additions to existing keys. `usage-summary.service.ts:62-90,115-118` processes later slices, skips only new keys beyond the cap, and reports `fact-limit` when a key was actually omitted. `usage-summary.service.spec.ts:87-109` tests a later slice updating `m0` after 100,000 facts.

The review prose was read on the [public PR page](https://github.com/Hive-Academy/PtahCode/pull/936); `gh api` was unavailable for the same authentication reason as the run log.

## Verification

- `npx jest -c libs/backend/usage-analytics/jest.config.ts --runInBand --silent --coverage=false`: 7 suites passed, 44 tests passed, exit 0. An initial run failed on a test-only `better-sqlite3` declaration import; the test now uses a narrow local constructor type.
- `npx jest -c apps/ptah-extension-webview/jest.config.ts --runInBand --silent --coverage=false`: exit 1 before tests; all 27 suites failed to start because esbuild `startSyncServiceWorker` returned `spawn EPERM`.
- `$env:NX_DAEMON='false'; npm run verify -- -p ptah-extension-webview,usage-analytics`: run once, exit 1 before targets; Nx default, ESLint, and Jest plugins each failed with `spawn EPERM`.
- `npx eslint apps/ptah-extension-webview/src/main.ts libs/backend/usage-analytics/src/lib/sources/opencode.source.ts libs/backend/usage-analytics/src/lib/sources/cold-start-budget.spec.ts libs/backend/usage-analytics/src/lib/usage-summary.service.ts libs/backend/usage-analytics/src/lib/usage-summary.service.spec.ts`: exit 0, no diagnostics.
- `git diff --check`: exit 0, no whitespace errors.

## Open risks

- The webview e2e and Electron runtime checks were prohibited locally. CI must confirm the boot screen and handover.
- The Actions log is inaccessible without GitHub authentication, so the diagnosis rests on the failing test's timing and the source order rather than its full locator trace.
- The webview Jest and Nx verification results remain unverified because subprocess creation is denied by this worktree environment (`spawn EPERM`). No UI screenshot was possible without a forbidden build or serve target.
