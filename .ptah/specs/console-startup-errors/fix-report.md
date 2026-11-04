## Root causes (file:line)

- `apps/ptah-extension-webview/project.json:16` put Zone.js in every runtime bundle, while `src/app/app.config.ts:187-189` normally uses `provideZonelessChangeDetection()`. Angular therefore emitted NG0914.
- `libs/backend/usage-analytics/src/lib/sources/codex.source.ts:20-35` and `grok.source.ts:20-38` read up to 10,000 JSONL files sequentially on a cold cache without checking the RPC abort signal. The handler's 30-second budget (`analytics-rpc.handlers.ts:33,85`) could expire while a source kept scanning, exceeding the frontend's 40-second timeout (`usage-vitals.cache.ts:26,90`). The timeout result then reached `vitals-load.ts:149` as an error. This is a code-path diagnosis; no Electron timing measurement was run.
- Review found another Electron path at `usage-summary.service.ts:56-103`: synchronous Claude ledger SQL and the OpenCode query were ahead of abort checks, so a large database could still block the 30-second timer.

## Changes

- Removed the unconditional webview Zone.js polyfill. `main.ts` now loads it only when the Electron bootstrap flag requests zone change detection, before Angular bootstrap.
- Codex and Grok readers now stop folder and line scans on abort and report `time-budget` partial status. Interrupted file projections are not stored in `FileFactsCache`.
- Added cold-start abort and cache regression specs.

## Tests

- `cold-start-budget.spec.ts` covers an expired budget in both JSONL sources and reparsing after a partial projection.

## Verification (exact command + result)

- `npm run verify -- -p ptah-extension-webview @ptah-extension/usage-analytics`: rejected by verify wrapper; projects require a comma-separated `-p` value. No checks ran.
- `npm run verify -- -p ptah-extension-webview,@ptah-extension/usage-analytics`: failed before targets ran. Nx daemon socket returned `connect EPERM`; Nx plugin loading then failed with `spawn EPERM` for the default, ESLint, and Jest plugins. Per task rule, verification was not retried.

## Decisions (option chosen, alternatives, evidence)

- Kept the Electron `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1` path by loading Zone.js on demand (`startup-config-ipc.ts:58-59`). Removing Zone.js completely would break that explicit fallback. A non-spec search of webview and `libs/frontend` found `NgZone.run` and `runOutsideAngular` calls, which are no-ops under zoneless; it found no `onStable`, `onMicrotaskEmpty`, or `fakeAsync` runtime use.
- Kept the 30-second host and 40-second frontend budgets and the RPC schema. Timely partial summaries are valid existing responses; raising the timeout would hide the cold scan. Real RPC failures still follow the existing error path.

## Not changed and why

- The landing page and other Angular apps have separate build configuration and are outside this renderer scope. Jest Zone.js test setup remains intact.
- No app launch or bundle build was performed, per task restrictions. Runtime behavior should be checked manually.

## Manual check steps (Electron dev app)

1. Open Electron with a fresh worktree and DevTools console. Verify NG0914 is absent.
2. Open the usage summary on cold start with many Codex/Grok sessions. It should resolve within the 40-second frontend budget; if the scan exceeds 30 seconds, source status should be partial with `time-budget`, without the vitals RPC timeout error.
3. Set `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1` and relaunch. Verify the fallback still boots without a missing Zone.js error.

## Revision 1

| Review item | Change (file:line) | Test / evidence |
| --- | --- | --- |
| 1. Claude ledger blocks the event loop | `usage-summary.service.ts:60-113` checks abort before SQL, reads groups in hourly slices, yields with `setImmediate`, and returns `time-budget` partial status. The signal-bearing RPC path defers full-range session counts and rankings, marking the source partial. | `usage-summary.service.spec.ts` covers pre-aborted and mid-scan abort. An individual hourly SQL aggregation is still synchronous and can block if one hour alone is exceptionally large; this was not timed on a real database. |
| 1. OpenCode ignores abort | `sources/opencode.source.ts:19-86` checks abort, reads SQLite messages in 256-row pages with yields, and does not cache an aborted projection. | `sources/cold-start-budget.spec.ts` covers pre-aborted read. |
| 2. Zone patch order | `apps/ptah-extension-webview/src/main.ts:1-36` leaves the RPC readiness call in place, imports Zone.js before dynamic Angular and app imports, and keeps the display config lazy. | Source inspection; app launch was prohibited. |
| 3. Aborted cache eviction | `sources/file-facts.ts:29-40` returns before eviction when aborted or too large to insert. | `sources/cold-start-budget.spec.ts` checks that an aborted insert preserves a full existing projection. |
| 4. Display window fallback | `display-window.config.ts:4-59` selects the Zone provider when the fallback flag is set. | Source inspection; app launch was prohibited. |
| 5. Outer loop cap | `sources/codex.source.ts:22-23` and `sources/grok.source.ts:30-31` stop outer loops once 10,000 files are scanned. | `sources/cold-start-budget.spec.ts` checks the 10,000-file edge for both sources. |

