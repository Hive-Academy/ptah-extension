# Code Logic Review — TASK_2026_563_2939, Batch 3

## Current summary — recheck round 1

| Metric              | Value                         |
| ------------------- | ----------------------------- |
| Overall score       | 8/10                          |
| Assessment          | APPROVED (Batch 3 scope)      |
| Blocking issues     | 0                             |
| Serious issues      | 0                             |
| Moderate issues     | 0                             |
| Minor issues        | 1                             |
| Failure modes found | 1 minor counter-contract edge |

The round-one section below is authoritative. The original review is retained as the requested finding history; its verdict and source line numbers describe the earlier revision. Pin/unpin RPC adoption remains a Batch 6 integration requirement, not an approved end-to-end behavior here.

## Initial review — superseded by round 1

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 0              |
| Moderate issues     | 0              |
| Minor issues        | 2              |
| Failure modes found | 1              |

The store and lifecycle predicates implement the requested exclusion and preservation behavior. The remaining blocking defect is the pin mutation's success contract: a frozen row is reported as successfully pinned/unpinned although its value did not change. This separates the score from the sound 7–8 band; the SQL protections and real-SQLite regression coverage separate it from the significant-problems 3–4 band.

Scope: all nine named Batch 3 files read in full, compared with the requested base where applicable. References below are worktree-relative, rooted at `D:\projects\ptah-extension-memory-quality-source`. Short names `memory.store.ts` and `memory.store.spec.ts` refer to `libs/backend/memory-curator/src/lib/`; `retention/` and `knowledge-agents/` are beneath that directory. No source, existing database, task state, or concurrent search-service file was modified. No applicable AGENTS.md or root instruction file was found in the worktree. No Batch 3 style review existed when inspected.

Inputs: task context; implementation-plan.md r3 components 4–5 and M5 inventory; task-description.md M5 criteria 5–10 and compatibility requirements; batches.md Batch 3. Caller inspection was limited to the pin/get RPC boundary and lifecycle service; the concurrent search batch is not judged here.

Verification: the authorized targeted Jest command completed with **5 suites passed, 106 tests passed, 0 snapshots**, in 24.024 seconds. The PowerShell wrapper printed a NativeCommandError record for redirected native stderr, but Jest's final result was passing. This was one runtime invocation, not independent proof under both SQLite drivers. `ptah_get_diagnostics` returned **Unavailable: None of the requested files are inside the workspace root**; no diagnostics pass is claimed. No full-project lint/typecheck, real-corpus measurement, or second-driver run was performed. The inspected existing lifecycle store/service and retention integration specs have no diff against ebfc73321; the targeted run does not include the entire retention suite.

## Five logic questions

### 1. How does this fail silently?

Finding 1: `memory.store.ts:544` returns void after an UPDATE that may affect zero rows. `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:268` and `:282` convert normal return into success and the requested pin value. Quarantine now creates this mismatch for an existing row. `recordUse` has no success-result contract; ignoring quarantined IDs is intentional, and its existing failure warning remains at `memory.store.ts:676`.

### 2. What user action produces unexpected behaviour?

Pin a quarantined, unpinned memory by a known ID: the RPC returns `{ success: true, pinned: true }`, while `pinned` remains false. The reverse mismatch applies to unpinning an already pinned quarantined row (`memory.store.ts:548`; RPC handler `:269`, `:283`). Existing IDs remain available through diagnostics and the intended quarantine-list surface, so hiding normal list results is not a mutation-result guarantee.

### 3. What input data produces a wrong answer?

The quarantined pin target above produces a false success. No additional wrong-result defect was established in Batch 3 queries. NULL scope uses `IS`, including restore at `memory.store.ts:909` and merge-target lookup at `:360`. Named and undefined stats use the same quarantine predicate as NULL stats (`:779`), including MAX(updated_at) (`:798`). Over-cap count excludes quarantined rows before grouping (`retention/memory-lifecycle.store.ts:28`).

