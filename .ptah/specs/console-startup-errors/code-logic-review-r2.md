# Code Logic Review — `console-startup-errors` (round 2)

## Summary

| Metric              | Value                          |
| ------------------- | ------------------------------ |
| Overall score       | 6/10                           |
| Assessment          | NEEDS_REVISION                 |
| Verdict             | REVISE                         |
| Blocking issues     | 0                              |
| Serious issues      | 1                              |
| Moderate issues     | 0                              |
| Minor issues        | 0                              |
| Failure modes found | 1                              |

Round 1’s three defects are fixed: a live RPC signal now runs the ledger count and ranking queries, the OpenCode page SQL keeps the assistant and time predicates, and `zone.js` loads before `getRpcClient()`. The new count spec would fail on the old `if (!signal)` skip. The signaled hourly merge still writes `knownCostUsd: 0` when every slice’s SQL sum was null, and the welcome spend cell formats that as `≥ $0.00`.

Score is 6 rather than 7–8 because that spend figure is wrong on the ordinary Electron path, not only after a timeout. It is not 5 or below because the session caption, the OpenCode time bound, and the Zone.js order now match the requested behaviour.

Skill: the task assigned none. No catalogue skill describes this review’s method; the role file was the method. No source was edited. The coordinator owns `npm run verify`. This review did not build, lint, or launch Electron. The implementer’s Jest run (7 suites, 41 tests) was not repeated here.

## Decisions

- Verdict is REVISE. Options were to treat a merged `knownCostUsd` of 0 as a valid lower bound of “at least nothing”, or to treat it as the coercion the vitals contract forbids. Evidence: `usage-summary.service.ts:89` substitutes 0 for a missing known cost, `usage-vitals.model.ts:174-184` says a missing known sum stays unknown and is never coerced to 0, and `formatSpendAmount` renders a finite 0 (`usage-vitals.model.ts:106-114`). The production handler always passes a signal (`analytics-rpc.handlers.ts:88-91`), so the hourly merge is the path the UI reads. Reversible: yes, this is a review verdict only.

## Prior findings

| # | Round-1 finding | Fixed | Evidence |
| - | --------------- | ----- | -------- |
| 1 | Ledger `sessionCount`, `messageCount`, and `topSessions` skipped whenever the RPC signal was present, so the welcome caption showed 0 | yes | `usage-summary.service.ts:94-113` runs the three queries when `signal` is present and not aborted. `usage-summary.service.ts:236` adds `ledgerSessionCount`. `usage-summary.service.spec.ts:39-55` calls `summarize` with a live signal and expects `sessionCount` 4 and `messageCount` 9. That spec fails if the guard is still `if (!signal)`. Abort before SQL and abort after the first slice still skip the counts (`usage-summary.service.ts:60`, `usage-summary.service.ts:64`, `usage-summary.service.spec.ts:13-36`). |
| 2 | Signaled OpenCode scan dropped the time filter and walked `rowid` from 0 | yes | `opencode.source.ts:40` keeps `json_extract(m.data, '$.role') = 'assistant'` and `time.created` in `[since, until)` on every page, with `ORDER BY m.rowid`. An abort still returns the in-range prefix already accepted, marks `time-budget`, and does not cache (`opencode.source.ts:60`, `opencode.source.ts:77-81`). |
| 3 | `getRpcClient` / `@ptah-extension/core` loaded before `zone.js` on the fallback path | yes | `main.ts:1` statically imports only `zone-change-detection.ts`, which reads `window.ptahConfig` and does not import Angular. `main.ts:17-19` awaits `import('zone.js')` before `import('./app/rpc-ready')`. `rpc-ready.ts:1` is the static import of `@ptah-extension/core`. `RpcClient` registers `message` at `rpc-call.util.ts:69` when `getRpcClient()` runs, after that import. Display bootstrap is inside the same function after the Zone.js import (`main.ts:21-22`, `display-window.config.ts:59`). |

## Five logic questions

### 1. How does this fail silently?

- A finished signaled ledger scan is schema-valid. Hours of one UTC day share a fact key and merge at `usage-summary.service.ts:80-90`. When every hour’s `known_cost_micro_usd` is null, the merged fact’s `knownCostUsd` is 0. `pricedCost` uses `costUsd ?? knownCostUsd` (`usage-vitals.model.ts:182`). `formatSpendAmount` turns that finite 0 plus `unpriced` into `≥ $0.00` (`usage-vitals.model.ts:113-114`). The contract next to the cell says a missing known cost is a dash and is never shown as $0 (`welcome-vitals.view.ts:122-125`).
- Session counts are no longer that silent zero. A completed signal-bearing scan stores the repository counts (`usage-summary.service.ts:95-99` and `usage-summary.service.ts:236`).
- An OpenCode abort still returns a partial list and does not cache it (`opencode.source.ts:78-81`). The welcome grid does not read that source reason.

