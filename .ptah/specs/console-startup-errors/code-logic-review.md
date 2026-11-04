# Code Logic Review — `console-startup-errors`

## Summary

| Metric              | Value                          |
| ------------------- | ------------------------------ |
| Overall score       | 5/10                           |
| Assessment          | NEEDS_REVISION                 |
| Verdict             | REVISE                         |
| Blocking issues     | 0                              |
| Serious issues      | 1                              |
| Moderate issues     | 2                              |
| Minor issues        | 2                              |
| Failure modes found | 4                              |

The zoneless startup path is wired correctly for the default Electron and VS Code webview build. The Codex and Grok readers do observe the signal the handler already passes, and an aborted projection is not inserted into `FileFactsCache`. The cold-start timeout is not closed on the Electron path a machine with many Claude sessions actually takes: that path runs synchronous ledger SQL before any abort check, and the 30s timer cannot fire while that query blocks the event loop.

Score is 5 rather than 7–8 because the user-visible failure (frontend `analytics:spendSummary` timeout at 40s) still happens when the session ledger is large, which is the Electron composition. It is not 3–4 because the default Zone.js removal matches `provideZonelessChangeDetection`, the fallback flag is synchronous, and the Codex/Grok abort checks are real.

Skill: the task assigned none. No catalogue skill describes this review's method; the role file was the method. `ptah_code_search_symbols` returned an empty index (`symbolCount: 0`), so symbol lookup fell back to Grep. No source was edited, so `ptah_get_diagnostics` was not run. The coordinator owns lint, test, and typecheck. This review did not build or launch Electron.

## Decisions

- Verdict is REVISE, not APPROVE. Options were to accept the Codex/Grok abort as enough, or to require the budget to cover the work Electron runs first. Evidence: `apps/ptah-electron/src/di/phase-1-infra.ts:167` registers `SessionStatsRepository`, and `usage-summary.service.ts:31-33` then skips `ClaudeLedgerSource` and reads Claude usage from synchronous SQL at `usage-summary.service.ts:56-77` before the signal is consulted at line 103. Reversible: yes, this is a review verdict only.

## Five logic questions

### 1. How does this fail silently?

- A time-budget summary is a successful RPC. `usage-vitals.cache.ts:91-95` maps any schema-valid summary to `vitalsReady`, and `vitals-load.ts:20-21` and `vitals-load.ts:119-122` serve that `ready` value for 60s. Totals from a prefix of the scan look like a finished spend summary until the TTL expires. The source rows do carry `reason: 'time-budget'` (`usage-summary.service.ts:184`), so a surface that reads `sources` can tell. The empty-screen cache does not.
- An aborted Codex or Grok file is not written into `FileFactsCache` (`file-facts.ts:35-38`). Files that finished before the abort stay cached and are reused. That part does not hide later bytes of an interrupted file. The next fetch reparses it.
- `FileFactsCache.read` still evicts older entries to make room for a projection it then refuses to store when the signal is already aborted (`file-facts.ts:29-38`). A large aborted parse drops good cache entries and leaves nothing in their place. The next summary rescans those files. The cached value is not a partial lie; the cache is just emptied.

### 2. What user action produces unexpected behaviour?

- Open the Electron app with a large `session_usage_turns` table (many Claude sessions) and read the usage summary on a cold start. `getWorkspaceUsageGroups` and `getWorkspaceTopSessions` run to completion with no signal (`session-stats-repository.ts:410-427` and `session-stats-repository.ts:449-484`). Both call better-sqlite3 `.all()`, which blocks the event loop, so `setTimeout` in `analytics-rpc.handlers.ts:85` does not abort until the queries return. If that work exceeds 40s, `usage-vitals.cache.ts:90` still times out and `vitals-load.ts:148-152` records an error. The new Codex and Grok checks have not started yet.
- Set `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1` and open the detached display window (`?ptahWindow=display`). `main.ts:22-24` loads Zone.js, then `display-window.config.ts:57` always calls `provideZonelessChangeDetection()`. In dev, Angular logs NG0914 (`node_modules/@angular/core/fesm2022/_debug_node-chunk.mjs:19664-19668`, `console.warn` only). The window still bootstraps on `NoopNgZone`. The default path, with the flag unset, no longer loads Zone.js, so that warning is gone there.