### Revision verification

- Exact required command: `$env:NX_DAEMON='false'; npm run verify -- -p ptah-extension-webview,usage-analytics`. It produced no output for several minutes and was interrupted; lint, test, and typecheck results were not obtained. No second verify run was made.
- Direct `npx eslint` on changed TypeScript files reported only the documented worktree `@nx/enforce-module-boundaries` errors for `@ptah-extension/core` in `main.ts` and `display-window.config.ts`, plus an unused `Row` warning that was removed afterward. No other errors were reported in that run.
- A follow-up `npx eslint` on every changed `usage-analytics` TypeScript file exited 0 with no output.
- Scoped `ptah_get_diagnostics` was unavailable: its TypeScript check was still running after 45 seconds and returned all six requested files as unchecked.
- `git diff --check` produced no whitespace errors. No Electron launch, build, or runtime timing was performed.

## Revision 2

The changes below supersede the Revision 1 descriptions of deferred ledger counts, OpenCode's unfiltered page query, and RPC readiness before Zone.js.

| Review item | Change (file:line) | Test / evidence |
| --- | --- | --- |
| Serious: finished RPC summaries omitted ledger sessions, messages, and rankings | `libs/backend/usage-analytics/src/lib/usage-summary.service.ts:94-116` runs the count and ranking queries while the budget is live; an abort still marks the ledger partial. | `usage-summary.service.spec.ts:39-55` asserts session and message counts with an RPC signal. Pre-aborted and mid-scan tests still cover the partial path. |
| Moderate: OpenCode scanned old rows before reaching the requested range | `libs/backend/usage-analytics/src/lib/sources/opencode.source.ts:40-43` applies assistant role and `[since, until)` filters in each SQL page. | The usage analytics Jest suite passes; SQL predicate inspected against the unsignaled query. |
| Moderate: RPC listener registered before fallback Zone.js | `apps/ptah-extension-webview/src/main.ts:17-19` loads Zone.js before importing the local RPC readiness module; `src/app/rpc-ready.ts:1` statically imports the core library inside that deferred module. | Source order inspected. Targeted ESLint passes, including the lazy import rule. Electron launch remains outside the task's allowed checks. |
| Test failure: `fs.readdir` namespace property cannot be spied on | `libs/backend/usage-analytics/src/lib/sources/cold-start-budget.spec.ts:11-14,84-103` uses a Jest module mock and typed `PathLike` implementations, clearing call counts before each cap assertion. | `npx jest -c libs/backend/usage-analytics/jest.config.ts --runInBand --silent`: **Test Suites: 7 passed, 7 total; Tests: 41 passed, 41 total; exit code 0.** |
| Worker exit warning | The awaited `setImmediate` calls in `usage-summary.service.ts:92` and `opencode.source.ts:54` create no recurring timer. | The Jest process exited with code 0 after reporting all suites; no worker exit warning appeared. |

Targeted lint: `npx eslint apps/ptah-extension-webview/src/main.ts apps/ptah-extension-webview/src/app/rpc-ready.ts libs/backend/usage-analytics/src/lib/usage-summary.service.ts libs/backend/usage-analytics/src/lib/usage-summary.service.spec.ts libs/backend/usage-analytics/src/lib/sources/opencode.source.ts libs/backend/usage-analytics/src/lib/sources/cold-start-budget.spec.ts` exited 0.

Required verification command (run once): `$env:NX_DAEMON='false'; npm run verify -- -p ptah-extension-webview,usage-analytics`. Result: exit code 1 after the queue released. Nx failed to load its default and ESLint/Jest plugins with `spawn EPERM` before lint, test, or typecheck targets ran. The direct Jest and targeted ESLint results above are the available checks; no verify retry was made.

