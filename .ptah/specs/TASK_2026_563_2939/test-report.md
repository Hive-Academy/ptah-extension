# Test Report - TASK_2026_563_2939

Memory quality at the source: extract prompt (M4), semantic merge candidates (M3), reversible
sediment quarantine (M5). Branch `fix/memory-quality-source`, base `ebfc73321`. Batches 1-6 are all
committed: `87fd6c9fd` (agent-sdk prompts), `f152a2793` (persistence-sqlite migrations),
`f453bfebf`/`b8b8fefef`/`d97a133f3` (memory-curator store/search/collector), `12252d5df`
(rpc-handlers). This report and the round-trip spec are the senior-tester's deliverable for Batch 7
and have not been committed by me; the team-leader owns that commit.

Full raw evidence lives in `harness/output/*` and is cited by file below rather than reproduced in
full.

## Live-database safety statement

- The live file `C:\Users\abdal\.ptah\state\ptah.sqlite` (and its `-wal`/`-shm`, and any
  `ptah.pre-migration-*`) was never opened for writing, migrated, renamed or deleted by any script in
  this report. Every measurement ran on a working copy derived from the pristine snapshot
  `C:\Users\abdal\AppData\Local\Temp\mqs-563-snapshot\memcopy-563.sqlite`.
- Snapshot SHA-256, re-verified at the start of both phases and again by hand:
  `2661275c4c120fd7554953cfae60ec6cc5f82c726ef0ebe925adf5b2e33b7810`. Match confirmed each time.