### 3. What input data produces a wrong answer?

- A Codex JSONL aborted mid-file contributes only the lines already parsed (`codex.source.ts:47-69`). Events before `session_meta` can lack `cwd` and then fail `workspaceMatches` at `codex.source.ts:37`, so a prefix undercounts that file. The partial projection is not cached, so a later full read can correct it, after the 60s vitals TTL.
- There is no Gemini or Copilot usage source. External ids are `codex`, `opencode`, `grok`, `antigravity`, `ollama-cloud` (`usage-summary.service.ts:18` and `usage-summary.service.ts:31`). `CliSessionSource.read` returns `unavailable` immediately (`cli-session.source.ts:7-14`). It is not a scan. `OpenCodeSource.read` accepts no signal (`opencode.source.ts:19`) and runs one synchronous query of up to 100001 rows (`opencode.source.ts:31-38`). A large `opencode.db` produces the same timeout as the ledger, with a wrong empty error on the client rather than a partial summary.
- `UsageSourceStatusSchema.reason` is a free string (`rpc-analytics.types.ts:39-45`), so `'time-budget'` passes `UsageSummarySchema.parse` at `analytics-rpc.handlers.ts:93`. The partial result is not rejected into `PERSISTENCE_UNAVAILABLE`.

### 4. What happens when a dependency fails?

- The handler creates an `AbortController`, arms 30s, and awaits `summarize` (`analytics-rpc.handlers.ts:84-92`). Abort does not reject that await. Return time is whatever the current source does after it next reads `signal.aborted`.
- Codex and Grok poll between days or workspaces, between files, and between JSONL lines (`codex.source.ts:23-29` and `codex.source.ts:47-48`, `grok.source.ts:24-32` and `grok.source.ts:47-48`). A normal file returns near the deadline. A single `readdir` or a single readline of a huge line still runs to completion; `boundedLines` only drops a line after it has been read (`file-facts.ts:44-47`).
- `ClaudeLedgerSource` already polls (`claude-ledger.source.ts:104-114`) but Electron does not call it when the stats repository is present (`usage-summary.service.ts:31-33`).
- `pricing.price` is awaited per contribution and does not take the signal (`usage-summary.service.ts:112-125`). One slow price call can still sit past the remaining gap between 30s and 40s. That path is unchanged.
- Zone fallback: if `import('zone.js')` rejects, `main.ts:28-30` logs and neither window bootstraps. That is visible, not silent.

### 5. What is missing that the requirements never mentioned?

- The 30s budget is not applied to the session-ledger queries or to OpenCode. Those are the unbounded reads on an Electron host whose Claude history lives in SQLite.
- The inner `break` on `scannedFiles >= 10_000` still exits only the inner loop (`codex.source.ts:30` inside `codex.source.ts:22`, `grok.source.ts:33` inside `grok.source.ts:23`). The next day or workspace scans another 10_000 files. Abort checks stop the wall clock; the cap does not. This cap bug was already there; the edit left it in place.
- Skipped sources are recorded as `unavailable`, not `partial` (`usage-summary.service.ts:224-226`). A budget spent on Codex marks Grok `unavailable` with reason `time-budget`.
- No Electron timing run exists. The fix report says the same. Tests abort before any file IO (`cold-start-budget.spec.ts:22-23` and `cold-start-budget.spec.ts:29-31`).

## Failure modes

### Ledger query outruns both budgets

- Trigger: Electron cold `analytics:spendSummary` with a large `session_usage_turns` table.
- Symptom: the renderer still logs the RPC timeout. Codex and Grok abort support never runs.
- Evidence: `phase-1-infra.ts:167`, `usage-summary.service.ts:31-33` and `usage-summary.service.ts:56-77`, `session-stats-repository.ts:410-427`, `analytics-rpc.handlers.ts:84-92`, `usage-vitals.cache.ts:26` and `usage-vitals.cache.ts:90`.
- Current handling: SQL runs to completion. The abort timer is queued but cannot run during synchronous `.all()`.
- Recommendation: check the signal before the ledger block, and run those queries so the timer can fire (chunked reads, or `setImmediate` between pages) and return the partial summary the schema already allows. Do the same for `OpenCodeSource.read`.

