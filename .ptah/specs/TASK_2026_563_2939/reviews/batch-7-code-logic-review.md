# Code Logic Review — `TASK_2026_563_2939`, Batch 7

## Summary

| Metric              | Value                                       |
| ------------------- | ------------------------------------------- |
| Overall score       | 8/10                                        |
| Assessment          | APPROVED                                    |
| Blocking issues     | 0                                           |
| Serious issues      | 0                                           |
| Moderate issues     | 0                                           |
| Failure modes found | 0 remaining; all 4 original findings closed |

## Recheck (round 2, final)

Read the complete current 648-line `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts`. Below, `spec` refers to that file. The final change closes the remaining part of finding 1. No new logic defect was established in the revised spec.

The NULL-workspace corpus is created at spec:274-277 and linked to quarantine-null at :278, after production migration 0049 runs at :254. Its real `CorpusStore.getCorpusMemoriesForPriming` output must be empty while quarantined (:458), then exactly contain quarantine-null after the real NULL-scope restore (:485,611-613). The distinct corpus name prevents the assertion from accidentally querying the named-workspace fixture. Named-workspace corpus assertions remain at :420 and :566-568. This completes the missing corpus portion of the two-scope matrix required by implementation-plan.md:875-889.

### Per-finding final status

| Finding                                               | Final status | Current file:line evidence                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Incomplete restored-row matrix                     | CLOSED       | Shared real-reader calls before/after both scopes: spec:329,379,422,523,570. Named search repeats at :531; unscoped search covers NULL at :437,583. Both corpus cycles now exist at :273,278,420,458,566,611. NULL merge, collector, observations, identity and timeline inclusion are asserted at :602,603,606,610,627. |
| 2. Timeline neighbor predicate escape                 | CLOSED       | Active anchor before restore at spec:473-481 excludes the quarantined after-neighbor; the same request after restore includes it at :637-646. Distinct timestamps at :206,213,221 make the neighbor eligible. Removing the current shared neighbor quarantine predicate would change the asserted pre-restore IDs.       |
| 3. Index final-filter predicate masked                | CLOSED       | Queryless named calls at spec:353-354 are asserted at :403,547. Unscoped queryless calls at :444,592 assert both scopes. These exercise the pure-filter branch without the upstream BM25 filter masking the final predicate.                                                                                             |
| 4. Index vectors disabled / hybrid execution unproven | CLOSED       | Truthful vecExtensionLoaded flag at spec:292-297; bm25Only false at :391,396,402; a contributed vector rank at :397; positive tier-2 contribution at :414-415.                                                                                                                                                           |

### Recheck (round 1)

Historical disposition: 7/10, NEEDS_REVISION. Findings 2-4 were closed and finding 1 was reduced to the missing NULL corpus cycle. Round 2 closes that remaining moderate issue. The original review was 5/10 with three serious and one moderate issue. This final assessment replaces the previous open-issue text in place.

### Verification and limits

Ran once from the authorized worktree:

`npx jest -c libs/backend/memory-curator/jest.config.ts --testPathPatterns "quarantine.round-trip" --runInBand`

**Exit 0; 1 suite passed; 1 test passed; 2.859 seconds.** No skip occurred. All reads and the sole review-file write stayed within `D:/projects/ptah-extension-memory-quality-source`. No source edit, git operation, main-checkout read or live-state access was performed.

The harness supports better-sqlite3 with node:sqlite fallback and throws when neither loads (`retention/retention-sqlite.test-support.ts:55-94`). Its sqlite-vec loader also throws on missing capability (:202-207). The test accepts either opener name at spec:195; successful output does not identify which one ran. Neither a forced node:sqlite run nor a separate Electron run was performed in this review. Approval concerns the shipping spec's logic; it does not certify completion of the plan's separate both-driver execution requirement. No independent diagnostics clearance or mutation-test result is claimed.

Score rationale: 8/10 reflects a sound single-test cycle using real production SQL and readers, with the four demonstrated gaps repaired. It exceeds the prior 7 because the explicit restored-row matrix is now complete. It is below 9-10 because runtime evidence is limited to one automatically selected driver and the review does not establish exhaustive sensitivity to every redundant upstream SQL predicate or every possible row state.

## Five logic questions

### 1. How does this fail silently?

No new silent-failure defect was established in this final revision. The new corpus empty-result assertion is paired with a positive post-restore assertion, so a missing corpus, missing link or always-empty reader would fail at spec:611-613 rather than produce a vacuous pass. The formerly bypassed timeline and queryless-index branches remain checked at :473 and :444.

### 2. What user action produces unexpected behaviour?

No unexpected action outcome was found for the requested restore-all cycle. Named and NULL restores each report one change, then zero on repetition (spec:484-488), and corpus reads in both scopes recover membership (:566,611).

### 3. What input data produces a wrong answer?

No wrong result was established for the fixture. Both R4-matching rows have separately asserted content/state and chunk text (spec:491-520), and the new corpus uses workspaceRoot: null with the correct row ID (:274-278). This does not generalize to all possible tier, pin, chunk or ranking inputs.

