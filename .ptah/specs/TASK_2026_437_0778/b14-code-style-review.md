# Code Style Review — Batch 14 (`TASK_2026_437_0778`, C13 main-thread cost attribution)

## Summary

| Metric          | Value                                 |
| ---------------- | -------------------------------------- |
| Overall score   | 7/10                                  |
| Assessment      | APPROVE_WITH_FIXES                    |
| Blocking issues | 0                                      |
| Serious issues  | 1                                      |
| Minor issues    | 3                                      |
| Files reviewed  | 7 (4 source/doc + 3 spec, all diffed in full) |

## Five style questions

### 1. What breaks in six months?

`session-history-reader.service.ts` was already 1145 lines before this batch and is now
1198 (`wc -l`). The CLAUDE.md file-size rule says past 1000 lines is "a deliberate look,
not an alarm," and prescribes the facade rule for any split: extract a nameable
collaborator rather than keep growing the god file
(`D:\projects\ptah-437\CLAUDE.md:168`). This batch had a working example of exactly that
pattern sitting next to it in the same task — `slow-statement-timing.ts` is a full
collaborator with its own contract doc, its own spec file, and a clean `withX(...)`
factory (`libs/backend/persistence-sqlite/src/lib/slow-statement-timing.ts:1-26,332-341`)
— and did not apply it to the agent-sdk half of the same C13 work. The timing state
(`slowReadWarnMs`, `slowReadLoggedAt`) and the `reportSlowHistoryRead` method were added
directly onto `SessionHistoryReaderService`
(`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:127-133,366-401`).
The next engineer who needs to touch resume timing again has one more reason to treat
this file as the place logging code lives, and the file keeps compounding.

### 2. What would a new team member misread?

Nothing structurally — both timing seams read cleanly in isolation, doc comments carry
the "why" (rate window, rethrow contract, phase-split rationale), and the log message
formats (`[SQLite] slow statement`, `[SessionHistoryReader] slow history read`) match
the `[RPC] slow handler` / `[MCP] slow tool` convention exactly, including the
`warn`-level, structured-context, forwarded-result contract
(`libs/backend/vscode-core/src/messaging/rpc-handler.ts:213,251`). A reader who diffs
`session-history-reader.service.spec.ts` will be confused by the amount of unrelated
reformatting noise mixed into the diff (see Minor issues) before finding the actual new
`describe('slow history read log', …)` block at line 1312.

### 3. What does this cost to maintain?

Low for the SQLite side — `withSlowStatementTiming` is a pure, well-isolated Proxy
wrapper with an exhaustive spec (`slow-statement-timing.spec.ts`, 347 lines covering
forwarding, exception passthrough, iterator accumulation, rate limiting, and the
brand-check hazard). Moderate for the agent-sdk side: the timing fields live as instance
state on an 1198-line class alongside compaction, pricing, boundary tracking and replay
concerns, so any future refactor of that file has to carry the timing logic along rather
than being able to route around a self-contained module.

### 4. Where is this inconsistent with the rest of the repository?

Two places:

- The extraction asymmetry described in Q1 — one half of C13 gets a collaborator file
  with its own CLAUDE.md-documented contract, the other gets inlined into the file the
  repo's own size rule already flags for a deliberate look.
- `libs/backend/persistence-sqlite/CLAUDE.md`'s "Internal Structure" section
  (lines 33-98) lists every notable file under `src/lib/` — `sqlite-connection.service.ts`,
  `migration-runner.ts`, `backup.service.ts`, `sqlite-errors.ts`, `embedder/`, `integrity/`
  — but was not updated to add `slow-statement-timing.ts`, even though the file is a new,
  non-trivial module in that same directory doing exactly the kind of thing the section
  exists to catalogue. The env-var documentation correctly landed in
  `vscode-core/CLAUDE.md` (matching where `readMsEnv`/`roundMs`/the rest of the env table
  already live), but the module inventory in the owning lib's own doc was not kept in
  sync.

### 5. What would you have done differently, and why is that better rather than merely other?

