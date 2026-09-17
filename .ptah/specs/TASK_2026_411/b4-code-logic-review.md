# Code Logic Review — `TASK_2026_411` (Batch B4)

Scope: commit `e72604346` only — stats projection, ledger cache, aggregator, and
the rewritten `session:stats-batch` RPC handler.

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------- |
| Overall score         | 6/10                                   |
| Assessment            | NEEDS_REVISION                         |
| Blocking issues        | 0                                      |
| Serious issues         | 1                                      |
| Moderate issues        | 3                                      |
| Failure modes found    | 3                                      |

The core projection/cache/aggregation machinery is careful and well tested
(golden accounting, LRU + coalescing, abort-before/abort-mid-page, source-level
regression against full-history replay). The defects below are a scope gap in
how a subagent's own compaction is handled under `current-context`, an
unsanitized-error path in the RPC handler, a coalescing edge case that can
misreport an unaborted caller as `error`, and a known (self-reported, tracked)
breaking change for two callers that still send more than 20 ids.

## Five logic questions

### 1. How does this fail silently?

No outright silent success-on-failure was found — every I/O and parse failure
either degrades to a documented `emptySessionStats`/`failedSessionStats` or is
explicitly reflected in `coverage`/`pricingCoverage`. The closest thing to
"silent" is `session-stats-reader.service.ts:224-229`: a **legacy flat-layout**
subagent file that fails to read during ownership determination is dropped
without incrementing `unreadableSubagents`, so `coverage` stays `'complete'`
and `agentSessionCount` is short by one, even though a real subagent file
existed and could not be read. The comment ("an unreadable flat file has no
provable owner") is true, but the *caller-visible* effect is a session that
reports full coverage while quietly missing a legacy subagent's tokens.

### 2. What user action produces unexpected behaviour?

- A user viewing "current context" stats for a session whose **subagent** ran
  long enough to hit its own `compact_boundary` sees the subagent's
  pre-compaction tokens/cost counted in full, while the exact same situation on
  the **parent** transcript is correctly excluded. See "Failure modes" below —
  this is architecturally supported (the ledger computes
  `currentContextStart` for every file, subagent included) but the aggregator
  never applies it to subagents (`session-usage-aggregator.ts:153-160`).
- A CLI user running `ptah session stats --ids <21+ ids>` (still unbounded in
  `apps/ptah-cli/src/cli/commands/session.ts:925`) now gets a hard
  `INVALID_PARAMS` failure for the whole call instead of stats for the first
  N sessions — self-reported in `b4-report.md`'s "Out-of-scope observations"
  but not fixed in this commit, and B4 is the batch that introduced the cap.

### 3. What input data produces a wrong answer (not an error)?

- A subagent transcript containing its own `compact_boundary` under
  `scope: 'current-context'` (see failure mode 1). The number returned is not
  an error — it is a plausible-looking, wrong total.
- A record with `type: 'user'` (or anything other than `'assistant'`/`'system'`)
  that happens to carry a `message.usage` block is counted into totals and
  `usageRecords` (`session-usage-ledger.ts:178-186`) but never into
  `messageCount` (which requires `assistant === true`). This matches the
  existing golden test (`session-usage-aggregator.spec.ts:274-289`) so it is
  deliberate, but it means `status: 'ok'` with `messageCount: 0` is a reachable,
  correct-per-spec but easy-to-misread combination for any caller that treats
  `messageCount === 0` as "nothing happened".

### 4. What happens when a dependency fails?

- `fs.stat`/`fs.readdir` failures are handled per call site with the shared
  `isMissing` shape check, degrading correctly to `[]`/`null`.
- An **unrelated caller's abort** can propagate to an innocent waiter: the
  ledger cache's `getOrProject` retries up to `MAX_COALESCE_ATTEMPTS = 3`
  when the in-flight projection it is riding on fails with another caller's
  `AbortError`, but on the fourth failure in a row it rethrows that (foreign)
  `AbortError` even though `signal?.aborted` is false for the waiting caller
  (`session-usage-ledger-cache.ts:87-103`). See failure mode 2.
- The RPC handler's own `try { … } finally { clearTimeout(timer) }`
  (`session-rpc.handlers.ts:896-906`) has no `catch`. `readStats` is designed
  to never reject for a per-session failure, and the one path it CAN reject
  through (the internal 20-id/UUID guard) is unreachable in practice because
  the same checks already ran in `SessionStatsBatchParamsSchema`. That makes
  the missing `catch` low-probability today, but it is the one place in this
  handler that does not follow the file's own pattern of converting internal
  errors to `RpcUserError` before they reach the transport — see failure mode 3.

### 5. What is missing that the requirements never mentioned?

- The plan text ("current-context: parent records after the last compact
  boundary + every subagent record") does not address subagent compaction, and
  neither the aggregator nor its golden test exercises a subagent with its own
  `compact_boundary` — this looks like an oversight rather than a deliberate
  choice, since the ledger already computes the data needed to fix it.
- No test asserts what happens when the SAME transcript file is requested
  concurrently by two independent `session:stats-batch` calls where one is
  aborted and the other is not (only same-page coalescing is tested,
  `session-stats-reader.service.spec.ts:284-304`, and even that test leaves
  `entries[1]`'s outcome unasserted).

## Failure modes

### 1. Subagent compaction ignored under `current-context`

- Trigger: a session whose subagent transcript contains its own
  `system`/`compact_boundary` record, requested with the default
  `scope: 'current-context'`.
- Symptom: the dashboard/CLI reports subagent tokens and cost from BEFORE the
  subagent's own compaction, inconsistent with how the parent's compaction is
  honoured for the exact same scope.
- Evidence: `session-usage-ledger.ts:41-44` and `:166-167` compute
  `currentContextStart` identically for parent and subagent ledgers, but
  `session-usage-aggregator.ts:153-160` only reads `parent.currentContextStart`
  — the subagent loop (`for (const subagent of input.subagents) { for (const
  record of subagent.records) count(record, false); }`) iterates from index 0
  regardless of `subagent.currentContextStart`. The golden test's `SUBAGENT`
  fixture (`session-usage-aggregator.spec.ts:105-112`) has no
  `compact_boundary`, so this path is untested.
- Current handling: none — every subagent record counts, always.
- Recommendation: either start each subagent's iteration at its own
  `currentContextStart` (symmetric with the parent), or, if "every subagent
  record" really is the intended contract (some subagents are dispatch-and-die
  and should count everything), say so explicitly in the aggregator's doc
  comment and add a golden test with a compacted subagent proving the
  choice — right now it reads as an unexercised gap, not a decision.

### 2. Coalescing exhaustion can misattribute another caller's abort

- Trigger: three or more concurrent `getOrProject` calls for the same
  `(path, size, mtime)` key, where the projections they ride on keep getting
  aborted by OTHER callers' signals (plausible when several stats pages target
  overlapping sessions, e.g. two dashboard tabs or a page reload racing the
  previous page's budget timeout).
- Symptom: a caller whose own `signal` was never aborted receives a thrown
  `AbortError` anyway, which `readOne`'s catch (`session-stats-reader.service.ts:189-197`)
  turns into `status: 'error'` for a session that had no actual problem.
- Evidence: `session-usage-ledger-cache.ts:87-103`, specifically the loop
  bound `attempt >= MAX_COALESCE_ATTEMPTS` combined with `!isAbortError(error)`
  — after 3 attempts the waiter gives up and rethrows even when
  `signal?.aborted` is `false`.
- Current handling: documented as a deliberate cap ("Attempts a waiter makes
  when other callers' projections keep aborting") but the failure mode for the
  caller on the losing end of attempt 3 is a false-negative session error, not
  a retry or a fresh `project()` call of its own.
- Recommendation: on the final attempt, start a fresh `project()` instead of
  rethrowing a foreign abort — the whole point of coalescing is throughput, not
  "give up and blame someone else's cancellation."

### 3. Unsanitized error path if `readStats` ever throws unexpectedly

- Trigger: any future change that makes `SessionStatsReaderService.readStats`
  reject outside its two known synchronous guards (id count / UUID shape), or
  an unforeseen synchronous throw from `findSessionsDirectory`.
- Symptom: the exception reaches the RPC transport with whatever message the
  internal error carried, bypassing the `RpcUserError`-with-safe-message
  pattern every other branch of this handler follows (compare
  `registerSessionStatsBatch`'s Zod-failure branch, which is careful to strip
  internal detail, at `session-rpc.handlers.ts:864-873`).
- Evidence: `session-rpc.handlers.ts:896-906` — `try { entries = await
  this.statsReader.readStats({...}) } finally { clearTimeout(timer); }`, no
  `catch`.
- Current handling: none; relies on `readStats` never actually rejecting in
  practice, which is currently true but not enforced by a test or a type.
- Recommendation: wrap the call in a `catch (error: unknown)` that logs and
  throws `RpcUserError('Failed to read session stats', 'INTERNAL_ERROR')` (or
  equivalent), matching every other handler in this file.

## Blocking issues

None.

## Serious issues

### CLI `ptah session stats --ids` breaks for >20 ids, and this commit is what breaks it

- File: `apps/ptah-cli/src/cli/commands/session.ts:919-943` (unchanged by this
  commit) against the new cap enforced at
  `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.schema.ts:24-26,38-45`.
- Scenario: `ptah session stats --ids <21 or more UUIDs>` — previously served
  (batched internally at `CONCURRENCY_LIMIT = 5`, see the pre-image at
  `git show 47bd2cf64:.../session-rpc.handlers.ts:860`), now rejected outright
  with `INVALID_PARAMS` for the whole request.
- Impact: a scripted or headless caller that worked before this commit now
  gets zero stats instead of partial stats, with no chunking fallback in this
  codebase yet.
- Fix: this is explicitly out of B4's exclusive-ownership file list
  (`apps/ptah-cli/**` is not listed in `batches.md`'s B4 section) and is
  self-reported in `b4-report.md`'s "Out-of-scope observations" — flagged here
  because it is a real, currently-shipped regression, not merely a note. It
  needs a follow-up batch (chunk the CLI's request into pages of 20) before B4
  ships to users who use the CLI stats command with more than 20 ids.

## Moderate and minor issues

- **Legacy flat subagent read failure not counted as unreadable** —
  `session-stats-reader.service.ts:207-232`, specifically the `subagentMembers`
  legacy-ownership loop: a flat `agent-*.jsonl` file that fails projection is
  silently excluded from `owned` and never increments `unreadableSubagents`,
  so `coverage` can read `'complete'` for a session that is actually missing a
  legacy subagent's data. Minor because nested-layout sessions (current SDK
  version) are unaffected.
- **Sequential (not concurrent) legacy ownership check** —
  `session-stats-reader.service.ts:218-230` awaits `page.subagentSlots.run(...)`
  inside a `for...of` loop rather than `Promise.all`-ing across the up-to-3
  slots, so legacy-layout sessions never actually use the 3-way subagent
  concurrency for ownership determination. Purely a missed-parallelism note,
  not a correctness bug (each file is still counted once).
- **`entries[1]` outcome unasserted in the mid-page abort test** —
  `session-stats-reader.service.spec.ts:296-299` checks indices 0, 2, 3 but
  not 1, even though `PARENT_FILE_CONCURRENCY = 2` means ids[0] and ids[1]
  start together and the mock aborts synchronously on ids[0]'s first call —
  ids[1]'s outcome is timing-dependent and the test does not pin it. Test gap,
  not a source defect, but it is exactly the kind of gap that would hide a
  regression in the abort-propagation path.

## Data flow

1. `session:stats-batch` → Zod parse (`SessionStatsBatchParamsSchema`) — OK,
   strict union rejects unknown keys and enforces `since <= until`.
2. Workspace authorization (`isAuthorizedWorkspace`) — OK, unchanged gate.
3. `AbortController` + 20s budget wired to `statsReader.readStats` — OK, but
   the call site has no `catch` (Serious/failure-mode 3 above).
4. `SessionStatsReaderService.readStats` — re-validates id count/shape
   (defense in depth, unreachable in this path) → resolves sessions dir → runs
   a 2-wide worker pool over `readOne`.
5. `readOne` → stats parent file, projects/caches its ledger, lists subagent
   membership (nested-first, legacy fallback), projects/caches each subagent
   ledger under a 3-wide page-shared semaphore → `aggregateSessionUsage`.
   Gap here: subagent's own `currentContextStart` is computed but discarded
   (failure mode 1).
6. `aggregateSessionUsage` — pure, well-tested scope/cost math. `totalCost`
   nullability, `pricingCoverage`, and `[since,until)` boundary semantics all
   verified against golden tests and match the documented contract exactly.
7. Handler re-attaches `cliAgents` per entry (own try/catch, degrades to `[]`)
   and returns `scope`/`since`/`until` echo — OK.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Stats-only projection, no full-history replay | COMPLETE | Source-level regression spec pins it (`session-rpc.handlers.spec.ts:1505-1515`). |
| `current-context` = parent-after-boundary + subagent records | PARTIAL | Subagent's own compaction is never applied — see failure mode 1. |
| `range` = `[since, until)`, untimestamped → partial coverage | COMPLETE | Boundary and timestamp-parse tests are exact. |
| Dedupe per `message.id`, later line replaces only its own counters | COMPLETE | Matches PR #490's per-component rule; golden test at `session-usage-ledger.ts:133-221`. |
| Cache validity on `(size, mtimeMs)`, exact-byte read on append | COMPLETE | `session-usage-ledger-cache.ts`, `projectJsonlLines`'s `byteLength`/`end` option. |
| In-flight coalescing, one caller's abort must not poison others | PARTIAL | Coalescing works for the common case, but see failure mode 2 for the exhaustion edge. |
| Failures never cached | COMPLETE | `store()` only runs after a successful `await`. |
| Subagent membership re-listed per request | COMPLETE | No directory-membership cache. |
| Concurrency bounds (2 parent / 3 subagent, page-wide) | COMPLETE | Synthetic 20-id test asserts peaks. |
| 20s abort budget inside 30s RPC timeout | COMPLETE | `STATS_PAGE_BUDGET_MS = 20_000`. |
| Zod: 20-id cap, UUID, strict union, `since <= until` | COMPLETE | `session-rpc.schema.ts`. |
| Errors returned as `RpcUserError`, no raw internal messages | PARTIAL | True for the Zod-failure branch; not enforced for a `readStats` throw (failure mode 3). |
| Cost nullable exactly when `pricingCoverage === 'none'` | COMPLETE | Verified by construction in the aggregator and by golden tests. |
| No active-provider fallback | COMPLETE | Deviation 2, correctly implemented and documented. |
| `status` correctness (never `'ok'` with partial totals on abort) | COMPLETE | Abort always routes through the outer catch to `failedSessionStats`. |
| Callers sending >20 ids | MISSING | CLI `session stats --ids` (Serious, above); dashboard is B5's job, tracked. |

Implicit requirements not addressed: symmetric compaction handling between
parent and subagent ledgers (nowhere stated, but the asymmetry is surprising
given the ledger builds the data for both); a chunking fallback for existing
>20-id callers landing in the same release as the cap.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Missing parent transcript | YES | `emptySessionStats` | — |
| Malformed JSON line | YES | `visit()` catches `JSON.parse`, skips | — |
| Malformed single counter | YES | `absentWhenMalformed` degrades per-field | — |
| Duplicate `message.id` lines | YES | Per-component replace, golden test | — |
| Untimestamped record in `range` | YES | Omitted + counted + `coverage: 'partial'` | — |
| `until` boundary (exclusive) | YES | Golden test proves `s2` at exactly `until` is excluded | — |
| Subagent with its own `compact_boundary`, scope `current-context` | NO | Counted in full regardless | Failure mode 1 |
| Page aborted before any work starts | YES | `page.signal?.aborted` short-circuit to `failedSessionStats` | — |
| Page aborted mid-projection | YES | `throwIfAborted` at each yield → outer catch → `failedSessionStats`, nothing cached | — |
| 3+ callers coalescing on a repeatedly-aborted key | PARTIAL | Retries 3 times then rethrows foreign abort | Failure mode 2 |
| >20 session ids (RPC boundary) | YES | Zod `.max(20)` → `RpcUserError` | CLI caller still sends more (Serious) |
| Legacy flat subagent file unreadable during ownership scan | PARTIAL | Excluded from ownership, not counted as unreadable | Minor, coverage under-reports |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the subagent-compaction gap (failure mode 1) is the one defect
  that produces a plausible, wrong number on the primary output of this batch
  (session cost/tokens) rather than an error path — and it is completely
  unexercised by the test suite, so it will not be caught by CI.
- What a robust implementation would add: (1) apply each subagent's own
  `currentContextStart` symmetrically with the parent, or document why not,
  with a golden test either way; (2) a `catch` around the `readStats` call in
  the RPC handler, matching this file's own pattern everywhere else; (3) let
  the ledger cache's final coalescing attempt start a fresh projection instead
  of rethrowing a foreign `AbortError`; (4) a companion fix (or an explicit,
  tracked blocking dependency) for the CLI's `--ids` chunking before this
  ships, since it is a shipped regression today, not a future nice-to-have.
