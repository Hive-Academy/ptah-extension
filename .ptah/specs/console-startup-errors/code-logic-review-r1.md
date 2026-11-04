# Code Logic Review — `console-startup-errors` (round 1)

## Summary

| Metric              | Value                          |
| ------------------- | ------------------------------ |
| Overall score       | 6/10                           |
| Assessment          | NEEDS_REVISION                 |
| Verdict             | REVISE                         |
| Blocking issues     | 0                              |
| Serious issues      | 1                              |
| Moderate issues     | 2                              |
| Minor issues        | 0                              |
| Failure modes found | 3                              |

Revision 1 lets the 30s timer run between ledger slices, stops OpenCode and the file cache on abort, loads Zone.js before `App` / `app.config` / the display config, and applies the 10_000 cap on the outer scan. The Electron RPC path still drops Claude session counts, message counts, and top sessions on every `analytics:spendSummary`, including scans that finish well inside the budget. The welcome grid prints that zero as the session total.

Score is 6 rather than 7–8 because that caption is wrong on the happy path, not only after a timeout. It is not 5 or below because the event-loop block that made the 40s client timeout the steady failure is sliced, and the cache, display-provider, and file-cap findings are fixed.

Skill: the task assigned none. No catalogue skill describes this review's method; the role file was the method. No source was edited. The coordinator owns `npm run verify`. This review did not build, lint, or launch Electron.

## Decisions

- Verdict is REVISE. Options were to accept the deferred counts because `sources[].reason` says they were deferred, or to treat a displayed `sessionCount` of 0 as a wrong answer. Evidence: `analytics-rpc.handlers.ts:88-91` always passes the signal, `usage-summary.service.ts:94-112` skips the count and ranking queries whenever that signal is present, and `welcome-vitals.view.ts:164-166` renders `sessionCount` with no look at `sources`. Reversible: yes, this is a review verdict only.

## Prior findings

| # | Round-0 finding | Fixed | Evidence |
| - | --------------- | ----- | -------- |
| 1 | Synchronous Claude ledger SQL blocks the 30s budget | partial | Slices and `setImmediate` at `usage-summary.service.ts:63-92`. Counts still omitted at `usage-summary.service.ts:94-112`. |
| 2 | `OpenCodeSource` ignores the signal | partial | Abort checks at `opencode.source.ts:19`, `opencode.source.ts:42`, `opencode.source.ts:62`, `opencode.source.ts:78`. The paged query has no time predicate at `opencode.source.ts:40`. |
| 3 | `zone.js` imported after the static Angular graph | partial | `App` and `app.config` load after Zone.js at `main.ts:19-25`. `getRpcClient()` still runs first at `main.ts:10`. |
| 4 | Aborted reads evict `FileFactsCache` | yes | Return before eviction at `file-facts.ts:29`. |
| 5 | Display window stays zoneless under the fallback flag | yes | `display-window.config.ts:59`, evaluated after `main.ts:19`. |
| 6 | 10_000 cap breaks only the inner loop | yes | `codex.source.ts:23` and `grok.source.ts:24` stop the outer loop. |

### 1. Ledger slices

Each signal-bearing call reads `getWorkspaceUsageGroups` for one hour, then yields (`usage-summary.service.ts:63-66` and `usage-summary.service.ts:92`). `LEDGER_SLICE_MS` is `3_600_000`. `since` / `until` are UTC day boundaries (`usage-summary.service.ts:41-43`), so the hours tile `[since, until)` with no gap. The SQL predicate is `occurred_at_ms >= ? AND occurred_at_ms < ?` (`session-stats-repository.ts:422`), so a turn on a boundary is counted once. `idx_session_usage_turns_time` is `(occurred_at_ms, provider_id, model_id)` (`session-store-migrations.ts:67`), so one hour is a time-index range, about 1/720 of a 30-day span, not another full-ledger aggregation. The workspace predicate is `COALESCE(s.workspace_key, t.workspace_key)`, so `idx_session_usage_workspace_time` does not limit the range; the time index still does.

