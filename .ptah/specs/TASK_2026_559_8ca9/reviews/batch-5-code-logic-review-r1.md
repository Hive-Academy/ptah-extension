# Code Logic Review — `TASK_2026_559_8ca9`

## Summary

Batch 5 independent store-layer review: **REVISE, 6/10**. The RRF bound and freshness implementation hold. Two bounded gaps remain: Unicode case-insensitive lookup and mandatory execution of the recall guard. These separate this score from the sound 7–8 band; the ranking design itself is not broken.

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Moderate issues     | 2              |
| Failure modes found | 2              |

Read all four named files and the requested batch, executor, context, and research material; traced the caller, indexer, sink, FTS helper, migration, and CI. The task folder has no task-description.md, implementation-plan.md, or code-style-review.md; batches.md declares a plan-free bugfix. `ptah_search_files` found no AGENTS.md. No Ptah file-read tool was listed, so native reads were used. No production edits or git operations were performed. No raw session logs or real user databases were read. Review reproductions used better-sqlite3 `:memory:` databases and source transpiled in memory.

Evidence abbreviations:

- S = `libs/backend/memory-curator/src/lib/code-symbol.store.ts`
- T = `libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts`
- P = `libs/backend/memory-contracts/src/lib/code-symbol-reader.port.ts`
- I = `libs/backend/workspace-intelligence/src/services/code-symbol-indexer.service.ts`
- N = `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`

## Five logic questions

### 1. How does this fail silently?

The required recall test uses `maybe`, which becomes `it.skip` after a caught native-load failure (T:210, T:224, T:878). Injecting that failure registered 11 runnable tests and 20 skipped tests, including recall, without an exception. CI can succeed without measuring recall in that condition. This does not mean the current CI installation actually skips it (M2).

### 2. What user action produces unexpected behaviour?

A case-insensitive search for `äpfel` does not boost a stored `Äpfel` declaration because S:400 only folds ASCII. A caller mentioning the name can rank first (M1). Trailing whitespace is safe: S:335 trims before exact lookup.

### 3. What input data produces a wrong answer?

The Unicode case-pair fixture below reproduces the rank-1 selection gap (S:400). Many same-name rows do not break the returned-page bound: S:403 truncates exact candidates, but S:502 gives every admitted exact candidate sufficient priority. See the proof below.

### 4. What happens when a dependency fails?

Freshness SQL errors propagate from S:232, and exact SQL errors propagate from S:409; the current namespace catches reader rejection and returns an error field (N:110). Vector-query rejection logs and falls back to BM25 (S:349). Existing BM25 errors log and return an empty list (S:446), while the added exact tier may still return matches. Existing timeout/malformed-vector behavior was not changed or exhaustively fault-tested. Native test dependency failure is reproduced in M2.

### 5. What is missing that the requirements never mentioned?

A Unicode folding policy and an assertion that CI actually executed the guard are absent (S:400; T:224). No large-workspace latency budget is specified. The schema has no symbol-name index (`libs/backend/persistence-sqlite/src/lib/migrations/0013_code_symbols.ts:28`); this is a query-plan observation, not a reproduced performance failure.

## Failure modes

### M1 — Non-ASCII case-insensitive lookup loses the exact tier

- Trigger: requested name differs only in a non-ASCII letter's case, with no identical-case row.
- Symptom: a caller can outrank the declaration despite the batch's case-sensitive-then-insensitive requirement.
- Evidence: S:400 uses `COLLATE NOCASE`; S:411 filters only rows SQLite already returned. Requirement: `.ptah/specs/TASK_2026_559_8ca9/batches.md:1371`. The indexer and sink preserve names (I:438; `libs/backend/memory-curator/src/lib/symbol-sink.adapter.ts:20`), with no ASCII-only constraint.
- Current handling: missed Unicode variants receive only normal hybrid ranking. Exact identical-case Unicode names work.
- Reproduction: actual migration schema in better-sqlite3 `:memory:`, vectors disabled. Insert `Äpfel` in `a.ts` with text `function Äpfel() { ` + `lots of unrelated content `.repeat(80) + ` }`; insert `caller` in `b.ts` with text `äpfel äpfel äpfel`. `searchSymbols('Äpfel', 1, '/ws')` returns `a.ts`, score 0.13760683760683762. `searchSymbols('äpfel', 1, '/ws')` has zero exact candidates and returns `b.ts`, score 0.023076923076923075. JS Unicode escapes U+00C4/U+00E4 avoided shell encoding loss.
- Recommendation: define a Unicode-aware fallback key/comparison, retain identical-case preference and workspace scope, and add this case-pair plus distractor regression. ASCII-only matching does not cover all identifiers.

### M2 — Mandatory recall guard can skip rather than fail

