# Code Style Review — `TASK_2026_563_2939`, Batch 4

> **Status note (post-review).** Added after this review, without changing the reviewer's verdict.
> Two things changed in `memory-search.service.ts` during the Batch 4 logic recheck:
>
> - Both cache keys (`makeCacheKey`, `makeIndexCacheKey`) are now JSON tuples (`JSON.stringify([...])`).
>   The `|`-delimiter collision risk has been resolved.
> - `searchIndex` normalises `workspaceRoot: ''` to "omitted" before it builds the cache key or the SQL.
>   `null` is outside the `searchIndex` API contract (`MemSearchIndexFilter.workspaceRoot` is
>   `string | undefined`).
>
> Treat these statements below as historical: section 4 item 2 (the delimiter-separated `makeCacheKey`),
> minor issue 2 (the `searchIndex` scope disparity, as far as `''` handling is concerned), and the
> file-by-file bullet on `makeCacheKey` and its `\u0000null` sentinel. The line numbers are those at
> review time.

## Summary

| Metric          | Value                                                    |
| --------------- | -------------------------------------------------------- |
| Overall score   | 8/10                                                     |
| Assessment      | APPROVED                                                 |
| Blocking issues | 0                                                        |
| Serious issues  | 0                                                        |
| Minor issues    | 3                                                        |
| Files reviewed  | 2 files in full (1 production, 1 spec, 2817 lines total) |

Batch 4 implements exact tri-state workspace scoping, safe LRU cache key hashing, quarantine exclusion filtering across all search paths, and an FTS5 `MATERIALIZED` CTE fix for SQLite BM25 scoring in `MemorySearchService` (`@ptah-extension/memory-curator`). The implementation is architecturally disciplined and clean: it avoids raw SQL string interpolation of external values, encapsulates the scope predicate cleanly in a private helper, documents subtle SQLite and vector engine trade-offs with high-value technical commentary, preserves tracing and fallback semantics, and provides rigorous real-SQLite integration tests.

The score is placed firmly in the 7–8 band (sound engineering): above 5–6 because zero architectural boundaries or type-safety invariants are breached and test coverage is comprehensive across both mock and real-SQLite layers; below 9–10 because `memory-search.service.ts` has crossed the 1000-line soft ceiling (1021 lines, finding 1), scope handling displays an asymmetry between `searchRich` and `searchIndex` (finding 2), and SQL quarantine constants are duplicated between the store and search services (finding 3).