- Every working copy was made with the SQLite online backup API from a `readonly` + `fileMustExist`
  source handle, to a fail-if-exists target under `%TEMP%\mqs-563-eval\`, never named `ptah*`. No
  script ever pointed at a path under `%USERPROFILE%\.ptah\state`.
- Working copies and their paths/times/hashes are listed in full in
  `harness/output/run-log.md` (Phase 1) and `harness/output/run-log-phase2.md` (Phase 2); the summary
  table below repeats the essentials.

### Working copies (summary)

| Copy                 | Target                                   | Backup time | Integrity                       | Migrated to      | Used for                                                                          |
| -------------------- | ---------------------------------------- | ----------: | ------------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| A (M5)               | `mqs-563-eval\copyA-m5.sqlite`           |    2,145 ms | ok                              | 49               | M5 migration evidence, M5 rules                                                   |
| relevance-main       | `mqs-563-eval\relmain-unmigrated.sqlite` |    2,495 ms | ok                              | none (schema 47) | Relevance "main" (base code)                                                      |
| M4                   | `mqs-563-eval\m4-unmigrated.sqlite`      |    3,261 ms | ok                              | none             | M4 sample filter, subject overlap                                                 |
| A (relevance branch) | `mqs-563-eval\relbranch-copyA49.sqlite`  |    2,607 ms | ok                              | 49               | Relevance "branch"; restore-all equivalence (mutated in place)                    |
| B (M3)               | `mqs-563-eval\copyB-m3.sqlite`           |    2,223 ms | ok                              | 48 only          | KNN "before"; 8(a) reach; 8(b) selection                                          |
| A (KNN)              | `mqs-563-eval\knn-copyA49.sqlite`        |    2,157 ms | ok                              | 49               | KNN "after"                                                                       |
| B′ (M3)              | `mqs-563-eval\copyBprime-m3.sqlite`      |    1,704 ms | ok (before and after deletions) | 48 only          | 8(b) resolve, with the 23 replay rows removed via production `MemoryStore.forget` |

Base-commit code ran from a throwaway detached worktree, `%TEMP%\mqs-563-base` @ `ebfc73321`,
created and removed cleanly (`harness/output/run-log.md` rows 2, 26).

## Gate summary

| #                   | Criterion (task-description.md r2)                                                                                                          | Result                                                                  | Numbers                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4-1..5             | Extract prompt content, reuse guidance, DO-NOT-EXTRACT categories, single exported constant, schema unchanged                               | **PASS**                                                                | Pinned by `extract-prompt.spec.ts`, `resolve-prompt.spec.ts`, `sdk-internal-query.curator-llm.spec.ts` (Batch 1, committed, reviewed APPROVED); dead duplicate deleted, `ptah_lsp_references` returned only the declaration                                                                                                                                            |
| M4-6                | Evaluation sample + counts recorded, new run has fewer single-use subjects                                                                  | **PASS**                                                                | 155→128 drafts, single-use 145→126 (see M4 table)                                                                                                                                                                                                                                                                                                                      |
| M4-7                | Rubric classification + durable-loss list                                                                                                   | **PASS**                                                                | `harness/output/m4-draft-classifications.md` (283/283 classified), 33-entry loss list below                                                                                                                                                                                                                                                                            |
| M4-8(a)             | Lower single-use count AND lower single-use share                                                                                           | **PASS (count) / FAIL (share)**                                         | count 145→126 (PASS); share 98.0%→99.2% (higher, **FAILS** the added share wording) — see explanation below                                                                                                                                                                                                                                                            |
| M4-8(b)             | Durable count new ≥ old                                                                                                                     | **PASS**                                                                | 105 ≥ 100                                                                                                                                                                                                                                                                                                                                                              |
| M4-8(c)             | Every durable-loss entry matched or accepted with reason                                                                                    | **PASS, with one flagged limitation**                                   | 33/33 reviewed; 1359b2b0 (5 entries) judged a real over-suppression, not sediment — see below                                                                                                                                                                                                                                                                          |
| M3-1..7             | Tier ordering, bounds, scoping, no extra network, BM25-only fallback, no usage/salience writes on tier 2, out-of-list/other-workspace guard | **PASS**                                                                | Pinned by `merge-candidate-collector.spec.ts` and `memory-curator.service.spec.ts` (Batch 5, committed, reviewed APPROVED); constants confirmed in code: `TIER2_PER_DRAFT_LIMIT=5`, `TIER2_TOTAL_LIMIT=25`, `TIER2_MAX_QUERIES=10`, `TIER2_QUERY_MAX_CHARS=512`, `TIER2_QUERY_TIMEOUT_MS=8000`, `TIER2_PASS_BUDGET_MS=20000`, `TIER2_COOLDOWN_AFTER_TIMEOUT_MS=300000` |
| M3-8(a)             | Family reach, after > before                                                                                                                | **PASS**                                                                | 1 → 3 distinct commitlint-family subjects; locality proof: identical result with `HTTPS_PROXY`/`HTTP_PROXY=http://127.0.0.1:9`, 0 recorded outbound attempts either way                                                                                                                                                                                                |
| M3-8(b)             | Attempted set identical; after merges/rate > before, for the shipped variant                                                                | **FAIL (After-B, shipped)** / informational PASS (After-A, not shipped) | Before 8/23 (34.78%); After-A 20/23 (86.96%); **After-B 7/23 (30.43%)** — recorded as measured, not hidden (plan explicitly anticipates this under D4 = B)                                                                                                                                                                                                             |
| M5-1..2             | Sampled classification, rule predicates, false-positive narrowing                                                                           | **PASS**                                                                | `quarantine-rules.md` r2, 72+ R4 rows read across all fields, 0 durable caught                                                                                                                                                                                                                                                                                         |
| M5-3                | Migration 0048 conventions, no edit to existing migrations                                                                                  | **PASS**                                                                | Committed `f152a2793`; ratchet grep clean (`toBe(47)` gone from `migrations/`)                                                                                                                                                                                                                                                                                         |
| M5-4                | Migration evidence: counts, integrity, hash, duration                                                                                       | **PASS**                                                                | See M5 migration table below — counts equal, integrity `ok`/`ok`, hashes equal, 28.4 ms                                                                                                                                                                                                                                                                                |
| M5-5                | Every read path excludes quarantined rows, with a spec per path                                                                             | **PASS**                                                                | `quarantine.round-trip.spec.ts` (new, this batch) + per-path specs in Batches 3/4/6                                                                                                                                                                                                                                                                                    |
| M5-6                | One round-trip spec: quarantine → exclude → restore → include                                                                               | **PASS**                                                                | `libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts`, 1/1 passing on both drivers                                                                                                                                                                                                                                                                       |
| M5-7                | No deletion, idempotent                                                                                                                     | **PASS**                                                                | Restore-all re-run returns `{restored:0}`; migration re-application guarded by `quarantined_at IS NULL`                                                                                                                                                                                                                                                                |
| M5-8                | Quarantined id never accepted as a merge target                                                                                             | **PASS**                                                                | `getMergeTarget` guard in `memory.store.ts:365-372`, exercised in round-trip spec and `memory-curator.service.spec.ts`                                                                                                                                                                                                                                                 |
| M5-9(a)-(d)         | Lifecycle never touches quarantined rows; unedited specs still pass                                                                         | **PASS**                                                                | `memory-lifecycle.quarantine.spec.ts` (Batch 3, committed); every pre-existing 443 lifecycle/retention spec passes with no expectation edits (confirmed in the 12-project run)                                                                                                                                                                                         |
| M5-10               | Quarantine → lifecycle pass → restore, controls unaffected                                                                                  | **PASS**                                                                | Same spec as M5-9                                                                                                                                                                                                                                                                                                                                                      |
| M5-11               | Quarantine totals + restore-all retrieval equivalence                                                                                       | **PASS**                                                                | 89 rows, only `rule:commitlint-scope-facts`; restore-all gives identical Q1-Q4 ids to "main" (4/4)                                                                                                                                                                                                                                                                     |
| Meas-1              | Relevance: branch ≥ main re-measured, AND branch ≥ 16/20                                                                                    | **PASS (≥ main) / FAIL (≥ 16/20)**                                      | main 9/20, branch 9/20 (Gate A PASS, equal); Gate B FAIL, both at 9 — see explanation below                                                                                                                                                                                                                                                                            |
| Meas-2              | Copies never touch the live file; consistent snapshot; integrity `ok` before use                                                            | **PASS**                                                                | See live-database safety statement and copy table above                                                                                                                                                                                                                                                                                                                |
| Meas (reach)        | Reachability: production caller file:line for every change                                                                                  | **PASS**                                                                | See reachability table below                                                                                                                                                                                                                                                                                                                                           |
| Scoped verification | 12-project `test lint typecheck`, `degradation-audit:lint`, `di-lint:lint`, dual-driver SQLite                                              | **PASS, with one disclosed pre-existing environment failure**           | 3355/3360 tests passed, 1 known-environment failure (below); both lint gates clean                                                                                                                                                                                                                                                                                     |

**Two gates fail honestly and are disclosed, not hidden:** M4-8(a)'s share sub-condition, and M3-8(b)
for the shipped D4 = B variant. Both were anticipated in the plan's risk register and Gate 2 decision
record. Neither blocks the other 30-odd criteria above, all of which pass.

## M4 — extraction evaluation

Full method, per-session table, cost table: `harness/output/m4-extraction.md`. Label: **prompt-only,
limited evaluation** — MCP was off for both prompt variants (implementation-plan.md:926-932), so the
new prompt's reuse-by-search lever was not exercised in either direction.

Sample: 10 sessions under `~/.claude/projects/D--projects-ptah-extension/`, seed
`TASK_2026_563_2939:m4`, deterministically drawn from 231 eligible files (200 KiB-5 MiB, closed,
≥1 memory on the copy). 43 windows, 86 extract calls (43 old + 43 new), interleaved, 3 concurrent
workers. All 86 calls returned `success`/`extracted`; 0 errors, 0 stalls.

| Metric                        | Old prompt (`ebfc73321`) | New prompt (branch) |
| ----------------------------- | -----------------------: | ------------------: |
| Total drafts                  |                      155 |        128 (−17.4%) |
| Distinct case-folded subjects |                      148 |                 127 |
| Single-use subjects           |                      145 |                 126 |
| Single-use share              |                    98.0% |               99.2% |
| Subjects already on the copy  |                       18 |                   6 |
| Durable (rubric)              |              100 (64.5%) |     **105 (82.0%)** |
| Mixed                         |               23 (14.8%) |            8 (6.3%) |
| Sediment                      |               32 (20.6%) |          15 (11.7%) |