### 4. What happens when a dependency fails?

Restore transaction execution errors call `handleFatalWriteError` and rethrow (`memory.store.ts:917`); the counter is updated only after a successful transaction (`:923`). Statement preparation is outside that catch (`:905`), consistent with existing insert/append structure: a prepare failure still propagates but does not invoke that hook. Reads propagate SQL errors. `recordUse` preserves its existing warn-and-continue contract (`:676`). Lifecycle uses BEGIN IMMEDIATE, rollback, and RetentionStepError (`retention/memory-lifecycle.store.ts:298`); preview errors remain explicit rather than masquerading as zero (`:251`). Restore failure coverage remains a minor gap, finding 3.

### 5. What is missing that the requirements never mentioned?

The plan requires frozen pin state but does not define how the existing pin/unpin API reports a rejected mutation (`implementation-plan.md:449`). Finding 1 closes that contract gap. Process-local counters (`memory.store.ts:146`) are not cross-process invalidation; this batch preserves that architecture rather than promising coherence with external writers. Caller wiring for getActiveById and getMergeTarget belongs to later batches (`batches.md:403`, `:462`), so those later integrations are not marked complete here.

## Failure modes

### 1. Frozen pin mutation reports success — Blocking

- Trigger: call memory:pin for a quarantined row whose pinned value is false, or memory:unpin for one whose value is true.
- Symptom: the response asserts success and a pin state that is not persisted.
- Evidence: `memory.store.ts:544`–`:551`; `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:263`–`:286`.
- Current handling: SQL correctly excludes the row, but the affected-row count is discarded and the method returns normally. The existing caller always constructs success on normal return.
- Recommendation: expose a non-success outcome for a frozen/missing target, and make the caller derive its result from that outcome. A deliberate rejection that the existing handler catches is another option if the void signature must remain. Preserve the quarantine freeze and the planned counter behavior. Add a real-store RPC regression proving that a quarantined target cannot receive a false success response.

## Blocking issues

### Finding 1 — Pin/unpin success is disconnected from the frozen write

- File: `libs/backend/memory-curator/src/lib/memory.store.ts:548`.
- Scenario: existing quarantined row receives an opposite-value pin request through the existing RPC.
- Impact: caller/UI is told the requested state is persisted, while restore later reveals the old state. This is Blocking under the review rubric's “silent failure that misleads a user” definition; it is not a claim of data loss.
- Fix: communicate rejected/no-op status across the store/caller boundary and test the response. The store-only test at `memory.store.spec.ts:2037` proves the freeze but cannot detect the false success. Coordinate the caller change with its owning batch; do not weaken the freeze to repair the response.

## Serious issues

None established.

## Moderate and minor issues

### Finding 2 — Explicit NULL stats lacks a real quarantine assertion — Minor

`memory.store.spec.ts:1980` exercises named and undefined scopes only. The older NULL-scope mock test at `:289` checks binding, not exclusion or MAX(updated_at). Production logic is correct by inspection (`memory.store.ts:779`), but a NULL-specific regression could pass these tests. Add quarantined and active NULL-scope controls plus named-workspace controls, and assert all tier counts and lastCuratedAt.

### Finding 3 — Restore execution failure has no regression test — Minor

Restore coverage at `memory.store.spec.ts:2104` through `:2215` checks success, exact columns, scope, idempotence and cap, but not rollback/error propagation. The fatal-write tests at `:318` exercise insert and append only. Add a failing restore UPDATE/transaction case that verifies unchanged quarantine state, unchanged counters, the original propagated error, and the fatal-write hook. This would protect `memory.store.ts:912`–`:924` against a future swallowed-error or premature-counter regression.

## Data flow