### 2. What user action produces unexpected behaviour?

- Open Electron and read the welcome spend cell for a workspace whose Claude turns sit in two or more UTC hours of the same day and have no stored known cost. `analytics:spendSummary` always supplies an `AbortSignal` (`analytics-rpc.handlers.ts:84-91`), so the service slices by `LEDGER_SLICE_MS` (`usage-summary.service.ts:63-65`). The unsignaled call, which the projection spec uses (`usage-summary.service.spec.ts:145`), issues one range query and does not merge, so it still omits `knownCostUsd`.
- Set `PTAH_ZONE_CHANGE_DETECTION_FALLBACK=1` and use either window. Preload writes `zoneChangeDetectionFallback` onto `window.ptahConfig` before the page script (`preload.ts:35-50`). Zone.js loads before the RPC client and before both configs. The default flag-off path does not load Zone.js. `project.json:16` sets `polyfills` to `[]`, and production and development do not override it (`project.json:61-97`).

### 3. What input data produces a wrong answer?

- Two `getWorkspaceUsageGroups` rows with the same day, provider, model, source, and cost authority, both with `known_cost_micro_usd: null`. SQLite `SUM` of nulls is null (`session-stats-repository.ts:418`). Each fact omits `knownCostUsd` (`usage-summary.service.ts:77`). The merge writes 0 (`usage-summary.service.ts:89`). `usage-vitals.model.spec.ts:207-212` treats that 0 as a known zero (`costUsd: 0`, unpriced), distinct from a missing known cost (`costUsd: null`).
- One hour of the same null day does not merge, so `knownCostUsd` stays absent and the spend cell stays empty. The displayed result depends on how many UTC hours contained turns.
- A live signal with a non-zero `getWorkspaceSessionCount` now returns that count. The round-1 input (any non-empty ledger, any live signal) no longer forces `sessionCount` to 0.

### 4. What happens when a dependency fails?

- Abort during the hour loop breaks before the next slice and skips the count queries (`usage-summary.service.ts:64` and `usage-summary.service.ts:94`). Status is `time-budget`. Facts already merged, including a spurious 0, stay in the summary.
- Abort after `getWorkspaceSessionCount` resolves throws before the message count and the ranking query (`usage-summary.service.ts:96-99`). `ledgerSessionCount` is kept. `messageCount` has no ledger contribution. The catch labels `time-budget` (`usage-summary.service.ts:120-121`). The caption shows the session count that finished.
- `getWorkspaceTopSessions` is still one synchronous full-range statement (`session-stats-repository.ts:449-484`). The abort timer cannot fire inside `.all()`. A ranking scan longer than the remaining slack can still miss the renderer’s 40s budget. That was not timed.
- If `import('zone.js')` rejects, `main.ts:27-29` logs and neither window bootstraps.
- OpenCode’s `catch` (`opencode.source.ts:83-84`) still maps a driver failure to `unavailable`.

### 5. What is missing that the requirements never mentioned?

- The hourly merge must preserve “no known cost” as an omitted `knownCostUsd`. The UI already documents that distinction. The slice work has to honour it, because the RPC path is the only production caller of `summarize`.
- No spec passes a live signal and two null-cost hourly rows. `usage-summary.service.spec.ts:51-55` mocks `getWorkspaceUsageGroups` to `[]`. `usage-summary.service.spec.ts:129` returns two days in one shot and calls `summarize` without a signal, so the loop body runs once (`usage-summary.service.ts:63`).
- `opencode.source.spec.ts:34` calls `read` without a signal, so it executes `opencode.source.ts:56-57`. Removing the time predicate from the signaled statement at `opencode.source.ts:40` would leave that spec green.
- No timed Electron run of a large `session_usage_turns` table. This review did not re-run Jest.

## Failure modes

### Merged null ledger cost shown as a known zero

- Trigger: Electron `analytics:spendSummary` for a UTC day whose turns fall in at least two clock hours and whose `known_cost_micro_usd` values are all null.
- Symptom: the spend cell reads `≥ $0.00` with the unpriced note. The same day with turns in only one hour stays a dash. Spend bars receive 0 rather than null (`usage-vitals.model.ts:260-266`). The usage dashboard folds the same field (`usage-summary-fold.ts:105`).
- Evidence: `analytics-rpc.handlers.ts:88-91`, `usage-summary.service.ts:63-65`, `usage-summary.service.ts:77`, `usage-summary.service.ts:89`, `usage-vitals.model.ts:182`, `usage-vitals.model.ts:113-114`, `welcome-vitals.view.ts:122-125`.
- Current handling: token fields are summed. `costUsd` stays null when either hour is null. The source status stays the existing historical-backfill partial. The zero is a normal optional number and passes `UsageFactSchema` (`rpc-analytics.types.ts:23`).
- Recommendation: set `knownCostUsd` on the merged fact only when at least one slice had a known cost. Add a test that calls `summarize` with a live signal and two null-cost rows for one day, and expects the property to be absent.