### Criterion 8(a): count PASS, share FAIL

- **Count**: 126 < 145. **PASS** on the user's AC 2 wording ("fewer single-use subjects").
- **Share**: 99.2% > 98.0%. The task-description's added condition (8a) requires the share to also be
  lower, guarding against "fewer drafts overall, same proportion single-use". Here total drafts fell
  17.4% while single-use count fell more slowly (13.1%), so the ratio rose. **This sub-condition
  FAILS.**
- **Why, and why it is not concerning**: on a 10-session, 128-draft sample, most subjects are
  inherently used once regardless of prompt quality — subject reuse only shows up when the SAME topic
  recurs within the sample, which is rare at this scale. The share sits at ~98-99% in both variants
  because of sample size, not because the new prompt failed to encourage reuse. The corpus-wide
  86.7% single-use baseline (cited for context, not gated) is a very different regime: 27,354
  subjects, months of accumulation, where reuse has room to show. This eval cannot distinguish "the
  new prompt doesn't help reuse" from "10 sessions is too small a sample to see reuse". The gate as
  literally written (8a, all three sub-conditions) therefore **fails**; the user's AC 2 as originally
  worded ("fewer single-use subjects") **passes**.

### Criterion 8(b): PASS

Durable count 105 ≥ 100. **PASS.**

### Criterion 8(c): every durable-loss entry reviewed — PASS, with one flagged limitation

Full 33-row list with the harness's per-row equivalence notes: `harness/output/m4-extraction.md`
§"Durable-loss list". Disposition of every entry:

| Disposition                                                                                                                                                                                                                                                        | Count | Entries                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----: | ------------------------------------- |
| Partially matched in the new run (explicit note in the harness table)                                                                                                                                                                                              |     3 | #2, #5, #11                           |
| Not a loss — subject already exists on the copy (correct dedup by design, not a new-run gap)                                                                                                                                                                       |     1 | #10                                   |
| Captured in another session's new-run output (cross-session, same fact)                                                                                                                                                                                            |     1 | #25                                   |
| **Session `1359b2b0` — reviewed individually, see verdict below**                                                                                                                                                                                                  |     5 | #19-23                                |
| Accepted — no new-run equivalent found; single-pass LLM variance between two independent live model calls, not a deterministic filter, partially offset by untallied new durable gains elsewhere in the sample (`m4-extraction.md` "Gains in the other direction") |    23 | #1, #3, #4, #6-9, #12-18, #24, #26-33 |