The host timer is 30s (`analytics-rpc.handlers.ts:33` and `analytics-rpc.handlers.ts:85`). It cannot fire during `.all()`, and it can fire on the `setImmediate` between slices. The client budget is 40s (`usage-vitals.cache.ts:26` and `usage-vitals.cache.ts:90`), which leaves about 10s for the slice that is in flight when the timer comes due. A normal hour of this index is far under that. One hour that itself blocks longer than the remaining slack — a backfill stamped into a single hour, or a planner that ignores the time index — can still miss the client timeout. That case was not timed. It is residual, not the steady path the unsplit query was.

A finished signal-bearing scan is not a full summary. `if (!signal)` guards session count, message count, and top sessions (`usage-summary.service.ts:94-112`). The handler always passes a signal, so those queries never run for `analytics:spendSummary`. Status is `partial`. The reason is `time-budget` when the signal is aborted, otherwise the fixed string `Session counts and top sessions deferred` (`usage-summary.service.ts:113`). That string is accurate about the counts and is the wrong reason when the fact cap stops the row loop: the `fact-limit` branch is only reached when `signal` is absent. Token facts from the slices that finished are kept. `sessionCount` stays `ledgerSessionCount + sessions.size` with `ledgerSessionCount` still 0 (`usage-summary.service.ts:49` and `usage-summary.service.ts:234`).

Mixed priced and unpriced hours of the same `(day, model, source, cost_authority)` do not share a map key, because `costSource` becomes `unpriced` only for the hours whose own `has_unpriced` is set (`usage-summary.service.ts:69-80`). They become two facts. `totals()` adds `costUsd ?? knownCostUsd` (`usage-vitals.model.ts:181-184` and `usage-vitals.model.ts:241-244`), so this UI still sums the same known cost as the old single group. A caller that sums only non-null `costUsd` would now count the priced hours; the old group had `costUsd: null` for the whole day. That is a shape change, not a wrong total on the vitals path.

### 2. OpenCode

The signal is consulted, pages yield, and an aborted projection is not cached. The paged statement is `WHERE m.rowid > ? ORDER BY m.rowid LIMIT 256` (`opencode.source.ts:40`). The unsignaled statement still filters `role = assistant` and `time.created` in SQL (`opencode.source.ts:57`). The signaled path JSON-parses every row and keeps an assistant message only after the parse (`opencode.source.ts:51-52`). A budget abort therefore returns the oldest matching rowids, or an empty list when those rowids are still below `since`. Status is `partial` / `time-budget` (`opencode.source.ts:60` and `opencode.source.ts:77`). Invalid JSON is skipped in the page loop without incrementing `malformed` (`opencode.source.ts:50`), and the invalid-row count query is replaced with `[]` when a signal is present (`opencode.source.ts:33`). A scan that finishes can be `complete` after dropping those rows.

### 3. Zone order

`import('zone.js')` at `main.ts:19` completes before `import('@angular/platform-browser')`, `import('./app/app')`, and `import('./app/app.config')` (`main.ts:20-25`). `provideZoneChangeDetection` therefore runs when that config module evaluates, after Zone exists. A search of `@angular/core/fesm2022/core.mjs` found no import-time `requires Zone` check. `NgZone` is constructed at bootstrap, not when the core barrel is first evaluated.

`@ptah-extension/core` does load `@angular/core` before that dynamic import. `main.ts:1` imports `getRpcClient`. That module imports `VSCodeService` (`rpc-call.util.ts:1`), and `vscode.service.ts:1` imports `@angular/core`. `libs/frontend/core/package.json` sets `sideEffects: false`, so the rest of the barrel can be tree-shaken; this edge cannot. `getRpcClient()` at `main.ts:10` constructs `RpcClient`, which calls `window.addEventListener('message', this.onMessage)` (`rpc-call.util.ts:68-70`) before Zone.js patches `EventTarget`. On the fallback path those RPC replies stay outside `NgZone`. The default path never loads Zone.js and uses `provideZonelessChangeDetection`, so this does not bring back NG0914.