All source references below are relative to **D:/projects/ptah-extension-memory-quality-source/libs/backend/memory-curator/src/**. `task/` denotes **D:/projects/ptah-extension-memory-quality-source/.ptah/specs/TASK_2026_563_2939/**; `root/` denotes that worktree's root. No source files were modified by this review.

## Scope and verification

- Read both Batch 4 files in full:
  - `lib/memory-search.service.ts` (1021 lines; diff: +107 lines, -54 lines)
  - `lib/memory-search.service.spec.ts` (1796 lines; diff: +408 lines, 0 lines deleted)
- Inspected the diff against `HEAD` (`git diff HEAD -- memory-search.service.ts memory-search.service.spec.ts`): verified zero unrelated diff noise, clean commit boundaries, and strict adherence to component 6 of `task/implementation-plan.md:577-653`.
- Verified type checking on the changed project: `npx nx run @ptah-extension/memory-curator:typecheck` completed with exit code 0 and zero TypeScript errors.
- Verified test suite execution: `npx nx test @ptah-extension/memory-curator --testFile=libs/backend/memory-curator/src/lib/memory-search.service.spec.ts` passed completely (51 tests passed, 0 failures, 0 skips, run time 7.265 s).
- Static diagnostics via `ptah_get_diagnostics` were queried; since the worktree is located outside the active workspace directory, the compiler response is deferred to the authoritative project-level `tsc` typecheck output.

## Five style questions

### 1. What breaks in six months?

1. **`searchIndex` Scope Asymmetry:** In `searchRich`, `workspaceRoot` is typed `string | null | undefined` and mapped via `searchScopePredicate` (`memory-search.service.ts:177-188`). In `searchIndex`, however, `MemSearchIndexFilter.workspaceRoot` remains `string | undefined` (`:40`). If an upstream caller in six months expects `searchIndex` to support the exact null-workspace scope (e.g. browsing memories stored without a workspace) and passes `{ workspaceRoot: null as any }`, `buildFilterClause` (`:809-813`) will evaluate `filter.workspaceRoot !== undefined` as true and generate `AND m.workspace_root IS ?`, binding `null`. While SQLite's `IS ?` operator with a null parameter can evaluate to NULL equality in certain configurations, `makeIndexCacheKey` (`:259`) falls back to `const ws = filter.workspaceRoot ?? ''`, which collapses `null` into `''` and would cause cache collisions between unscoped searches and null-workspace searches.
2. **Local Vector Cluster KNN Crowding:** In `vecSearchInner` (`:474-513`), sqlite-vec's `vec0` KNN operator chooses the top `limit` candidate rowids before SQL filters (`ACTIVE_MEMORY` and `searchScopePredicate`) apply. As explicitly documented in `:469-473`, if a user accumulates dozens of quarantined or out-of-scope memories within a dense semantic cluster, those records will occupy KNN slots and be discarded at the join, potentially reducing returned vector candidates without a refill loop. While this is an accepted trade-off for performance, it is a point of potential degradation if quarantine volume scales significantly.

### 2. What would a new team member misread?

1. **`ACTIVE_MEMORY` vs `ACTIVE_MEMORY_UNALIASED`:** Lines 168–170 define:
   ```typescript
   const ACTIVE_MEMORY = 'm.quarantined_at IS NULL';
   const ACTIVE_MEMORY_UNALIASED = 'quarantined_at IS NULL';
   ```
   A new team member composing a new search or retrieval query might inadvertently use `ACTIVE_MEMORY` in a query that references `memories` without the `m` alias (such as `timeline:681` or `getObservations:739`), leading to a SQL runtime error (`no such column: m.quarantined_at`). The comment at `:164-167` clearly explains the distinction, but the existence of two dual constants requires attention.
2. **`MATERIALIZED` in `bm25SearchByMemory`:** In `bm25SearchByMemory` (`:921-934`), the query uses `WITH chunk_hits AS MATERIALIZED (...)`. Without the detailed explanatory comment at `:910-918`, a developer might view `MATERIALIZED` as an idiosyncratic or redundant hint and remove it, which would trigger SQLite FTS5 error `"unable to use function bm25 in the requested context"` when `MIN(bm25(...))` is evaluated under `GROUP BY`.

### 3. What does this cost to maintain?

1. **File Length Over 1000 Lines:** `memory-search.service.ts` now stands at 1021 lines, having grown by 51 net lines in this batch. It encompasses multiple search modalities: BM25 FTS5 lexical matching, sqlite-vec KNN querying, RRF fusion math, worker-client cross-encoder reranking, multi-field metadata filtering, timeline traversal, and observation queue querying. Combining all these responsibilities in one file increases review overhead and potential conflict surface.
2. **Duplication of Quarantine Predicates Across Libraries:** The SQL fragment for quarantine exclusion is now present in `MemorySearchService` (`ACTIVE_MEMORY`), `MemoryStore` (`ACTIVE_MEMORIES_WHERE` / inline clauses), and `MemoryLifecycleStore` (`MEMORY_LIFECYCLE_SQL`). If the quarantine data model is extended (for example, adding an expiration timestamp or archive status), updates must be manually coordinated across at least three distinct service files in `memory-curator`.

### 4. Where is this inconsistent with the rest of the repository?

1. **Centralized Scope Helper vs Ad-Hoc Filter Logic:** `MemorySearchService` introduces `searchScopePredicate(workspaceRoot)` (`:177-188`), which cleanly returns `{ sql, params }`. However, within the same class, `buildFilterClause` (`:803-855`) and `bm25SearchByMemory` (`:919`) do not use this helper; `bm25SearchByMemory` constructs `wsFilter = workspaceRoot ? 'AND m.workspace_root IS ?' : ''` directly inline.
2. **Cache Key Construction Techniques:** `makeCacheKey` (`:243-252`) uses custom delimiter separation (`${normalizedQuery}|${scopeTag}|${limit}|${counter}`), whereas `makeIndexCacheKey` (`:258-273`) builds a JSON projection of sorted filter fields. Both are well-suited to their respective query structures, but represent two different cache serialization styles within the same service.

### 5. What would you have done differently?

1. **Unify Scope Type Across Both Search Surfaces:** Expand `MemSearchIndexFilter.workspaceRoot` to `string | null` to match `searchRich`'s tri-state capability, and route `buildFilterClause` through a unified scope predicate builder. This would guarantee identical scoping and caching semantics regardless of whether a query runs through `searchRich` or `searchIndex`.
2. **Export a Shared Submodule Predicate Utility:** Rather than defining `ACTIVE_MEMORY` and `ACTIVE_MEMORY_UNALIASED` as private constants in `memory-search.service.ts`, extract a small internal utility (`lib/retention/quarantine-sql.util.ts` or similar) shared by `MemoryStore`, `MemoryLifecycleStore`, and `MemorySearchService`.
3. **Respect Batch Boundaries and Avoid Premature Splitting:** While `memory-search.service.ts` has crossed 1000 lines, keeping the scope and quarantine changes in place without splitting the file in Batch 4 was the correct choice. As dictated by the task rationale, splitting the class mid-feature would break concurrent batches and destabilize the ongoing wave.

## Blocking issues

None established within the reviewed batch.

## Serious issues

None established within the reviewed batch.

## Minor issues

### 1. File size exceeds the 1000-line soft ceiling — Minor

- **File:** `lib/memory-search.service.ts:1-1021`
- **Problem:** Repository coding standards define a soft ceiling of 700 lines (warning) and 1000 lines (warrants a deliberate look). Adding the quarantine predicates, `searchScopePredicate`, `makeCacheKey` limit/scope logic, and the `MATERIALIZED` CTE pushed `memory-search.service.ts` from 970 to 1021 lines.
- **Impact:** Increased reading cost and merge conflict potential for a service that already unites BM25, KNN vector search, RRF fusion, reranking, timeline, and index browsing.
- **Recommendation:** Do not split during this feature run. As specified in `task/batches.md:338-339`, one file owning both M3 scope and M5 quarantine filtering was an intentional architectural constraint. In a future dedicated refactoring task, apply the facade rule: extract `MemoryIndexBrowseService` or `MemorySearchQueryRunner` as an injected collaborator while retaining `MemorySearchService` as the public entry point.

### 2. Scope typing disparity between `searchRich` and `searchIndex` — Minor

- **File:** `lib/memory-search.service.ts:40`, `:309`, `:908`, `:959`
- **Problem:** `searchRich(..., workspaceRoot?: string | null)` accepts tri-state scoping (`null` for no workspace, `undefined`/`''` for all, `string` for a specific workspace), but `searchIndex(filter: MemSearchIndexFilter)` and its private query runners (`bm25SearchByMemory`, `vecSearchByMemory`) accept only `workspaceRoot?: string`.
- **Impact:** Callers of `searchIndex` cannot explicitly query for unassigned (null workspace) memories, creating a slight capability gap between the two search APIs.
- **Recommendation:** In a subsequent iteration, update `MemSearchIndexFilter.workspaceRoot` to `string | null` and harmonize `makeIndexCacheKey` and `bm25SearchByMemory` with `searchScopePredicate`.

### 3. Duplicate SQL quarantine constants across stores — Minor

- **File:** `lib/memory-search.service.ts:168-170`
- **Problem:** `ACTIVE_MEMORY = 'm.quarantined_at IS NULL'` and `ACTIVE_MEMORY_UNALIASED = 'quarantined_at IS NULL'` duplicate similar string constants in `memory.store.ts` and `memory-lifecycle.store.ts`.
- **Impact:** Maintenance duplication if table aliasing or quarantine schema definitions change in the future.
- **Recommendation:** Consolidate SQL quarantine fragments into an internal shared constants file within `libs/backend/memory-curator` during an upcoming cleanup pass.

## File-by-file

### `lib/memory-search.service.ts`

Score 8/10 — 0 B, 0 S, 3 M (M1, M2, M3).
The service correctly implements all Batch 4 functional requirements:

- `searchScopePredicate` (:177-188) cleanly formats the SQL clause and parameter array for tri-state workspace scoping.
- `makeCacheKey` (:243-252) incorporates `limit` and an explicit `\u0000null` sentinel, preventing cache collisions between different page sizes and scopes.
- `bm25Search` (:420-455) unconditionally joins `memories m`, filters by `ACTIVE_MEMORY`, and appends scope SQL.
- `vecSearchInner` (:474-513) applies both `ACTIVE_MEMORY` and `scope.sql` to chunk rowids, accompanied by an explicit docstring explaining vec0 KNN slot selection behavior (:469-473).
- `timeline` (:671-717) and `getObservations` (:726-752) exclude quarantined records, with `timeline` immediately returning empty rows if the anchor row is quarantined.
- `buildFilterClause` (:803-855) initializes its `where` array with `ACTIVE_MEMORY`, guaranteeing that pure-filter browsing and compact row fetches exclude quarantined items.
- `bm25SearchByMemory` (:905-954) uses a `MATERIALIZED` CTE to resolve the SQLite FTS5 aggregate error with `bm25()` under `GROUP BY`, filtering quarantined items upstream before `LIMIT`.
- Exceeds the 1000-line soft ceiling at 1021 lines (M1).

### `lib/memory-search.service.spec.ts`

Score 9/10 — 0 B, 0 S, 0 M.
Comprehensive, highly readable test organization spanning 1796 lines:

- Existing mock-based unit tests (:1-1483) verify fast isolated behaviors: R1 reranker integration, R3 cache hits/misses, R5 RRF weighting, and SQL statement structure.
- Dedicated real-SQLite integration section (:1484-1795) uses `RetentionTestDb` with production migrations up to 0048 and native vector support to test actual SQLite engine behavior.
- Real-SQLite test cases thoroughly cover:
  - Exact null scope vs undefined scope (:1562-1579).
  - Cache isolation between null and unscoped searches (:1581-1592).
  - Cache separation for different `topK` values (:1594-1610).
  - Cache invalidation on store write-counter bump (:1612-1633).
  - Real SQLite BM25 scoring with `MATERIALIZED` CTE per memory (:1635-1658).
  - Quarantined BM25 matches not starving active matches (:1660-1698).
  - Quarantine exclusion across all 5 search/read paths (:1700-1747).
  - Equivalence assertion proving that with zero quarantined rows, output is identical to unpredicated queries (:1749-1794).

## Pattern compliance

| Repository rule or nearby convention                        | Status       | Evidence                                                               |
| ----------------------------------------------------------- | ------------ | ---------------------------------------------------------------------- |
| Parameterized queries only (no raw value interpolation)     | PASS         | `memory-search.service.ts:444`, `:502`, `:679`, `:740`, `:940`, `:981` |
| Tri-state workspace scoping (`string`, `null`, `undefined`) | PASS         | `memory-search.service.ts:177-188`, `:306-310`                         |
| Safe cache key encoding with scope tag and limit            | PASS         | `memory-search.service.ts:243-252`                                     |
| Upstream quarantine filtering before LIMIT                  | PASS         | `memory-search.service.ts:437-440`, `:926-934`                         |
| Graceful fallbacks on vector or reranker failure            | PASS         | `memory-search.service.ts:340-347`, `:374-380`                         |
| Preserved OpenTelemetry / ITracer spans                     | PASS         | `memory-search.service.ts:280`, `:311`, `:462`, `:589`                 |
| Error narrowing (`instanceof Error`)                        | PASS         | `memory-search.service.ts:343`, `:377`, `:451`, `:950`                 |
| File size under 700/1000 lines                              | FAIL (Minor) | `memory-search.service.ts` is 1021 lines (Finding 1)                   |
| Dedicated real-SQLite specifications with cleanup           | PASS         | `memory-search.service.spec.ts:1484-1795`                              |
| Zero unrelated diff noise                                   | PASS         | All 515 lines changed are strictly relevant to Batch 4                 |

## Maintenance debt

- **Introduced:** `memory-search.service.ts` expanded by 51 lines, crossing the 1000-line ceiling (1021 lines). Two local SQL string constants (`ACTIVE_MEMORY`, `ACTIVE_MEMORY_UNALIASED`) were added to the module level.
- **Retired:** Resolved SQLite FTS5 runtime crash (`unable to use function bm25 in the requested context`) in `bm25SearchByMemory`. Eliminated cache contamination between null-scoped and global queries, as well as between different page limits. Eliminated risk of quarantined memories leaking into search results or starving active BM25 candidates.
- **Net:** Strongly positive. The changes harden critical search semantics and persistence correctness while adding minimal structural debt.

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH** (full source and diff examined, 51/51 tests passing on real SQLite, typecheck clean, zero diff noise).
- Key concern: `memory-search.service.ts` exceeds 1000 lines (1021 lines) and will eventually need facade-based extraction of its query running or browsing collaborators.
- What a 10/10 version would do differently:
  1. Extract an internal query runner collaborator (e.g. `MemoryIndexBrowseService` or `MemorySearchSqlRunner`) to reduce file size below 700 lines.
  2. Extend `MemSearchIndexFilter.workspaceRoot` to `string | null` and reuse `searchScopePredicate` inside `bm25SearchByMemory` and `buildFilterClause`.
  3. Unify `ACTIVE_MEMORY` SQL constants into a shared internal utility across `memory-curator` stores.
