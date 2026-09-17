# Code Logic Review — Batch 4 — `TASK_2026_461_639c`

Reviewer: code-logic-reviewer (Ollama Cloud lane). Scope: untracked
`libs/backend/skill-synthesis/src/lib/cleanup/` (6 files) plus the tracked diffs on
`queue/stage-handlers.service.ts` and `skill-synthesis.stage-handlers.spec.ts`. All
other uncommitted files belong to Batch 3 and were not reviewed.

I read every Batch 4 file in full, the migration, the plan (`implementation-plan.md`
components 4b/4c/4d/4f, D4a, D6a, R1, R7), `batches.md` tasks 4.1-4.4, the batch
report, and the supporting production code the cleanup depends on
(`TrajectoryExtractor`, `SessionVerdictStore`, `SkillQueueStore.findBySessionStage`,
`ForegroundActivityTracker`, drain config keys). I re-ran the three cleanup suites
myself on this worktree (after confirming no jest/nx executor was alive):
**14/14 passed** under `node:sqlite`; the report's better-sqlite3 run is consistent
with the same code paths and was not repeated.

## Verdict

**CHANGES_REQUESTED — 7/10**

The core irreversible path is correct: the predicate keeps every candidate any
verdict or any evidence protects, the reject UPDATE is guarded against races, the
cursor advances only after a committed batch, and a crash repeats at most one batch
harmlessly. The specs are not vacuous — real migrations through 0045, assertions
that reach the rows, mutation evidence pasted, second-run `skipped: complete`
asserted, tracker invocation survives. One major defect sits on the irreversible
path itself: a transient per-candidate error is converted into a permanent
rejection, and the plan text that ratified the marker did not ratify that outcome
for a candidate that a verdict actually protects.

## Findings

### 1. Per-candidate catch converts a transient store error into a terminal rejection

- Severity: **major**
- Evidence: `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts:169-185`
- Scenario: `evaluateCandidate` starts with `this.verdicts.findBySession(sessionId)`
  (`:231`) and `this.queue.findBySessionStage` (`:241`) — both are DB reads on the
  same connection. This repository explicitly supports two hosts sharing
  `~/.ptah/state/ptah.sqlite` (pinned in the queue-payload CLAUDE.md bullet). Host B
  holds a write lock; host A's verdict lookup throws `SQLITE_BUSY`; the catch at
  `:171-179` assigns `reject-unreadable`; the candidate is rejected with reason
  `backlog-cleanup: transcript unreadable and no verdict` — **even though a verdict
  row exists and protects it**. `rejected` is terminal, so the data is lost for
  good. A defect in the extractor throws into the same funnel.
- Current handling: the failure is honest (warn + counter + distinct reason), but
  the outcome is wrong for a candidate that was never actually examined.
- Fix: on catch, **defer** the candidate — count it as examined (or in a separate
  counter), do NOT push a rejection, and still advance the cursor. The candidate
  stays `candidate`; nothing re-examines it in this cleanup pass, but no
  irreversible decision is made on evidence that was never read. Alternatively,
  narrow the try to the `extract` call only, so a verdict-queue failure surfaces
  through the whole-run catch as `failed` instead of a rejection.
- Note: `batches.md` XB2 specifies the marker text "counted in
  rejected_transcript_unreadable or last_reason", which this implements. But D4a's
  rationale ("nothing can ever produce evidence for it") holds only for a
  permanently unreadable transcript — it does not hold for a transient lock error
  on the verdict row. The requirement itself leaves the real case unspecified; the
  implementation realizes it as data loss.

### 2. A transient transcript read error is indistinguishable from a missing transcript

- Severity: **minor** (residual risk of ratified D4a)
- Evidence: `libs/backend/skill-synthesis/src/lib/trajectory-extractor.ts`
  (`readJsonlMessages` try/catch → `null` + warn on ANY error) and
  `skill-backlog-cleanup.service.ts:250` (`if (!trajectory) continue`).