Lazy `import('./app/app')` moves the main component out of the initial script. Production budgets cover `initial` (4.1mb) and `anyComponentStyle` only (`project.json:63-73`); there is no lazy-chunk budget to fail. The display window already loaded a separate chunk. The extra local fetch delays bootstrap by one script load. `@ptah-extension/core` stays reachable from the initial module, so Angular core is not deferred.

### 4. Cache

`FileFactsCache.read` returns the parsed projection before the eviction loop when the signal is aborted or the fact list is larger than `MAX_CACHED_FACTS` (`file-facts.ts:29-38`). An aborted Codex or Grok file no longer drops older entries. The partial list is not inserted.

### 5. Display window

`displayWindowConfig` is still loaded by the dynamic import inside `bootstrapDisplayWindow` (`main.ts:32-37`), which runs only after the Zone.js import. The providers call `provideZoneChangeDetection()` when `useZoneChangeDetectionFallback()` is true (`display-window.config.ts:59`). Flag off stays zoneless and does not load Zone.js.

### 6. File cap

Codex breaks the day loop when `scannedFiles >= 10_000` or the signal is aborted (`codex.source.ts:23`). Grok does the same on the workspace loop (`grok.source.ts:24`). The inner loops still `break` only themselves; the next outer iteration sees the cap and stops.

## Five logic questions

### 1. How does this fail silently?

- The handler returns a schema-valid summary. `usage-vitals.cache.ts:92-94` maps that to `vitalsReady`. `toActivityVitals` copies `summary.sessionCount` (`usage-vitals.view.ts:177`). `sessionsCaption` prints any number, including 0 (`welcome-vitals.view.ts:164-166`). It does not read `sources[].reason`. A finished Electron summary whose ledger counts were skipped looks like a history with no Claude sessions.
- An OpenCode abort caches nothing (`opencode.source.ts:78-81`). The contributions it did return are still part of the same ready summary for the vitals TTL. An empty OpenCode list is not distinguished from "no OpenCode usage" except by the source reason the grid does not show.
- Aborted file projections are not written into `FileFactsCache` (`file-facts.ts:29`).

### 2. What user action produces unexpected behaviour?

- Open the Electron app and read the welcome usage grid. `analytics:spendSummary` always passes an `AbortSignal` (`analytics-rpc.handlers.ts:84-91`). Claude token facts can be complete while `sessionCount` omits every ledger session (`usage-summary.service.ts:94-112` and `usage-summary.service.ts:234`). The caption is `0 sessions · 90 days` when no external source added a session, beside a grid drawn from those Claude facts (`hasUsage` is `facts.length > 0`, `usage-vitals.model.ts:222-224`).
- Set `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1` and use the main window. The RPC `message` listener was registered before Zone.js (`main.ts:10`, `rpc-call.util.ts:69`). Zone change detection does not run for that listener. The default flag-off path is zoneless and does not take this branch.

### 3. What input data produces a wrong answer?

- Any non-empty `session_usage_turns` range, on a call that passes `signal`. Session count, message count, and the ledger top-five are the pre-signal defaults (0 and `[]`), not a prefix of the ledger. External Codex, OpenCode, and Grok sessions still count.
- The same day and model with `known_cost_micro_usd` null in only some hours. Facts split by `costSource` (`usage-summary.service.ts:80-90`). Vitals totals still add `knownCostUsd`. A consumer of `costUsd` alone sees only the priced hours.
- An `opencode.db` whose in-range assistant rows sit at high `rowid`. The signaled scan starts at `rowid > 0` (`opencode.source.ts:40-42`). Abort before that region yields `contributions: []` and `reason: 'time-budget'`.

### 4. What happens when a dependency fails?

