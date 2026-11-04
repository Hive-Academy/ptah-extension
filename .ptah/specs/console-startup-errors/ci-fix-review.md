# CI fix logic review — uncommitted diff vs `05e294926`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 1 |

Scope is the uncommitted diff only: `apps/ptah-extension-webview/src/main.ts`, `libs/backend/usage-analytics/src/lib/sources/opencode.source.ts`, `cold-start-budget.spec.ts`, `usage-summary.service.ts`, `usage-summary.service.spec.ts`. Read with the handlers those lines call (`message-router.service.ts`, `boot-status.service.ts`, Electron `did-finish-load` publishers, display-window boot). No source edits. `ptah_code_search_symbols` had an empty index (`symbolCount: 0`); lookup fell back to Grep. `ptah_get_diagnostics` on the three production files did not finish (TypeScript check still running after 45s). Jest was not re-run here.

Score is 7 rather than 8 because the OpenCode page buffer now counts schema-invalid assistant rows toward the 100k cap and then caches that prefix. It is not 5–6: the boot replay is ordered, host IPC is not applied twice, and both CodeRabbit fixes change the result the new tests assert.

Skill: none assigned. No catalogue skill describes this review. The role file was the method.

## Decisions

- Double delivery of a host boot push is not a defect. Options were to treat the overlap between `captureBootMessage` and `MessageRouterService` as a rewind bug, or to require a macrotask inside `bootstrapApplication` before calling it one. Evidence: the router listener is installed from the `APP_INITIALIZER` in `provideMessageRouter` (`message-router.service.ts:349-357`) and removed in the microtask after `bootstrapApplication` resolves (`main.ts:36-39`). Host pushes arrive as IPC macrotasks (`preload.ts:71-72`). Initializers used by this bootstrap return void (`app.config.ts:246-247`, `293-297`). A macrotask cannot run in that window, so a push is either only captured or only live. Reversible: yes, verdict only.
- The OpenCode cap regression is Moderate, not Serious. It drops later valid rows only after 100k schema-invalid assistant objects in range, and the source status is `partial`. Reversible: yes.

## Five logic questions

### 1. How does this fail silently?

- OpenCode with a signal: a JSON assistant row that fails `assistant` is pushed onto `records` before that check (`opencode.source.ts:54-55`). The page loop stops once `records.length > 100000` (`opencode.source.ts:44`, `64`). Later valid rows are never read. The truncated result is cached (`opencode.source.ts:82-84`) until the db key changes. Status is `partial` with reason `Query limit or workspace metadata incomplete` (`opencode.source.ts:81`), so the RPC is not `complete`, but the reason describes a valid-row cap. Invalid JSON and NULL `data` do not take this path: they increment `pagedMalformed` and are not pushed (`opencode.source.ts:52-54`). On the signal path `invalidCount` is forced empty (`opencode.source.ts:33`), so those rows are not also added from the SQL count.
- Boot replay does not fail this way. `handleMessage` replaces readiness (`boot-status.service.ts:216-224`) and `mergeHostStep` refuses to move a `done`/`failed` step backward or lower an active `done` count (`boot-status.service.ts:340-361`). Applying the same payload twice would leave the same signals. `MessageRouterService` does not collapse the burst: `onWindowMessage` appends to a FIFO and one macrotask drains it (`message-router.service.ts:110-121`, `207-220`). Boot types are not `rpc:response`, so the replay loop does not flush synchronously. Order is arrival order. The newest captured readiness push is the one that remains.

### 2. What user action produces unexpected behaviour?

- Cold-start usage with a signal, against an OpenCode db that has more than 100k assistant rows whose JSON parses but fails `assistant` (bad `time.created`, non-object `tokens`, negative counts). Spend from later valid rows is missing until the db file changes. The new regression test does not build this shape: it inserts 256 NULL `data` rows plus one valid assistant (`cold-start-budget.spec.ts:67-72`).
- Opening the Electron shell still replays `boot:readinessChanged` and `boot:progress` that landed during the dynamic-import gap. That is the e2e case (`boot-progress.e2e.spec.ts:142-153`), which leaves `boot:getReadiness` unanswered. No second user-visible boot transition was found for a normal IPC push.