## Blocking issues

None.

## Serious issues

### Hourly merge invents a known cost of zero

- File: `libs/backend/usage-analytics/src/lib/usage-summary.service.ts:89`
- Scenario: `summarize` is called with the RPC `AbortSignal`. The loop steps `LEDGER_SLICE_MS` (`usage-summary.service.ts:63`). `getWorkspaceUsageGroups` groups by UTC day (`session-stats-repository.ts:413-423`), so two hours of one day share the key built at `usage-summary.service.ts:80`. Each row with a null sum omits `knownCostUsd` (`usage-summary.service.ts:77`). The merge expression `(prior.knownCostUsd ?? 0) + (fact.knownCostUsd ?? 0)` always assigns `knownCostUsd`.
- Impact: an unpriced fact whose known cost was unknown becomes a known zero. `totals` and `lastNDays` add it (`usage-vitals.model.ts:241-245` and `usage-vitals.model.ts:263-265`). `toSpendCell` shows `≥ $0.00` instead of the empty dash (`welcome-vitals.view.ts:122-136`). A single-hour day, and any caller that omits the signal, still omit the field. Token sums on the same merge are the real hour totals.
- Fix: omit `knownCostUsd` when both sides omit it. Keep a real lower bound when either side has one. Cover it with a signaled two-row fixture.

## Moderate and minor issues

None that meet this round’s bar. Leftovers are under non-blocking notes.

## New defects

1. Serious — signaled hourly merges write `knownCostUsd: 0` for a day whose SQL known-cost sums are null, and the spend cell shows that zero. `usage-summary.service.ts:89`, `usage-vitals.model.ts:182`, `welcome-vitals.view.ts:124-125`. Trigger: two UTC hours of unpriced ledger turns and `analytics:spendSummary`. Fix: leave `knownCostUsd` unset unless a slice had a known cost, and assert that with a live signal.

No new defect in the Zone.js order, the display-window provider, the ledger count queries on a finished signal, the OpenCode time predicate, the 10_000 file cap, or `FileFactsCache` eviction. `file-facts.ts:29` still returns an aborted projection before the eviction loop.

## Data flow

1. Preload sets `zoneChangeDetectionFallback` before the renderer evaluates (`preload.ts:35-50`). Unchanged.
2. `main.ts:17` loads Zone.js only when the flag is true, then `rpc-ready.ts`, then `getRpcClient().markReady()`, then platform-browser and either `app.config` or the display config (`main.ts:17-25`). Provider choice matches the flag (`app.config.ts:187-189`, `display-window.config.ts:59`). OK.
3. `project.json:16` keeps `polyfills: []` for production and development. Jest still loads Zone through `apps/ptah-extension-webview/src/test-setup.ts`. OK.
4. The renderer calls `analytics:spendSummary`. The handler arms 30s and passes the signal (`analytics-rpc.handlers.ts:84-92`). OK.
5. Ledger hours are half-open and day-aligned (`usage-summary.service.ts:41-43` and `usage-summary.service.ts:63-65`). A boundary turn is counted once. OK.
6. Hours of one day merge. Token fields add. A null known cost becomes 0. Gap.
7. If the signal is still live, session count, message count, and top sessions run (`usage-summary.service.ts:94-113`). OK for a scan that finishes. The ranking statement is still one full-range synchronous query.
8. OpenCode pages are filtered in SQL (`opencode.source.ts:40`). Abort is not cached. OK for the time bound.
9. Codex and Grok still stop the outer scan on abort or 10_000 files (`codex.source.ts:23`, `grok.source.ts:24`). `FileFactsCache.read` does not evict on abort (`file-facts.ts:29`). OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Finished RPC summaries include ledger session count, message count, and top sessions | COMPLETE | `usage-summary.service.ts:94-113`. The new spec fails on the old skip. |
| OpenCode signaled read is bounded by `[since, until)` | COMPLETE | `opencode.source.ts:40`. The OpenCode spec does not pass a signal. |
| Zone.js loads before the RPC listener and the Angular graph on fallback | COMPLETE | `main.ts:17-19`, `rpc-ready.ts:1`. Display config loads later. |
| Hourly slices do not double-count turns or drop an hour | COMPLETE | Half-open UTC hours tile `[since, until)`. |
| Merged facts keep an unknown cost unknown | GAP | `usage-summary.service.ts:89` writes 0. |
| Partial ledger summary labeled on abort | COMPLETE | `time-budget` at `usage-summary.service.ts:115-121`. A finished scan still uses the historical-backfill reason. |
| Aborted reads do not evict `FileFactsCache` | COMPLETE | `file-facts.ts:29`. |
| Display window follows the fallback flag | COMPLETE | `display-window.config.ts:59`, evaluated after `main.ts:17`. |
| 10_000 cap stops the outer file scan | COMPLETE | `codex.source.ts:23`, `grok.source.ts:24`. |

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Signal already aborted before ledger SQL | YES | `usage-summary.service.ts:60` | Counts do not run |
| Abort after the first hour | YES | Next loop head breaks; spec covers one aborted slice | Later hours omitted, `time-budget` |
| All hours finish with a live signal | YES for counts | `usage-summary.service.ts:94-113` | Session caption gets the repository count |
| Two null-cost hours of one day | NO | Merge assigns `knownCostUsd: 0` | Spend cell shows `≥ $0.00` |
| One null-cost hour of one day | YES | No prior, property omitted | Dash, so the cell disagrees with the two-hour day |
| Two hours with real known costs | YES | The sum keeps both numbers | Lower bound adds |
| Hour boundary turn | YES | `>=` start and `<` end | No double count |
| OpenCode row outside `[since, until)` on the signal path | YES | Predicate in the page SQL | Spec does not exercise this branch |
| OpenCode invalid JSON on the signal path | YES for the row | `json_valid` excludes it | Invalid-count query still skipped; status can be `complete` |
| Flag off, main and display | YES | Zone.js not imported; zoneless providers | NG0914 stays gone |
| Flag on, RPC listener | YES | Zone.js, then `rpc-ready.ts`, then `getRpcClient()` | Listener is registered on the patched `EventTarget` |
| Aborted file larger than the cache budget | YES | Return before eviction | Partial facts are not stored |
| `polyfills` on production and development | YES | Inherited `[]` | Not compile-checked here |