- Abort does not reject `summarize`. The handler returns when the current hour query or the current OpenCode page returns, then the loop sees `signal.aborted` (`usage-summary.service.ts:64` and `opencode.source.ts:42`). One synchronous `.all()` still delays both the 30s timer and the 40s client timeout.
- `getWorkspaceCoverage` is one indexed row and stays in front of the slice loop (`usage-summary.service.ts:61`). It is not the budget risk.
- If `import('zone.js')` rejects, `main.ts:27-29` logs and neither window bootstraps.
- OpenCode's `catch` (`opencode.source.ts:83-84`) still maps a driver failure to `unavailable`, including when the signal is already aborted.

### 5. What is missing that the requirements never mentioned?

- The signal path never fills ledger `sessionCount`, `messageCount`, or `topSessions`, and nothing in the vitals view treats that source reason as "hide the count".
- The signaled OpenCode read is not the same query as the unsignaled read. It drops the time filter and the invalid-JSON count.
- No timed Electron run of a large `session_usage_turns` table. Tests abort before a second slice (`usage-summary.service.spec.ts:25-36`) or they call `summarize` without a signal (`usage-summary.service.spec.ts:39-54`), which is the branch that still runs the count queries.

## Failure modes

### Deferred ledger counts shown as the session total

- Trigger: Electron `analytics:spendSummary`. The handler always supplies a signal.
- Symptom: the activity caption reports 0 Claude sessions, or only external sessions, while the fact grid includes Claude tokens. Top sessions omit the ledger.
- Evidence: `analytics-rpc.handlers.ts:88-91`, `usage-summary.service.ts:94-112`, `usage-summary.service.ts:113`, `usage-summary.service.ts:234`, `usage-vitals.view.ts:177`, `welcome-vitals.view.ts:164-166`.
- Current handling: source status is `partial` with `Session counts and top sessions deferred`. The summary numbers are still ordinary numbers. `vitalsReady` stores them.
- Recommendation: page the count and ranking queries on the same signal, or leave `sessionCount` unset when they did not run so `sessionsCaption` takes the null branch. Do not return 0 for a scan that was skipped.

### OpenCode budget spent on the oldest rowids

- Trigger: `opencode.db` larger than what 256-row pages can walk in the time left after the ledger slices.
- Symptom: OpenCode usage is missing or is only the oldest in-range rows. The RPC itself returns. The source says `time-budget`.
- Evidence: `opencode.source.ts:39-55` compared with `opencode.source.ts:57`.
- Current handling: yield between pages, do not cache an abort, mark `partial`.
- Recommendation: keep the assistant and `time.created` predicates in the paged SQL, and key the cursor on that ordered result. Count invalid JSON on this path too.

### Fallback RPC listener stays outside NgZone

- Trigger: `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1`.
- Symptom: `provideZoneChangeDetection` is selected, but the `message` listener that completes RPC promises was added with the native `addEventListener`. Zone-based change detection does not see those replies.
- Evidence: `main.ts:1`, `main.ts:10`, `main.ts:19`, `rpc-call.util.ts:1`, `rpc-call.util.ts:68-70`, `vscode.service.ts:1`, `display-window.config.ts:59`.
- Current handling: Zone.js is imported before `bootstrapApplication`. It is not imported before `getRpcClient()`.
- Recommendation: dynamic-import `zone.js` before the first `getRpcClient()` call when the flag is set, or register the `message` listener after that import.

## Blocking issues

None.

## Serious issues

### Signal-bearing summaries omit Claude session stats and the UI shows the zero

- File: `libs/backend/usage-analytics/src/lib/usage-summary.service.ts:94`
- Scenario: `UsageAnalyticsService.summarize` is called with the RPC `AbortSignal`. After the hourly group loop, `getWorkspaceSessionCount`, `getWorkspaceMessageCount`, and `getWorkspaceTopSessions` run only when `signal` is falsy. Production always passes the signal (`libs/backend/rpc-handlers/src/lib/handlers/analytics-rpc.handlers.ts:88`).
- Impact: `sessionCount` adds a ledger contribution of 0 (`usage-summary.service.ts:234`). `topSessions` has no ledger rows (`usage-summary.service.ts:229`). `messageCount` misses ledger messages. The source row is `partial` (`usage-summary.service.ts:113`), and `toActivityVitals` still publishes `sessionCount` (`libs/frontend/chat/src/lib/services/vitals/usage-vitals.view.ts:177`). The welcome caption becomes `0 sessions · 90 days` (`libs/frontend/chat/src/lib/services/vitals/welcome-vitals.view.ts:164-166`) on a workspace whose only usage is the Claude ledger. Token facts from the slices that completed are present, so the grid is not empty.
- Fix: run those three queries in abortable slices, or omit `sessionCount` when they were not run. Keep `time-budget` for an abort that also truncated facts. Add a test that calls `summarize` with a live signal, lets every hour return, and asserts the session count.

