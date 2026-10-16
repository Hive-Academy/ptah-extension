# Code Style Review - P2 Outcome store core - `TASK_2026_646_136a`

Review family: Anthropic (Claude Sonnet 5.5). Implementers were OpenAI codex lanes (Batches 6, 34, 35, 15, 20), so the reviewer is a different family.

Scope: `git diff 8fc9278e9^..dd021d709 -- libs/backend/lane-outcomes libs/shared/src/lib/types/lane-outcome.types.ts` (40 files, 5 844 insertions). Every non-spec source file of `libs/backend/lane-outcomes/src` was read in full (21 files, about 2 800 lines). Specs and `*.test-support.ts` were read only where a claim depended on them. No Nx, Jest or build was run. I ran `grep`, `git diff`, and `prettier --check` on the lib. Runtime failure modes are left to the P2 code-logic review. I mention them only where a style finding points at one.

## Summary

| Metric          | Value                               |
| --------------- | ----------------------------------- |
| Overall score   | 6/10                                |
| Assessment      | NEEDS_REVISION                      |
| Blocking issues | 0                                   |
| Serious issues  | 2                                   |
| Moderate issues | 11                                  |
| Minor issues    | 7                                   |
| Files reviewed  | 40 changed files (21 source) + 3 sibling comparisons (skill-synthesis `di/`, lane-routing `matrix.schema.ts` and `di/tokens.ts`) |

Score rationale. Boundaries, tags, tsconfig and exports of the lib are in good shape, and the write path is carefully built. What pulls the score under the P1 bar (7/10) is the pipeline file: it copies one journal-append loop three times and lets two of the copies drift from the shared constant, and the whole lib carries almost no comments, though it publishes a 40-name barrel. Both are cheap to fix. The rest are Moderate items that match the kind P1 accepted with follow-ups.

Evidence that separates it from the 7-8 band: 7/10 needs no Serious issue. The duplication in `outcome-write-pipeline.ts` (Serious 1) is a live defect-in-waiting, because the journal limit constant exists and is used in one of three places. Evidence that separates it from the 5-6 band below: the boundaries are clean and nothing Blocking exists.

Positives, with evidence:
- Graph is exactly as batches.md rule 9 says. Non-relative imports in the lib are `@ptah-extension/shared` (16), `platform-core` (8), `persistence-sqlite` (4), `agent-sdk` (2), plus `zod`, `tsyringe` and `node:*`. There is no `lane-routing` and no `vscode-core` import (grep over `src`). `node:fs`, `node:os` and `node:path` appear only in specs.
- `project.json:6` has tags `["scope:extension", "type:feature"]`. `tsconfig.base.json:159-160` maps `@ptah-extension/lane-outcomes` to `src/index.ts`. `tsconfig.lib.json` is `strict: true` and excludes `*.test-support.ts` like the four sibling libs.
- No `any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` or `as unknown as` in any non-spec source file. All SQL in `sqlite-lane-outcome.store.ts` is static text with `?` parameters. There is no string-built query from input.
- `register.ts:23-26` takes `(container, logger)` with a structural `LaneOutcomeLogger` (`lane-outcome-logger.ts:1-6`), as SC-9 asks. The only `container.resolve` calls sit in `useFactory` closures (`register.ts`) and in `start.ts`, which is the lifecycle entry the composition root calls.
- `eslint.config.mjs` spreads `baseConfig` with a comment saying why (sibling `skill-synthesis` adds its own selectors). Only this file fails `prettier --check` (Minor 7).

## Five style questions

### 1. What breaks in six months?

- Someone retunes `OUTCOME_JOURNAL_LIMIT` (`write/key-value-outcome-journal.ts:5`, 5000). `accept()` follows it (`outcome-write-pipeline.ts:268`). `drain()` (`:335`) and `dispose()` (`:655`) keep their own literal `5000`. The three paths then admit different numbers of entries into one journal. See Serious 1.
- Someone adds a fourth store method and forgets to override it in `KeyValueLaneOutcomeStore`. The method runs on the inherited `InMemoryLaneOutcomeStore` state and is never persisted, with no compile error (Moderate 5). Today the eight overrides at `key-value-lane-outcome.store.ts:119-157` cover every mutator.
- A seventh verdict or a third `OutcomeExecutorKind` value is added in `libs/shared`. `LaneOutcomeRowSchema` (`lane-outcome.schema.ts:32-62`) restates the enums by hand, so the recorder rejects the new value at runtime with the log line "Invalid lane outcome" (`lane-outcome-recorder.service.ts:48-52`), and the type check stays green (Moderate 3).
- Anyone adding a second observer of "a lane row was inserted" must add a sixth positional constructor argument to `OutcomeWritePipeline` (`outcome-write-pipeline.ts:127-133`) and another lazy `c.resolve` in the `register.ts:62-66` lambda (Moderate 2).
- Another migration of `lane_outcome_records` must be copied by hand into two spec DDLs, and the pipeline spec DDL already drifted once (`batches.md:1095`, F20-1). See Moderate 7.

