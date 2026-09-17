# Code Logic Review — `TASK_2026_437_0778` Batch 14

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 8/10                                 |
| Assessment           | APPROVED                             |
| Blocking issues      | 0                                     |
| Serious issues       | 0                                     |
| Moderate issues      | 2                                     |
| Failure modes found  | 3                                     |

Scope reviewed: `libs/backend/persistence-sqlite/src/lib/slow-statement-timing.ts` (new, 382
lines) + `slow-statement-timing.spec.ts` (new, 348 lines); `sqlite-connection.service.ts` diff
(+20/-2) + its spec diff (+66); `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
diff (+91) + its spec diff (+179); `libs/backend/vscode-core/CLAUDE.md` env-table diff. Read every
file above in full, not only the diff hunks. Ran
`npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/agent-sdk` from
`D:\projects\ptah-437`: 2 projects, exit 0 — persistence-sqlite 28/37 suites (9 native-ABI suites
skipped as expected, matches the executor's claim), 359/439 tests passed, 80 skipped;
agent-sdk 104/106 suites, 1847/1850 tests passed, 3 skipped. No failures.

## CI abort context (native `Statement::~Statement()` assertion)

The specific concern raised for this review — a wrapper that retains `Statement` objects past
DB close / environment teardown, turning the PR #510 exit-time flake into a frequent one — was
checked directly against `slow-statement-timing.ts`:

- `wrapStatement` (`slow-statement-timing.ts:241-296`) returns a `Proxy` over the real
  `statement`; its `methods` cache (`:246`) holds only the *forwarded function* per accessed
  prop, closing over `target`/`reporter`. This is exactly the same lifetime as a caller holding
  the statement directly — the wrapper adds no cache that outlives the caller's own reference to
  the statement (no connection-level statement cache, no static/module-level map keyed by SQL
  text holding statement instances; `SlowStatementReporter.rateTable`, `slow-statement-timing.ts:88`,
  is keyed by SQL string and holds only `{lastLoggedAt, suppressed}` — never a `Statement`).
- `timeIterator` (`:197-238`) implements `return()` (`:227-232`) and forwards to
  `inner.return(value)`, so a `for...of` `break` over a wrapped `iterate()` still triggers
  `IteratorClose` on the *real* better-sqlite3 iterator, which is what releases the native
  statement's busy/step state. This is pinned by the spec "reports an iterate() closed early by
  break" (`slow-statement-timing.spec.ts:312-323`).
- Every native call is dispatched with `Reflect.apply(method, target, args)` / `method.bind(target)`
  — never with the Proxy as receiver — matching better-sqlite3's brand-check requirement and
  pinned by the spec's `#private`-field `BrandedStatement`/`BrandedDatabase` fixtures
  (`slow-statement-timing.spec.ts:33-122`), which throw if called with the wrong `this`.
- `db.close()` is forwarded generically (`:374-376`, `bind(target)`), so the wrapper does not
  intercept or delay the real close call.