- Scenario: on Windows, an antivirus or backup tool holds a short-lived lock on
  `<session>.jsonl`; the read throws `EBUSY`; the extractor returns `null`; a
  candidate with no verdict is rejected as "unreadable" — permanently, for a file
  that was readable one second later.
- Current handling: this is exactly the D4a option the team ratified ("unreadable
  transcript keeps the candidate" was rejected), so the implementation matches the
  decision record. The residual risk is real but was accepted and is scheduled for
  measurement (Batch 7 byte-copy comparison before merge).
- Fix (recommendation, not a batch blocker): have `readJsonlMessages` distinguish
  `ENOENT` (permanently missing → reject) from other I/O errors (transient → defer,
  as in finding 1). If Batch 7's measurement shows no real-world occurrences, close
  this as accepted risk.

### 3. The fake-invocation delete loop has no stop or budget check

- Severity: **minor**
- Evidence: `skill-backlog-cleanup.service.ts:270-276` (`for (;;) { ... }`).
- Scenario: an unexpectedly large `context_id IS NOT NULL` backlog runs past the
  60-second wall budget and ignores an abort signal, because `stopReason` is not
  consulted inside the loop. The 200-candidate cap does not bound it (it runs
  after pages are exhausted).
- Current handling: each 500-row page is its own committed transaction and
  `finished_at` is written only after the loop completes (`:282-290`), so a crash
  resumes cleanly and no state lies. The defect is bounded run-away work, not
  correctness.
- Fix: check `stopReason` inside the loop; on stop, return a `partial` report
  without writing `finished_at`. The next run re-pages (empty), then resumes the
  delete from the same cursor.

### 4. Malformed or empty `source_session_ids` rejects with an imprecise reason and no warning

- Severity: **minor**
- Evidence: `skill-backlog-cleanup.store.ts:233-244` (`parseSessionIds` → `[]`,
  silent, `optional-capability` marker) and `skill-backlog-cleanup.service.ts:261`
  (empty list → `readable` stays false → `reject-unreadable`).
- Scenario: a candidate row with corrupt JSON or `[]` in `source_session_ids` is
  rejected as "transcript unreadable and no verdict". The reason string
  misdescribes the actual cause ("no sessions listed"), and nothing logs it — the
  only trace is the reason on the rejected row itself.
- Current handling: D4a's letter ("no verdict + nothing readable") does cover the
  case, and the rejection IS recorded on the row, so it is auditable after the
  fact.
- Fix: warn once per run when `parseSessionIds` degrades (or count it in a separate
  counter) so a corrupt row is visible at diagnosis time; alternatively rename the
  reason for the no-sessions case. Lowest-priority change in this list.

### 5. AC9 coverage gaps: mid-run abort and resume-after-partial are not tested

- Severity: **minor**
- Evidence: `skill-backlog-cleanup.service.spec.ts:281-294`.
- Scenario: `batches.md` task 4.2 AC9 demands "wall budget -> partial and the next
  run resumes from the cursor; abort -> partial". The only abort test is the
  pre-run gate (`:154-165`, returns `skipped: 'aborted'`). No test aborts the
  signal between candidates to produce `status: 'partial', reason: 'aborted'`
  (service.ts:162-167 + 213-221). The wall-budget test's title says "resumes from
  the committed cursor", but its body never runs a second run — the claim is
  untested. The 200-candidate row cap (`row-budget`, service.ts:141, 223) has no
  test at all.
- Fix: add (a) a mid-run abort test asserting `partial` + `aborted` + committed
  rejections; (b) a two-run wall-budget test asserting the second run pages from
  the committed cursor; (c) a row-budget test with >200 candidates. I reviewed the
  logic by reading it and it is correct; these are coverage gaps, not defects.

### 6. A `workspace_root` of `''` bypasses the queue-row transcript fallback

- Severity: **minor** (unreachable from today's capture path)
- Evidence: `skill-backlog-cleanup.service.ts:242` —
  `candidate.workspaceRoot ?? queued?.workspaceRoot` keeps `''` (nullish
  coalescing treats only `null`/`undefined` as missing), so `if (!workspaceRoot)
  continue` skips the session without ever consulting the queue row.
- Scenario: `''` is the reserved cross-project marker (never written by the capture
  path, per the TASK_2026_322 rules), so this cannot occur in current data. If a
  future writer emits `''`, that candidate's sessions would all be skipped and the
  candidate would trend to rejection without a transcript read.
- Fix: treat only `null` as unknown —
  `candidate.workspaceRoot !== null ? candidate.workspaceRoot : queued?.workspaceRoot`.

### 7. A `failed` report zeroes counters that the tick may have committed

- Severity: **minor**
- Evidence: `skill-backlog-cleanup.service.ts:121-127` — the whole-run catch returns
  `...emptyCounters()` even when earlier pages in the same tick committed
  rejections and cursor progress.
- Scenario: page 1 rejects 50 candidates and commits; `writeProgress` for page 2
  throws; the caller sees `failed` with `rejectedNoEvidence: 0` while the state
  row correctly holds 50. The cron summary (Batch 5) under-reports for that tick.
- Fix: read the state row in the catch and report its cumulative counters, or
  accept the cosmetic gap and document it. Not blocking.

## Five logic questions

1. **Silent failure?** The one silent degradation is `parseSessionIds`
   (finding 4) — corrupt input becomes `[]` with no log, and the downstream
   rejection reason misstates the cause. Everything else that fails is either
   warned, counted, or written to `last_reason` on the state row. The degradation
   markers are honest: the per-candidate catch really does count
   `rejectedTranscriptUnreadable` and warn (`:172-179`); the whole-run catch really
   does return `failed` and warn (`:115-127`); the store marker claims
   `optional-capability`, which is accurate for a tolerated parse fallback.
2. **Unexpected user action?** A user promoting a candidate mid-run (via the
   Skills tab) while the cleanup examines it: the paging read saw `status='candidate'`,
   the guarded UPDATE leaves the promoted row untouched (`store.ts:147-150`,
   pinned by the store spec's concurrent-promote case). A user pausing on battery
   or typing only affects whole ticks via gates. No user action produces a wrong
   disposition.
3. **Wrong answer from input data?** Three inputs can produce a wrong outcome
   rather than an error: a transient file lock (finding 2), a transient DB lock
   (finding 1), and corrupt `source_session_ids` (finding 4). All three end in the
   same terminal rejection.
4. **Dependency failure?** The DB being unavailable before the state read
   degrades to a `failed` report (fail-open, correct). The DB failing **mid-run**
   is the dangerous case — it lands in the per-candidate catch (finding 1) or the
   whole-run catch (state counters stay correct, report undercounts — finding 7).
   The extractor failing degrades per finding 2. No failure path throws out of
   `run()`: I traced every `await` and store call.
5. **Missing from requirements?** The plan never specified behaviour for the
   fake-invocation delete loop vs. the wall budget (finding 3), never specified a
   log for corrupt session lists (finding 4), and AC9's abort/resume clauses were
   never pinned by tests (finding 5). The `''` workspace edge (finding 6) is a
   contract left implicit by TASK_2026_322's three-valued column.

## Transaction, cursor and state-row audit (checks 3-4)

- `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` via `db.exec` throughout
  (`store.ts:267-277`); no `db.transaction`; no nested transactions —
  `writeProgress` and `readState` are unwrapped, and `initialize` /
  `rejectBatch` / `deleteFakeInvocations` are never called inside each other.
- Cursor advances only after `rejectBatch` commits and `writeProgress` succeeds
  (`service.ts:200-210`). Crash between the two: rejections are committed, the
  cursor is stale, the next run re-pages — rejected rows are excluded by the
  paging predicate, kept rows re-examine harmlessly. At most one batch repeats.
- Every named parameter is bound on every path — verified per statement in the
  store, including the `initialize` INSERT fallback (which the store spec
  exercises, because migration 0045 ships no seed row: the first `initialize` takes
  the UPDATE-changes-0 → INSERT path).
- NOT NULL respected: `version`, `cutoff_created_at`, `started_at` are bound on
  both the UPDATE-reset and INSERT paths of `initialize` (`store.ts:74-105`);
  `writeProgress` updates in place and never touches them. The reason column is
  `last_reason` everywhere; `last_error` appears nowhere.
- The `complete` gate (`service.ts:80-85`) requires `version` match AND
  `finishedAt !== null`, so a finished run cannot re-run and an unfinished one is
  never skipped; a version bump re-initializes (resets) as the plan intends.

## Predicate audit (checks 1-2)

- Reject requires: NO session has a verdict row (degraded or not) AND no session
  yields a readable transcript with work evidence. Any verdict keeps
  (`:230-237`, degraded counted separately); any session's evidence keeps
  (`:240-259`); several sessions where only one has evidence keeps. Candidates at
  or after the cutoff are never paged (`created_at < @cutoff`, strict, boundary
  pinned by the store spec). Only `status='candidate'` rows change (guard in the
  UPDATE).
- Transcript location: candidate `workspaceRoot` first, else the `prefilter` queue
  row's `workspace_root` + `transcript_path` (`:241-248`), pinned by both the
  service spec (queue fallback case) and the integration spec (`fallback`
  candidate with NULL root). "Unreadable" vs "read but no evidence" is separated
  by the `readable` flag (`:251, :261`) into the two distinct reasons, both
  asserted end-to-end in the integration spec.

## Gate-stage diff audit (check 7)

`gateTarget` now returns the `'rejected'` sentinel; all three call sites
(`stage-handlers.service.ts:522, 600, 729`) check it BEFORE the null-candidate
check and before any gate dispatch, returning
`{outcome:'skipped', reason:'gate-candidate-rejected'}` — distinct from every
no-candidate reason. `grep` confirms exactly three callers exist, all covered.
Promoted candidates remain gradeable (spec positive control asserts the judge
panel is called). AC11's mutation evidence matches the code I read.

## Spec vacuity audit (check 9)

Not vacuous. Both specs resolve a real opener (`resolveOpener`; `it.skip` only
when no binding exists — the report's runs show 0 skipped on both bindings) and
apply real migrations (store spec: 3, 11, 32-36, 40, 45; integration spec: every
migration with a SQL body through version 45). Assertions query the actual rows
(`SELECT` on candidates and invocations after the run) and the actual state row.
I re-ran the suites myself: 14/14. Tasks 4.1-4.4 are all done; the only silently
soft spot is AC9's untested abort/resume clauses (finding 5), which is a coverage
gap, not undone work.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 4.1 store: paging, guard, rollback, paged delete | COMPLETE | none |
| 4.2 service: gates, caps, D4a predicate, report union, fail-open | COMPLETE | major: transient error → terminal reject (finding 1) |
| 4.2 AC9: abort → partial, resume from cursor | PARTIAL | untested clauses (finding 5) |
| 4.3 integration: all dispositions, counters exact, second run complete | COMPLETE | none |
| 4.4 gate stages skip rejected, promoted still graded | COMPLETE | none |
| XB1/XB2/XB3/XB4 constraints | COMPLETE | markers honest, both bindings, no DI edit |

## Verdict rationale

- Recommendation: **REVISE** — approve after finding 1 is fixed (defer-on-catch,
  a small change confined to `execute`'s per-candidate loop) or after the team
  explicitly re-ratifies the transient-error-to-reject behaviour with D4a's
  rationale on record. Findings 2-7 are minor and can ride along or go to Batch 7.
- Confidence: **HIGH** — every claim above is from files read in full, and the
  passing suites were re-run by the reviewer.
- Top risk: one `SQLITE_BUSY` during the verdict lookup permanently rejects a
  verdict-protected candidate on a two-host shared database.
- What a robust implementation would add: defer-on-catch for per-candidate errors;
  ENOENT-vs-transient split in the extractor; a stop check inside the delete loop;
  the three missing AC9 tests.