- Trigger: native resolution or better-sqlite3 instantiation fails, including ABI mismatch.
- Symptom: all new native behavioral checks skip without causing a failing run.
- Evidence: T:210–224, T:878. Unconditional SQL-shape tests at T:147 and T:161 do not assert ranking. The batch requires a failing regression guard at batches.md:1343 and batches.md:1372.
- Current handling: catch discards the reason and selects `it.skip`. The gate predates this batch, but the newly required guard is placed behind it.
- Reproduction: transpiled the unmodified spec into an in-memory test-registration harness; injected failure in `require.resolve('better-sqlite3')`, collected `it` and `it.skip`. Result: 11 runnable, 20 skipped, `recallSkipped: true`, no exception. This proves the bypass, not that today's machine has a broken native installation.
- CI qualification: `.github/workflows/ci.yml:89` rebuilds better-sqlite3 for Node before affected tests at line 182. That mitigates ABI problems, but no CI-specific assertion in T:224 prevents skipping. Jest reports skips, so this is non-failing rather than literally invisible.
- Recommendation: fail native readiness with its cause in CI for this guard, or require a native test target whose execution is enforced by CI. A developer-only skip can remain if CI cannot take it silently.

## Blocking issues

None reproduced in Batch 5.

## Serious issues

None reproduced in Batch 5.

## Moderate and minor issues

- **Moderate M1:** S:400 — incomplete case-insensitive recall for valid non-ASCII identifiers.
- **Moderate M2:** T:224, T:878 — mandatory regression guard bypass on native failure.
- No additional scored findings. The executor's globally worded ranking claim needs qualification, but candidate truncation does not break the batch's rank-1 requirement.

## Data flow

1. **OK:** Indexer emits function/class names and qualified method names (I:438, I:470). Sink extracts and preserves the last colon-delimited name (`symbol-sink.adapter.ts:20`, `:46`).
2. **OK:** Namespace passes query, maxResults, root to the reader (N:91). Its existing post-search filePath filtering at N:96 is outside this store change.
3. **OK:** S:334 caps topK at 50; S:335 trims and handles blank input.
4. **M1:** S:394–412 binds query/root/limit, orders identical-case names first, but NOCASE excludes Unicode-only case variants.
5. **OK:** Exact list is limited to topK; BM25/vector request four times topK (S:338–345). Identical-case rows sort first before LIMIT, so fallback rows cannot truncate away an identical-case match.
6. **OK:** S:358 chooses weights, S:502 sums by rowid, and S:512 sorts and cuts to topK.
7. **OK:** S:232 executes one bound COUNT/MAX statement for one workspace. Empty aggregate yields `{symbolCount:0,newestUpdatedAt:null}`. Normal SQLite INTEGER values are numbers; the connection has no safe-integer/BigInt override. The optional port member at P:38 preserves implementer compatibility; `CodeIndexFreshness` is exported at `memory-contracts/src/index.ts:21`.

### RRF proof and exact-list truncation

At S:108, S:358, S:498–514, for one-based array ranks:

`score(r) = [r in E]*3/(25+rankE) + [r in B]*b/(25+rankB) + [r in V]*(1-b)/(25+rankV)`.

`b=0.6` for fewer than four tokens, otherwise 0.3. Rank is array position plus one, not raw BM25 score or vector distance. Rows present in all three lists receive all three terms. The sources have unique rowids; the BM25 fallback helper deduplicates (`fts-query.util.ts:185`). For a row absent from E, maximum score is `(b+1-b)/26 = 1/26`. Every admitted exact row has rankE <=50, hence score >= `3/75 = 0.04 > 1/26`. Vector unavailability only reduces the non-exact bound. There is no counterexample under these conditions.

The exact list **does truncate before fusion**, at S:403. Reproduced with 51 same-name rows and topK=50: exact list length 50, last file omitted. Supplying the omitted row at BM25 rank 2 to the actual fusion method gives 0.6/27 = 0.022222222222222223, below a non-exact row at BM25/vector rank 1 (1/26). Thus the literal global claim “every exact-name row in the database outranks every non-exact row” is false. However, the 50 admitted exact rows fill all 50 output slots and exclude both lower-scoring rows. When fewer than topK exact matches exist, all are admitted. **Returned-page exact priority and rank 1 remain valid.** No defect is filed for truncation.

### Query shape and workspace scope

- `handleToolsList `: trimmed at S:335 before whitespace detection. No miss.
- `Class.method`: dot is literal, not whitespace; exact lookup works. The production indexer actually stores qualified method names (I:470). Reproduction returned an exact candidate at rank 1.
- `foo()`: compares literally against symbol_name and does not boost stored `foo`; existing FTS sanitization strips parentheses (`fts-query.util.ts:153`). Reproduction returned `foo` through BM25. Call-expression normalization is not required for exact stored-name recall, so no defect is filed.
- Valid non-empty roots are bound and scope exact candidates (S:394). Undefined retains the existing raw-store all-workspaces behavior. Empty-string roots are also unscoped, consistently with the pre-existing BM25/vector convention (S:420, S:464); not a new Batch 5 contract.