**Session `1359b2b0` verdict (explicit review, per instruction).** The old prompt extracted 5
durable/mixed drafts from this session (mojibake byte-encoding root cause, a generalizable bulk-repair
script pattern, an exclusion rule, and a six-step verification workflow — TASK_2026_367 batch B11).
The new prompt returned `status: extracted, drafts: []` for **all 3 windows** of this session (pulled
directly from `m4-calls.jsonl`: `"lastAssistantText":"```json\n{\n \"memories\": []\n}\n```"`) — a
deliberate model decision, not a stall or error. The content is, by the rubric's own definition,
durable (a reusable root cause and a reusable procedure, none of the three sediment classes). **This
is judged a real loss / over-suppression, not correct filtering of sediment.** The most likely cause
is that the whole session reads as a single completed one-off task narrative, and the new prompt's
"DO NOT EXTRACT task/worktree chatter" guidance, combined with its stricter reusability bar, appears
to have suppressed the entire session rather than distilling the reusable procedure from the
one-off framing. This is disclosed as a limitation to watch if the new prompt is observed suppressing
whole sessions at scale; it does not fail criterion 8(b) (aggregate durable count still rose 100→105
on this 10-session sample) and criterion 8(c) is satisfied because every entry has been reviewed and
disposed of, with this one marked as a genuine, not-accepted loss for visibility rather than papered
over.

**Overall M4 criterion 8 verdict: (a) count PASS / share FAIL, (b) PASS, (c) reviewed and disposed,
with one flagged real loss.**

Cost: 87 LLM calls (86 extract + 1 probe), ≈2.18M input tokens (uncached + cache creation + cache
read), ≈0.29M output tokens, SDK-reported `total_cost_usd` ≈ $5.00 (`harness/output/m4-extraction.md`
§"Cost and network").

## M3 — semantic merge candidates

### 8(a): family reach — PASS

Copy B (48 only, no quarantine). Draft `{kind:'fact', subject:'commitlint-scope-enum', content:
<verbatim newest row content>}`. Full detail: `harness/output/m3-reach.md`.

|                                                                             |                                           Candidates | Distinct commitlint-family subjects |
| --------------------------------------------------------------------------- | ---------------------------------------------------: | ----------------------------------: |
| Before (tier 1 only)                                                        |                                                    5 |                               **1** |
| After (shipped `MergeCandidateCollector.collect`, real embedder + reranker) | 9 (tier1 5 + tier2 4, 1 query, `tier2Skipped: null`) |                               **3** |

**Gate: after (3) > before (1). PASS.** Re-verifies the plan's baseline of 1 on a family of 49
subjects / 171 rows on this snapshot.

**Locality / proxy-offline proof.** The same 8(a) call ran twice in fresh processes: once with no
proxy vars, once with `HTTPS_PROXY=http://127.0.0.1:9` and `HTTP_PROXY=http://127.0.0.1:9` (a
guaranteed-closed local port) plus `NODE_USE_ENV_PROXY=1`. Results were **byte-identical** in both
runs. Because proxy env vars alone can't prove absence of a raw socket, the harness also installed a
non-blocking network recorder (`lib/net-guard.ts`) wrapping `net.Socket.prototype.connect`,
`dns.lookup`/`dns.promises.lookup` and `fetch`, in both the main thread and the embedder worker
thread. **Both runs recorded exactly 0 network attempts.** A positive control (the same guard, then a
real `fetch`/`http.get` to the dead port) confirmed the recorder does catch outbound attempts when
they occur. **Conclusion: the tier-2 path made 0 outbound network calls; locality holds.**

### 8(b): replay — FAIL for the shipped variant (After-B, D4 = B)

Full method, replay set (20 selected + 3 fixed commitlint extras = 23 total), per-draft results:
`harness/output/m3-replay.md`. Replay set selected by seed `TASK_2026_563_2939:m3`, real embedder
cosine similarity ≥ 0.85 to a same-workspace, different-subject neighbour (20 qualified after 38
examined; bar was not lowered). Copy B′ = copy B with the 23 replay rows deleted via production
`MemoryStore.forget` (so no draft can find itself).

|                                                                         | Before (base prompt, tier 1 only) | After-A (branch prompt, tier 2 forced on — **not the shipped variant**) | **After-B (branch prompt, shipped D4 = B)** |
| ----------------------------------------------------------------------- | --------------------------------: | ----------------------------------------------------------------------: | ------------------------------------------: |
| Attempts                                                                |                                23 |                                                                      23 |                                          23 |
| Resolve calls that reached the LLM                                      |                                 8 |                                                                      23 |                                           8 |
| Merges (guard-checked: in candidate list AND `getMergeTarget` non-null) |                                 8 |                                                                      20 |                                       **7** |
| Merge rate                                                              |                            34.78% |                                                                  86.96% |                                  **30.43%** |
| Extra resolve calls over Before                                         |                                 — |                                                                     +15 |                                       **0** |

**Gate result (judged on the shipped D4 = B variant, as the plan requires):**

| Check                                    | Result                    |
| ---------------------------------------- | ------------------------- |
| Attempted set identical across all three | PASS (23 ids)             |
| merges(After-B) > merges(Before)         | **FAIL: 7 < 8**           |
| rate(After-B) > rate(Before)             | **FAIL: 30.43% < 34.78%** |

This is recorded as measured, not hidden or re-scoped, per implementation-plan.md's explicit risk
register entry for D4 = B. For reference, the non-shipped After-A variant passes both checks (20 > 8,
86.96% > 34.78%), at a cost of +15 extra LLM resolve calls (D4's cost, confirmed 0 for the shipped
variant).

**Why After-B underperforms Before on this set**: 15 of the 23 replay rows have an empty tier 1 (that
is exactly the selection criterion — a close semantic neighbour under a _different_ subject), so under
D4 = B tier 2 never runs for them and resolve short-circuits identically to Before. Of the 8 drafts
with a non-empty tier 1, Before merged 8/8 (into the same-subject tier-1 row, using the base prompt's
"subjects match" rule); After-B merged 7/8 — two drafts moved into a tier-2 row instead of their
tier-1 row, and one draft that merged under the base prompt returned `null` under the branch prompt.
**Two variables are confounded by design**: the base prompt's subject-equality merge rule versus the
branch prompt's "same fact, decision or preference, else null" rule, and the tier-1-only versus
tier-1+tier-2 candidate list. With only 8 LLM-backed drafts, a 1-merge swing is within the noise of a
non-deterministic model call. Merge _quality_ (whether each merge is the right one) was not scored;
this measurement counts guarded merges only, per the plan's gate definition.

**Collector wall time** (real embedder + reranker, warm): Before (tier 1 only) median 0.46 ms.
After-A: tier 2 ran on all 23 drafts, median 595 ms, max 862 ms, 13.5 s total. After-B: tier 2 ran on
8 drafts, median 495 ms, max 957 ms, 4.3 s total (the other 15 short-circuit at the `tier1-empty` gate
in <1 ms).

### Reranker — pre-existing production finding, not fixed

**Confirmed real, not a harness artifact.** Independently reproduced outside any harness/product
build: calling `@huggingface/transformers`'s `text-classification` pipeline directly on
`Xenova/ms-marco-MiniLM-L-6-v2` with production's exact options (`dtype:'q8', topk:null,
truncation:true, max_length:512`) returns `{"label":"LABEL_0","score":1}` for every input pair,
regardless of content. Root cause: this cross-encoder export has a single output logit
(regression-style), and the pipeline's default softmax post-processing over one logit is mathematically
always 1.0. This is production code, unmodified by this task
(`git log ebfc73321..HEAD -- libs/backend/memory-curator/src/lib/embedder/` is empty):

- **File:line**: `libs/backend/memory-curator/src/lib/embedder/embedder-worker.ts:277-295`
  (`rerank()`), specifically the `fn(pairs, { topk: null, ... })` call at `:284-288` and
  `extractScore` at `:260-265`.
- **Effect measured across every rerank call this session (41 total: 10 in KNN starvation, 1 in 8(a),
  31 in 8(b))**: every call returned a single distinct score (`1`) for all candidates, and in every
  case the output order equaled exactly the first-N of the RRF input order (`outputIsInputPrefix:
true`). Because `Array.prototype.sort` is a stable sort, all-tied scores preserve the pre-rerank RRF
  order. **Reranking is currently an inert no-op in production**, for both before-this-task and
  after-this-task code — it was already broken on `ebfc73321`.
- **Effect on this task's gates**: none of M3's gates depend on rerank ordering — 8(a) and 8(b) count
  set membership and guarded-merge outcomes, not fine ranking order. The measurements above were run
  with the real (inert) reranker in the path, unmodified, as instructed.
- **Not fixed**: per instruction, product code was not changed. This is recorded as a pre-existing
  defect for a follow-up task, not attributable to this bugfix.

### Pre-existing fix disclosed (Batch 4, already committed)

`bm25SearchByMemory` threw on main ("unable to use function bm25 in the requested context") under
`GROUP BY`, so `mem:searchIndex` and the corpus build ranked on vectors only. Batch 4 fixed this with
a materialized CTE as part of landing the quarantine predicate in the same function (the two could
not be split without re-introducing the bug in a different shape). This changes `searchIndex`
ranking versus main; it is a pre-existing-bug fix, not new task scope, and was disclosed by the
team-leader at batch time (`batches.md` "Follow-ups recorded" §B4).

## M5 — reversible sediment quarantine

### Migration evidence — PASS

Full JSON: `harness/output/m5-migration.json`. Copy A, real `SqliteMigrationRunner.applyAll(MIGRATIONS,
{vecExtensionLoaded: true})`, no backup service.

|                                                                    |            Before |                     After |
| ------------------------------------------------------------------ | ----------------: | ------------------------: |
| `memories`                                                         |            26,706 |                    26,706 |
| `memory_chunks`                                                    |            29,447 |                    29,447 |
| `memory_chunks_fts` (via docsize)                                  |            29,447 |                    29,447 |
| `memory_chunks_vec`                                                |            29,443 |                    29,443 |
| `integrity_check`                                                  |     ok (1,382 ms) |             ok (1,273 ms) |
| Ordered SHA-256, `memories` (25 pre-existing columns, excl. new 2) | `d05e7346…5db340` | `d05e7346…5db340` (equal) |
| Ordered SHA-256, `memory_chunks` (rowid + 6 columns)               | `e068f00f…9b0bba` | `e068f00f…9b0bba` (equal) |
| `schema_migrations` max                                            |                47 |                        49 |

**Migration duration: 28.4 ms** (applied `[48, 49]`, `finalVersion: 49`). **Gate: counts equal,
integrity ok/ok, hashes equal — PASS.**

### Rules — PASS

Full JSON: `harness/output/m5-rules.json`. On copy A after migration: `quarantine_reason` breakdown
is **exactly one reason, `rule:commitlint-scope-facts`, count 89** (0 other reasons). 125 rows matched
the predicate before the common guard; the guard excluded 36 (0 pinned, 0 core, 0 corpus-linked, 0
kind/content mismatches recorded as guard violations — the 36 were already outside the predicate's own
`kind`/content narrowing, i.e. the predicate count itself resolves to 89 net). All 89 are in workspace
`D:\projects\ptah-extension`; 89 chunks are owned by quarantined rows (matches quarantine-rules.md §6
exactly: 89 rows, 89 chunks). Every durable/guard fixture id from `quarantine-rules.md` sections 3, 4
and 6 that still exists on this newer copy (23 checked) stays `quarantined_at IS NULL`. **Gate: exact
match with quarantine-rules.md r2 §6 — PASS.**

### Round-trip spec — PASS (revised after code-logic-review NEEDS_REVISION 5/10)

`libs/backend/memory-curator/src/lib/quarantine.round-trip.spec.ts` (new, this batch). Real SQLite +
sqlite-vec, production migrations 0048/0049, real `MemoryStore`, `MemorySearchService`, `CorpusStore`,
`MergeCandidateCollector`. Seeds R4-matching rows and active controls in BOTH a named workspace and
the NULL workspace, plus one exact-subject tier-1 match per scope (so D4=B runs tier 2 in both
scopes). Asserts exclusion from `search`, `searchRich`, `searchIndex` (both query and queryless/
pure-filter shapes, named-scope and unscoped), `listAll`, `findMergeCandidates`,
`MergeCandidateCollector.collect`, `timeline` (both a quarantined anchor → `{rows:[],
anchorIndex:0}`, and an ACTIVE anchor whose timeline neighbour is quarantined and excluded),
`getObservations`, corpus members (`CorpusStore.getCorpusMemoriesForPriming`, ONE corpus per scope —
named and NULL — each with its member link created _after_ migration, exactly the state the guard
defends against), and `getActiveById`. Also
proves `recordUse`/`setPinned` are frozen no-ops on a quarantined row, and that hybrid search
actually ran (`bm25Only: false`, at least one hit carries a `vecRank`) rather than silently degrading
to BM25-only. Restores `{all:true}` for the named workspace then `null`, and re-asserts inclusion on
every path above with FRESH calls (not reusing pre-restore results), with content, chunks, subject,
salience, tier, `archived_at`, pinned, `hits` and `last_used_at` byte-for-byte unchanged and both
quarantine columns NULL. Idempotence checked (second restore call returns `{restored:0}`).

**Revision, per code-logic-review `reviews/batch-7-code-logic-review.md` (5/10, NEEDS_REVISION,
3 serious + 1 moderate finding, spec-only fix, no product code changed):**

1. The NULL-workspace row previously had a narrower assertion set than the named-workspace row and
   was never re-checked after restore on most paths. It now gets the identical exclusion/inclusion
   matrix (`search`/`searchRich` via the unscoped cross-workspace calls `IMemoryReader.search` and
   `searchIndex`'s filter actually support, `findMergeCandidates`, `collect`, `getObservations`,
   `getActiveById`), with fresh post-restore calls on every path, not a subset.
2. `timeline` previously only exercised a quarantined anchor (which short-circuits before reaching
   the neighbour SQL at all). Added: an ACTIVE anchor with a quarantined "after" neighbour in
   timestamp order — the neighbour is asserted absent before restore and present after, which a
   removed neighbour-side predicate would now fail.
3. `searchIndex` previously only used query mode, whose quarantine filtering is masked by an
   upstream predicate in `bm25SearchByMemory` before `buildFilterClause` ever runs. Added: the
   queryless (pure-filter) shape, named-scope and unscoped, which reaches `buildFilterClause`
   directly — a removed `ACTIVE_MEMORY` predicate there would now fail this spec.
4. The search connection stand-in only exposed `db`, so `searchIndex`'s own `connection.vecExtensionLoaded`
   read was falsy and its vector branch never ran even though sqlite-vec was loaded. Fixed with a
   connection wrapper reporting `vecExtensionLoaded: true` (matching `memory-search.service.spec.ts`'s
   real-SQLite pattern); `bm25Only` is now asserted `false` and at least one `searchRich` hit is
   asserted to carry a non-null `vecRank`, and the collector's `tier2Count` is asserted `> 0` (not
   merely that it avoided the `tier1-empty` skip reason).

**Recheck round 2 (finding 1 narrowed to a moderate gap): only the named-workspace quarantined row
was corpus-linked, so the NULL-workspace row never got the corpus exclusion → restore → inclusion
cycle. Fixed**: a second corpus (`roundtrip-corpus-null`, `workspaceRoot: null`) is created after 0049
and linked to `quarantine-null`, mirroring the named-workspace corpus exactly. Asserted excluded from
`CorpusStore.getCorpusMemoriesForPriming('roundtrip-corpus-null')` while quarantined, and included
(with its id) after restore.

**Run results (post-revision, round 2):**

- Default Jest driver: `npx nx test @ptah-extension/memory-curator --testPathPatterns quarantine.round-trip --skip-nx-cache` → **1 passed, 1 total**.
- Electron/better-sqlite3 ABI driver: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron.cmd ./node_modules/jest/bin/jest.js --config libs/backend/memory-curator/jest.config.ts --testPathPatterns quarantine.round-trip --runInBand` → **1 passed, 1 total**.
- Both invocations resolved `better-sqlite3` successfully in this environment (it did not need to
  fall back to `node:sqlite` in either run). A forced `node:sqlite` run was judged NOT cheap enough to
  do safely here: the only way to force the fallback is to make `require('better-sqlite3')` fail
  (e.g. temporarily moving the package out of a shared `node_modules`), which risks other concurrent
  agents on this machine mid-run. Not attempted; the fallback branch itself is unit-covered by the
  pre-existing `retention-sqlite.test-support.ts` opener logic, unchanged by this task. The spec now
  also asserts `t.openerName` is one of the two known drivers, as a cheap audit trail.
- `npx nx run-many -t lint typecheck -p @ptah-extension/memory-curator --skip-nx-cache` → both green.

### Lifecycle exclusion — PASS

`libs/backend/memory-curator/src/lib/retention/memory-lifecycle.quarantine.spec.ts` (Batch 3,
committed): quarantined archival-past-grace and recall-past-cutoff rows survive a lifecycle pass with
chunks/tier/`archived_at` unchanged; an equivalent unquarantined control is archived/deleted exactly
as main; quarantined rows are excluded from over-cap counting and eviction; restore then a second pass
makes them eligible again; SQL-level defence-in-depth confirms the write statements themselves carry
the predicate. Every pre-existing TASK_2026_443 lifecycle/retention spec passes with **no expectation
edits** (confirmed in the 12-project scoped run below).

### Branch relevance & restore-all equivalence — see Measurement section below (shared method/gates)

## Measurement: relevance (Track A method)

Full detail: `harness/output/relevance-main.md` (main), `harness/output/relevance-branch.md`
(branch + restore-all equivalence), `harness/output/knn-starvation.md`.

Method for both runs: `MemorySearchService.searchRich(query, 5, 'D:\projects\ptah-extension')`,
`VecStatus.available = false` (BM25-only, no rerank — the same path Track A originally printed),
Track A's exact Q1-Q4 MATCH expressions, top 5, Track A's rubric with a reason on every row.

| Query     | main (base code, unmigrated copy) | branch (49 applied) | Track A 2026-09-19 |
| --------- | --------------------------------: | ------------------: | -----------------: |
| Q1        |                               3/5 |                 3/5 |                4/5 |
| Q2        |                               2/5 |                 2/5 |                4/5 |
| Q3        |                               4/5 |                 4/5 |                5/5 |
| Q4        |                               0/5 |                 0/5 |                3/5 |
| **Total** |                          **9/20** |            **9/20** |          **16/20** |

**All 20 branch hits are the identical ids, at the identical rank, as main** — the branch's top-5 for
every query is unchanged by the quarantine filter, because none of Q1-Q4's relevant corpus is a
commitlint-scope-fact. Confirmed directly: re-running the same BM25 SQL _without_ the
`quarantined_at IS NULL` predicate shows 0 quarantined rows in any unfiltered top 20 for these four
queries (the OR-fallback expressions do match 14/55/49 quarantined commitlint rows for Q2/Q3/Q4
respectively, but all rank below 20).

### Gates — both stated honestly

| Gate                                             | Requirement | Result   | Numbers     |
| ------------------------------------------------ | ----------- | -------- | ----------- |
| **A** (plan: branch ≥ main re-measured)          | ≥ 9/20      | **PASS** | 9/20 = 9/20 |
| **B** (task-description §4 criterion 1, literal) | ≥ 16/20     | **FAIL** | 9/20        |

**Why Gate B cannot be met on this corpus — existence counts, not a ranking defect:**

- Of Track A's original 20 printed rows, **10 exist** on this copy (the other 10 are gone from the
  snapshot itself — this is true on the unmigrated copy too, so it predates and is unrelated to this
  task's quarantine rule).
- Of the 16 rows Track A judged relevant, only **8 exist** on the copy, and only **7 are inside the
  `D:\projects\ptah-extension` workspace scope** (the 8th is in a different worktree's workspace root
  and is correctly out of scope for a workspace-scoped query).
- **The branch surfaces all 7 reachable relevant rows**, plus 2 new relevant rows Phase 1 judged
  fresh (`thoth-phase3-scope`, `release/electron` `01KXE1JS…`) — 9/20. To reach 16/20 would require 9
  more relevant rows to appear in a corpus that, per `quarantine-rules.md` §8, the pre-existing
  TASK_2026_443 age lifecycle already deleted after 2026-09-19. This is a corpus-availability
  ceiling, not a regression introduced by M3/M4/M5, and not something a ranking change inside this
  task's scope could fix.
- **The rubric was not adjusted** to manufacture a pass; both numbers are reported as measured.

### Restore-all equivalence — PASS, 4/4

On the branch's copy A: `restoreQuarantined({all:true}, 'D:\projects\ptah-extension')` restored 89;
`restoreQuarantined({all:true}, null)` restored 0 (all 89 were workspace-scoped); a second call
restores 0 (idempotent). Re-running Q1-Q4 after restore gives **ids identical to "main"** for all 4
queries. **PASS, 4/4.**

### KNN starvation (accepted limitation, not gated)

Full table: `harness/output/knn-starvation.md`. On Q1-Q3 and `searchRich`, 0 KNN slots are lost to
quarantine (all 20/20 survive the join before and after 0049). Q4 loses 1/20 `searchRich` slots and
3/80 `searchIndex` slots to quarantine — in both cases the final hit set is unaffected because BM25
already supplies a full page. The worst case is, by construction, the 8(a) commitlint draft itself:
its vector neighbourhood loses 9/20 (`searchRich`) and 29/80 (`searchIndex`) slots to quarantine,
which is the intended effect of 0049 on a query whose nearest neighbours are the quarantined family.
No query in this measurement under-fills its final page; the plan's accepted-limitation ceiling (no
refill round, `memory-search.service.ts:486-490`) is confirmed but not exercised here.