## Moderate and minor issues

### Moderate: signaled OpenCode scan is not bounded by the requested time range

- File: `libs/backend/usage-analytics/src/lib/sources/opencode.source.ts:40`
- Scenario: `signal` is set. Pages walk `rowid` from 0. Range and `role` are applied in JavaScript after `JSON.parse`. The invalid-count query is skipped (`opencode.source.ts:33`).
- Impact: the 30s budget can expire on old or non-assistant rows and return an empty or oldest-prefix partial. A scan that reaches the end can report `complete` with invalid rows dropped (`opencode.source.ts:50`). The unsignaled query still filters in SQL (`opencode.source.ts:57`). Abort is not cached (`opencode.source.ts:78`).
- Fix: page the same filtered SELECT, with a cursor on that order, and keep the malformed count.

### Moderate: fallback Zone.js still loads after the RPC listener

- File: `apps/ptah-extension-webview/src/main.ts:10`
- Scenario: fallback flag is true. `getRpcClient()` runs at module evaluation. `vscode.service.ts:1` has already imported `@angular/core`. `import('zone.js')` runs later (`main.ts:19`). `App` and both configs are correctly after that import.
- Impact: `RpcClient` listens for `message` with the unpatched `addEventListener` (`libs/frontend/core/src/lib/services/rpc-call.util.ts:69`). Fallback zone change detection misses those RPC completions. The default zoneless path does not load Zone.js, so NG0914 stays fixed there. Lazy `App` does not trip the initial bundle budget (`project.json:63-70`).
- Fix: import `zone.js` before `getRpcClient()` when the flag is set.

## New defects

1. Serious — ledger session count, message count, and top sessions are skipped on every signaled summary and shown as a real total. `usage-summary.service.ts:94`, `usage-summary.service.ts:234`, `welcome-vitals.view.ts:164`. Fix: slice those queries or return a null count when they did not run.
2. Moderate — OpenCode's signaled reader scans `rowid` order without the time predicate. `opencode.source.ts:40`. Fix: page the filtered statement used at `opencode.source.ts:57`.
3. Moderate — fallback path registers the RPC `message` listener before Zone.js. `main.ts:10`, `rpc-call.util.ts:69`. Fix: load `zone.js` before `getRpcClient()` when the flag is set.

No new defect found for a signal that is not passed into Codex, Grok, OpenCode, or `FileFactsCache.read`. Aborted file projections are not inserted and do not evict. Ledger hours do not overlap. The display window uses the same fallback provider as the main window.

## Data flow