1. **OK — store reads:** findMergeCandidates filters inside the candidates CTE before ROW_NUMBER and limits (`memory.store.ts:401`); aliases are valid. `list` reuses one unaliased predicate for count and the single-table aliased page (`:450`, `:464`, `:468`). `listAll` similarly shares the predicate (`:492`, `:507`, `:519`). Existing scope and ranking behavior is retained.
2. **OK — stats and corpus:** both stats statements reuse the same scope/quarantine WHERE (`memory.store.ts:779`, `:798`). Corpus priming filters its joined memory alias (`knowledge-agents/corpus.store.ts:314`); membership itself remains intact, proven at `corpus.store.spec.ts:377`.
3. **OK — read seams:** getActiveById hides quarantined content without changing raw getById (`memory.store.ts:333`, `:345`). getMergeTarget returns only an ID in the exact scope, including NULL; “active” means nonquarantined, not “recall tier” (`:357`). Later caller wiring remains separately owned.
4. **PARTIAL — freeze:** recordUse filters both root selection and UPDATE (`memory.store.ts:655`, `:663`), keeping quarantined fields and counters unchanged. setPinned filters its UPDATE (`:548`), preserving fields, but finding 1 affects the caller's claimed result.
5. **OK — restore:** deduplicate IDs, cap at 500, bind JSON through json_each; bind reason separately; constrain every selector with workspace_root IS @ws (`memory.store.ts:886`–`:910`). Transaction clears exactly two columns and reports actual changes (`:907`, `:913`). No chunks or indexes are rewritten. Empty IDs return zero without SQL (`:895`).
6. **OK — cache generation:** positive restore calls markWorkspacesChanged (`memory.store.ts:923`), which bumps the named scope plus the global generation or the NULL/global generation once (`:169`). Skipping the bump at zero changes is safe for this operation: no eligibility changed, and the first successful restore already invalidated its scope. Cross-process cache coherence is an existing architectural limitation, not solved by bumping on a no-op.
7. **OK — lifecycle:** all ten required constants carry exclusion (`retention/memory-lifecycle.store.ts:12`–`:71`). The trigger-existence query correctly has none. SELECT and writes happen under BEGIN IMMEDIATE (`:298`), so another writer cannot quarantine a selected row between selection and deletion. Both chunk and memory DELETE repeat the guard (`:50`, `:56`); chunk-trigger cleanup cannot be invoked for a quarantined row by these deletes. Cap and preview omit it before counting. Explicit user deletes remain authoritative per plan (`memory.store.ts:554`, `:603`).

## Requirements fulfilment

| Requirement                                       | Status   | Gap                                                                                                                                                     |
| ------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5 criterion 5, Batch 3 read inventory            | COMPLETE | CTE, list/count, listAll/count and corpus predicates present; other batches own search/RPC integration                                                  |
| M5 criteria 6–7, scoped exact restore             | COMPLETE | Only two columns cleared; actual change count; one-scope transaction; no deletes (`memory.store.ts:905`)                                                |
| M5 criterion 8, merge-target store seam           | COMPLETE | Exact-scope/nonquarantine lookup exists (`memory.store.ts:357`); caller guard is Batch 5                                                                |
| M5 criterion 9(b), stored-field freeze            | COMPLETE | recordUse and setPinned exclude quarantined rows (`memory.store.ts:548`, `:669`)                                                                        |
| Truthful pin/unpin mutation result                | PARTIAL  | Finding 1                                                                                                                                               |
| M5 criterion 9(a,c), lifecycle protection and cap | COMPLETE | Selection, writes and counts exclude quarantined rows (`retention/memory-lifecycle.store.ts:12`)                                                        |
| M5 criterion 9(d), active-row compatibility       | PARTIAL  | Diff is predicates only; existing targeted lifecycle tests pass unedited; entire retention suite and second-driver verification not run here            |
| M5 criterion 10, lifecycle regression             | COMPLETE | Age controls, cap controls, restore then eligibility, direct-write defence tested (`retention/memory-lifecycle.quarantine.spec.ts:140`, `:228`, `:300`) |

