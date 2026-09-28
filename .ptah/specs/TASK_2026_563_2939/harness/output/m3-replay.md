# M3 replay 8(b) — TASK_2026_563_2939 (Phase 2)

Measurement table row **M3 replay** (M3 criterion 8b). Raw output:

- `output/m3-replay-set.json` (selection)
- `output/m3-copyBprime.json` (copy B′)
- `output/m3-replay.json` (per-draft and summary, with the guard applied)
- `%TEMP%\mqs-563-eval\m3-candidates.json` and `m3-calls.jsonl` (every candidate set, and every
  resolve call with its SDK record)

Script: `harness/merge-replay.ts select | replay | report`.

**Headline: the shipped variant, After-B (D4 = B), FAILS the 8(b) gate.** It made 7 merges against
Before's 8, a rate of 30.4 % against 34.8 %. After-A, the variant not chosen, passes: 20 merges,
86.96 %, at 15 extra resolve calls.

## 1. Replay set

- **Copy:** copy B (`copyB-m3.sqlite`, 48 only; see `m3-reach.md` for its copy record). The workspace
  is `D:\projects\ptah-extension`, 25,683 rows.
- **Order:** `sha256('TASK_2026_563_2939:m3' + ':' + id)`, hex, **descending**, so the highest hash
  comes first.
