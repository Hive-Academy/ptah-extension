# Code Logic Review — `TASK_2026_440_834c` Batch 4 Fixes (Task 4.3)

Scope reviewed: `libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts`,
`observation-retention.store.spec.ts`, `libs/backend/memory-curator/src/lib/diagnostics.service.ts`
(comment only). Read in full against the prior review's two findings. Ran
`npx nx run-many -t test -p @ptah-extension/memory-curator --parallel=1` myself: 35/35 executed
suites pass, 549 passed, 59 skipped (pre-existing native-gated suites, unchanged count class from
the prior run). No source modified by this review.

## Summary

| Metric              | Value                  |
| -------------------- | ---------------------- |
| Overall score         | 7/10                    |
| Assessment             | APPROVED WITH FIXES     |
| Blocking issues        | 0                       |
| Serious issues         | 0                       |
| Moderate issues        | 1 (new, see Q2)         |
| Failure modes found    | 0 new                   |

## Finding-by-finding

### 1. SERIOUS — `PENDING_BYTES_SQL` unbounded per-poll cost — CLOSED

- Fix: `observation-retention.store.ts:104` exports `PENDING_BYTES_MAX_ROWS = 5_000` with a
  docblock (`:99-103`) naming the mechanism ("payload columns are absent from
  `idx_obs_queue_drain`, so every matching row requires a base-table lookup") and the measured
  cost ("~26 ms for ~5k pending rows").
- Gate: `readLiveStorage` (`:452-474`) now runs `PENDING_BYTES_SQL` only when
  `pending !== null && pending.rows <= PENDING_BYTES_MAX_ROWS` (`:462`). Above the bound,
  `pendingBytes` is set to `null` and a stable token
  `` `pendingBytes: not measured above ${PENDING_BYTES_MAX_ROWS} pending rows` `` is pushed to
  `readErrors` (`:469-473`) without calling the `read()` wrapper, so no `logger.warn` fires for
  this expected, policy-driven skip.
- The other three live reads (`pending` summary, `stuckEligibleRows`, `quarantineLedgerRows`)
  are unchanged in shape and still run unconditionally (`:475-486`).
- Specs: `observation-retention.store.spec.ts:549-576` seeds 5,001 pending rows, asserts
  `pendingRows === 5001`, `pendingBytes === null`, `readErrors` equals exactly
  `['pendingBytes: not measured above 5000 pending rows']`, **zero** issued statements matching
  `/octet_length/i`, and `logger.warn` not called. `:578-601` seeds exactly 5,000 rows with a
  3-byte payload per row and asserts `pendingRows === 5000`, `pendingBytes === 15_000` (5000 × 3),
  the skip token absent, and exactly one `octet_length` statement issued. I re-ran both; they pass
  against the current code. I hand-verified they would fail on revert: reverting the gate at `:462`
  to the pre-fix unconditional call would make the 5,001-row test's `pendingBytes` a non-null
  number and its `octet_length` assertion non-empty (both explicit failures), and the boundary
  test only exists to prove the `<=` comparison is not `<` (an off-by-one revert to `<` would fail
  `pendingBytes === 15_000`, since row 5000 would be silently excluded and the sum would be
  `14_997`). Both specs are therefore load-bearing against the two most likely regressions
  (removing the bound, and shifting it by one).
- Verdict: **CLOSED**. The unbounded cost is gone; the new cost ceiling (~26 ms at the 5,000-row
  bound, index-only below it) is documented in the same file the other measured numbers already
  live in (766 ms, 72 ms/1.4 s), matching this store's own convention.

### 2. Orchestrator concern — misleading skip token when the prerequisite read itself failed

**The concern is valid. This is a real, if narrow, defect.**

- Evidence: `readLiveStorage`'s `pending` read (`:452-460`) is itself wrapped by the `read()`
  helper (`:439-450`), which on failure appends `` `pending: ${errorText(error)}` `` to
  `readErrors` and returns `null`. The very next block (`:461-474`) branches on
  `pending !== null && pending.rows <= PENDING_BYTES_MAX_ROWS`. When `pending === null` (the
  prerequisite failed — connection hiccup, corrupt index, whatever `pending`'s `read()` caught),
  the `else` branch still runs and pushes the **same** token used for the "backlog too large"
  case: `` `pendingBytes: not measured above ${PENDING_BYTES_MAX_ROWS} pending rows` ``. That
  sentence is false in this branch — the reason `pendingBytes` was not measured is that the row
  count is *unknown*, not that it exceeds 5,000. `readErrors` in this case ends up carrying two
  entries: an accurate `pending: <real error>` and a fabricated `pendingBytes: not measured above
  5000 pending rows` that implies a specific, wrong, more alarming diagnosis (large backlog)
  next to the true one (a read failure). No spec exercises this branch — every existing
  `readLiveStorage` failure spec (`:603-627`) drops `observation_quarantine`, which only fails the
  *last* read (`quarantineLedger`), never the `pending` read that gates this branch. The path is
  real but untested.
- Is it misleading enough to fix: **yes**. This is a diagnostics surface whose whole purpose is to
  tell an operator or an on-call engineer why a number is missing; conflating "we chose not to
  look" with "we tried and failed" sends someone chasing the wrong hypothesis (a large backlog)
  when the actual problem (a broken read) is sitting one array entry away, correctly reported, but
  now easy to misread as a duplicate or a side-effect of the fabricated one rather than the real
  cause.
- Severity: **Moderate**. Not Serious/Blocking — nothing is lost, corrupted, or silently
  succeeded; the *behaviour* (skip the byte read when the row count is unknown) is correct and
  safe, and the accurate `pending: <error>` entry is still present alongside it. It is a
  correctness defect in an error *message*, not in program state or control flow.
- Recommended fix: distinguish the two cases with a different token, e.g.
  `` `pendingBytes: unknown (pending row count unavailable)` `` when `pending === null`, and keep
  the existing "not measured above N pending rows" token only for the `pending.rows >
  PENDING_BYTES_MAX_ROWS` case. A minimal alternative that avoids inventing a second string: when
  `pending === null`, push nothing extra — the `pending: <error>` entry already explains why every
  dependent field (`pendingRows`, `oldestPendingAt`, `pendingBytes`) is null, so an additional
  `pendingBytes` line adds noise without adding information. Either fix is small; add a spec that
  forces the `pending` read to throw (e.g. drop a column `PENDING_SUMMARY_SQL` needs, or inject a
  connection that throws only on the first `.get()`) and asserts `readErrors` does **not** contain
  the "not measured above" token in that case.

### 3. Remaining per-poll cost — now bounded

- `PENDING_SUMMARY_SQL` (`:95-97`) and `STUCK_ELIGIBLE_COUNT_SQL` (`:113-115`) both run
  `WHERE processed_at IS NULL [AND captured_at < @cutoff]` against `idx_obs_queue_drain`, whose key
  is exactly `(processed_at, captured_at)`. Every column each query reads (`COUNT(*)`,
  `MIN(captured_at)`, the predicate columns) is in the index, so both are index-only scans with no
  base-table row lookup — the same class of cheap query the pre-fix code already relied on for
  these two, unchanged by this batch.
- `LEDGER_COUNT_SQL` (`:117`) is an unfiltered `COUNT(*)` over `observation_quarantine`, but that
  table's size is bounded by policy: `MemoryRetentionService`'s `pruneLedger` step
  (`memory-retention.service.ts:411-417`, called once per retention run) caps it at
  `limits.ledgerMaxRows`. Not literally index-only, but bounded by a run-time-enforced ceiling
  rather than by unbounded backlog growth — pre-existing, unchanged by this batch.
- `PENDING_BYTES_SQL`, the one query that combined "scales with backlog" and "needs a base-table
  lookup per row," is now capped at 5,000 rows (~26 ms measured) per finding 1.
- **Yes** — the worst-case per-poll cost is now bounded. The three unconditional reads are
  index-only or policy-capped, and the one previously-unbounded read now has an explicit,
  measured, tested ceiling.

### 4. MODERATE — diagnostics invariant comment — CLOSED

- `diagnostics.service.ts:61`: `// Required storage relies on the MemoryRetentionService
  never-throws contract pinned by its degradation specs.` immediately above
  `storage: this.retention.storageHealth()` (`:62`).
- Accuracy check: `storageHealth()` (`memory-retention.service.ts:199-257`) wraps its own
  `readState()` call in a local `try/catch` (`:213-218`), delegates to `readSettings()` which
  itself catches and degrades to `MEMORY_RETENTION_DEFAULTS` (`:645-654`), and to
  `reclaimer.readPageStats()` which is documented and implemented as never-throwing
  (`sqlite-page-reclaimer.ts:82-97`, "never throws" in its own docblock), and to
  `store.readLiveStorage()`, itself documented "Never throws" (`observation-retention.store.ts:
  419-422`) and exercised by an explicit spec, `'never throws: a closed connection yields nulls
  and a read error'` (`:603-617`). The comment's claim is accurate and each part of it is backed
  by a real spec, not just a docstring.
- No fallback DTO or local `try/catch` was added at the call site, matching the report — this is a
  documentation fix only, and correctly so: adding a second defensive layer around an already
  fully-guarded, spec-pinned callee would be redundant, not safer.
- Verdict: **CLOSED**.

## New defects

None found beyond finding 2 above (which is the orchestrator's own concern, confirmed and
scoped). No `TODO`/`STUB`/`FIXME`/placeholder markers in the diff (`git diff` grep, clean). Only
the three authorized files were touched; `git diff --stat` shows
`observation-retention.store.ts` (+27/-6), `observation-retention.store.spec.ts` (+55/-0),
`diagnostics.service.ts` (+5/-0) — consistent with the report and with no stray edits into Batch 5
territory (`thoth-runtime`, `cli-engine` untouched).

## Verdict

- Recommendation: APPROVED WITH FIXES (superseded — see Round 2 below)
- Confidence: HIGH
- Top risk: the misleading skip token when the `pending` prerequisite read itself fails (finding
  2) — narrow, untested, and Moderate severity; does not block merge but should be fixed (a
  one-line conditional or token change, per the recommendation above) with a regression spec
  before this ships, since it is exactly the kind of thing nobody notices until an on-call engineer
  is misled by it during an actual incident.
- What a robust implementation would add: (1) split the skip token by cause (`pending === null`
  vs. `pending.rows > PENDING_BYTES_MAX_ROWS`), or suppress the redundant `pendingBytes` entry
  when `pending` already failed; (2) a spec that forces the `pending` read to throw and asserts
  `readErrors` reflects the real cause without the fabricated "not measured above N" token.

## Round 2

Scope: `observation-retention.store.ts:461-475` and the new spec in
`observation-retention.store.spec.ts:603-618`, fixing the Round-1 Moderate finding (misleading
skip token when the `pending` prerequisite read itself fails). Read in full, not from the report
alone. Ran `npx nx run-many -t test -p @ptah-extension/memory-curator --parallel=1` myself: 35/35
executed suites pass, 550 passed (up from 549 in Round 1 — the one new spec), 59 skipped
(unchanged, pre-existing native-gated suites). No source modified by this review. `git diff --stat`
confirms only the three authorized files changed (diagnostics.service.ts +5, store.ts +28/-6,
store.spec.ts +72), no `TODO`/`STUB`/`FIXME`/placeholder markers introduced.

### Finding: misleading prerequisite-failure token — CLOSED

- Code (`observation-retention.store.ts:461-475`):
  ```
  let pendingBytes: number | null = null;
  if (pending !== null) {
    if (pending.rows <= PENDING_BYTES_MAX_ROWS) {
      pendingBytes = read('pendingBytes', () => { ... });
    } else {
      readErrors.push(`pendingBytes: not measured above ${PENDING_BYTES_MAX_ROWS} pending rows`);
    }
  }
  ```
  `pendingBytes` is initialized to `null` at `:461`. The outer guard at `:462` (`if (pending !==
  null)`) means neither inner branch runs when the prerequisite `pending` read failed — the token
  push at `:471-473` is now reachable **only** through the inner `else`, i.e. only when `pending`
  succeeded (`pending !== null`) **and** `pending.rows > PENDING_BYTES_MAX_ROWS`. When `pending ===
  null`, the function falls straight through to `stuckEligibleRows` (`:476`) having added nothing
  beyond whatever the `pending` read's own `read()` wrapper already pushed
  (`` `pending: ${errorText(error)}` ``, `:439-450`). This is exactly the fix requested: the
  bound-exceeded case and the prerequisite-failure case no longer share a token, and the failure
  case now carries only its own accurate entry.
- Confirmed: the ≤5,000 path is untouched — `pending.rows <= PENDING_BYTES_MAX_ROWS` still runs
  `PENDING_BYTES_SQL` through the same `read()` wrapper as before (`:464-469`), identical to the
  Round-1 code apart from being nested one level deeper. The Round-1 specs for the 5,001-row
  skip and the exact-5,000-row measurement (`:549-576`, `:578-601`) still pass unmodified,
  confirming this nesting did not change either of those two behaviours.
- New spec (`observation-retention.store.spec.ts:603-618`, `'does not report a backlog-bound skip
  when the pending summary fails'`): drops `idx_obs_queue_drain` (`t.raw.exec('DROP INDEX
  idx_obs_queue_drain')`) and calls `readLiveStorage`. Asserts `pendingRows === null`,
  `pendingBytes === null`, `readErrors` contains an entry matching `/^pending: /`, `readErrors`
  does **not** contain the exact string `'pendingBytes: not measured above 5000 pending rows'`,
  and zero issued statements match `/octet_length/i`.
- Realism check: `PENDING_SUMMARY_SQL` (`:95-97`) is `... FROM observation_queue INDEXED BY
  idx_obs_queue_drain WHERE processed_at IS NULL`. An explicit `INDEXED BY` clause naming an index
  that does not exist is a genuine SQLite preparation error ("no such index:
  idx_obs_queue_drain"), thrown from inside `this.statement(db, PENDING_SUMMARY_SQL).get()` —
  the exact call the `pending` read's `read()` wrapper (`:439-450`) wraps in a real `try/catch`.
  This is not a mocked or simulated failure; it is a real thrown `SqliteError` traveling through
  the production code path, the same injection style this spec file already uses elsewhere
  (`DROP TABLE observation_quarantine` at `:638` to force the `quarantineLedger` read to fail).
  It is a faithful stand-in for the real-world causes of this branch (index corruption, a
  migration that has not yet run, schema drift between a stale build and a newer database) — all
  of which surface to `better-sqlite3` as the same class of prepare-time error caught by the same
  generic `catch (error: unknown)`.
  One nuance, not a defect: `STUCK_ELIGIBLE_COUNT_SQL` (`:113-115`) also declares `INDEXED BY
  idx_obs_queue_drain`, so dropping the index makes the `stuckEligible` read fail too — the test
  does not assert on `stuckEligibleRows` or count `readErrors` exactly, using
  `expect.arrayContaining([...])` for the pending-error check and `not.toContain` (not
  `toEqual`) for the token check, so the extra, unasserted `stuckEligible: ...` entry the real
  code also produces does not make the test brittle or hide anything — it is compatible with the
  fix's contract either way.
- Would fail on revert: reverting `:461-475` to the Round-1 shape (`if (pending !== null &&
  pending.rows <= PENDING_BYTES_MAX_ROWS) { ... } else { ...push the token... }`, a single flat
  condition rather than nested) makes the `else` reachable when `pending === null` again, so with
  the index dropped `readErrors` would include the exact skip token and the
  `not.toContain('pendingBytes: not measured above 5000 pending rows')` assertion would fail. I
  traced this by hand against the Round-1 source captured in this review's own Round-1 section
  (`.../observation-retention.store.ts:462` as quoted there) rather than by re-running a revert,
  which is sufficient given the code is a straightforward boolean refactor and the assertion is a
  direct string-membership check on the exact token the old code pushed.
- Verdict: **CLOSED**. Token now emitted only on the bound-exceeded path; prerequisite failure
  yields `pendingBytes: null` with only the accurate `pending: <error>` entry; the ≤5,000
  measurement path is unchanged; the new spec exercises a real (not mocked) failure and is
  evidenced to fail against the pre-fix code.

### New defects

None. No `TODO`/`STUB`/`FIXME`/placeholder markers in the diff. Only the three authorized files
were touched (`observation-retention.store.ts`, `observation-retention.store.spec.ts`,
`diagnostics.service.ts`), matching the report; no Batch 5 files (`thoth-runtime`, `cli-engine`)
were touched.

### Final verdict

- Recommendation: **APPROVED**
- Confidence: HIGH
- All three findings from the original review (the Serious unbounded-scan finding, the Moderate
  diagnostics-invariant-comment finding, and the Moderate misleading-token finding raised in this
  review's own first pass) are closed with file:line evidence and specs that fail on revert. No
  new defect found in either round. Batch 4 (Task 4.3) is ready to commit.