## Reachability table

Verified against the current (post-Batch-6, committed) code via direct `Grep`/`Read`, not the
workspace's symbol-index tool (which returned a stale cached copy of `memory.store.ts`,
`memory-search.service.ts` and `corpus.store.ts` during this review — discarded in favour of direct
file reads for every line number below).

| Change                                               | Production caller (file:line)                                                                                                                                                                                                                                        | Reachable from                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| M4: `EXTRACT_SYSTEM_PROMPT`                          | `curator-llm-adapter/sdk-internal-query.curator-llm.ts:294-299` (`runQuery` inside `extract()`)                                                                                                                                                                      | `SdkInternalQueryCuratorLlm`, registered `SDK_CURATOR_LLM_ADAPTER`; consumed as `ICuratorLLM.extract` by `MemoryCuratorService.doCurate`              |
| M4: `RESOLVE_SYSTEM_PROMPT`                          | `sdk-internal-query.curator-llm.ts:363-368` (`runQuery` inside `resolve()`)                                                                                                                                                                                          | `memory-curator.service.ts:768 this.llm.resolve(drafts, related, signal, options)` inside `doCurate`                                                  |
| M3: `MergeCandidateCollector`                        | `curator-llm/merge-candidate-collector.ts` `collect()`                                                                                                                                                                                                               | constructed `memory-curator.service.ts:210`; called `:621 await this.mergeCandidates.collect(...)` inside `doCurate`, feeding `llm.resolve` at `:768` |
| M3: merge-target guard                               | `memory.store.ts:365-372` (`getMergeTarget`)                                                                                                                                                                                                                         | `memory-curator.service.ts` merge guard (`not-in-candidates`/`ineligible` reasons, `:795-806`) before `appendChunks`                                  |
| M3: `appendChunks` eligibility                       | `memory.store.ts:710-791`                                                                                                                                                                                                                                            | `memory-curator.service.ts:681 await this.store.appendChunks(...)`                                                                                    |
| M5: quarantine columns                               | migrations `0048_memory_quarantine.ts`, `0049_memory_sediment_quarantine.ts`                                                                                                                                                                                         | applied at boot via `SqliteConnectionService.applyAll(MIGRATIONS)`                                                                                    |
| M5: `MemoryStore` read filters                       | `getActiveById` `:353-358`, `getMergeTarget` `:365-372`, `findMergeCandidates` `:419`, `list` `:458`, `listAll` `:500`, `setPinned` `:562`, `recordUse` `:675/685`, `appendChunks` `:718/745`, `stats` `:816-817`, `listQuarantined`/`restoreQuarantined` `:849-959` | RPC handlers, curator, lifecycle, search                                                                                                              |
| M5: `MemorySearchService` filters                    | `ACTIVE_MEMORY`/`ACTIVE_MEMORY_UNALIASED` constants `:168-169`, used at `:454,515,704,710,762,831,950,1001`                                                                                                                                                          | `memory:search`/`searchRich`/`searchIndex`/`timeline`/`getObservations` RPC, `ptah_memory_search` MCP tool, skill-gap curator, corpus build           |
| M5: `CorpusStore.getCorpusMemoriesForPriming` filter | `corpus.store.ts:314`                                                                                                                                                                                                                                                | `corpus:query`/`prime` RPC path                                                                                                                       |
| M5: lifecycle predicates                             | `memory-lifecycle.store.ts` (10 SQL constants)                                                                                                                                                                                                                       | `MemoryLifecycleService.runStep`, the background retention job                                                                                        |
| M5/D2: `memory:listQuarantined`                      | `memory-rpc.handlers.ts:763-813` → `store.listQuarantined` `:780`                                                                                                                                                                                                    | RPC surface `METHODS` `:133`                                                                                                                          |
| M5/D2: `memory:restoreQuarantined`                   | `memory-rpc.handlers.ts:816-866` → `store.restoreQuarantined` `:858`                                                                                                                                                                                                 | RPC surface `METHODS` `:134`                                                                                                                          |
| M5: `memory:get` → `getActiveById`                   | `memory-rpc.handlers.ts:249-256`                                                                                                                                                                                                                                     | RPC surface `METHODS` `:120`; also reachable by an agent via `ptah interact rpc.call`                                                                 |