### Aborted parse evicts the file cache

- Trigger: abort while parsing a file whose partial fact list is large enough to exceed `MAX_CACHED_FACTS` or while the cache is already at `MAX_ENTRIES`.
- Symptom: later summaries rescan files that had been cached. Numbers are not taken from the partial projection.
- Evidence: `file-facts.ts:29-38`.
- Current handling: eviction runs, then the aborted projection is dropped.
- Recommendation: skip the eviction loop when `signal.aborted` is already set, or evict only when the insert will happen.

### Fallback Zone.js loads after the app graph

- Trigger: `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1`.
- Symptom: `NgZone` is constructed after Zone exists, because `provideZoneChangeDetection` builds `NgZone` in a factory (`node_modules/@angular/core/fesm2022/core.mjs:1638-1644`) and `bootstrapApplication` runs after the dynamic import (`main.ts:22-26`). APIs captured while the static graph evaluated (`main.ts:1-3`, including `app.config.ts`) stay unpatched. Zone change detection can miss tasks those imports already bound.
- Evidence: `main.ts:1-26`, `app.config.ts:187-189`.
- Current handling: the flag is read once at `app.config` evaluation. Preload has already set it (`preload.ts:18` and `preload.ts:35-50`, `startup-config-ipc.ts:58-59`), so the provider choice matches the flag. The patch order does not.
- Recommendation: dynamic-import `zone.js` before importing `@angular/platform-browser`, `App`, and `app.config`, which is the order Angular requires for a real zone.

### Display window under the fallback flag

- Trigger: fallback flag on, and the URL is `?ptahWindow=display`.
- Symptom: dev console warns NG0914. Boot still completes.
- Evidence: `main.ts:22-24`, `display-window.config.ts:54-57`, Angular `provideZonelessChangeDetection` at `_debug_node-chunk.mjs:19664-19668`.
- Current handling: display config never reads `useZoneChangeDetectionFallback`.
- Recommendation: either skip the Zone.js import for the display window, or give that config the same provider branch as `app.config.ts`.

## Blocking issues

None.

## Serious issues

### Electron Claude ledger still ignores the summary budget

- File: `libs/backend/usage-analytics/src/lib/usage-summary.service.ts:56`
- Scenario: Electron always constructs `UsageAnalyticsService` with `SessionStatsRepository` (`apps/ptah-electron/src/di/phase-1-infra.ts:167`). `summarize` then runs coverage, grouped usage, session count, message count, and top sessions before `signal?.aborted` is read at `usage-summary.service.ts:103`. Those calls are synchronous better-sqlite3 `.all()` / `.get()` (`session-stats-repository.ts:410-427` and `session-stats-repository.ts:449-484`). The handler only aborts a signal (`analytics-rpc.handlers.ts:84-92`); it does not race the promise. A blocked event loop also postpones the 30s timer.
- Impact: on a workspace with many Claude sessions, the renderer still hits the 40s timeout in `usage-vitals.cache.ts:90` and surfaces an error through `vitals-load.ts:148-152`. The Codex/Grok changes do not run until this SQL returns. `OpenCodeSource.read` (`opencode.source.ts:19-38`) is the same class of hole if the ledger is fast and Codex returns quickly: the fourth argument from `usage-summary.service.ts:109` is ignored, and one synchronous query can pass 40s.
- Fix: poll or slice the ledger reads and `OpenCodeSource.read` on the same `AbortSignal`, and return the partial `UsageSummary` the handler already validates. Keep the synchronous `.all()` off the budget-critical path.

`ClaudeLedgerSource` is not the Electron reader in this composition. It already stops on abort (`claude-ledger.source.ts:104-114`). There is no separate Gemini or Copilot source to fix.

## Moderate and minor issues

### Moderate: Zone.js is imported after the static application graph

- File: `apps/ptah-extension-webview/src/main.ts:1`
- Scenario: fallback flag is true. `app.config.ts:187-189` has already chosen `provideZoneChangeDetection` during the static import, which is correct because `window.ptahConfig` is set in preload before page scripts (`preload.ts:18-50`, `zone-change-detection.ts:6-14`). `await import('zone.js')` then runs, and only then `bootstrapApplication`.
- Impact: the fallback the change claims to preserve patches Zone after Angular and the app modules have evaluated. `new NgZone` itself runs later and will see `Zone`. Tasks captured earlier are not patched. The default flag-off path does not import Zone.js, so NG0914 from the old polyfill is gone on that path.
- Fix: load `zone.js` before the Angular and app modules when the flag is set.