### 4. What happens when a dependency fails?

Setup cannot skip missing SQLite bindings or sqlite-vec (retention/retention-sqlite.test-support.ts:88,202). Named hybrid calls must not silently degrade to BM25 (spec:391,396,402). Real database queries decide corpus membership; logger and observation-queue stand-ins do not fabricate those results (spec:271,292-306). No dependency failure injection is claimed.

### 5. What is missing that the requirements never mentioned?

Successful driver-selection reporting would make dual-driver verification easier to audit: spec:195 checks membership in the supported-name set but does not report the selected name. This remains an evidence limitation, not an additional code finding. No new acceptance requirement is introduced.

## Failure modes

None remain from the four original findings, and no new supported failure mode was found in this recheck. Scope examined: the entire revised spec, its production migration/restore/read wiring established in the earlier rounds, and the final NULL corpus fixture and assertions. Verification: one scoped passing Jest execution. Residual uncertainty: no forced second driver, mutation campaign, large-data stress run, or independent diagnostics run.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None requiring revision. Dual-driver execution evidence remains outside this final code-logic approval.

## Data flow

1. **OK:** spec:193 opens real SQLite and sqlite-vec. The harness migration list applies production 0048 (`retention/retention-sqlite.test-support.ts:219-227`).
2. **OK:** spec:201-251 seeds named/NULL R4 rows, active controls and tier-1 matches. Real chunks and vector rows are inserted at :134-146.
3. **OK:** spec:254 applies production migration 0049 SQL, and :256-263 checks reasons and untouched controls. No manual quarantine UPDATE replaces production SQL.
4. **OK:** spec:271-278 creates separate named and NULL corpora and links already-quarantined rows, respecting the migration guard's ordering requirement.
5. **OK:** real store/search/collector instances are created at :280,298,306. Search uses the actual database with vector capability enabled (:292-297).
6. **OK:** exclusions cover named and NULL rows through exact-scope or supported unscoped public APIs (spec:379-481). Queryless index and active-anchor timeline assertions exercise the earlier missing branches.
7. **OK:** real restoreQuarantined restores all in each scope and is checked for idempotence (spec:484-488).
8. **OK for seeded fields:** spec:491-520 verifies content, subject, salience, tier, archived_at, pinned, hits, last_used_at and chunk text remain unchanged, and quarantine columns become NULL.
9. **OK:** fresh calls on the existing service instances assert restored visibility (spec:523-646), including the newly completed NULL corpus cycle (:611-613).

## Requirements fulfilment

| Requirement                                     | Status                        | Evidence / limit                                |
| ----------------------------------------------- | ----------------------------- | ----------------------------------------------- |
| Exactly one test walks the cycle                | COMPLETE within reviewed file | One it at spec:191; Jest reports one test       |
| Production 0048 + 0049 quarantine               | COMPLETE                      | spec:193,254; harness:219                       |
| Real store/search/collector/corpus paths        | COMPLETE                      | spec:271,280,298,306                            |
| Every restored fixture row on every listed path | COMPLETE                      | spec:379-646, including NULL corpus :458,611    |
| Active-anchor timeline exclusion                | COMPLETE                      | spec:473,637                                    |
| Queryless index protection                      | COMPLETE                      | spec:403,444,547,592                            |
| Restore all, named and NULL                     | COMPLETE                      | spec:484-488                                    |
| Required content/state/chunks unchanged         | COMPLETE for seeded values    | spec:491-520                                    |
| Driver fallback with no missing-binding skip    | COMPLETE by inspected harness | retention-sqlite.test-support.ts:55-94          |
| Runtime evidence for both drivers               | PARTIAL                       | Only the authorized ordinary Jest run performed |

Implicit requirements not addressed: selected-driver visibility in successful verification output; no further functional gap identified.

## Edge cases

| Case                                    | Handled | How                              | Concern                                       |
| --------------------------------------- | ------- | -------------------------------- | --------------------------------------------- |
| Repeated restore                        | YES     | spec:487-488                     | None for fixture                              |
| NULL-workspace corpus member            | YES     | spec:274,278,458,611             | Prior finding closed                          |
| Quarantined anchor                      | YES     | spec:461,465                     | Both scopes                                   |
| Active anchor with quarantined neighbor | YES     | spec:473,637                     | Tests current shared neighbor predicate       |
| Queryless index                         | YES     | spec:403,444,547,592             | Named and unscoped                            |
| Missing SQLite/vector binding           | YES     | Harness throws                   | No skip                                       |
| All possible tier/pin values            | NO      | Fixture uses recall and pinned=0 | Not claimed by this fixture-specific approval |

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH** for closure of all four findings and the passing scoped test; second-driver execution is unverified.
- Top residual risk: a single automatically selected driver run cannot certify both binding implementations.
- What a robust verification handoff would add: record distinct passing runs and selected driver names for better-sqlite3 and node:sqlite. No further source revision is requested by this review.