Extract a small `session-history-slow-read-reporter.ts` (or fold the timing concern into
an existing helpers file under `libs/backend/agent-sdk/src/lib/helpers/`) mirroring
`slow-statement-timing.ts`'s shape: a constructor taking `{ logger, thresholdMs, now? }`,
a `report(sessionId, timing)` method, injected into `SessionHistoryReaderService` as a
field. That keeps the rate-limit table and the log line assembled in one place with one
spec file, keeps the growing service's constructor and field list from absorbing another
concern, and treats both halves of a single component (C13) the same way instead of
picking a different pattern per file. It is better than the current shape specifically
because the repository already wrote down why (the facade rule, `CLAUDE.md:168`) and
already demonstrated it inside this very batch — the inconsistency isn't stylistic
preference, it's not following the plan's own established seam.

## Blocking issues

None.

## Serious issues

### C13's two files use different extraction patterns for the same kind of work

- File: `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:127-133,366-401`
  vs. `libs/backend/persistence-sqlite/src/lib/slow-statement-timing.ts` (whole file)
- Problem: the SQLite side of C13 extracted a documented, independently-tested
  collaborator (`withSlowStatementTiming` + `SlowStatementReporter`); the agent-sdk side
  added the equivalent rate-limited warn-on-threshold logic as private fields and a
  private method directly on `SessionHistoryReaderService`, which was already past the
  repo's 1000-line "deliberate look" mark (1145 → 1198 lines).
- Tradeoff: keeping it inline saves one file and one DI wire-up today, but grows the
  file the repo's own size rule already flags, and it means the same C13 measurement
  concept is represented two different ways six months from now when someone greps for
  "how does Ptah do slow-call attribution."
- Recommendation: extract the timing/rate-limit logic (fields `slowReadWarnMs`,
  `slowReadLoggedAt`, method `reportSlowHistoryRead`) into a small collaborator class
  under `libs/backend/agent-sdk/src/lib/helpers/`, injected via the facade rule, with its
  own spec. Not blocking — the current code is correct and well-tested — but it is the
  gap between a 7 and an 8+ on this batch.

## Minor issues

- `libs/backend/persistence-sqlite/CLAUDE.md` "Internal Structure" (lines 33-98) does not
  list the new `slow-statement-timing.ts`, unlike every other notable file in
  `src/lib/`. Low cost to fix, but it is the one doc this batch touched two of three
  siblings for and skipped.
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` diff carries a
  large amount of unrelated Prettier reformatting (e.g. lines 211-1249, breaking
  previously single-line `mockResolvedValue('/sessions/dir')` calls across multiple
  lines) mixed into the same commit as the new `describe('slow history read log', …)`
  block. Consistent with `.lintstagedrc.mjs` running `nx format:write` on stage
  (`D:\projects\ptah-437\CLAUDE.md:197-198`), so likely unavoidable pre-commit behavior
  rather than an authoring choice, but it makes the actual functional diff harder to
  review at a glance.
- `HistoryReadTiming.durationMs` in `session-history-reader.service.ts:76-85` duplicates
  information the caller already has (`performance.now() - startedAt` is both passed in
  and separately derivable from `readMs + projectMs + pricingMs`, though the two are not
  guaranteed to sum exactly since `pricingMs` overlaps `projectMs`'s measurement window
  at lines 303-309). Not a bug — the log line is measurement-only and pricing genuinely
  runs inside the "projection" window — but a one-line comment noting that
  `readMs + projectMs ≠ durationMs` exactly would save the next reader from treating the
  three numbers as a clean partition.

## File-by-file

### `libs/backend/persistence-sqlite/src/lib/slow-statement-timing.ts` (new)

Score 9/10 — 0B, 0S, 0M. Clean Proxy-based wrapper with a documented contract
(never alters result/exception, fast path is two clock reads, rate-limited logging),
correctly forwards untimed members bound to the real receiver to satisfy
better-sqlite3's native brand check (`:23-25`, `:373-376`). Naming, JSDoc density and
test coverage are the standard this repo's diagnostics code sets elsewhere
(`event-loop-monitor.ts`, `rpc-handler.ts`).

### `libs/backend/persistence-sqlite/src/lib/slow-statement-timing.spec.ts` (new)

Score 9/10 — 0B, 0S, 0M. Manual-clock driven, exact assertions on thresholds and the
rate window, exercises the brand-check hazard with `#private` fields on the fakes
(`:33-34,69-70`), covers the throwing-logger and throwing-statement paths. No native
`better-sqlite3` dependency, so nothing here needed a Jest-skip guard.