### Moderate: aborted reads still evict `FileFactsCache`

- File: `libs/backend/usage-analytics/src/lib/sources/file-facts.ts:29`
- Scenario: `parse` returns a large fact list after `signal.aborted` became true. The `while` loop drops oldest entries until the new list would fit or the map is empty. The following `if` then refuses to insert.
- Impact: one aborted file drops previously cached projections. It does not store the partial list (`file-facts.ts:35-38`). Codex's `partial: signal?.aborted` (`codex.source.ts:69`) and Grok's `partial = true` on abort (`grok.source.ts:48`) both take this path. A second call reparses; it does not read the partial back from the cache.
- Fix: return before eviction when the signal is aborted.

### Minor: display window stays zoneless while fallback loads Zone.js

- File: `apps/ptah-extension-webview/src/app/display-window/display-window.config.ts:57`
- Scenario: fallback flag set and `ptahWindow=display`.
- Impact: dev NG0914 warning. Production `ngDevMode` is false, so the warn is compiled out. Boot uses `NoopNgZone` either way. The default (flag off) display path no longer loads Zone.js, which removes the warning that the old polyfill caused on every display boot.
- Fix: branch the display providers, or import Zone.js only for the main window.

### Minor: the 10_000 file cap does not span the outer loop

- File: `libs/backend/usage-analytics/src/lib/sources/codex.source.ts:30` and `libs/backend/usage-analytics/src/lib/sources/grok.source.ts:33`
- Scenario: a 90-day Codex tree, or many Grok workspaces, with the signal still live.
- Impact: each day or workspace can scan another 10_000 files. Abort checks limit wall clock only when something polls. Pre-existing; the new `break` on abort has the same shape but the next outer iteration checks `signal.aborted` immediately, so abort itself does stop.
- Fix: use one labelled break, or a shared `partial` return, for both the cap and the abort.

## Data flow