- **Rule** (plan: "a nearest neighbour (vector KNN) in the same workspace with a different
  case-folded subject and cosine similarity ≥ 0.85"). A row qualifies when:
  - each of its chunks is re-embedded with the REAL embedder (bge-small-en-v1.5),
  - that embedding is run as a vec0 KNN query, and
  - among the returned chunks of OTHER memories in the same workspace with a different
    `TRIM(LOWER(subject))`, the best has **exact cosine ≥ 0.85**.

  The cosine is computed directly from the vectors, not read off sqlite-vec's L2 distance. The
  harness also checked that the stored vectors are unit-norm: 500 sampled, norm 0.9999997 to
  1.0000004, so vec0's L2 order is cosine order. The re-embedded vector against the row's own
  stored vector gave cosine 0.9914 to 1.0000 over 40 chunks.

- **KNN depth:** it starts at k = 64 and would double while the k-th neighbour is still ≥ 0.85, up
  to the sqlite-vec cap of 4096. k = 64 was always enough.
- **Selection size:** 20 rows qualified after **38 examined**, in 4.2 s. The 0.85 bar was not
  lowered.
- **Commitlint family:** **0** of the 20 selected rows are commitlint-family. Per plan:1041-1044,
  the **3 newest family rows** in the workspace were added as **fixed extra drafts**, listed
  separately. They are in all three runs.
- **Attempts:** **23 per variant.**
- **Neighbours inside the set:** no selected row's matched neighbour is itself a replay row. So
  deleting the set from B′ removed no row's qualifying neighbour.

|   # | Id                           | Kind       | Subject                          | Nearest qualifying neighbour (subject)  | Neighbour id                 | Cosine |
| --: | ---------------------------- | ---------- | -------------------------------- | --------------------------------------- | ---------------------------- | -----: |
|   1 | `01KXDTZZWR0EX268GYVC989R8C` | fact       | ptah-message-push-pattern        | ptah-message-push-pipeline              | `01KXK5V29FVGA7YM9J31NNW3X0` | 0.9418 |
|   2 | `01M19GMARSRXCEJ2MYZF915ZMG` | fact       | three-level-filter-composition   | skill-sync-filter-order                 | `01M15F9HYY03KW3NTSSAKEBKSF` | 0.8982 |
|   3 | `01M21SD8ERKWSDT6HHG43MFSK5` | event      | collision-repair-sep-9-2026      | task-id-collision-protocol              | `01M21RXXQMAGF9PMRYHQ0NFPS5` | 0.8821 |
|   4 | `01KWMJ8FS0CAPWRH82T9G0MA1Z` | fact       | memory-search-fully-broken       | memory-subsystem-offline                | `01KWCCHSG54T8XK966F98541B6` | 0.8513 |
|   5 | `01M00Z9AD1S9HN991XSBRSWMW4` | fact       | no-live-run-verification         | no-live-run-gates                       | `01M0126ZEYTV1Z2YD3EXNBQ22A` | 0.8550 |
|   6 | `01M1VHQWPSC7TYF2GZBVZKQVJ1` | fact       | compaction-hook-handler          | compaction-safety-timeout-ms            | `01M1VHQWP9A5NKJB5WA126T969` | 0.8793 |
|   7 | `01KW9QTQPT5SAEFA1XM55PKVHW` | fact       | ptah-cli-agent-key-slots         | dual-key-slot-mismatch                  | `01KWJJ5GM1MZ64HQE9103TJ7CM` | 0.9244 |
|   8 | `01M07XE4H0C31YHJXKD8G0ST45` | fact       | license-server-endpoint-routing  | license-server-routes                   | `01M05RRHBPHTH14QCNDA9Z6NN2` | 0.8995 |
|   9 | `01KWHQEDKHMSBJ1Q78QHYQNYXD` | fact       | queued-message-editing           | editqueue-method                        | `01KVZG4CXTYPPT9Q2JEFQZ7CAM` | 0.9016 |
|  10 | `01M05VX974BB0TJ8FMX7D7A15K` | preference | orchestration-batch-sequencing   | batch-sequencing                        | `01M010G596PR883528KX8E2F54` | 0.8646 |
|  11 | `01KWJJWVFH3YXXQNW4Z9Z2SPNY` | fact       | ptah-codebase                    | windows-paths-requirement               | `01M1YEFNPW3KZCXJR74XMG580F` | 0.9410 |
|  12 | `01KVBDEH8WFZDNHWDK2HVX10DW` | fact       | batch_sign-output-directory      | esigner-batch-sign-output-separate      | `01KTGMAHE4TT4XVX7896J5Z3F4` | 0.9871 |
|  13 | `01M2K9X3Y3DP1Z6B81Z45MECQQ` | event      | task-442-pr-514-merge            | task-2026-442-pr-514                    | `01M2K9X44FVZG3YPT7C6H434J0` | 0.8502 |
|  14 | `01M1HTB1TNEZDZJMGAZ34PB4DN` | fact       | sdk-content-blocks               | tool-use-caller-field                   | `01M1SJMQK3RZ8TT35J9H1S23FZ` | 0.8861 |
|  15 | `01M30Q30W2VA9P6BNTKBA7ATP9` | fact       | angular-eslint-22-rule-removal   | angular-eslint-no-conflicting-lifecycle | `01M30Q30YP0JQZ64P2J3JGQJT7` | 0.9539 |
|  16 | `01KWMKR3QA0CMT4XB9DZ6YNG1Y` | fact       | chat-input-restorecontenttoinput | restore-content-to-input                | `01KWJGVACC9Q6SJSR8EQ5NR4TC` | 0.8971 |
|  17 | `01M04RSWF5TX151MCBJ153Q029` | fact       | ptah-compaction-architecture     | compaction-reload-tab-mismatch          | `01M20ZGV333559DA9VB2Q9BMMP` | 0.8668 |
|  18 | `01KXKE44S3WBRT6WS1GSRQ4JNB` | event      | electron-shell                   | ptah-electron-shell                     | `01KXGY72935GQYZ5FADRSFNQQE` | 0.9396 |
|  19 | `01M07YPA0YVMHDXKD6RHB4STBA` | preference | contrast-fix-pattern             | base-content-fix                        | `01M04VGEMJ98WGZEDDM61H25GA` | 0.8509 |
|  20 | `01M27A2DBZMTN4C54CEW7G1D44` | preference | task-completion-scope            | task-execution-scope                    | `01M278WC9K7CN7RED1NHPCZXF1` | 0.9321 |

Fixed extra drafts (commitlint family, the newest 3 by `created_at`; added, not selected):

| #   | Id                           | Kind  | Subject                      | Created              |
| --- | ---------------------------- | ----- | ---------------------------- | -------------------- |
| X1  | `01M31ZH2G4ERTH33NNCBFGVCBZ` | event | task-spec-commitlint-failure | 2026-09-21T12:37:20Z |
| X2  | `01M2XACB41R4V4RCQ33WZ6RTTY` | fact  | commitlint-scope-enum        | 2026-09-19T17:10:47Z |
| X3  | `01M24941ZZ3Q1E66E4Z8301S67` | fact  | commitlint-scopes            | 2026-09-09T23:47:46Z |

## 2. Copy B′

- **Copy:** `%TEMP%\mqs-563-eval\copyBprime-m3.sqlite`. A fresh backup-API copy of the verified
  snapshot (started 2026-09-26T18:33:42.441Z, backup 1,704 ms, integrity `ok`), migrated to 48 only.
- **Deletions:** all 23 replay rows, removed with the production `MemoryStore.forget(id)` (sqlite-vec
  loaded, `foreign_keys = ON`).
- **Counts before and after:**

  | Count           | Before |  After |
  | --------------- | -----: | -----: |
  | `memories`      | 26,706 | 26,683 |
  | `memory_chunks` | 29,447 | 29,422 |
  | FTS docsize     | 29,447 | 29,422 |
  | vec rowids      | 29,443 | 29,418 |

  The replay rows owned 25 chunks. Their residue is 0 memories and 0 chunks, and `integrity_check`
  is `ok` after the deletions.

- **So no draft can find itself.**

## 3. The three runs

Each draft is `{ kind, subject, content, type, concepts, files }` of its row, verbatim, plus
`salienceHint: 0.5`, which is fixed for every draft in every run because the type requires it.
There is one `resolve([draft], candidates)` call per draft per variant, through the real
`SdkInternalQueryCuratorLlm` (MCP off, read-only tools, haiku tier, `lib/llm.ts`). A pool of 3
worked concurrently, and the variant order alternated per draft.

| Variant     | Candidate set                                                                                            | Resolve prompt                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Before**  | `MemoryStore.findMergeCandidates([subject], ws)`: tier 1 only                                            | BASE `ebfc73321` `RESOLVE_SYSTEM_PROMPT`: `old-RESOLVE_SYSTEM_PROMPT.txt`, sha256 `4c67dc24…51e4`, captured by `git show`, re-verified in this phase |
| **After-A** | Shipped `MergeCandidateCollector.collect`, tier 2 **forced on**                                          | BRANCH prompt                                                                                                                                        |
| **After-B** | Shipped `MergeCandidateCollector.collect`, **unmodified** (D4 = B: tier 2 only when tier 1 is non-empty) | BRANCH prompt                                                                                                                                        |

### What "After-A" is here (engineering choice, documented)

- **Plan wording:** "tier 1 + tier 2, always". It measures the variant the team did not choose.
  The shipped collector cannot do that: it returns early on `tier1.length === 0`
  (`merge-candidate-collector.ts:187`). No shipped code was edited.
- **The harness hands the collector a store proxy.** When the real tier 1 is empty, the proxy's
  `findMergeCandidates` returns one synthetic sentinel row, which opens the gate. The sentinel is
  stripped from the result afterwards.
- **Everything else is the shipped path.** The tier-2 loop, bounds (5 per draft, 25 per pass,
  10 queries), dedup and scope check all run exactly as shipped. The sentinel id matches no row,
  so it cannot displace or collide with a tier-2 hit.
- **Where tier 1 was non-empty, After-A behaves exactly like After-B:** the sentinel was not used
  (8 drafts).

### The merge guard

This is `memory-curator.service.ts` `eligibleMergeTarget` (`:790-813`), replicated. A resolved
`mergeTargetId` counts as a merge only when **both** of these hold:

- it is in the candidate list sent to the model for that draft and variant (otherwise the reason is
  `not-in-candidates`), and
- `MemoryStore.getMergeTarget(id, 'D:\projects\ptah-extension')` on copy B′ is non-null (otherwise
  `ineligible`).

Every non-null id the model returned in this run passed both checks, so there were **0 refusals**.
Every resolve returned exactly one entry per draft.

## 4. Results

|                                                                                              |      Before | After-A (not chosen) | **After-B (shipped)** |
| -------------------------------------------------------------------------------------------- | ----------: | -------------------: | --------------------: |
| Attempts (identical 23 ids in every run)                                                     |          23 |                   23 |                    23 |
| Drafts with a non-empty candidate list                                                       |           8 |                   23 |                     8 |
| **Resolve calls that reached the LLM**                                                       |       **8** |               **23** |                 **8** |
| Resolve short-circuits (`related.length === 0`, `sdk-internal-query.curator-llm.ts:360-362`) |          15 |                    0 |                    15 |
| **Merges** (guard applied)                                                                   |       **8** |               **20** |                 **7** |
| **Merge rate**                                                                               | **34.78 %** |          **86.96 %** |           **30.43 %** |
| Tier-2 runs                                                                                  |           0 |                   23 |                     8 |
| Errors                                                                                       |           0 |                    0 |                     0 |

### Gate (judged on the variant chosen at Gate 2, D4 = B)

| Check                                                                         | Result                                        |
| ----------------------------------------------------------------------------- | --------------------------------------------- |
| Attempted set identical across all three                                      | **PASS**: the same 23 ids                     |
| merges(After-B) > merges(Before)                                              | **FAIL**: 7 is not greater than 8             |
| rate(After-B) > rate(Before)                                                  | **FAIL**: 30.43 % is not greater than 34.78 % |
| For reference: merges(After-A) > merges(Before), rate(After-A) > rate(Before) | pass: 20 against 8; 86.96 % against 34.78 %   |

**8(b) fails for the shipped variant. This is recorded as measured, as the plan requires
(plan:1028, Risks: "Under D4 option B, the M3 merge gate 8(b) fails").** Under the plan, the D4
choice goes back to the user with these numbers; option A needs explicit approval.

### Why After-B cannot beat Before on this set

- **After-B changes nothing on 15 of the 23 drafts.** Their tier 1 is empty, so under D4 = B tier 2
  never runs and resolve short-circuits exactly as in Before.
- **Those 15 are the whole of After-A's gain.** After-A merged **all 15** into a tier-2 neighbour.
  It also merged 5 of the 8 tier-1 drafts, which gives 20/23.
- **The selection rule favours such drafts.** It requires a close neighbour with a _different_
  subject, which is exactly where tier 1 finds nothing.
- **On the 8 drafts with a non-empty tier 1**, Before merged 8 of 8, into the same-subject tier-1
  row each time. After-B merged 7 of 8:
  - `01M04RSWF5TX151MCBJ153Q029` `ptah-compaction-architecture`: Before merged into its tier-1 row.
    After-A and After-B both returned `null`, so the draft is stored as new.
  - Two drafts merged into a **tier-2** row instead of their tier-1 row:
    - `compaction-hook-handler` merged into `compaction-safety-timeout-ms` (in both A and B)
    - `commitlint-scope-enum` (X2) merged into `commit scope registration ptah` (B)
  - X2 in After-A and X3 in After-A returned `null`.
- **Two causes are confounded, by design of the measurement.** Before uses the base prompt, which
  says "Prefer mergeTargetId when subjects match (case-insensitive)". After uses the branch prompt,
  which merges only on "the same fact, decision or preference", and "if unsure, set null". So
  After-B's 1-merge deficit mixes the prompt change with the wider list. With 8 LLM-backed drafts,
  one flip is inside the noise of a non-deterministic model.
- **Merge quality was not judged.** The plan's gate counts guarded merges. Whether each merge is
  right (for example `compaction-hook-handler` into `compaction-safety-timeout-ms`, or the After-A
  tier-2 merges) was not scored, and nothing here claims After-A's extra merges are correct.

### D4 cost: extra resolve calls over Before

|         | LLM resolve calls |                                                                                          Extra over Before |
| ------- | ----------------: | ---------------------------------------------------------------------------------------------------------: |
| Before  |                 8 |                                                                                                          — |
| After-A |                23 |                                              **+15** (every draft whose tier 1 was empty now makes a call) |
| After-B |                 8 | **0**: confirmed. It is the same 8 drafts, and tier 2 never caused a call that Before did not already make |

- **Why the cost is 15.** In production, `resolve` is one call per pass, not per draft
  (`memory-curator.service.ts:620-639`). So the After-A cost there is "one extra call in every pass
  whose drafts all have an empty tier 1", not "+15 per 23 drafts".
- **What this replay measures is the per-draft upper bound.** Here each draft is its own pass.

### Collector wall time (tier-2 path, real embedder and reranker, warm)

- **Warm-up:** one embed, 627 ms, before the first draft.
- **Before:** `findMergeCandidates` only. Median 0.46 ms, 16 ms total over 23 drafts.

| Variant | Drafts where tier 2 ran | Median ms when tier 2 ran | Max ms | Total ms (23 drafts) |                                   Median ms over all 23 |
| ------- | ----------------------: | ------------------------: | -----: | -------------------: | ------------------------------------------------------: |
| After-A |                      23 |                       595 |    862 |               13,501 |                                                     595 |
| After-B |                       8 |                       495 |    957 |                4,311 | 0 (15 short-circuits at the `tier1-empty` gate, ≤ 1 ms) |

Every tier-2 pass was one `searchRich` query, because each pass had one draft. The `tier2Skipped`
field was `null` wherever tier 2 ran, so no budget, timeout or error was hit.

## 5. Reranker (pre-existing; not changed)

- **All 31 rerank calls returned score 1.** Those are the calls made during candidate collection
  (After-A 23 + After-B 8). All 31 returned **a single distinct score, `1`**, and in all 31 the
  output order was **exactly the first 5 of the RRF input order**.
- **So every tier-2 set above is the RRF top 5 of its `searchRich` call.** A working cross-encoder
  would be expected to reorder the fused 20 before the top-5 cut, and so change which 5 rows tier 2
  contributes. It does not.
- **This affects which tier-2 rows were shown to the model,** in both After-A and After-B. It does
  not affect Before, which has no tier 2, or the attempted-set rule.
- **It was not fixed.** Per the senior-tester's diagnosis of `embedder-worker.ts:277-295`, this is
  a pre-existing production limitation outside this task.

## 6. Cost and network

All calls used the user's `claude` CLI login through `@anthropic-ai/claude-agent-sdk` `query()`.
The model resolved to `claude-haiku-4-5-20251001` on every call.

| Variant              |  Calls | Uncached input | Cache creation |  Cache read |     Output | SDK `total_cost_usd` | Sum of call durations |
| -------------------- | -----: | -------------: | -------------: | ----------: | ---------: | -------------------: | --------------------: |
| Before (old prompt)  |      8 |             80 |         56,496 |      66,035 |     10,464 |               0.1846 |               177.5 s |
| After-A (new prompt) |     23 |            230 |        141,040 |     221,309 |     36,158 |               0.5293 |               559.6 s |
| After-B (new prompt) |      8 |             88 |         23,848 |     122,092 |     13,566 |               0.1445 |               210.2 s |
| **Total**            | **39** |        **398** |    **221,384** | **409,436** | **60,188** |          **≈ 0.858** |               947.4 s |

- **Calls:** 39 LLM calls. The limit was 69 (23 × 3); 30 resolves short-circuited with no call.
  - All 39 had `result` subtype `success`.
  - 1 call used a tool: `Grep`, on X3 in After-B.
  - MCP was never requested (`mcpServerRunning: false` on every call).
- **Tokens:** input-side ≈ 0.63 M (uncached + cache creation + cache read). Output ≈ 0.06 M.
- **Wall clock:** the LLM phase ran 18:33:39Z → 18:39:37Z (≈ 6 min at concurrency 3).
- **Notional cost:** the `total_cost_usd` figures are SDK-reported and may be notional on a
  subscription login.
- **Local steps:** 8(a), the selection, and the collection made no network call (the 8(a) guard
  evidence is in `m3-reach.md`). The only network traffic in 8(b) is these 39 resolve calls.