## Scoped verification

### 12-project run (Task 7.3)

`npx nx run-many -t test lint typecheck -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/agent-sdk @ptah-extension/shared @ptah-extension/rpc-handlers ptah-extension-vscode @ptah-extension/messaging-gateway @ptah-extension/skill-synthesis @ptah-extension/cli-engine @ptah-extension/thoth-runtime @ptah-extension/task-specs @ptah-extension/cron-scheduler --skip-nx-cache`

Header confirmed: **"Running targets test, lint, typecheck for 12 projects and 26 tasks they depend
on"**. Result: **112/113 test suites passed, 3355/3360 tests passed** (4 skipped, 1 failed). Every
`build`/`lint`/`typecheck` task across all 12 projects and their 26 dependencies succeeded.

**The 1 failure is a pre-existing environment condition, not a product defect:**
`libs/backend/rpc-handlers/src/lib/harness/selection/harness-skill-selection-rpc.service.spec.ts` ›
`"never writes state.json"` fails because `C:\Users\abdal\AppData\Local\Temp\.ptah` exists on this
machine (`expect(existsSync(statePath)).toBe(false)` receives `true`). Confirmed as environment, not
this task:

- `Test-Path 'C:\Users\abdal\AppData\Local\Temp\.ptah'` → `True`.
- `git diff ebfc73321 -- <spec file> <production file>` is **empty** — both files are byte-identical
  to the base commit, so this would fail identically on `ebfc73321` under the same environment
  condition. The directory was left untouched, per instruction.