1. Preload `ipcRenderer.sendSync('get-startup-config')` (`preload.ts:18`) assigns `window.ptahConfig.zoneChangeDetectionFallback` from `PTAH_ZONE_CHANGE_DETECTION_FALLBACK === '1'` (`startup-config-ipc.ts:58-59`, `preload.ts:49-50`). OK, synchronous, before module evaluation.
2. `app.config.ts:187-189` reads that flag once and picks `provideZoneChangeDetection` or `provideZonelessChangeDetection`. OK for the provider choice.
3. `main.ts:22` imports `zone.js` only when the flag is true, then bootstraps the main app or the display window. Gap: Zone patches run after the static graph. Display providers stay zoneless.
4. `project.json:16` sets `polyfills` to `[]`. `production` and `development` (`project.json:61-97`) do not override it. No second webview build target sets `zone.js`. The landing page is a different project and still polyfills Zone.js. OK for this app. Jest still calls `setupZoneTestEnv` (`apps/ptah-extension-webview/src/test-setup.ts:1-3` and the frontend `test-setup.ts` files). `fakeAsync` remains in specs only. No `onStable` or `onMicrotaskEmpty` in `*.ts` / `*.tsx`. `NgZone.runOutsideAngular` is documented as a no-op under zoneless (`message-router.service.ts:20-23`).
5. Renderer calls `analytics:spendSummary` with a 40s timeout (`usage-vitals.cache.ts:87-90`).
6. Handler validates params, arms 30s, calls `summarize` (`analytics-rpc.handlers.ts:57-92`). OK.
7. With the Electron repository, Claude data comes from uninterruptible SQL (`usage-summary.service.ts:56-77`). Gap.
8. Then each source `read(..., signal)` (`usage-summary.service.ts:109`). Codex and Grok honor it and return `partial` / `time-budget` (`codex.source.ts:41`, `grok.source.ts:42`). OpenCode ignores it. Gap.
9. `FileFactsCache` skips insert when aborted (`file-facts.ts:35`). Gap: eviction already happened.
10. Aggregator forces the in-flight source to `partial` / `time-budget` and marks the rest `unavailable` (`usage-summary.service.ts:184-187` and `usage-summary.service.ts:224-226`). Schema accepts the reason. Frontend caches the whole summary as `ready` for 60s.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Drop unconditional Zone.js so the default webview stops emitting NG0914 | COMPLETE | `polyfills: []` on the only build options. Both named configurations inherit it. Provider is zoneless when the flag is not strictly `true`. |
| Fallback flag readable synchronously before bootstrap | COMPLETE | Preload `sendSync` plus `useZoneChangeDetectionFallback` at `app.config` init and again in `main.ts`. |
| Fallback selects `provideZoneChangeDetection` and loads Zone.js first | PARTIAL | Provider selection is correct. Zone.js loads after the static imports, and the display window stays zoneless. |
| Display-window bootstrap still runs | COMPLETE | `main.ts:23-24` still lazy-imports `display-window.config` and bootstraps it. Its inner catch still logs failures. |
| No runtime `onStable` / `onMicrotaskEmpty` dependency found | COMPLETE | Search of `*.ts` / `*.tsx` found none. `NgZone` uses are `run` / `runOutsideAngular`. |
| Jest still loads Zone where specs need it | COMPLETE | `setupZoneTestEnv` is unchanged. `fakeAsync` specs were not switched to zoneless setup. |
| Handler passes `AbortSignal` into Codex and Grok | COMPLETE | Interface already had the argument (`usage-source.types.ts:28`). `summarize` passes it (`usage-summary.service.ts:109`). Both sources now read it. |
| Aborted parses are not cached | COMPLETE | Insert is guarded. Eviction is not. |
| Partial status reason `time-budget` | COMPLETE | At the source return and again in the aggregator for the source that was in flight. Sources not started are `unavailable`, not `partial`. |
| Host returns inside the frontend 40s budget on a Claude-heavy cold start | MISSING | Ledger SQL and OpenCode are outside the abort checks and can block the timer. |
| Other sources bounded the same way | MISSING | Claude ledger (Electron), OpenCode. Claude file source is bounded but unused in this host. Antigravity and Ollama return immediately. No Gemini or Copilot reader. |

Implicit requirements not addressed: the fix report's manual Electron check was not run, and `npm run verify` did not run (daemon `EPERM`). This review did not re-run it.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Flag unset or any value other than `true` | YES | `zone-change-detection.ts:13` uses `=== true`. Spec covers the string `'true'`. | None |
| Flag set, main window | PARTIAL | Zone import then `provideZoneChangeDetection` | Patch order |
| Flag set, display window | PARTIAL | Boots zoneless after Zone.js loads | Dev NG0914 |
| `polyfills` on production and development | YES | Inherited `[]` | Not compile-checked here |
| Codex/Grok abort before any file | YES | Outer loop breaks; spec covers this | Spec does not abort mid-file |
| Abort mid-file | YES | Line loop breaks; cache insert skipped | Evicts other entries first |
| File larger than 64MB | YES | `file-facts.ts:20` returns `partial` without parsing | Unchanged |
| Sessions directory missing | YES | `unavailable`, not `time-budget` | Abort is ignored in that case, which is the right status |
| 10_000 file cap across days or workspaces | NO | Inner `break` only | Pre-existing |
| Many Claude sessions on Electron | NO | Sync SQL first | Timeout remains |
| Large OpenCode database | NO | Sync query, signal ignored | Timeout remains |
| Partial summary served to the UI | YES | Valid schema, cached 60s as `ready` | Undercount looks finished until TTL |
| Signal aborted but the scan already finished every file | YES | Status stays `complete` if `partial` is false | Narrow race; contributions are actually complete |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM
- Top risk: a Claude-heavy Electron cold start still blocks `analytics:spendSummary` past 40s inside synchronous ledger SQL, so the console timeout survives the Codex/Grok abort checks.
- What a robust implementation would add: interrupt or slice the session-ledger reads and `OpenCodeSource.read` on the same signal; skip `FileFactsCache` eviction when the signal is aborted; import `zone.js` before the Angular graph when the fallback flag is set; give the display window the same change-detection branch, or do not load Zone.js for it.