The rewritten “undefined drops the workspace predicate” expectation is legitimate (`memory.store.spec.ts:300`): undefined still means all workspaces, but must now exclude quarantine. The new assertions retain empty binding arguments and explicitly forbid a workspace predicate. This is a stats test, not an edited 443 lifecycle expectation.

Implicit requirement not addressed: truthful reporting when an otherwise valid pin request is rejected due to quarantine.

## Edge cases

| Case                                   | Handled | How                                                                                                                | Concern                                                                                               |
| -------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Empty, duplicate, over-500 restore IDs | YES     | Deduplication, empty return, 500 cap (`memory.store.ts:886`)                                                       | Truncation is intentional; returned count is actual changes                                           |
| NULL vs named restore                  | YES     | IS binding, isolation both directions (`memory.store.spec.ts:2146`)                                                | No all-workspace restore                                                                              |
| Repeated restore / active IDs          | YES     | quarantine predicate; zero result; no new generation (`memory.store.spec.ts:2172`)                                 | None established                                                                                      |
| Quarantined highest-ranked candidate   | YES     | Filter is before ranking (`memory.store.ts:411`)                                                                   | Add a saturated quota fixture if strengthening tests                                                  |
| Pin a quarantined row                  | NO      | Database correctly freezes it                                                                                      | Caller falsely reports success; finding 1                                                             |
| Quarantined oldest lifecycle rows      | YES     | Removed from selection/count, preserved through pass (`retention/memory-lifecycle.quarantine.spec.ts:189`, `:269`) | Archival eviction selector protection is inspected; cap regression fixture primarily exercises recall |
| Wrong IDs reach destructive statements | YES     | Guards repeated in both DELETEs and archive UPDATE (`retention/memory-lifecycle.quarantine.spec.ts:300`)           | None established                                                                                      |
| Dependency write failure               | YES     | Restore throws; lifecycle rolls back (`memory.store.ts:917`; `retention/memory-lifecycle.store.ts:314`)            | Restore failure test missing                                                                          |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for the identified false-success defect and SQL inspection; MEDIUM for complete runtime compatibility because dual-driver and full retention verification are outstanding.
- Top risk: a quarantined pin request reports a persisted state that does not exist.
- What a robust implementation would add: a truthful rejected-pin outcome and caller regression; explicit NULL quarantine stats coverage; a restore failure/rollback test. Keep the current exclusion predicates and exact restore transaction.

## Recheck (round 1)

### Verdict and verification

**8/10 — APPROVED for Batch 3.** Zero blocking, serious or moderate findings remain in this batch; one minor counter-contract edge is recorded below. The previous pin finding is resolved at the store boundary and transferred explicitly to Batch 6 for caller adoption. This does not assert that an unchanged RPC handler now reports failures correctly.

The authorized targeted Jest command passed **5 suites, 112 tests**, with no snapshots, in **17.88 seconds**. It was run once; the same PowerShell redirected-stderr wrapper record appeared, followed by Jest's passing summary. No second-driver run, full retention run, lint/typecheck, or live-database check was performed. The previous diagnostics workspace-root limitation remains; diagnostics were not retried. Only this review document was changed.

Reviewed the revised store diff against ebfc73321, the changed methods in context, and all added/revised tests, carrying forward the full-file reads from the initial review. Paths and abbreviated file names retain the root defined above. Search-service edits and RPC handler edits remain out of scope.

The 8/10 score reflects sound store behavior with real regression tests and correct post-commit cache invalidation. The minor mixed-root counter edge, limited transactional test strength, and outstanding cross-batch caller verification prevent an exemplary 9–10 score; no remaining Batch 3 user-visible defect justifies the previous 6/10 band.

### Per-finding status