Conclusion: nothing in this diff extends a `Statement`'s lifetime relative to the real
`better-sqlite3` handle, adds a long-lived cache of statement objects, or changes when/whether
`.close()` runs. The CI abort is very likely the pre-existing exit-time flake the task description
already suspects (PR #510's push did not contain this batch). This is checked-and-cleared, not
proven-impossible: no test in this batch runs against the real native module (all 9 native-tagged
suites in `persistence-sqlite` skip under the current ABI mismatch, `bmjbyv4u2.output`), so the
actual interaction with `Statement::~Statement()` at process exit is unverified against the real
binary in this environment. Recommend one manual run under Electron (matching the executor's own
"native suites skipped in Jest, validated under Electron manually" note) covering an early-`break`
`iterate()` immediately followed by process exit, since that is the one path a mocked spec cannot
prove.

## Five logic questions

### 1. How does this fail silently?

- A throwing logger is caught and swallowed (`slow-statement-timing.ts:166-169`,
  `report()`'s `try/catch`), by design and pinned by spec (`:249-260`). This is correct per the
  stated contract ("a diagnostics line must never turn a successful statement into a failure") —
  not a defect, but it does mean a broken logger (e.g. a full disk under a file-backed logger)
  silently disables ALL slow-statement attribution with no fallback signal. Nothing elsewhere in
  this batch surfaces "the timing wrapper stopped reporting." Low-severity — this is the
  documented, intentional trade-off for a measurement-only tool (implementation-plan.md:640
  "Failure behaviour: timing wrapper never alters results or exceptions").
- `SessionHistoryReaderService.reportSlowHistoryRead` is only reached on the success path inside
  the outer `try` (`session-history-reader.service.ts:319-329`, before the method's own `catch`
  at `:337`). If `hydrateMissingPricing`, `aggregateUsageStats`, `seedLiveUsageBaseline`, or
  `projectHistoryMessages` throws, the slow-read line is never emitted for a read that may well
  have been slow right up to the point of failure — the attribution is lost for exactly the
  sessions most likely to matter (large/corrupt histories). This is a real gap but not "silent
  success": the caller still sees the error via the outer catch and an error-level log
  (`:340-343`). Moderate, not blocking.

### 2. What user action produces unexpected behaviour?

None found that changes observable behaviour. Both wrappers are strictly additive logging; no
user-facing return value, error type, or timing-sensitive control flow is altered. The single
piece of caller-visible surface — proxied statement identity — is preserved by design (chaining
methods that return `target` return the `proxy` instead, `slow-statement-timing.ts:283-289`,
pinned by the "returns the timed statement from chaining calls such as pluck()" spec, `:336-346`).

### 3. What input data produces a wrong answer, not an error?

- `RATE_TABLE_MAX_ENTRIES` (256) is enforced by clearing the **entire** rate table
  (`slow-statement-timing.ts:152-154`) rather than evicting one entry. The in-flight comment
  ("clearing it can only permit an extra line, never hide one") is true for *suppression*, but it
  silently resets every entry's `suppressedSinceLastLog` counter to 0 the moment the table is
  full and a 257th distinct SQL text arrives. A query that had accumulated, say, 40 suppressed
  occurrences loses that count with no trace — the next log line for it reports
  `suppressedSinceLastLog: 0` even though occurrences happened in the gap. Under a real workload
  with many ad-hoc SQL texts (the exact "dynamic SQL" scenario the constant's own doc comment
  anticipates, `:49-53`) this could recur often enough that the suppressed-count field
  systematically undercounts. Moderate — it is an observability accuracy issue, not a functional
  one, and the design explicitly prioritises "never grow unbounded" over "never lose a count."
- The rate-limit `key` is the **full, untruncated** SQL text (`sql` param, e.g.
  `slow-statement-timing.ts:255-260,365`), while only the logged preview is truncated to 120
  chars (`:159`, `SQL_PREVIEW_CHARS`). Two SQL texts that are identical in their first 120 chars
  but differ later (e.g. a long `IN (...)` list appended to an otherwise-fixed prefix) are rate
  limited independently and both logged, each showing the same 120-char preview — a reader sees
  two "different" slow-statement lines with identical `sql` fields and no way to tell they were
  different statements. Minor: the SQL text used as the key is the *template* string passed to
  `prepare()`, which for parameterized queries is normally static, so this is a narrow case (a
  caller that builds `IN (?, ?, ...)` text dynamically per call size — same pattern flagged as a
  reason the table itself needs a cap).

### 4. What happens when a dependency fails?

- `better-sqlite3` open failure: unaffected — `withSlowStatementTiming` wraps only after
  `this.factory(this._dbPath)` returns successfully (`sqlite-connection.service.ts:206-217`); an
  open failure throws before wrapping and is handled exactly as before
  (`classifyOpenFailure`/rethrow).
  - `sqlite-vec`'s `loadExtension` is called through the wrapped `db` (`loadVecExtension(db)` at
    `:223`) but is forwarded generically and bound to the real target
    (`slow-statement-timing.ts:374-376`), so a missing/failed native extension load behaves
    identically to the unwrapped path — confirmed no `loadExtension`-specific timing branch
    exists (only `prepare`/`exec`/`pragma`/`transaction` are specially handled).
- `SessionHistoryReaderService`: if `jsonlReader.findSessionsDirectory` or the main-message read
  throws/returns not-found, the method returns its early-empty result before `readDoneAt` is even
  reached in some paths (sessions-dir-not-found) or before the phase marks in others (file-not-
  found) — no slow-read line for a read that never got to loading data, which is correct (there's
  nothing to attribute). Confirmed by tracing `session-history-reader.service.ts:236-283` — the
  two error-shortcut branches return before `readDoneAt = performance.now()` is computed.

### 5. What is missing that the requirements never mentioned?

- implementation-plan.md:626-643 (C13) asks for wrapping so "any consumer" is timed transparently
  and names `SqliteDatabase`/`SqliteStatement` as the verified contracts — delivered. It does not
  mention `db.function`/`db.aggregate`/`db.table`/`db.loadExtension`/`db.backup`/`db.serialize`
  explicitly (the review brief asked to hunt these). Checked: the `SqliteDatabase` structural
  interface this lib defines (`sqlite-connection.service.ts:44-60`) exposes only `exec`,
  `prepare`, `pragma`, optional `loadExtension`, optional `backup`, `close`, `open`,
  `inTransaction`, `transaction` — no `function`/`aggregate`/`table`/`serialize` members exist on
  the port at all, so there is nothing for the wrapper to mishandle there; sqlite-vec is loaded
  via `loadExtension` only, and that member is forwarded correctly (see Q4). This is a
  non-finding — the port simply doesn't carry those members, so the "hunt" surface doesn't exist
  in this codebase.
- No metric/counter for **how often** the rate table hits its 256-entry cap-and-clear
  (finding in Q3) is exposed anywhere; a future debugging session would have no way to know
  attribution data was periodically wiped, short of noticing `suppressedSinceLastLog` resets.
  Minor — logged as an observability gap, not a defect.

## Failure modes

### Rate-table full-clear loses accumulated suppression counts

- Trigger: more than 256 distinct SQL texts (or transaction function names) cross the slow
  threshold within one rate window.
- Symptom: `suppressedSinceLastLog` on the next line for an already-tracked, still-slow query
  reads lower than the true count of suppressed occurrences since its last logged line.
- Evidence: `slow-statement-timing.ts:152-154`.
- Current handling: full `Map.clear()`, documented as an accepted trade-off.
- Recommendation: none required to approve — this is the documented, deliberate simplification
  for an unbounded-dynamic-SQL guard. If precision matters later, an LRU-eviction of the single
  oldest entry (not a full clear) would preserve more history at the same worst-case memory bound.

### Slow-read attribution lost on a post-parse exception

- Trigger: `hydrateMissingPricing`, `aggregateUsageStats`, `seedLiveUsageBaseline`, or
  `projectHistoryMessages` throws after a slow read/parse phase.
- Symptom: no `[SessionHistoryReader] slow history read` line for a read that spent real
  wall-clock time before failing; the operator only sees the generic error log with no phase
  breakdown.
- Evidence: `session-history-reader.service.ts:225-345` — `reportSlowHistoryRead` call site sits
  after all four steps, inside the same `try` whose `catch` (`:337`) has no `finally`-style
  cost-attribution fallback.
- Current handling: none; the outer catch logs the error but not the timing.
- Recommendation: not blocking for a measurement-only C13 task (the plan's own scope is "measure
  the happy path first"), but worth a one-line follow-up: move the phase marks into a
  `try/finally` so `reportSlowHistoryRead` fires even on a thrown error, using `failed`-style
  semantics like the SQLite wrapper already does for `run`/`get`/`all`.

### Env-var threshold is read once at construction, not per-call

- Trigger: `PTAH_SQLITE_SLOW_WARN_MS` / `PTAH_HISTORY_SLOW_WARN_MS` changed at runtime (e.g. via
  a debugging session that flips the env var without restarting the host).
- Symptom: the new threshold has no effect until the process restarts — `SqliteConnectionService`
  reads the env var once per `openAndMigrate()` call (effectively once per process,
  `sqlite-connection.service.ts:210-213`), and `SessionHistoryReaderService.slowReadWarnMs` is a
  class-field initializer evaluated once at construction
  (`session-history-reader.service.ts:127-129`).
- Evidence: as above.
- Current handling: matches every other env-threshold in this codebase (`readMsEnv` is the same
  helper `event-loop-monitor`/RPC/MCP thresholds already use this way, per
  `libs/backend/vscode-core/CLAUDE.md`'s existing table) — this is consistent with repository
  convention, not a new inconsistency introduced by this batch.
- Recommendation: none — this is expected/standard behaviour for this repo's env-threshold
  pattern; documented here only because the review brief asked to hunt env-var parsing.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: rate-table full-clear silently resets `suppressedSinceLastLog` counters —
  `slow-statement-timing.ts:152-154` (see Failure modes).
- Moderate: slow-read attribution is lost when a post-parse step throws —
  `session-history-reader.service.ts:225-345` (see Failure modes).
- Minor: rate-limit key uses untruncated SQL text while the log preview is truncated to 120
  chars, so two texts sharing a 120-char prefix log as visually identical lines —
  `slow-statement-timing.ts:159,255-260,365`.
- Minor: no counter/metric surfaces how often the rate table's cap-and-clear fires —
  observability gap only.

## Data flow

1. `SqliteConnectionService.openAndMigrate()` calls `this.factory(this._dbPath)` to get the real
   `better-sqlite3` handle — OK, unchanged.
2. The real handle is wrapped once via `withSlowStatementTiming` before any pragma, vec-extension
   load, or migration touches it (`sqlite-connection.service.ts:206-217`) — OK, matches the
   contract "every consumer, the migration runner included, sees the timed view."
3. `applyPragmas(db)` / `loadVecExtension(db)` / `this.migrationRunner` all operate on the
   *wrapped* `db`; native calls are dispatched with the real object as receiver
   (`Reflect.apply`/`bind`) — OK, verified no "Illegal invocation" risk.
4. `db.prepare(sql)` returns a per-call `Proxy` over the real statement, timing
   `run`/`get`/`all`/`iterate`; other statement members (`pluck`/`raw`/`expand`/`bind`/
   `safeIntegers`/`columns`) forward transparently, re-wrapping to the proxy only when the real
   method returns `target` for chaining — OK, pinned by spec.
5. A call at/above `thresholdMs` reaches `SlowStatementReporter.report`, which rate-limits per SQL
   text and logs via the injected `Logger.warn`, swallowing any logger exception — OK for the
   stated contract; see rate-table full-clear finding for a minor accuracy gap.
6. `SessionHistoryReaderService.readSessionHistory` marks `startedAt`/`readDoneAt`, times the
   synchronous replay/stats/projection and the optional pricing hydrate, and calls
   `reportSlowHistoryRead` once, after the last synchronous step and before the compaction-
   expectation bookkeeping — OK on the success path; gap on the exception path (see Failure
   modes).
7. `reportSlowHistoryRead` rate-limits per `sessionId` with the same "full clear at cap" pattern
   as the SQLite wrapper, and logs the `readMs`/`projectMs`/`pricingMs` split plus counts — OK,
   pinned by spec including the exact numeric split (`slow-statement-timing.spec.ts` pattern
   mirrored in `session-history-reader.service.spec.ts:1305-1400`).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Wrap `SqliteDatabaseFactory`'s handle so every consumer (incl. migration runner) is timed | COMPLETE | none |
| `run/get/all/iterate` (summed) / `exec` / `pragma` / `transaction` (+ deferred/immediate/exclusive) timed | COMPLETE | none |
| Warn ≥ 50 ms default, configurable via `PTAH_SQLITE_SLOW_WARN_MS` | COMPLETE | none |
| ≤ 1 line per SQL text per minute, with suppressed count | COMPLETE | rate table can lose suppressed-count history at 256-entry cap (moderate, documented trade-off) |
| Never alters results or exceptions | COMPLETE | pinned by spec (rethrow + throwing-logger swallow) |
| `readSessionHistory` duration log with phase split, configurable via `PTAH_HISTORY_SLOW_WARN_MS` | COMPLETE | not emitted on a post-parse exception (moderate) |
| `vscode-core/CLAUDE.md` env table rows | COMPLETE | none — both vars documented with defaults and effect |

Implicit requirements not addressed: a metric/log signalling that the rate-limit table hit its cap
(minor, observability only). Everything else the plan's C13 section and Batch 14 task list ask
for is present and tested.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Fast statement (below threshold) | YES | two clock reads, no rate-table touch, spec asserts exactly 2 reads/call | none |
| Statement throws | YES | rethrown unchanged, still timed and logged if slow | none |
| Logger throws | YES | swallowed in `try/catch` around `logger.warn` | intentional per contract |
| `iterate()` exhausted normally | YES | `finish(false)` on `done`, one summed line | none |
| `iterate()` closed early (`break`) | YES | wrapper's `return()` forwards to `inner.return`, finalizes both | this is the exact mechanism the CI-flake concern hinges on; spec-covered but not against the real native binary here |
| `iterate()` throws mid-iteration | YES | `finish(true)` before rethrow | none |
| Transaction variants (deferred/immediate/exclusive) | YES | each variant timed under the same SQL-text key, `this`/args forwarded | none |
| Chaining (`pluck().all()`) | YES | proxy returned when real method returns `target` | none |
| > 256 distinct slow SQL texts in one window | YES | full-clear fallback | loses suppressed-count precision (moderate) |
| `PTAH_SQLITE_SLOW_WARN_MS` / `PTAH_HISTORY_SLOW_WARN_MS` malformed, 0, or negative | YES | `readMsEnv` returns `undefined` for non-finite or `<= 0`, default applies | none — pre-existing, reused helper |
| History read fails after parse but before stats | NO | no slow-read line emitted | attribution lost (moderate) |
| Concurrent sessions each cross the per-session read threshold | YES | keyed by `sessionId`, independent budgets | none, pinned by spec |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the rate-table's full-clear-on-cap behaviour can make `suppressedSinceLastLog`
  undercount during a burst of many distinct slow SQL texts — an observability accuracy gap, not
  a correctness or safety one.
- What a robust implementation would add: (1) evict the single oldest rate-table entry instead of
  clearing the whole table, preserving more suppression history at the same bound; (2) wrap the
  session-history phase marks in a `try/finally` so a post-parse exception still emits the
  slow-read line with whatever phases completed; (3) one CI/manual run of the early-`break`
  `iterate()` path against the real (not mocked) `better-sqlite3` binary immediately followed by
  process exit, to close the residual uncertainty the ABI-mismatch skip leaves around the
  `Statement::~Statement()` teardown-order concern this review was specifically asked to
  scrutinise.

---

## Delta review (review fixes)

Scope: only the fixes made in response to this document's two moderate findings and the sibling
style review's serious/minor findings, verified by reading current code in
`D:\projects\ptah-437` (not the diff) — `slow-statement-timing.ts` (+spec),
`sqlite-connection.service.spec.ts`, `persistence-sqlite/CLAUDE.md`,
`agent-sdk/src/lib/helpers/history/session-history-read-timing.ts` (+spec, new),
`session-history-reader.service.ts` (+spec). Ran
`npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/agent-sdk` from
`D:\projects\ptah-437`: persistence-sqlite 28/37 suites (9 native-ABI suites skipped, expected),
360/440 tests passed, 80 skipped, exit 0; agent-sdk 105/107 suites, 1857/1860 tests passed, 2
skipped, exit 0 — the only anomaly is an `InternalQueryQueueTimeoutError` stack trace printed
after the agent-sdk run completes ("Successfully ran"), which is unrelated to timing
(`internal-query-queue-timeout.error.ts`) and matches the task's own instruction to attribute
`off-thread-process-spawner*`/`spawn-worker-pool*`-adjacent flakiness to Batch 13's uncommitted
files, not this batch.

### 1. Rate-table 256-entry LRU eviction (SQLite wrapper)

`slow-statement-timing.ts:141-163` now evicts only the single oldest entry at the cap instead of
clearing the whole table, exactly as the base review's "what a robust implementation would add"
recommended. Traced `report()`:

- Every slow hit — suppressed or freshly logged — does `rateTable.delete(key)` then
  `rateTable.set(key, entry)` (`:152` and `:155`/`:163`), which per `Map` semantics re-inserts the
  key at the end of iteration order. `rateTable.keys().next()` (`:160`) is therefore always the
  key least recently involved in a slow call, not merely least recently *logged* — a query that is
  hit every few seconds but always suppressed (window not yet elapsed) still keeps refreshing its
  position and is never the eviction target ahead of a truly idle key. This matches the doc
  comment at `:150-151` and is O(1): one `Map.get`, one `delete`, one `keys().next()` (only when at
  cap), one `set` — no scan.
- The suppressed counter is preserved across an eviction of a *different* key: eviction only ever
  removes `rateTable.keys().next().value`, and the entry being reported on is deleted and
  re-inserted with its own `suppressed` value carried through the `entry` object reference
  (`:154` returns early with the same object; `:158` reads `entry?.suppressed` before the object is
  replaced) — a key's own counter is never touched by another key's eviction.
- Pinned by `slow-statement-timing.spec.ts:250-278` ("evicts only the least recently slow SQL text
  at the cap, keeping other suppression counts"): fills the table to
  `SQLITE_SLOW_RATE_TABLE_MAX_ENTRIES`, shows `quiet` (untouched since its first hit) is the one
  evicted and logs again, while `kept` (refreshed via a suppressed hit mid-fill) survives two
  eviction opportunities with its `suppressedSinceLastLog` count intact — a full `Map.clear()`
  would have reset it to 0, which the test explicitly calls out.

No residual issue. This closes the base review's moderate finding ("Rate-table full-clear loses
accumulated suppression counts").

### 2. History-read timing: `finish()` on every exit path

Traced every branch of `readSessionHistory` (`session-history-reader.service.ts:160-325`) against
`HistoryReadStopwatch.finish` (`session-history-read-timing.ts:97-112`):

- Success path: `timing.finish(false)` (`:285`) runs after all four steps
  (`replayToStreamEvents`, `hydrateMissingPricing`, `aggregateUsageStats`/
  `seedLiveUsageBaseline`/`projectHistoryMessages`), inside the `try`, before the return — OK.
- Exception path: the single outer `catch` at `:304` calls `timing.finish(true)` (`:305`) as its
  first statement, unconditionally, regardless of which step threw or whether `readDone()` was
  ever called — this is the `try/finally`-equivalent the base review's Failure-modes section asked
  for as a follow-up, and it is now present. Two early-return branches (`sessionsDir` not found at
  `:221-229`, transcript read failure at `:243-260`) exit the outer `try` via `return`, not
  `throw`, so they do **not** go through `catch` and never call `finish()` at all — but per the
  contract in `session-history-read-timing.ts:15-17` ("a read that never loaded its transcript has
  nothing to attribute") this is correct: `finish()` gates on `this.readDoneAt !== undefined`
  (`:101`) so even a hypothetical missed call there would have been a no-op. No exit path produces
  a leaked stopwatch or a missing report for a read that had data to attribute.
- A phase running at error time is added: `finish()` calls `closePhase()` before checking
  `readDoneAt` (`:100`), and `closePhase()` (`:114-120`) adds whichever phase (`project` or
  `pricing`) was open into its running total. Concretely: if `hydrateMissingPricing` throws while
  the `pricing` phase is open (`:276-277`), the outer catch's `finish(true)` closes that phase and
  `pricingMs` reflects the partial hydration time. Pinned exactly by
  `session-history-read-timing.spec.ts:99-120` ("closes an open phase and reports failed when
  finished from a catch").
- `failed` field: threaded through unchanged to `HistoryReadTimingReport.failed` and logged
  verbatim (`:110`, `:194`) — `finish(false)` vs `finish(true)` is the only place it originates.
- `eventCount` empty if replay never finished: `events()` is only called after
  `replayToStreamEvents` returns (`:274`); if that call itself throws, `eventCount` stays
  `undefined` in the report, matching the interface doc ("absent when the read failed before
  replay produced events") and the spec's `eventCount: undefined` assertion in the same test.
- Second `finish()` call is a no-op: the `finished` boolean guard (`:98-99`) short-circuits before
  `closePhase()` or `owner.report()` run again — pinned by
  `session-history-read-timing.spec.ts:106-107` (`watch.finish(true); watch.finish(false); // a
  second finish is a no-op`) and by the reader's own structure, where `finish(false)` on the
  success path (`:285`) and `finish(true)` in the catch (`:305`) can both execute only if something
  *after* `:285` throws — in which case the second call is correctly inert and the already-reported
  `failed: false` line stands, which is the right answer since the read itself did succeed.
- Reads failing before transcript load are not reported: both early-return branches (`:221-229`,
  `:243-260`) return before `timing.readDone()` is ever called, so even though neither goes through
  `finish()`, the invariant holds structurally — there is no code path where a stopwatch that never
  saw `readDone()` gets reported. Confirmed no `finish()` call exists on either early-return
  branch (a gap the base review's Q4 already noted as "correct, there's nothing to attribute").
- Thrown error and return value unchanged: `finish()`/`report()` never throw into the caller — the
  only I/O inside `report()` (`logger.warn`) is wrapped in its own `try/catch` at
  `session-history-read-timing.ts:184-198`, matching the SQLite wrapper's same swallow pattern.
  Confirmed no other statement between `catch (error)` at `:304` and the existing `return`
  (`:315-323`) can throw from the timing code itself.
- No exception from the timing code escapes into the reader: every method on `HistoryReadStopwatch`
  and `SessionHistoryReadTiming` does only arithmetic and `Map` operations outside the
  logger-guarded `try`; the one call that talks to injected code (`this.logger.warn`) is guarded.
  Verified by `session-history-read-timing.spec.ts:171-177` ("never lets a throwing logger
  escape").

No residual issue. This closes the base review's moderate finding ("Slow-read attribution lost on
a post-parse exception").

### 3. Extraction to `session-history-read-timing.ts`, constructed without a DI token

- `this.readTiming = new SessionHistoryReadTiming(logger)` at
  `session-history-reader.service.ts:123`, inside the constructor body, is consistent with three
  existing sibling patterns in the same lib: `sdk-permission-handler.ts:162`
  (`this.ruleStore = new PermissionRuleStore(this.logger)`),
  `helpers/off-thread-process-spawner.ts:651` (`this.pool = new SpawnWorkerPool(logger,
  degradation)`), and `helpers/session-lifecycle-manager.ts:299` (`this._registry = new
  SessionRegistry(this.logger)`) — none of these collaborators carry a DI token either. This is
  the established convention for a stateful-but-private collaborator that only the owning service
  ever needs, not a deviation this batch introduced.
- No shared mutable state across service instances: `SessionHistoryReadTiming` holds only a
  per-instance `loggedAt` Map (`session-history-read-timing.ts:151`) and a per-instance
  `thresholdMs`/`now`; nothing is `static` or module-level. Two `SessionHistoryReaderService`
  instances (there is normally exactly one per DI container, but nothing prevents a test from
  constructing two) get fully independent rate-limit tables — confirmed by reading the class body
  top to bottom, no shared references beyond the injected `Logger`.
- Spec quality (`session-history-read-timing.spec.ts`, 178 lines): covers disjoint phase splitting
  including the untimed-bookkeeping gap (`durationMs` including time outside any phase, matching
  the header doc's `readMs + projectMs + pricingMs <= durationMs` claim), below-threshold silence,
  catch-path attribution, pre-transcript-load non-report, per-session independent rate budgets,
  LRU eviction at the 128-entry cap, env-var threshold read, and a throwing logger. This is
  equivalent in depth to the SQLite wrapper's spec and does not merely restate the happy path.

No residual issue.

### 4. Docs: the declined `pricingMs` comment

Verified against the code, not just the comment: `pricingMs` is timed as a phase fully disjoint
from `projectMs`. In `readSessionHistory`, `timing.begin('project')` opens after `readDone()`
(`:268`), then `timing.begin('pricing')` (`:276`, only when `isDirectAnthropic`) closes the
`project` phase and opens `pricing` before `await this.hydrateMissingPricing(...)` (`:277`), then
`timing.begin('project')` again (`:279`) closes `pricing` and re-opens `project` before
`aggregateUsageStats`/`seedLiveUsageBaseline`/`projectHistoryMessages`. `HistoryReadStopwatch`
accumulates each phase into its own running total (`session-history-read-timing.ts:117-118`), so
`pricingMs` is never folded into `projectMs` even though pricing hydration runs in the middle of
the projection work, exactly as the header comment
(`session-history-read-timing.ts:21-26`) states ("`pricingMs` is the awaited pricing hydration
that runs between the two projection halves and is NOT included in `projectMs`"). The comment is
accurate; declining to remove/simplify it was the right call — removing it would have hidden the
one non-obvious fact (that pricing interleaves with, rather than follows, projection) a reader
needs to interpret the logged split correctly.

No residual issue.

### 5. Tightened `sqlite-connection.service.spec.ts` slow-statement specs

Both specs (`sqlite-connection.service.spec.ts:556-623`) still prove what they need to:

- "logs a transaction that blocks past `PTAH_SQLITE_SLOW_WARN_MS` and returns its result"
  (`:570-604`): filters `logger.entries` to `sql === '<transaction reindexAll>'` before asserting
  (`:588-593`), with an explanatory comment that a concurrent migration statement crossing the 5 ms
  bar on a loaded machine is a correct, unrelated line rather than a test failure. This still
  proves a slow statement is logged with the right shape (`level: 'warn'`, `op: 'transaction'`,
  `failed: false`) — narrowing the filter only removes cross-talk from unrelated slow lines, it
  does not weaken the assertion on the transaction itself. `real.costMs`/`busyWait(20)` still
  forces the transaction over the 5 ms threshold, so the "slow" condition is still genuinely
  exercised, not assumed.
- "stays silent for statements under `PTAH_SQLITE_SLOW_WARN_MS`" (`:606-622`): raises the
  threshold to 600,000 ms (10 minutes) specifically so no real statement can cross it under CI
  load, per its own comment. This still proves the negative case — a real `prepare().all()` call
  runs and no `[SQLite] slow statement` line appears — the change only removes the risk that CI
  jitter pushes a normally-fast statement over a tight bar; it does not create a tautology, because
  the statement genuinely executes and is genuinely checked against the real
  `SlowStatementReporter.settle()` comparison (`slow-statement-timing.ts:131`), not skipped.

Neither test was hollowed out — both still exercise the real `withSlowStatementTiming` wrapper
end-to-end through `SqliteConnectionService`, not a mock of the reporter. No residual issue.

### Delta verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- All five fixes were checked against current code (not just the diff) and against their specs;
  every fix does what it claims, with no new logic defect introduced. The two moderate findings
  from the base review (rate-table full-clear, lost slow-read attribution on exception) are both
  closed. Item 5's spec-tightening was verified to still exercise the real wrapper against real
  timing, not weakened into a tautology.
- Outstanding from the base review, unchanged and not part of this fix set: the CI-abort residual
  uncertainty (no test in either project runs against the real native `better-sqlite3` binary in
  this environment, per the ABI-mismatch skips observed in this run too) — still recommend the
  manual Electron run of an early-`break` `iterate()` immediately followed by process exit, as the
  base review already noted.