### Performance follow-up

Real-schema in-memory EXPLAIN returned `SEARCH code_symbols USING INDEX idx_code_symbols_workspace (workspace_root=?)` plus `USE TEMP B-TREE FOR ORDER BY`. This scans the selected workspace and orders matching candidates; LIMIT does not make it a name seek. Freshness scans the workspace for MAX too. No large-workspace latency failure or threshold was reproduced, so deferring a name index is reasonable. The proposed `(workspace_root, symbol_name COLLATE NOCASE)` index should be reconsidered alongside the Unicode fix; an ASCII index alone cannot fix M1. An unscoped query needs separate consideration because workspace is that index's leading column.

## Requirements fulfilment

| Requirement                                      | Status   | Gap                                                       |
| ------------------------------------------------ | -------- | --------------------------------------------------------- |
| Optional freshness port member and exported type | COMPLETE | P:18, P:38; barrel present                                |
| One scoped COUNT/MAX; empty `{0,null}`           | COMPLETE | S:232; native fixture verified                            |
| Exact source and rank-1 priority                 | COMPLETE | S:338; bound proven for admitted candidates               |
| Case-sensitive then case-insensitive             | PARTIAL  | M1: ASCII-only fallback                                   |
| >=12 fixtures, recall@1 100%, recall@5 >=90%     | PARTIAL  | T:882–894 asserts 14 targets meaningfully; M2 allows skip |
| Natural-language target in top 5                 | COMPLETE | T:901 fixture passed; whitespace-query fusion unchanged   |
| Guard fails on retrieval regression              | PARTIAL  | Mutation caught when executed; M2 bypasses execution      |

Implicit requirements not addressed: Unicode folding policy and enforced CI guard execution. Lazy reindex orchestration belongs to Batch 6, not this batch.

## Edge cases

| Case                            | Handled | How                                 | Concern                          |
| ------------------------------- | ------- | ----------------------------------- | -------------------------------- |
| Blank query                     | YES     | S:335–336 empty page                | None introduced                  |
| Empty/unknown root freshness    | YES     | S:232 aggregate                     | Verified `{0,null}`              |
| Trailing whitespace             | YES     | Trim before lookup                  | None                             |
| Qualified method                | YES     | Literal stored name                 | Verified `Class.method`          |
| Call expression                 | YES     | Normal hybrid fallback              | No exact boost promised          |
| ASCII case collision            | YES     | Identical-case first before LIMIT   | T:984                            |
| Unicode case variant            | NO      | ASCII-only NOCASE                   | M1                               |
| More equal names than topK      | YES     | Exact candidates fill output        | Global claim needs qualification |
| Different workspace             | YES     | Bound predicate                     | T:1055                           |
| SQL punctuation                 | YES     | Bound equality and FTS sanitization | T:1024                           |
| Native dependencies unavailable | NO      | Recall test skips                   | M2                               |
| Very large workspace            | YES     | Correct bounded output              | Scan latency not benchmarked     |

## Verification evidence

- Requested command run once from worktree root: `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/memory-curator @ptah-extension/memory-contracts --skip-nx-cache`. Exit 0: curator test/lint/typecheck and contracts typecheck passed (four successful targets).
- Requested `node_modules/.bin/nx run @ptah-extension/memory-contracts:eslint:lint`: exit 0, lint passed. Nx Cloud separately reported an organization-plan 401; local lint still succeeded.
- Scoped `ptah_get_diagnostics` for store and port: TypeScript compiler, 0 errors, 0 warnings. This review did not rerun all consumer projects; optional P:38 imposes no additional member requirement on their existing doubles.
- Independently executed original recall, natural-language, and freshness callbacks using Jest assertions, actual store/FTS code, and real migration schema in `:memory:`. A minimal connection wrapper and disabled vectors isolated the BM25 path. All three passed. Replacing `exactNameSymbols` only on the process's prototype with `() => []` made the same recall assertion fail: all 14 targets ranked 2 or 3. This verifies the fixture catches regression when executed; it does not claim to reproduce the executor's hybrid mutation counts.
- Independently reproduced Unicode selection, whitespace trimming, qualified-name matching, pre-fusion truncation, and the native-gate registration bypass. No production source mutation was written.

## Verdict

- Recommendation: **REVISE**
- Confidence: **HIGH** for reproduced findings and fusion proof; large-workspace latency and current CI native readiness remain unmeasured.
- Top risk: the required recall guard can stop executing while the test target succeeds.
- What a robust implementation would add: Unicode-aware fallback and a distractor fixture; mandatory CI native readiness with a useful failure reason; precise ranking documentation. Track the name-index performance follow-up separately.