### 2. What would a new team member misread?

- `LaneOutcomeRowSchema` (`lane-outcome.schema.ts:32`) parses a `LaneOutcomeRecord`, but `LaneOutcomeRow` (`store/lane-outcome.store.ts:8-10`) is a different type, the record plus `budgetStopped`. Reading `LaneOutcomeRowSchema.parse(x)` as returning a `LaneOutcomeRow` is the natural guess, and wrong.
- `LaneOutcomeReader` is both the shared port (`libs/shared/.../lane-outcome.types.ts:150`) and the lib class (`lane-outcome-reader.service.ts:30`). The class file has to alias the port to `LaneOutcomeReaderPort` (`:3`) to compile. The barrel then exports a third name for the same capability, `LaneOutcomeQueries` (`index.ts:49`).
- The store port returns `'applied' | 'duplicate' | 'missing' | 'invalid'` (`lane-outcome.store.ts:68-72`) and `'applied' | 'held' | 'duplicate'` (`:73-76`) with no word about what each means or who acts on `missing`. The meaning lives only in `outcome-write-pipeline.ts:564-594`.
- The shared file header says "no type here may carry ... paths" (`lane-outcome.types.ts:5-6`), yet the batch adds `workspaceRoot` to `LaneOutcomeRecord` (`:72`), and the recorder fills it from the hook payload (`lane-outcome-recorder.service.ts:107`). Plan part B accepted the column (`implementation-plan-part-b.md:202`), so the header is stale or the field needs an explicit privacy note (Moderate 8).
- `reader.recentOutcomes()` is typed `LaneOutcomeSummary[]`, "holds no text", but the runtime objects are whole rows with `workspaceRoot`, `skillsLoaded` and `budgetStopped` (Moderate 6).

### 3. What does this cost to maintain?

