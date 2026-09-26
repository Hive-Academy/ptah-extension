# KNN starvation — TASK_2026_563_2939 (Phase 2)

Measurement table row **KNN starvation** (r1, finding 8). This is an **accepted limitation**: the
row is recorded, not gated. Raw output: `output/knn-starvation.raw.json`. Script:
`harness/branch-audit.ts knn`.

## Method

- **Code:** the BRANCH (HEAD `12252d5df`).
- **Embedder:** the REAL `EmbedderWorkerClient` (`lib/embedder.ts`, bge-small-en-v1.5 plus the
  ms-marco-MiniLM-L-6-v2 reranker), with `VecStatus.available = true` and sqlite-vec loaded. Both
  copies were opened `readonly`.
- **"Before 0049" and "after 0049" (plan wording).**
  - The prompt asked for the unmigrated copy as "before". The branch code cannot run on an
    unmigrated copy: every search statement names `m.quarantined_at`, a column that 0048 adds.
  - "Before 0049" is therefore **copy B** (`copyB-m3.sqlite`, 48 applied, 49 not). There, every
    `quarantined_at` is NULL, so the quarantine predicate is a no-op, exactly as on an unmigrated
    copy.
  - "After 0049" is a fresh copy, `knn-copyA49.sqlite` (48 + 49, 89 quarantined; started
    2026-09-26T18:31:34.106Z, backup 2,157 ms, integrity `ok`).
- **Queries:** Q1-Q4 (Track A) and the 8(a) draft query.
  - The 8(a) draft query is built exactly as the collector builds it:
    `` `${subject} ${content}`.trim().slice(0, 512) ``, 183 chars. It comes from row
    `01M2XACB41R4V4RCQ33WZ6RTTY`, `commitlint-scope-enum`, the newest in the workspace.
- **Paths measured:**
  - `searchRich(q, 5, ws)`: KNN `LIMIT` = 5 × 4 = 20
  - `searchIndex({ query: q, workspaceRoot: ws })`: topK 20, KNN `LIMIT` = 80
- **What is recorded per query:**
  - **KNN candidates:** rows the vec0 statement returned, before any join.
  - **Surviving join:** rows left after `mc.rowid IN (…) AND m.quarantined_at IS NULL AND
m.workspace_root IS ?`.
  - **Drop breakdown:** out of scope, or in scope but quarantined.
  - **BM25 rows.**
  - **Fused size:** the size of the fused list before slicing. It is reconstructed from the
    recorded BM25 and vector rowids with `executeFtsQueryPlan`'s merge rule, capped at 20.
  - **Final hit count.**

## searchRich (KNN LIMIT 20, topK 5)

| Query      | Copy        | KNN candidates | Surviving join | Dropped: other scope | Dropped: quarantined (in scope) | BM25 rows | Fused (≤ 20) | Final hits |
| ---------- | ----------- | -------------: | -------------: | -------------------: | ------------------------------: | --------: | -----------: | ---------: |
| Q1         | before 0049 |             20 |             20 |                    0 |                               0 |        20 |           20 |          5 |
| Q1         | after 0049  |             20 |             20 |                    0 |                               0 |        20 |           20 |          5 |
| Q2         | before      |             20 |             20 |                    0 |                               0 |        20 |           20 |          5 |
| Q2         | after       |             20 |             20 |                    0 |                               0 |        20 |           20 |          5 |
| Q3         | before      |             20 |             20 |                    0 |                               0 |        20 |           20 |          5 |
| Q3         | after       |             20 |             20 |                    0 |                               0 |        20 |           20 |          5 |
| Q4         | before      |             20 |             20 |                    0 |                               0 |        20 |           20 |          5 |
| Q4         | after       |             20 |         **19** |                    0 |                           **1** |        20 |           20 |          5 |
| 8(a) draft | before      |             20 |             20 |                    0 |                               0 |        20 |           20 |          5 |
| 8(a) draft | after       |             20 |         **11** |                    0 |                           **9** |        20 |           20 |          5 |

## searchIndex (KNN LIMIT 80, topK 20)

| Query      | Copy   | KNN candidates | Surviving join | Dropped: other scope | Dropped: quarantined (in scope) | Final rows |
| ---------- | ------ | -------------: | -------------: | -------------------: | ------------------------------: | ---------: |
| Q1         | before |             80 |             79 |                    1 |                               0 |         20 |
| Q1         | after  |             80 |             79 |                    1 |                               0 |         20 |
| Q2         | before |             80 |             80 |                    0 |                               0 |         20 |
| Q2         | after  |             80 |             80 |                    0 |                               0 |         20 |
| Q3         | before |             80 |             79 |                    1 |                               0 |         20 |
| Q3         | after  |             80 |             79 |                    1 |                               0 |         20 |
| Q4         | before |             80 |             79 |                    1 |                               0 |         20 |
| Q4         | after  |             80 |         **76** |                    1 |                           **3** |         20 |
| 8(a) draft | before |             80 |             80 |                    0 |                               0 |         20 |
| 8(a) draft | after  |             80 |         **51** |                    0 |                          **29** |         20 |

## Reading

- **Starvation is real but invisible on these queries.** After 0049, quarantined chunks take KNN
  slots:
  - 1 of 20 for Q4 on `searchRich`, and 3 of 80 on `searchIndex`
  - **9 of 20 and 29 of 80** for the commitlint draft, which is the worst case by construction,
    because its nearest neighbours are the quarantined family
- **The final hit counts never drop.** BM25 always supplies 20 rows, so the fused list stays full
  (20) and the page stays full (5 or 20).
- **What starvation costs is vector evidence.** For the 8(a) draft, the vector list shrinks from 20
  to 11 rows. After 0049 its top 5 changes at ranks 3-5 (`ptah-commitlint-scopes` and one
  `commitlint-scope-enum` row drop out; `commitlint` and two `ptah-extension` rows come in),
  because the quarantined neighbours are no longer eligible. That change is the intended effect of
  0049 on this draft, not a loss.
- **The page would under-fill only when BM25 is also short.** A query with fewer than about 20 BM25
  matches, whose vector neighbourhood is mostly quarantined or out of scope, would under-fill,
  because there is no refill round (`memory-search.service.ts:486-490`). None of the five measured
  queries is in that regime.
- **Q1-Q3 are unchanged by 0049** in every recorded count. **Q1-Q4 return the same 5 hit ids** on
  both copies: Q4's one starved KNN slot was not in its top 5. Only the 8(a) draft's hits change.

## Reranker (pre-existing, not changed by this task)

Every `searchRich` call above reached the rerank step, because the fused list had 20 rows (≥ 5).
Each of the 10 rerank calls:

- took 20 candidates and returned 5
- returned **one distinct score, `1`**, for all of them
- returned an output order that is **exactly the first 5 of its input order** (`outputIsInputPrefix`
  true in all 10)

So the final hits are the RRF order, sliced. Reranking is inert, as the senior-tester's separate
diagnosis of `embedder-worker.ts:277-295` predicts: a single-logit model, and softmax over one logit
is always 1.0. Where a reranker would normally reorder the top 5 (for example Q3, whose hits carry
vector ranks 7, 9, 20, 1, 11), it does not. `embedder-worker.ts` was not changed.