### 3. What input data produces a wrong answer?

- The OpenCode case above. NULL `data` and non-JSON text are counted once and the cursor still moves (`opencode.source.ts:49-54`), so the 257-row fixture reaches `good` and reports `malformedRecords: 256`. On the old query those NULL rows were excluded (`json_valid` was required) and, because a signal skips the SQL invalid count, `malformedRecords` stayed 0. The new test fails on that old code.
- Ledger facts: a later slice may add tokens to a key that already exists after `groups.size` hits 100000 (`usage-summary.service.ts:80-81` uses `continue` only when `!prior`). The new spec's second mock returns `m0` (`usage-summary.service.spec.ts:93-109`). The old `break` ran before the row was merged, so `m0` stayed at 1 token and that expectation fails on the old code. `fact-limit` is set only when a new key is skipped (`usage-summary.service.ts:81`, `115-117`).

### 4. What happens when a dependency fails?

- `bootstrapApplication` rejection removes the capture listener and does not replay (`main.ts:40-42`). The captured pushes are dropped. The app did not start, and `BootStatusService` is not running a pull. The listener is not left attached.
- Display bootstrap failure is caught inside `bootstrapDisplayWindow` (`main.ts:52-54`) and does not reject the outer `try`. The outer path still removes the listener and replays (`main.ts:38-39`). The display router has no boot handler (`display-window.config.ts:62-68`). A replayed boot push is queued and ignored. `displayWindow:state` is not in the capture list. `DisplayWindowStateHandler.load` pulls `displayWindow:getState` (`display-window-state.handler.ts:52-57`, called from `display-window.component.ts:162`).
- OpenCode `prepare`/`all` throwing (missing `time_created`, broken native module) still hits the existing `catch` and returns `unavailable` (`opencode.source.ts:87-88`). The signal query now names `m.time_created`, which the non-signal count and `opencode.source.spec.ts` already require.
- An abort sets `partial` and skips the cache (`opencode.source.ts:64`, `82`). A page whose rowids never advance sets `stalled`, reason `Paging cursor stalled`, and does not cache (`opencode.source.ts:57`, `81-84`).

### 5. What is missing that the requirements never mentioned?

- `did-finish-load` pushes are only `boot:readinessChanged` (`post-window.ts:117-119`) and `boot:progress` snapshots (`boot-progress-publisher.ts:137-142`). Both types are captured. Other pushes during the later chunk-load gap (git watcher broadcast from `boot-heavy-services.ts:456-459`, library changes) are still dropped. That is outside this diff. Several of those handlers already pull or refresh on their own.
- The router never reads `event.origin`, `event.source`, or `isTrusted` (`message-router.service.ts:110-113`). A replayed `MessageEvent` has an empty origin, which is the same shape the preload already delivers (`preload.ts:68-72`). The replay is accepted. That is required, not a hole.
- External contribution merge still `break`s at the fact cap (`usage-summary.service.ts:156`), so a later row that would update an existing key is skipped once a new key is refused. Pre-existing, not changed by this diff. The ledger loop no longer does that.

## Failure modes

### Schema-invalid OpenCode rows fill the page cap

- Trigger: signal-path read, more than 100k assistant-role objects in range that `JSON.parse` accepts and `assistant.safeParse` rejects, with a valid assistant at a higher `rowid`.
- Symptom: that valid usage is absent, status `partial`, reason is the query-limit string, and the result is cached.
- Evidence: `opencode.source.ts:44`, `opencode.source.ts:54-55`, `opencode.source.ts:64-72`, `opencode.source.ts:81-84`. Old loop pushed only after `assistant.safeParse` succeeded (removed lines in the diff).
- Current handling: second loop counts the rejected rows as malformed, then stops.
- Recommendation: schema-check in the page loop, increment `pagedMalformed`, and push only rows that pass. Keep the cursor advance on `rowid` alone.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. Moderate. OpenCode signal paging stores schema-invalid assistant rows in the 100k buffer. File: `libs/backend/usage-analytics/src/lib/sources/opencode.source.ts:54`. Scenario and fix are the failure mode above.
2. Minor. The new OpenCode spec covers NULL `data` and cursor progress across a 256-row page (`cold-start-budget.spec.ts:67-72`). It does not fail if the `cursor === before` stall break is removed, and it does not cover a schema-invalid assistant. The stall branch itself is sound.