1. Preload still sets `zoneChangeDetectionFallback` before module evaluation. Unchanged.
2. `main.ts:1-10` loads `getRpcClient` (and therefore `@angular/core` via `vscode.service.ts`) and registers the `message` listener. Gap on the fallback path only.
3. `main.ts:19` loads Zone.js when the flag is set, then platform-browser, then `App` / `app.config` or the display config. Provider choice matches the flag (`display-window.config.ts:59` and the main `app.config` path). OK for `provideZoneChangeDetection`.
4. `project.json:16` keeps `polyfills: []`. Production and development do not override it (`project.json:61-97`). OK.
5. Renderer calls `analytics:spendSummary` with a 40s timeout (`usage-vitals.cache.ts:87-90`).
6. Handler arms 30s and passes the signal (`analytics-rpc.handlers.ts:84-92`). OK.
7. Ledger coverage, then one indexed hour at a time, yielding between hours (`usage-summary.service.ts:61-92`). The timer can run between slices. OK for a normal hour.
8. Count and ranking queries are skipped because the signal is present (`usage-summary.service.ts:94`). Gap.
9. External sources run until abort (`usage-summary.service.ts:126-131`). Codex and Grok still honor the signal and the outer 10_000 cap. OpenCode honors abort and walks rowids from 0. Gap.
10. `FileFactsCache` returns before eviction when aborted (`file-facts.ts:29`). OK.
11. Summary `sessionCount` adds the skipped ledger as 0 (`usage-summary.service.ts:234`). Vitals marks the body ready and the caption prints the number. Gap.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Hourly ledger SQL stays short enough for the 30s timer to fire and the reply to beat 40s | PARTIAL | Yields exist and the time index makes a normal hour small. One pathological hour can still block past the 10s slack. Not timed on a real database. |
| Partial ledger summary labeled correctly | PARTIAL | Abort sets `time-budget`. A finished signaled scan says counts were deferred, then publishes `sessionCount` 0. |
| No double-count or missed hour at slice boundaries | COMPLETE | Half-open hours tile the UTC day range. Mixed priced hours split into two facts; vitals totals still add `knownCostUsd`. |
| OpenCode observes the signal and does not cache an abort | PARTIAL | Checks and the cache guard are real. The paged query is not the time-bounded query. |
| Zone.js loads before the Angular app graph on fallback | PARTIAL | Before `App`, `app.config`, platform-browser, and the display config. After `getRpcClient()` and `@angular/core`. |
| Lazy `App` load is not a harmful budget or startup change | COMPLETE | Initial budget only. One extra local chunk. Angular core stays on the initial graph through `getRpcClient`. |
| Aborted reads do not evict `FileFactsCache` | COMPLETE | `file-facts.ts:29`. |
| Display window follows the fallback flag | COMPLETE | `display-window.config.ts:59`. |
| 10_000 cap stops the outer scan | COMPLETE | `codex.source.ts:23`, `grok.source.ts:24`. |
| No new dropped signal or cache poisoning | COMPLETE | Codex, Grok, OpenCode, and `FileFactsCache.read` take the signal. Aborts are not inserted. |

Implicit requirements not addressed: no Electron timing run, and this review did not re-run `npm run verify`.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Signal already aborted before ledger SQL | YES | `usage-summary.service.ts:60` throws into the `time-budget` status | Count queries do not run |
| Abort after the first hour | YES | Next loop head breaks; spec covers one aborted slice | Later hours are omitted and labeled `time-budget` |
| All hours finish with a live signal | NO | Counts stay skipped; reason says deferred | Caption shows 0 |
| Hour boundary turn | YES | `>=` start and `<` end | No double count |
| Mixed priced and unpriced hours | YES for vitals totals | Two facts; `pricedCost` uses `knownCostUsd` | `costUsd`-only consumers see priced hours only |
| One hour larger than the 10s slack | NO | `.all()` is still synchronous | Untimed |
| OpenCode abort on old rowids | NO | Prefix or empty partial | Time filter not in SQL |
| OpenCode invalid JSON on the signal path | NO | `continue` without a malformed increment | Can look `complete` |
| Flag off, main and display | YES | Zone.js not imported; zoneless providers | NG0914 stays gone |
| Flag on, display window | YES | Zone.js, then `provideZoneChangeDetection` | Listener order is the main-window gap |
| Aborted file larger than the cache budget | YES | Return before eviction | Partial facts are not stored |
| 10_000 files across days or workspaces | YES | Outer loop stops | Inner `break` still needs the outer check |
| `polyfills` on production and development | YES | Inherited `[]` | Not compile-checked here |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: every Electron spend summary omits Claude session counts and the welcome caption shows that zero next to the Claude usage grid.
- What a robust implementation would add: abortable slices for the three ledger ranking queries, or a null `sessionCount` when they are skipped; the time-bounded OpenCode page query on the signal path; `zone.js` imported before `getRpcClient()` when the fallback flag is set.