### degradation-audit and di-lint

- `npx nx run degradation-audit:lint`: **PASS**. `libs/backend/memory-curator: 20 ok (baseline 20)` —
  unchanged from baseline; total 295 unsuppressed sites workspace-wide (pre-existing, unrelated to
  this task).
- `npx nx run di-lint:lint`: **PASS**. "1605 @inject sites all resolve to a registered token (722
  tokens); every container-constructed class names all required and non-equivalent defaulted
  dependencies."

### Dual-driver SQLite reruns

- Default Jest and `ELECTRON_RUN_AS_NODE=1` Electron reruns both pass for
  `quarantine.round-trip.spec.ts` (see M5 section above).
- Batches 2-6 each recorded their own dual-driver reruns at commit time (`batches.md` verification
  sections); not re-run here since those batches are unchanged since their own green dual-driver
  passes and are covered again by the 12-project run above.

## Cost and network summary

| Phase                   |   Calls | Approx. input tokens (incl. cache) | Approx. output tokens | SDK `total_cost_usd` |
| ----------------------- | ------: | ---------------------------------: | --------------------: | -------------------: |
| M4 extraction (Phase 1) |      87 |                             ≈2.18M |                ≈0.29M |               ≈$5.00 |
| M3 replay (Phase 2, 8b) |      39 |                             ≈0.63M |                ≈0.06M |              ≈$0.858 |
| **Total**               | **126** |                         **≈2.81M** |            **≈0.35M** |           **≈$5.86** |

