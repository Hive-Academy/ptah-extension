# Track A Retrieval Review — `TASK_2026_473_c9f4`

## Verdict
ACCEPT

## Defects
*(No verified defects found. All investigated edge cases, security vectors, degenerate inputs, deduplication keys, ranking behavior, and bounded execution paths behave correctly as designed.)*

## What I checked and found correct

1. **Security regression & FTS5 grammar neutralization (`fts-query.util.ts:133-140`)**:
   - The sanitizer strips double-quotes `"` and metacharacters `* ( ) ^ : + - ~` by replacing them with spaces.
   - FTS5 boolean operators (`near`, `and`, `or`, `not`) are stripped case-insensitively.
   - Straight apostrophes `'` and curly/typographic apostrophes `’` are replaced with spaces (`.replace(/['’]/g, ' ')`), preventing grammar breakout and safely separating possessives and contractions (e.g. `"user's"` -> `"user"` + `"s"`, where `"s"` is dropped by `length > 1`).
   - Inputs consisting entirely of apostrophes (`'''`, `’'’`), metacharacters, or keywords collapse into empty token arrays resulting in the safe no-op match expression `'""'`.
   - All surviving tokens are wrapped in double quotes `"${t}"` (with `*` suffix on the final token only), precluding phrase or column injection.
   - All three call sites bind the match expression as a parameterized placeholder `?` in SQLite prepared statements.

2. **Empty and degenerate inputs (`fts-query.util.ts:141-154`)**:
   - Evaluated inputs: `""`, whitespace-only `"   "`, single characters `"a b c"`, metacharacters-only `"\" * ( ) ^ : + - ~ ' ’"`, FTS5 keywords only `"AND OR NOT NEAR"`, single stopword `"the"`, multi-stopword `"what did we do"`, single content term `"commitlint"`, and combined stopword/content queries `"what is commitlint"`.
   - Every input produces a well-formed `FtsQueryPlan` with valid SQLite FTS5 expressions; none causes syntax errors or crashes when executed against SQLite `MATCH`.
   - When a query contains only stopwords, `buildFtsQueryPlan` gracefully preserves recall by generating an `OR` match across the original tokens with `fallbackMatch: null`.
   - When a query contains a single content term, `buildFtsQueryPlan` outputs `match: '"<term>"*'` with `fallbackMatch: null`, avoiding redundant fallback query execution.

3. **Top-up rule & deduplication keys (`executeFtsQueryPlan`)**:
   - `bm25Search` (`libs/backend/memory-curator/src/lib/memory-search.service.ts:407`): Uses `keyOf: (row) => row.rowid`. Each row in `memory_chunks` has a unique integer primary key `rowid`. Verified deduplication is stable.
   - `bm25SearchByMemory` (`libs/backend/memory-curator/src/lib/memory-search.service.ts:894`): Uses `keyOf: (row) => row.memory_id`. The SQL query groups by `mc.memory_id`, so each row represents a unique string `memory_id`. Verified deduplication is stable.
   - `bm25SearchSymbols` (`libs/backend/memory-curator/src/lib/code-symbol.store.ts:371`): Uses `keyOf: (row) => row.rowid`. Each row in `code_symbols` has a unique integer primary key `rowid`. Verified deduplication is stable.
   - **BM25 Order and RRF Integration**:
     - Precise `AND` matches form the head of the list; `OR` fallback rows append only as needed to top up the page.
     - In `rrfFuse` (`memory-search.service.ts:501-509`), reciprocal rank score is computed strictly from array index position (`rank = idx + 1`). Prioritizing `AND` rows before `OR` rows correctly ensures precise hits receive higher BM25 rank contribution.
     - In `rrfFuseByMemory` (`memory-search.service.ts:957-960`), rank position is likewise computed from array index (`idx + 1`); the raw BM25 score in `row.rank` is not used directly for fusion.
     - The reranker path (`memory-search.service.ts:311-340`) relies on cross-encoder scoring of chunk text candidates and is unaffected by the composite origin of the candidate set.

4. **Execution cost & boundedness (`fts-query.util.ts:161-183`)**:
   - `executeFtsQueryPlan` executes `run(plan.match)` first.
   - A fallback query is dispatched if and only if `primary.length < limit` AND `plan.fallbackMatch !== null`.
   - The query execution is strictly bounded to at most 2 SQL statements per invocation.
   - There are no loops or recursive calls. Both SQL queries are bounded by `LIMIT ?`.

5. **Test suite integrity (`memory-search.service.spec.ts:494-504, 605-614`)**:
   - In `memory-search.service.spec.ts`, expected call counts on cache misses were updated from 1 to 2 (single cache miss) and from 2 to 4 (two cache misses with distinct workspaces) because the unit test mock fixtures provide fewer rows (2 rows) than the requested limit (`10 * 4 = 40`), appropriately triggering the fallback query.
   - The tests verify that subsequent identical requests hit the LRU cache and make 0 additional DB calls. The underlying contract (caching bypasses DB execution) remains fully proven and was not weakened.

6. **Stopword list analysis (`fts-query.util.ts:9-85`)**:
   - Examined all 65 tokens in `STOPWORDS`.
   - Identified domain terms that overlap with language keywords: `any` (TypeScript type), `of` (RxJS creator), `from` (RxJS creator / ES module import), `all` (Promise.all), `as` (TypeScript assertion), `this` (JS binding), `in` (TS keyword).
   - In queries combining technical terms with distinct concepts (e.g. `rxjs of operator` -> `operator`, `typescript any vs unknown` -> `unknown`), the remaining content terms guide the AND match. In queries containing exclusively stopwords, `buildFtsQueryPlan` falls back to the original tokens under OR. No crashes or unhandled states occur.