| Finding                            | Status                                                      | Current evidence and impact                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — false pin/unpin success        | RESOLVED in Batch 3; caller integration assigned to Batch 6 | `memory.store.ts:558` now returns the affected-row result, false for missing/quarantined and true for a matched active row. Counter changes occur only on true (`:565`). Tests cover unchanged active values (`memory.store.spec.ts:2037`), both frozen directions (`:2047`), and missing IDs (`:2068`). The store can now tell the caller that no mutation matched. Batch 6 must consume the boolean and test its RPC response before end-to-end closure. |
| 2 — NULL stats quarantine coverage | RESOLVED                                                    | `memory.store.spec.ts:2073` seeds active unscoped core/recall rows, a quarantined unscoped archival row with the highest timestamp, and named-workspace controls. It asserts all tier counts plus MAX(updated_at) at `:2098` and named control results at `:2105`. Removing quarantine or workspace filtering would change the expected result.                                                                                                            |
| 3 — restore failure regression     | RESOLVED, with test-strength limitation below               | `memory.store.spec.ts:2113` uses the real store and database with a trigger raising ABORT (`:2131`), asserts a thrown error carrying the trigger message, the exact error passed once to handleFatalWriteError (`:2149`), both quarantine timestamps unchanged, no open transaction, no counter change and no success log (`:2151`).                                                                                                                       |

### Counter trace across write paths

The recursion hazard is avoided: markWorkspacesChanged calls the new primitive incrementGeneration (`memory.store.ts:178`), while bumpWriteCounter delegates to markWorkspacesChanged (`:186`). For a single named root the named generation and `''` each advance once; for a single NULL/empty root only `''` advances once. A list of distinct named roots plus at most one NULL/empty root also advances `''` once.

| Path                   | Current behavior                                                                                                                                                                                                                     | Evidence                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| insertMemoryWithChunks | Both generations advance after the transaction returns; failure does not reach the bump                                                                                                                                              | `memory.store.ts:312`–`:316`; `memory.store.spec.ts:2371`          |
| setPinned              | Only a matched active row bumps; same-value match remains successful                                                                                                                                                                 | `memory.store.ts:558`–`:567`; `memory.store.spec.ts:2037`          |
| forget                 | Preserves the previous unconditional post-DELETE bump, now also invalidating the global generation; missing IDs can cause harmless extra invalidation                                                                                | `memory.store.ts:570`–`:573`; `memory.store.spec.ts:2419`          |
| deleteBySubjectPrefix  | Positive changes bump the exact named root and global key; zero changes do not                                                                                                                                                       | `memory.store.ts:589`–`:597`; `memory.store.spec.ts:2398`          |
| purgeBySubjectPattern  | Positive named-scope changes bump both keys; empty/no-match returns do not                                                                                                                                                           | `memory.store.ts:639`–`:650`; `memory.store.spec.ts:2405`          |
| appendChunks           | Both generations advance after the transaction; empty additional chunks retain the early return                                                                                                                                      | `memory.store.ts:706`, `:767`–`:772`; `memory.store.spec.ts:2380`  |
| recordUse              | Deduplicated/capped IDs and SQL semantics remain unchanged apart from quarantine exclusion. DISTINCT restored archival roots are passed together after commit, so several named restored roots invalidate the global generation once | `memory.store.ts:655`–`:692`; `memory.store.spec.ts:2389`          |
| restoreQuarantined     | Positive committed changes mark the exact scope and global key; zero changes/failure do not bump                                                                                                                                     | `memory.store.ts:935`–`:948`; `memory.store.spec.ts:2280`, `:2414` |
| Lifecycle              | The existing service passes a Set of changed roots once; the new primitive still handles its named/NULL roots                                                                                                                        | `retention/memory-lifecycle.service.ts:208`; `memory.store.ts:174` |

recordUse deliberately still does not invalidate generations for ordinary recall/core use when no archival row is restored. Hits/last_used_at are updated, but that existing cache policy is pinned by `memory.store.spec.ts:1405` and unchanged by this revision. Thus “every committed write” in the new comment is broader than the actual preserved policy; the change fixes global invalidation for writes that already advance generations. Quarantined usage remains frozen, without being included in restored roots (`memory.store.ts:675`, `:685`).