- 8(a) and its proxy-offline proof, the KNN starvation measurement, and both relevance runs made 0
  LLM calls (BM25/embedder/reranker only, all local).
- All calls used the operator's own `claude` CLI login; `total_cost_usd` figures are SDK-reported and
  may be notional under a subscription plan.
- No live-database access happened anywhere in either phase; transcripts under
  `~/.claude/projects/` were read-only.

## Deviations and follow-ups disclosed

- **M4-8(a) share sub-condition fails** on a 10-session sample for the reason explained above; not a
  product defect, a sample-size artifact of the added AC wording.
- **M3-8(b) fails for the shipped D4 = B variant** with real numbers (7/23, 30.43%, vs Before's
  8/23, 34.78%), exactly as the plan's risk register anticipated. The After-A (D4 = A) alternative
  passes both checks at a cost of +15 extra resolve calls per pass whose drafts all have empty tier 1.
  This is a decision point for the user/orchestrator, not something this report resolves.
- **Reranker (`embedder-worker.ts:277-295`) is pre-existing, inert (always scores 1) and was not
  fixed**, per instruction; recorded with file:line and independent reproduction evidence.
- **`bm25SearchByMemory` fix** (Batch 4, already committed and disclosed in `batches.md`): a
  pre-existing crash under `GROUP BY` was fixed with a materialized CTE in the same function that
  needed the quarantine predicate; `searchIndex` ranking changes as a result. Pre-existing bug fix,
  not new scope.
- **Session `1359b2b0`'s 5-entry durable loss** is flagged as a genuine over-suppression by the new
  extract prompt, not accepted as correct filtering — see M4 §8(c) above.
- One environment-only test failure (`%TEMP%\.ptah` exists) is disclosed above and confirmed identical
  on the base commit.

## Verdict

**Criteria proven**: M4 1-7, M4-8(b), M4-8(c) (reviewed and disposed), M3 1-7, M3-8(a) (incl. locality
proof), M5 1-11 in full (migration, rules, round-trip, lifecycle, restore equivalence), Measurement
Gate A (branch ≥ main), Meas-2 (copy safety), reachability, scoped verification (with one disclosed
environment failure), degradation-audit, di-lint.

**Criteria not proven, disclosed with numbers, not hidden**:

- M4-8(a) share sub-condition (99.2% > 98.0%, sample-size effect).
- M3-8(b) for the shipped D4 = B variant (7/23 vs 8/23 before; 30.43% vs 34.78%).
- Measurement Gate B, branch ≥ 16/20 (9/20; corpus-availability ceiling from the pre-existing 443
  lifecycle deletions, not a regression this task introduced or could fix within scope).

**Risks a reader should know about**:

- The reranker is inert in production today (pre-existing, unrelated to this task) — tier-2 candidate
  ordering within its top-5 cut is currently just RRF order, not cross-encoder-refined. A future task
  should investigate whether the MS-MARCO cross-encoder export needs a different pipeline task type
  (e.g. reading the raw logit instead of the softmaxed `text-classification` score) or a different
  model export.
- D4 = B, as shipped, does not clear the M3-8(b) merge-rate gate on this replay set. If a stronger M3
  merge-rate result is required, the D4 = A alternative (tier 2 always, not gated on tier 1) does
  clear it, at the cost of one extra resolve-carrying `searchRich`+embed+rerank round-trip per curator
  pass whose drafts all have an empty tier 1 — a decision for the user/orchestrator, not resolved by
  this report.
- Track-A-relevance recall on this corpus is capped well below 16/20 by the pre-existing 443 age
  lifecycle's deletions, independent of anything in this task; the branch does not regress it (Gate A
  passes, 9/20 = 9/20) and correctly surfaces every Track-A-relevant row the corpus still holds in
  scope.