## Data flow

Boot, main window:

1. Capture listener registered before the first import (`main.ts:15-24`). OK.
2. `did-finish-load` and any push during `await import` append `boot:readinessChanged` / `boot:progress` only. OK for those types.
3. `bootstrapApplication` installs `MessageRouterService` (capture phase) and constructs `BootStatusService`, which starts `boot:getReadiness`. No host macrotask runs before the promise resolves. OK, no live-plus-capture duplicate.
4. Listener removed, then synchronous `dispatchEvent` in arrival order (`main.ts:38-39`). Capture cannot see the replay. OK.
5. Router enqueues the burst; one drain applies it FIFO. `BootStatusService.adopt` / `mergeHostStep` run. OK.
6. The pull response is an IPC macrotask. Its capture-phase flush drains any already queued boot replays before the bubble-phase RPC listener resolves the pull (`message-router.service.ts:27-33`, `117-119`). The pull is monotonic (`boot-status.service.ts:247-249`), so it cannot rewind the replay. A newer pull can still move forward. OK.

Boot, display window: same capture and replay. No boot handler. State push is not buffered; `load()` pulls. OK.

Boot, failure: listener removed, buffer dropped (`main.ts:40-42`). OK for the main app. Display inner `catch` still takes the success path. Harmless for boot types.

OpenCode signal page: rowid advances independently of payload validity (`opencode.source.ts:49-51`). NULL and bad JSON counted, not buffered. Schema failures buffered. Gap as above.

Ledger: slices keep running after the cap; existing keys still merge; omitted new keys set `fact-limit`. OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Replay early `boot:readinessChanged` / `boot:progress` in order after bootstrap | COMPLETE | Host IPC is not double-applied. Identical replay would be idempotent. |
| Display-window path | COMPLETE | Boot replay is a no-op; state uses pull. |
| Failure removes the listener | COMPLETE | Main rejection does not replay. Display failure is swallowed and still replays boot types into a router that ignores them. |
| Other `did-finish-load` push types | COMPLETE | Only the two boot types are sent on that event. |
| OpenCode cursor advances across a malformed page and counts those rows | COMPLETE | New spec fails on the old query. |
| OpenCode stall does not cache | COMPLETE | Untested by the new spec. |
| Later ledger slices update existing keys; `fact-limit` only when a key is omitted | COMPLETE | New spec fails on the old `break`. |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Boot push before router exists | YES | Captured, replayed once | None for IPC |
| Boot push after listener removal | YES | Live router only | None |
| Boot push during bootstrap microtasks | YES | Not reachable for IPC | A microtask `dispatchEvent` of a boot message would be queued and replayed; no production sender found |
| Same boot payload applied twice | YES | Replace / monotonic fold | Back-office `failed` would upsert twice; path not reachable for IPC |
| Pull completes around replay | YES | Flush applies replay first; pull will not rewind | None |
| Bootstrap throws | YES | Listener removed, no replay | Pushes dropped with the dead app |
| Display window | YES | Pull for state | Boot buffer unused |
| 256 NULL OpenCode rows then one valid row | YES | Cursor moves, count 256 | Spec locks this |
| Schema-invalid assistant past 100k | NO | Buffered, then scan stops and caches | Moderate |
| Stalled rowid page | YES | `partial`, not cached | Spec does not lock the branch |
| Ledger update of `m0` on the next hour slice after 100k keys | YES | `continue` when `prior` exists | Spec fails on old code |
| New ledger key after the cap | YES | Skipped, `fact-limit` | None |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for the boot replay and the ledger cap; MEDIUM for how often OpenCode rows fail `assistant` in real databases
- Top risk: a large OpenCode history of schema-invalid assistant JSON is cached as a partial prefix and later valid usage stays out until the db key changes
- What a robust implementation would add: schema-check inside the OpenCode page loop so only contributable rows occupy the 100k buffer; one fixture that removes `cursor === before` handling and one schema-invalid row past a full page