## Verified commands and real output

### 1. Test suite execution
Command:
```powershell
npx nx test @ptah-extension/memory-curator --skip-nx-cache
```

Real Output:
```text
 PASS   memory-curator  libs/backend/memory-curator/src/lib/embedder/embedder-worker-client.spec.ts (8.697 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts (9.252 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-curator.admission.spec.ts (10.455 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts (10.519 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/knowledge-agents/knowledge-agent.service.spec.ts (10.727 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.boot-defer.spec.ts (11.014 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/diagnostics.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts (11.278 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.coalesce.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-curator.service.spec.ts (11.41 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/embedder/embedder-status.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/retention/observation-retention.store.spec.ts (11.644 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.boot-scan-budget.spec.ts (11.681 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/di/register.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/retention/memory-lifecycle.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger.integration.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-search.service.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/salience-ranking.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/retention/retention-run-budget.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/curator-window-runner.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/knowledge-agents/corpus-filter.util.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/boot-scan-scheduler.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/workspace-fingerprint.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/transcript-windows.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-writer.dedup-parity.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory-writer.adapter.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/curator-job-queue.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/clamp-transcript.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/queue-slot-timeout.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/episode-tracker.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/fts-query.util.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/observation-queue.store.rekey.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/curator-llm/curator-pass-admission.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/knowledge-agents/corpus-suggestion.service.spec.ts (13.271 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/observation-queue.store.spec.ts (13.237 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts (13.359 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/memory.store.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/knowledge-agents/corpus.store.spec.ts
 PASS   memory-curator  libs/backend/memory-curator/src/lib/retention/memory-retention.integration.spec.ts (14.376 s)
 PASS   memory-curator  libs/backend/memory-curator/src/lib/retention/memory-lifecycle.store.spec.ts (16.838 s)
Test Suites: 42 passed, 42 total
Tests:       720 passed, 720 total
Snapshots:   0 total
Time:        18.333 s, estimated 26 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/memory-curator
```

### 2. Typecheck execution
Command:
```powershell
npx nx run-many -t typecheck -p @ptah-extension/memory-curator
```

Real Output:
```text
> nx run @ptah-extension/memory-curator:typecheck
> tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json

 NX   Successfully ran target typecheck for project @ptah-extension/memory-curator
```

### 3. Read-only live database execution on 36,278 memories
Executed the exact retrieval queries read-only against `%USERPROFILE%\.ptah\state\ptah.sqlite`:
- **Query 1**: `"what did we decide about the judge threshold"`
  - Plan: `match: '"decide" AND "judge" AND "threshold"*'`, `fallback: '"decide" OR "judge" OR "threshold"*'`
  - Top 5 hits returned:
    - Rank 1: `[fact] [skill-promotion-threshold] (-13.64)`
    - Rank 2: `[entity] [task-2026-245] (-13.59)`
    - Rank 3: `[fact] [skill-synthesis] (-10.98)`
    - Rank 4: `[fact] [p3-batch-1-committed] (-10.46)`
    - Rank 5: `[fact] [p3-enhancer-architecture] (-10.46)`
- **Query 2**: `"how do we name DI tokens"`
  - Plan: `match: '"name" AND "di" AND "tokens"*'`, `fallback: '"name" OR "di" OR "tokens"*'`
  - Top 5 hits returned:
    - Rank 1: `[fact] [workspace-intelligence-tokens] (-11.67)`
    - Rank 2: `[fact] [knowledge-agent-token] (-11.36)`
    - Rank 3: `[fact] [tsyringe-di-container-token] (-10.90)`
    - Rank 4: `[entity] [skill-synthesizer-service] (-10.17)`
    - Rank 5: `[fact] [ddi-symbol-mirror-pattern] (-10.01)`
- **Query 3**: `"why did the release branch drift"`
  - Plan: `match: '"release" AND "branch" AND "drift"*'`, `fallback: '"release" OR "branch" OR "drift"*'`
  - Top 5 hits returned:
    - Rank 1: `[fact] [release-branch-policy] (-14.23)`
    - Rank 2: `[fact] [ptah-release-branches] (-13.78)`
    - Rank 3: `[event] [pr-284-merge-conflict-resolution] (-12.82)`
    - Rank 4: `[fact] [release/electron] (-11.24)`
    - Rank 5: `[fact] [release-branch-merge-pattern] (-10.61)`
- **Query 4**: `"what is the user's preference for commit messages"`
  - Plan: `match: '"user" AND "preference" AND "commit" AND "messages"*'`, `fallback: '"user" OR "preference" OR "commit" OR "messages"*'`
  - Top 5 hits returned:
    - Rank 1: `[preference] [multi-agent-checkout-coordination] (-12.20)`
    - Rank 2: `[preference] [commit-batching] (-11.86)`
    - Rank 3: `[preference] [concurrent-agent-conflict-resolution] (-11.71)`
    - Rank 4: `[preference] [abdallah-git-workflow] (-11.35)`
    - Rank 5: `[preference] [di-refactor-commit-message-accuracy] (-11.08)`