## Non-blocking notes

- `opencode.source.ts:33` still replaces the invalid-JSON count with `[]` when a signal is present. A `{bad` row is excluded by `json_valid` in the page SQL, so the contribution list matches the unsignaled read. `malformedRecords` stays 0 and the status can be `complete`, while `opencode.source.spec.ts:37-38` expects `partial` and one malformed row only for the no-signal call. That is a status difference, not an in-range assistant row returned from the wrong day.
- `opencode.source.ts:50-52` drops a page row that fails `assistant.safeParse` without incrementing `malformed`. A message that has `role` and `time.created` but no `tokens` object is omitted, and a finished scan can say `complete`. The second loop would have counted it (`opencode.source.ts:68`).
- `opencode.source.ts:43` cannot see the abort until `page.all` returns. The time filter is in that statement, so the first page walks `rowid` order until it has 256 matches or reaches the end. A large `opencode.db` whose matches sit at high rowids can still block the 30s timer inside one `.all()`.
- `usage-summary.service.ts:99` runs `getWorkspaceTopSessions` for the whole `[since, until)` window in one synchronous statement (`session-stats-repository.ts:449-484`). Abort is checked only between the three count calls. A large ledger can still spend the renderer budget there. Not timed.
- `usage-summary.service.ts:115` chooses `fact-limit` from `ledgerGroupCount`, which adds every hourly SQL row, not from merged `groups.size`. More than 100_000 raw hour rows that collapse into fewer facts would be labeled `fact-limit` even though every key was summed. The ledger source is already `partial` because history is not backfilled, and the welcome view does not branch on `fact-limit`. Hitting 100_000 hourly rows means on the order of 50 distinct group keys in every hour of a 90-day window.
- `usage-summary.service.spec.ts:39-55` would fail on the round-1 skip. It does not assert `getWorkspaceTopSessions`, and it never supplies two group rows, so it stays green with the zero known-cost merge. `opencode.source.spec.ts` never passes a signal.
- The inner fact-cap `break` at `usage-summary.service.ts:68` leaves the hour loop running. Later hours hit the same cap and add nothing. Extra queries, not extra facts.
- An abort checked after the session-count query (`usage-summary.service.ts:96`) keeps that count and skips message count and top sessions. The caption shows the count that finished. `messageCount` is short.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: a normal multi-hour unpriced Claude day is shown as `≥ $0.00` on every Electron spend summary.
- What a robust implementation would add: omit `knownCostUsd` when every merged hour omitted it, and a signaled fixture with two null-cost rows for one day that expects the property to be absent. The round-1 count, OpenCode time bound, and Zone.js order can stay as they are.