- The pipeline is one class of 671 physical lines (643 non-blank, 57 below the repo's 700-line `max-lines` warning at `eslint.config.mjs:556-560`) that owns queueing, the KV journal, admission policy for held reports, retry backoff, dead-lettering, and the held-run index. `submit()` runs 165-257 and `drain()` runs 326-413. It is covered by 1 822 spec lines in three files, which is a good sign about the care taken and an indicator of how much state it carries.
- Three stores implement the same hold/receipt state machine in three bodies (`in-memory` `:29-80`, `sqlite` `:157-208`, KV by inheritance), checked by three near-identically named specs (`describe`/`it` titles line up one to one: "joins ... in held order", "returns duplicate, missing and invalid ...", "497 plus one"). Nothing proves the third behaves like the first except the author's care (Moderate 4).
- `2000` as a read cap appears as seven separate literals (see Moderate 1). A one-day hold is spelled three different ways.
- `findLatestByAgent` and `hasReceipt` are in the port, in all three stores, and in specs, but no production caller exists (`grep` finds none outside `libs/backend/lane-outcomes`). They are speculative surface (Minor 3).

### 4. Where is this inconsistent with the rest of the repository?

- Tokens: sibling libs keep every DI token in `di/tokens.ts` with a header comment (`skill-synthesis/src/lib/di/tokens.ts:1-8`, `lane-routing/src/lib/di/tokens.ts:16-25` with a doc comment per token). Here `LANE_OUTCOME_PIPELINE` is declared in `di/register.ts:21` as a bare `Symbol.for(...)` outside the `LANE_OUTCOME_TOKENS` object, and `tokens.ts:1-8` has no comments at all (Moderate 9).
- Schemas: `lane-routing/src/lib/matrix/matrix.schema.ts:88,100,108` tie each Zod schema to its shared type with `satisfies z.ZodType<T>`, the model P1 pointed at. `LaneOutcomeRowSchema` does not (Moderate 3).
- Comment density: `skill-synthesis/di/register.ts` has 13 comment lines. The whole lane-outcomes source has two JSDoc blocks (`lane-outcome.store.ts:14`, `key-value-lane-outcome.store.ts:34`). See Serious 2.
- Store tests: the repo's contract-runner pattern for ports (`libs/backend/platform-core/src/testing/contracts/`) is not used for this port's three implementations (Moderate 4).
- Constants: `lane-routing` names its numbers (`routing-constants.ts`). Here `DELAYS`, `HOLD_LIMIT` and `HOLD_SWEEP_MS` are named (`outcome-write-pipeline.ts:59-61`), and then `1000`, `25`, `250`, `200`, `2000` and `5000` are used inline in the same file.

### 5. What would I have done differently?

- Route every journal write through `KeyValueOutcomeJournal.append` (it exists, has a spec at `key-value-outcome-journal.spec.ts:35,47`, and nothing in production calls it). If the pipeline needs a batch form, add `appendMany(ops): Promise<{ accepted: number }>` next to it, using the one constant. This deletes about 60 lines of the pipeline and the drift.
- Let the pipeline expose `onLaneInserted(listener): () => void`. `startLaneOutcomes` already holds both the recorder and the pipeline and already collects unsubscribe handles (`start.ts:25-52`), so it can subscribe the recorder there. That removes the late-bound `c.resolve<LaneOutcomeRecorder>` inside the pipeline factory and the fifth constructor argument.
- Compose the KV store around an in-memory core (`private readonly core = new InMemoryLaneOutcomeStore()`), or give both stores a shared `OutcomeStateMachine` of pure functions. Then a forgotten method is a compile error against `implements LaneOutcomeStore`, not a silent no-write.
- Run one `runLaneOutcomeStoreContract(makeStore)` suite against all three stores, and build the SQLite spec DB from the real `MIGRATIONS` (exported at `persistence-sqlite/src/index.ts:83`).
- Write a file header for `outcome-write-pipeline.ts` and the store port stating the state machine in six lines (ack-after-apply, journal only while the DB is closed, hold 24 h, 500 holds max, permanent vs transient failure). This is the document that decisions #34 and #40 currently hold, in a task folder that will be archived.

## Blocking issues

None.
- No `eslint-disable` of `@nx/enforce-module-boundaries` anywhere in the lib (grep clean).
- No `vscode-core`, `lane-routing` or deep `/src/` import (import census above).
- No new `as any`, `@ts-ignore` or `as unknown as` in production code.
- `agent-sdk` is imported through its barrel only (`start.ts:2-6`, `lane-outcome-recorder.service.ts:9`).

## Serious issues

### 1. The journal-append loop exists three times, and two copies ignore the limit constant

- File: `libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts:265-280` (`accept`, uses `OUTCOME_JOURNAL_LIMIT`), `:332-347` (`drain`, literal `5000`), `:651-664` (`dispose`, literal `5000`). The class already imported the constant at `:17`.
- Problem: `KeyValueOutcomeJournal.append` (`write/key-value-outcome-journal.ts:62-75`) is the one place the rule "if full, bump `droppedAtCapacity`, else assign `seq` and push" is written, and it is spec-covered. The pipeline never calls it and re-implements the rule inline three times. This is duplication with drift in the exact sense of the review's hunt list: one copy follows the constant, two do not. The same file also has `1000` (`:154`, `:292`), `25` (`:361`), `250` (`:412`), `200` (`:624-625`) and `2000` (`:645`) as bare numbers next to the named `DELAYS`/`HOLD_LIMIT`/`HOLD_SWEEP_MS` (`:59-61`), and `'subagent:'` three times (`:212`, `:246`, `:579`) although `subagentRunId` (`subagent-join.ts:7`) is the lib's single owner of that prefix.
- Tradeoff: The inline form was probably chosen to keep each batch inside one `journal.update` write (atomic with the `heldRuns` edit). That is a fair reason, and `append` as written does not offer it. The fix keeps the atomicity and removes the three copies.
- Recommendation: add a pure helper next to the journal, for example `appendEntries(value, ops): JournalValue<T>`, that applies the limit rule once. `append` and all three pipeline sites call it inside their own `update` callback. Name the loose numbers (`QUEUE_LIMIT`, `DRAIN_BATCH`, `REJECTED_LIMIT`, `DISPOSE_DEADLINE_MS`) at the top of the file with the existing three. Replace `startsWith('subagent:')` with a `isSubagentRunId(runId)` exported from `subagent-join.ts` that uses `SUBAGENT_LANE_ID`.

### 2. The lib's public API and its state machine have no documentation

- File: `libs/backend/lane-outcomes/src/index.ts:1-60` (40 exported names, no comment), `di/register.ts:23-98`, `di/start.ts:12-52`, `di/tokens.ts:1-8`, `store/lane-outcome.store.ts:48-102`, `write/outcome-write-pipeline.ts:112-671`. The only JSDoc blocks in about 2 800 source lines are `lane-outcome.store.ts:14` and `key-value-lane-outcome.store.ts:34`.
- Problem: this is the new public API the task asked a style review for, and a reader cannot tell from the code:
  - what `startLaneOutcomes` returns (a disposer) and that it registers the services itself when absent (`start.ts:17-18`);
  - which tokens a host must provide (`FAILURE_CLASSIFIER`, `SKILL_TELEMETRY_SEAM` are optional, `register.ts:76-93`) and which it aliases (`LANE_OUTCOME_READER` in `lane-routing/di/tokens.ts:19-22` expects `useToken` to `LANE_OUTCOME_TOKENS.READER`);
  - what `enqueue` (fire-and-forget) versus `submit` (awaits admission) promise, and what `state: 'applied' | 'held' | 'queued'` means (`outcome-write-pipeline.ts:34-40`);
  - why a missing run can be held for 24 h only when it is `subagent:`-prefixed (`:212-231`).
  P1 criticised plan-letter comments as meaningless after archiving. The opposite gap is worse: this batch carries the plan's decisions only in `decisions.md` (#34, #40) and the pipeline carries none of them.
- Tradeoff: Short comments cost a few dozen lines and match every sibling (`skill-synthesis/di/tokens.ts:1-8`, `lane-routing/di/tokens.ts:16-25`). Missing comments cost every future reader a trip to the task folder, or a misuse of `enqueue` versus `submit`.
- Recommendation: add (a) a file header on `outcome-write-pipeline.ts` listing the six invariants from decisions #34 and #40; (b) one-line JSDoc per store-port method naming the return states; (c) JSDoc on `registerLaneOutcomeServices`, `startLaneOutcomes` and each `LANE_OUTCOME_TOKENS` member saying provided-by-lib or optional-from-host; (d) group the barrel with three comments (contract, stores, wiring).

## Moderate issues

### 1. Repeated literals for one concept (read cap, one-day hold, window)

- `2000` as the read cap: `lane-outcome-reader.service.ts:19` (`READ_LIMIT`), `in-memory...store.ts:156,169`, `sqlite...store.ts:285,302,308` (inside SQL text), `key-value...store.ts:110`.
- One day as a hold lifetime: `24 * 60 * 60 * 1000` at `lane-outcome-recorder.service.ts:175,195`, `86_400_000` at `in-memory...store.ts:122` and `sqlite...store.ts:245`, `86400000` (days to ms) at `lane-outcome-reader.service.ts:70`. Ninety days is `90 * 24 * 60 * 60 * 1000` at `key-value...store.ts:106`.
- Fix: a `lane-outcome.constants.ts` with `OUTCOME_READ_LIMIT`, `HELD_REPORT_TTL_MS`, `KV_RETENTION_MS`, `MS_PER_DAY`. The SQL `LIMIT 2000` can interpolate the constant because it is a number literal in a static template.

### 2. Pipeline constructor callback and late service lookup

- File: `outcome-write-pipeline.ts:127-133` (five positional parameters, three optional), `di/register.ts:41-67`.
- Problem: `onLaneRecordInserted` is a bare callback so the pipeline can tell the recorder a row landed, and the recorder depends on the pipeline. The cycle is broken by `c.resolve<LaneOutcomeRecorder>(...)` inside the factory lambda (`register.ts:62-66`), a service-locator call evaluated at event time. A mis-wire (recorder not registered) is not a startup error. The throw is caught and logged as a warning (`outcome-write-pipeline.ts:547-556`). `OutcomeStoreAvailability` is built inline at `register.ts:55-61` instead of as a named adapter.
- Cost: one extra observer means another constructor argument; the "optional parameters in positional order" shape already invites argument mix-ups (`storage`, `availability`, `callback` are all `undefined`-able).
- Fix: see question 5. `pipeline.onLaneInserted(listener)` returns a disposer, and `startLaneOutcomes` subscribes `recorder.onLaneRecordInserted` next to the two registry subscriptions. The constructor shrinks to `(store, logger, deps?: { storage; availability })`.

### 3. `LaneOutcomeRowSchema` restates shared enums and has no type tie

- File: `lane-outcome.schema.ts:32-62` (`executorKind`, `verdict`, `telemetryJoin`, and `['approved','rejected','revise']` also at `:25` and `write/report-effect.ts:26`), `:41` etc. The model is `lane-routing/.../matrix.schema.ts:88,100,108` (`satisfies z.ZodType<T>`).
- Problem: the P1 review raised the same shape for `route-decide-result.schema.ts` (P1 Moderate 3). A new `LaneCompletionVerdict` value compiles and then fails at runtime at the write edge.
- Fix: `export const LaneOutcomeRecordSchema = z.object({...}) satisfies z.ZodType<LaneOutcomeRecord>` and rename (see Moderate 10). Export `OUTCOME_EXECUTOR_KINDS`, `OUTCOME_TELEMETRY_JOINS`, `OUTCOME_REVIEW_VERDICTS` from `libs/shared` the way `OUTCOME_TASK_KINDS` is, and use `z.enum(...)` on them.

### 4. Three store implementations, three hand-written specs, no contract runner

- Files: `store/in-memory-lane-outcome.store.spec.ts:6-155`, `key-value-lane-outcome.store.spec.ts:39-208`, `sqlite-lane-outcome.store.spec.ts:53-231`.
- Problem: seven of the tests have the same intent and nearly the same title in all three files. The repo already has the runner shape in `libs/backend/platform-core/src/testing/contracts/`. When the port gains a method, the three specs must each be extended, and the port is the one place where `sqlite` and `in-memory` must agree (the KV store inherits the in-memory behaviour, so a bug in the inherited code shows in two stores).
- Fix: a `store.contract.ts` in test-support exporting `runLaneOutcomeStoreContract(name, factory)`; each spec keeps only its backend-specific cases (rollback restore, reopen file, eviction above 2 000 rows).

### 5. `KeyValueLaneOutcomeStore extends InMemoryLaneOutcomeStore`

- File: `store/key-value-lane-outcome.store.ts:35-157`, `in-memory-lane-outcome.store.ts:13-16` (four `protected` collections), `write/pipeline.test-support.ts:53` (`FaultStore extends InMemoryLaneOutcomeStore` too).
- Problem: the repo's stated rule is composition over inheritance. Here the subclass reaches into `protected rows/receipts/held/budgetStops`, snapshots and restores them by hand (`:73-97`), and wraps eight methods with `this.write(() => super.x())`. The base class is also exported from the barrel (`index.ts:24`) as if it were a product-grade store.
- Fix, not urgent: `KeyValueLaneOutcomeStore implements LaneOutcomeStore` and holds an `InMemoryLaneOutcomeStore` it delegates to. Delegation keeps the read methods one-liners and turns a forgotten mutator into a compile error. If delegation is judged too noisy, add a comment on the base class listing the methods the subclass must keep in sync.

### 6. Reader returns wider objects than its declared types

- File: `lane-outcome-reader.service.ts:37-55` (`recentOutcomes` returns `join(rows)` typed `LaneOutcomeSummary[]`), `:77-80` (`get`), `subagent-join.ts:13-34` (`...row` spreads `budgetStopped`).
- Problem: structural typing hides the extra fields. A consumer that serialises the "summary" (log line, RPC, the Agents tab) emits `workspaceRoot`, `subagentSessionId`, `skillsLoaded` and `budgetStopped`. The shared header promises "Holds no text" (`lane-outcome.types.ts:106`, the `LaneOutcomeSummary` comment).
- Fix: project explicitly in `recentOutcomes` with a `toSummary(record): LaneOutcomeSummary` that lists the 15 picked keys, and drop `budgetStopped` in `get()`.

### 7. Hand-copied DDL in specs has already drifted once

- File: `store/sqlite-lane-outcome.store.spec.ts:21-45`, `write/pipeline.test-support.ts:110-135`. Evidence: `batches.md:1095` (F20-1: the pipeline spec DDL lacked three columns, so a test failed).
- Fix: apply `MIGRATIONS` (exported from `@ptah-extension/persistence-sqlite`, `index.ts:83`) through `SqliteMigrationRunner` (`:80`) in both. The tests then fail when a migration and the store disagree, which is the point.

### 8. `workspaceRoot` on `LaneOutcomeRecord` contradicts the file's privacy rule

- File: `libs/shared/src/lib/types/lane-outcome.types.ts:5-6` ("no type here may carry request text, prompt text, file contents or paths") against `:70-72` (new `subagentSessionId`, `parentSessionId`, `workspaceRoot`, all `?: string | null`). Recorder: `lane-outcome-recorder.service.ts:107`. Plan: `implementation-plan-part-b.md:202`.
- Problem: either the plan is right and the header must say "except `workspaceRoot` for the telemetry join, which is stored locally and never sent to a webview or provider", or the field needs to leave the type that routing and the UI read (see Moderate 6). The comment on the fields also says "null for lanes" while the type marks them optional, so there are three absent states (`undefined`, `null`, a value).
- Fix: amend the header with the exception and the reason, and make the three fields non-optional (`string | null`) now that the recorder always sets them (`:47-49`, `:105-107`) and `LaneOutcomeRowSchema` accepts `.optional()` only because the store's decode path omits them.

### 9. `LANE_OUTCOME_PIPELINE` token sits outside the token object and `tokens.ts`

- File: `di/register.ts:21` (declaration), re-exported from `index.ts:56-59`; `LANE_OUTCOME_TOKENS` at `di/tokens.ts:1-8` lacks it. `LANE_OUTCOME_TOKENS.LOGGER` (`tokens.ts:7`) is registered at `register.ts:27` and resolved nowhere (every consumer receives the `logger` argument by closure).
- Problem: the convention from siblings and from the lead's brief is "`Symbol.for` tokens in `di/tokens.ts`, one frozen object". A host that needs the pipeline token must import from `register` rather than from the tokens module, and a dead token invites someone to resolve it and get a different instance.
- Fix: move the pipeline symbol into `LANE_OUTCOME_TOKENS.PIPELINE`; delete `LOGGER` or document it as the injection point and make the factories resolve it.

### 10. Names that collide or mislead

- `LaneOutcomeRowSchema` validates a `LaneOutcomeRecord`, not a `LaneOutcomeRow` (see question 2). Rename to `LaneOutcomeRecordSchema`.
- Class `LaneOutcomeReader` shares a name with the shared port (`lane-outcome-reader.service.ts:3,30`), forcing an alias. Either name the class `LaneOutcomeReaderService` (the file is already `*.reader.service.ts`) or drop `LaneOutcomeQueries` and let the class `implements LaneOutcomeReaderPort` directly. `LaneOutcomeQueries` adds only `agentSignals` and `get`; export those two as a named interface if the RPC layer needs it.
- Module-level constants `columns`, `names` (lowercase) beside `INSERT`, `UPDATE`, `SELECT` (upper) in `sqlite-lane-outcome.store.ts:36-47`. Make them `COLUMNS`, `COLUMN_NAMES`.

### 11. Persisted JSON is trusted without validation in two of three readers

- File: `write/key-value-outcome-journal.ts:33` (`storage.get<JournalValue<T>>(...)`, then `saved?.entries ?? []`), `outcome-write-pipeline.ts:143` and `:604` (`storage.get<RejectedValue>(...)` with `.entries.length`).
- Problem: the KV store validates its snapshot with Zod (`key-value-lane-outcome.store.ts:23-28,41`), the SQLite decode validates every row. These two keys are persisted state with the same trust level and no check, so a hand-edited or older-version value turns into `TypeError: Cannot read properties of undefined` inside the constructor (`:143`) that registers the pipeline. That is both a contract inconsistency inside the lib and a boundary rule ("validate external input where it enters").
- Fix: `JournalValueSchema` and `RejectedValueSchema` next to their types, `safeParse` on read, fall back to the empty value and log once. The generic `T` of the ops can stay `z.unknown()` at the storage edge.

## Minor issues

1. `di/start.ts:17-18` registers services when the recorder token is absent and silently ignores the `logger` argument if it is present. Either always call `registerLaneOutcomeServices` from the root and make `start` take only the container, or document the either/or.
2. `di/register.ts:3,15` imports `SqliteConnectionService` as a value and uses it only as a type argument. Use `type SqliteConnectionService`.
3. `findLatestByAgent` (`store/lane-outcome.store.ts:86`) and `hasReceipt` (`:95`) have no production caller. So does `SubagentRunTelemetry.specVerdictSource` (`skill-telemetry-seam.port.ts:9`). Drop them or note the P3 consumer that will use them.
4. `error instanceof Error ? error.name : 'UNKNOWN'` is repeated four times (`lane-outcome-reader.service.ts:51-53,134-137`, `lane-outcome-recorder.service.ts:98`, `outcome-write-pipeline.ts:552`) next to a private `failureCode()` (`:92-100`) that does the richer version. Share one helper in `lane-outcome-logger.ts` or a small `errors.ts`.
5. `lane-outcome-recorder.service.ts:134-161`: the `checks` parameter type is hand-written. `DeliverableCheck` already exists in `write/report-effect.ts:31-33` but is not exported. Export it and use it.
6. `lane-outcome-reader.service.ts:100-142`: the "telemetry unavailable" fallback `rows.map(... applySubagentJoin(row, null, false))` appears twice. `applySubagentJoin(row, telemetry, available = true)` takes a boolean flag that switches `telemetryJoin` between `'unavailable'` and the match value. A second function or a `joinState` enum reads better.
7. `libs/backend/lane-outcomes/eslint.config.mjs` fails `prettier --check` (the only file in the lib or in `lane-outcome.types.ts` that does). In `lane-outcome.types.ts:47-48` the diff also reflowed the unrelated `OutcomeTelemetryJoin` union and added a trailing newline. Harmless, but it is churn in a shared contract file.

## File-by-file

### `src/index.ts`
Score 6/10 - 0 B, 1 S (share of Serious 2), 1 M. 40 names exported (`:1-60`) where hosts need roughly the registration functions, tokens, the recorder/reader types, the seam port and the arg schemas. Stores, journal keys, the journal class, the three journal types, `OutcomeWritePipeline` and the report-effect helpers (`reportEffectOf`, `deliverablesVerdictOf`) are internals that now count as public API. P1 raised the same for `routing-constants` (P1 Maintenance 3). Cut to what a host imports, and export the rest only when a consumer exists.

### `src/lib/di/register.ts`, `start.ts`, `tokens.ts`, `lane-outcome-logger.ts`
Score 7/10 - 0 B, 0 S (Serious 2 partly), 3 M, 2 m. Conventions match the sibling `register*Services(container, logger)` shape and SC-9. Gaps: Moderate 2 (callback and lookup), Moderate 9 (token outside object, dead `LOGGER`), Minor 1-2. The `isRegistered(SQLITE_CONNECTION)` store selection (`register.ts:30`) is a capability test, not a host sniff, and is the decision #34 design, so I do not count it against the lib.

### `src/lib/write/outcome-write-pipeline.ts`
Score 5/10 - 0 B, 1 S, 3 M. Careful, well-tested logic, but the structure is its own enemy: Serious 1 (three append copies, bare numbers, `'subagent:'` literal), Serious 2 (no header), Moderate 2 (callback), Moderate 11 (unvalidated `RejectedValue`). `submit()` at 93 lines and `drain()` at 88 lines each mix policy and I/O; the hold-admission block `:212-252` and the dead-letter method `reject` `:596-632` are natural extraction points (`HoldAdmission`, `RejectedLedger`) once Serious 1 is done. Counting non-blank lines it is 57 under the 700-line warning, so add a feature here and the lint warning fires.

### `src/lib/write/key-value-outcome-journal.ts`, `report-effect.ts`
Score 7/10 - 0 B, 0 S, 2 M. Small and readable. `append` is the right abstraction that the pipeline fails to use (Serious 1). `:33` trusts persisted JSON (Moderate 11). `report-effect.ts:26` repeats the review verdict enum (Moderate 3).

### `src/lib/store/lane-outcome.store.ts`
Score 6/10 - 0 B, 0 S, 1 M, 1 m. A good port shape, with `OutcomeEffectResolver` keeping policy out of storage. It carries a runtime function (`applyOutcomeEffect`, `:34-47`) in the port file; that is fine at this size. No docs on the return states (Serious 2).

### `src/lib/store/sqlite-lane-outcome.store.ts`
Score 7/10 - 0 B, 0 S, 2 M. Static parameterised SQL, Zod on decode (`:50-57` `HeldSchema`, row schema), one column map as the single source for INSERT/UPDATE. Issues: literal `2000` inside SQL (Moderate 1), casing of the module constants (Moderate 10), `holdReport` calls `Date.now()` although the port passes `nowMs` to its siblings (`:321-325`).

### `src/lib/store/in-memory-lane-outcome.store.ts`, `key-value-lane-outcome.store.ts`
Score 6/10 - 0 B, 0 S, 3 M. Inheritance (Moderate 5), repeated constants (Moderate 1), no contract runner (Moderate 4). The KV `write()` serialises the whole 2 000-row snapshot twice per write to compare (`:56-67`); that is a runtime cost for the logic review, and it also argues for delegation, which could dirty-track per method.

### `src/lib/lane-outcome-recorder.service.ts`, `lane-outcome-reader.service.ts`, `subagent-join.ts`, `agent-signals.ts`, `skill-telemetry-seam.port.ts`, `lane-outcome.schema.ts`
Score 6/10 - 0 B, 0 S, 4 M, 4 m. Clear single-purpose files, `*.service.ts`/`*.port.ts` suffixes match the repo. Name collision and misleading schema name (Moderate 10), wide returns (Moderate 6), no `satisfies` tie (Moderate 3), repeated literals and helper drift (Minor 4-6). For the logic reviewer: `classificationInputs` (`recorder:32-38,75-83`) is only drained by `onLaneRecordInserted`, so a lane insert that returns `false` (duplicate) leaves its entry in the map.

### `libs/shared/src/lib/types/lane-outcome.types.ts`
Score 7/10 - 0 B, 0 S, 1 M, 1 m. Three optional fields against the file's own privacy header (Moderate 8). Unrelated reflow (Minor 7).

### Project files (`project.json`, `eslint.config.mjs`, `jest.config.ts`, `tsconfig*.json`)
Score 9/10. Tags, targets, `strict: true`, test-support exclusion and base-config spread all match the sibling libs. `build` target uses `@nx/esbuild` with `external: ["tsyringe"]`, which the other backend libs also do. Only the Prettier miss in Minor 7.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| New lib has `scope:*` and `type:*` Nx tags | PASS | `project.json:6` |
| Graph: `lane-outcomes -> {shared, platform-core, persistence-sqlite, agent-sdk}` only, no `lane-routing`, no `vscode-core` | PASS | import census over `src` (see Summary) |
| Cross-lib imports use public `@ptah-extension/*` aliases, no deep relative paths | PASS | `tsconfig.base.json:159-160`; no `../../` into another lib in `src` |
| No `eslint-disable` of `@nx/enforce-module-boundaries` | PASS | grep over `src` |
| No `any` / `@ts-ignore` / `as unknown as` in production code | PASS | grep over non-spec `src` |
| Tokens are `Symbol.for` constants in `di/tokens.ts` in one frozen object | FAIL (Moderate) | `di/register.ts:21`; `tokens.ts:1-8` |
| `register*Services(container, logger)` with structural logger (SC-9) | PASS | `register.ts:23-26`, `lane-outcome-logger.ts:1-6` |
| No `container.resolve` outside composition roots | PASS with note | only in factory closures and in `start.ts` (the host-called entry point) |
| Zod at boundaries, tied to shared types (`satisfies z.ZodType<T>`) | FAIL (Moderate) | `lane-outcome.schema.ts:32-62` against `matrix.schema.ts:88,100,108` |
| Persisted state validated on read | FAIL (Moderate) | `key-value-outcome-journal.ts:33`, `outcome-write-pipeline.ts:143,604` |
| Kebab-case filenames with role suffixes | PASS | `*.service.ts`, `*.port.ts`, `*.store.ts`, `*.schema.ts`, `*.test-support.ts` |
| Port implementations share a contract test | FAIL (Moderate) | three separate store specs |
| Composition over inheritance | FAIL (Moderate) | `key-value-lane-outcome.store.ts:35` |
| `max-lines` 700 (skip blanks and comments) | PASS (close) | `outcome-write-pipeline.ts` 643 non-blank / 671 total |
| Comment density matches sibling libs | FAIL (Serious) | 2 JSDoc blocks in the lib against `skill-synthesis` `di/` |
| Parameterised SQL only | PASS | `sqlite-lane-outcome.store.ts:47-65,70-150` |
| Host DI phase files, guard specs (rule 8) | NOT_APPLICABLE | no host imports `lane-outcomes` yet (only the three `tsconfig.build.json` path entries); first host wiring comes with a later batch |
| Public API minimal and consistent | FAIL (Moderate) | `index.ts:1-60` (40 names) |

## Maintenance debt

- Introduced: a 671-line pipeline with three copies of the same journal rule; three store implementations kept in step by hand; 40 public names; seven repeated literals for the same four concepts; a lib with almost no prose.
- Retired: the in-memory VS Code outcome behaviour (replaced by a durable KV store); the unbounded-queue hazard; the `LaneOutcomeRecord` fields that had no column.
- Net: slightly up. The debt is local and cheap to pay down (journal helper, constants file, contract runner, doc comments), and none of it crosses a lib boundary.

## Verdict

- Recommendation: REVISE (two Serious findings; no Blocking).
- Confidence: HIGH on the boundary and naming findings (each grep-verified). MEDIUM on how large the pipeline refactor needs to be: Serious 1 can be fixed with a pure helper and constants without splitting the class.
- Key concern: `outcome-write-pipeline.ts` re-implements the journal-append rule three times with the limit hard-coded in two, and the lib publishes a 40-name API with no documentation of its state machine.
- What a 10/10 version would do differently:
  - One `appendEntries` helper in the journal module, used by `append` and the three pipeline sites; named constants for every limit and delay; `isSubagentRunId` in `subagent-join.ts`.
  - `onLaneInserted` listener on the pipeline wired in `startLaneOutcomes`; constructor reduced to `(store, logger, deps?)`.
  - `PIPELINE` inside `LANE_OUTCOME_TOKENS`; no dead `LOGGER` token; doc comments on tokens, register, start and each store-port method; a header on the pipeline.
  - `LaneOutcomeRecordSchema satisfies z.ZodType<LaneOutcomeRecord>` over shared enum constants; Zod on the journal and rejected-ledger reads.
  - A `runLaneOutcomeStoreContract` suite for all three stores, with the SQLite spec DB built from the real `MIGRATIONS`.
  - KV store delegating to the in-memory core instead of inheriting from it.
  - A barrel that exports the registration functions, tokens, recorder/reader types, seam port and arg schemas, and nothing else until a consumer asks.
  - An explicit `toSummary()` projection in the reader, and the shared header amended for `workspaceRoot`.