Existing boundaries remain: a whole-database purge only bumps the global key, not each affected named key (`memory.store.ts:640`, `:650`), and index rebuilds do not acquire new generation handling. Those behaviors predate this revision and are not claimed fixed. The new named-write test walks insert, pin, append, archival use, prefix deletion, named purge, restore and forget with exact generation counts (`memory.store.spec.ts:2370`); the NULL test verifies single increments (`:2424`). Multiple restored named roots are correct by inspection but are not explicitly tested in the new case.

### Finding 4 — Multiple roots mapping to the global key violate the once-per-call claim — Minor

- File: `libs/backend/memory-curator/src/lib/memory.store.ts:178`.
- Trigger: markWorkspacesChanged receives `[null, '']` or repeated NULL roots. This can also occur through recordUse when separate archived rows have SQL NULL and empty-string workspace roots: SELECT DISTINCT keeps them distinct (`:671`), then both map to `''`.
- Symptom: `getWriteCounter('')` advances twice in one call, despite the exact-once contract at `:170`. Named generations remain unaffected beyond their supplied roots.
- Impact: no stale-cache or row-corruption defect; generations are monotonic invalidation tokens. The observable exact-once counter contract is not universally true. This is nonblocking.
- Current handling: unscopedChanged only suppresses the final extra bump; it does not suppress repeated global-key increments inside the loop.
- Recommendation: handle NULL/empty roots once per call while preserving any intentional duplicate named-root behavior (the older test at `memory.store.spec.ts:162` expects two increments for a repeated named root). Add a mixed NULL/empty case, including a recordUse call restoring both roots if that stored shape is supported.

### Trigger regression validity and remaining uncertainty

The message-shape assertion at `memory.store.spec.ts:2144` is a legitimate replacement for instanceof Error: it still rejects an absent error or an error without the expected trigger text, and the identity comparison at `:2150` checks that the hook received the same thrown object. It avoids assuming that a native-driver exception shares the Jest Error prototype.

The test proves update failure propagation, no reported restore success, unchanged quarantine timestamps and transaction cleanup. Its “second row, after the first row's update ran” comment (`memory.store.spec.ts:2130`) is stronger than the assertion: SQL row visitation order is not an API guarantee, and RAISE(ABORT) itself undoes earlier effects of that statement. Even without an explicit surrounding transaction, this single UPDATE can leave both rows unchanged and no open transaction. Therefore the test is valid for the identified error-path gap, but is not independent proof that the explicit transaction wrapper remains present. The wrapper is verified by source inspection (`memory.store.ts:930`); an additional transaction-spy assertion or RAISE(FAIL) fixture would strengthen that specific guarantee. No second production defect is inferred from this test limitation.

### Five-question recheck disposition

1. **Silent failure:** the store now exposes pin rejection (`memory.store.ts:567`); RPC adoption remains Batch 6. Restore errors still rethrow (`:939`).
2. **Unexpected user action:** no new Batch 3 behavioral defect established for pin, restore, or lifecycle. Frozen pin requests now return false (`:565`).
3. **Wrong input result:** mixed NULL/empty roots produce the minor generation-count mismatch in finding 4; restore SQL scope remains exact (`:927`).
4. **Dependency failure:** the trigger test now exercises the restore catch and cleanup (`memory.store.spec.ts:2113`); no counter or success log occurs on that failure.
5. **Unstated requirements:** cross-batch callers must consume the boolean, and a once-per-call generation claim should define handling of multiple roots that normalize to the same global key (`memory.store.ts:170`, `:556`).

Final recommendation for this round: **APPROVE Batch 3**, with finding 4 as a nonblocking follow-up and the pin/unpin response requirement retained explicitly for Batch 6.