### `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts`

Score 8/10 — 0B, 0S, 1M (the CLAUDE.md doc gap above is attributed to the lib doc, not
this file). Wiring is minimal and correct: one `withSlowStatementTiming(...)` call at
the single point the database is created (`:207-220`), threshold sourced through
`readMsEnv` exactly like every other `PTAH_*_WARN_MS` var in the repo. No behavior
change to callers.

### `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.spec.ts`

Score 8/10 — 0B, 0S, 0M. Two focused new tests (crosses threshold + logs; stays silent
under it) at `:552-618`, using the existing `FakeSqliteDatabase`/`createMockLogger`
seams rather than inventing new fixtures.

### `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`

Score 6/10 — 0B, 1S (extraction asymmetry, above), 1M (the `durationMs` partition
comment). Logging format, `performance.now()` timing mechanism and rate-limit shape are
correct and consistent with the repo's established diagnostics pattern; the method is
correctly kept `private` (`:366`). The cost is entirely about where the code lives, not
what it does.

### `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts`

Score 7/10 — 0B, 0S, 1M (reformatting noise, above). New `describe('slow history read
log', …)` block (`:1312-1418`) is well-structured: manual `performance.now` mock via
`jest.spyOn`, per-session rate-limit test, env-override test. Matches the quality bar of
`slow-statement-timing.spec.ts`.

### `libs/backend/vscode-core/CLAUDE.md`

Score 9/10 — 0B, 0S, 0M. Env table addition (`PTAH_SQLITE_SLOW_WARN_MS`,
`PTAH_HISTORY_SLOW_WARN_MS`) lands in the one place the repo already keeps this table,
matching the existing row format exactly, and the added prose explains the log format
and rate-limit contract for both new lines without duplicating what the source-level
JSDoc already says.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Env-var thresholds documented in `vscode-core/CLAUDE.md` env table | PASS | `libs/backend/vscode-core/CLAUDE.md:53-61` |
| Env vars read via `readMsEnv`, not raw `process.env[...]` parsing | PASS | `sqlite-connection.service.ts:214`, `session-history-reader.service.ts:127-129` |
| Slow-call log message format matches `[RPC] slow handler` / `[MCP] slow tool` | PASS | `slow-statement-timing.ts:158`, `session-history-reader.service.ts:390` vs. `rpc-handler.ts:251` |
| `catch (error: unknown)` | PASS | no new untyped catches introduced |
| File-size facade rule applied when a split is warranted | FAIL (one of two files) | `session-history-reader.service.ts` (1198 lines) vs. `slow-statement-timing.ts` extraction |
| Lib CLAUDE.md "Internal Structure" kept in sync with new files | FAIL | `persistence-sqlite/CLAUDE.md` missing `slow-statement-timing.ts` |
| `catch (error: unknown)` narrowing before `.message` | PASS | `classifyOpenFailure` etc., pre-existing, unaffected |
| New DI wiring where needed | N/A | no new DI tokens in this batch |

## Maintenance debt

- Introduced: one well-isolated collaborator (`slow-statement-timing.ts`) with its own
  spec; ~70 lines of timing/logging logic added directly to an already-oversized service
  class.
- Retired: nothing.
- Net: slightly negative for `session-history-reader.service.ts` (it was already past
  the size threshold and grew further without the facade extraction the repo's own rule
  recommends); neutral-to-positive for `persistence-sqlite` (new logic is fully
  isolated, but the lib's own doc index now has one undocumented file).

## Verdict

- Recommendation: REVISE (non-blocking) — the code is correct, well-tested and safe to
  ship as-is; the fixes below raise consistency, not correctness.
- Confidence: HIGH
- Key concern: the same C13 change was implemented with two different structural
  patterns across its two files, and the repo's own facade-rule guidance points at the
  pattern this batch didn't use for the file that needed it.
- What a 10/10 version would do differently: (1) extract the agent-sdk timing logic into
  a small collaborator mirroring `slow-statement-timing.ts`'s shape, injected rather than
  inlined; (2) add `slow-statement-timing.ts` to `persistence-sqlite/CLAUDE.md`'s
  Internal Structure list; (3) a one-line comment noting `readMs + projectMs` is not a
  strict partition of `durationMs` because pricing hydration is measured inside the
  projection window.
