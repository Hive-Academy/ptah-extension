# Code Style Review — `TASK_2026_563_2939`, Batch 3

## Summary

| Metric          | Value                                                     |
| --------------- | --------------------------------------------------------- |
| Overall score   | 8/10                                                      |
| Assessment      | APPROVED                                                  |
| Blocking issues | 0                                                         |
| Serious issues  | 0                                                         |
| Minor issues    | 3                                                         |
| Files reviewed  | 9 batch files in full (5 production, 4 spec/test-support) |

Batch 3 integrates quarantine awareness, write freezes, scoped restoration, and lifecycle exclusion into `@ptah-extension/memory-curator`. The implementation is sound and disciplined: it respects existing method idioms in each store, employs parameterized SQL queries exclusively, adheres to tsyringe and better-sqlite3 patterns, preserves data immutability for frozen rows, and provides thorough real-SQLite regression specifications. Evidence: `memory.store.ts:345`, `:357`, `:806`, `:870`, `corpus.store.ts:311`, `memory-lifecycle.store.ts:14`, and `memory-lifecycle.quarantine.spec.ts:139`.

The score sits firmly in the 7–8 band (sound engineering): above 5–6 because zero architectural boundaries or type-safety invariants are breached; below 9–10 because `memory.store.ts` has crossed the 1000-line soft ceiling (finding 1), the public export barrel exceeds the 150-line guideline (finding 2), and minor formatting diff noise exists on existing type definitions (finding 3).

All source references below are relative to **D:/projects/ptah-extension-memory-quality-source/libs/backend/memory-curator/src/**. `task/` denotes **D:/projects/ptah-extension-memory-quality-source/.ptah/specs/TASK_2026_563_2939/**; `root/` denotes that worktree's root. No source files were modified by this review.

## Scope and verification

- Read all 9 Batch 3 files in full:
  - `lib/memory.store.ts` (1007 lines)
  - `lib/memory.store.spec.ts` (2232 lines)
  - `lib/memory.types.ts` (160 lines)
  - `index.ts` (219 lines)
  - `lib/knowledge-agents/corpus.store.ts` (366 lines)
  - `lib/knowledge-agents/corpus.store.spec.ts` (404 lines)
  - `lib/retention/memory-lifecycle.store.ts` (124 lines)
  - `lib/retention/retention-sqlite.test-support.ts` (310 lines)
  - `lib/retention/memory-lifecycle.quarantine.spec.ts` (338 lines)
- Compared `MemoryStore` query and error-handling idioms with its existing methods (`insertMemoryWithChunks:240-311`, `purgeBySubjectPattern:446-450`, `stats:775-805`) and `MemoryLifecycleStore`'s constant-based SQL export pattern (`MEMORY_LIFECYCLE_SQL:11-75`).
- Inspected SQL parameters, transaction boundaries, write-counter invalidations, JSDoc comments, and test assertions across real SQLite setups.
- Ran project-scoped static analysis and type checks: `npx nx run-many -t typecheck lint -p @ptah-extension/memory-curator` passed with exit code 0.
- Ran project-scoped test suite: `npx nx test @ptah-extension/memory-curator -- --testPathPattern="memory\.store\.spec|corpus\.store\.spec|memory-lifecycle\.quarantine\.spec|memory-lifecycle\.store\.spec"` passed completely (44 suites, 790 tests passed, 0 failures, 0 skips).
- `ptah_get_diagnostics` was queried with absolute file paths; it returned unavailable due to the external worktree root (`D:\projects\ptah-extension-memory-quality-source`), so the verified Nx CLI typecheck output serves as the authoritative diagnostic gate.

## Five style questions

### 1. What breaks in six months?

If a developer adds a new query or read path to `MemoryStore` (e.g. for a new view, diagnostic, or export), they might write a plain `WHERE workspace_root IS ?` without appending `AND quarantined_at IS NULL`. In `MemorySearchService`, dynamic filter assembly is consolidated in `buildFilterClause(...)`. In `MemoryStore`, SQL queries are prepared inline within each method. Because `MemoryStore` does not use a shared WHERE-clause builder or query helper, every newly authored method must remember to include the quarantine exclusion filter manually (`memory.store.ts:411`, `:450`, `:492`, `:779`).

### 2. What would a new team member misread?

A new team member might conflate `getById(id)` with `getActiveById(id)` (`memory.store.ts:333`, `:345`). `getById` is the raw identity lookup used by internal resolvers and repair tasks that already filtered in SQL, and it returns quarantined records as-is. In contrast, `getActiveById` filters quarantined rows and is intended for user-facing reads such as `memory:get`. The JSDoc on `getActiveById` clearly documents this distinction, but a developer scanning method names without reading the docstring could inadvertently choose `getById` when exposing data.

Additionally, the tri-state convention for `workspaceRoot` in `listQuarantined` (`memory.store.ts:806-829`) follows `stats`: `string` filters to that workspace, `null` filters strictly to unscoped rows (`workspace_root IS NULL`), and `undefined` queries all workspaces. This is intentional and necessary for multi-workspace aggregation, but requires care when routing from RPC handlers.

### 3. What does this cost to maintain?

Maintaining `memory.store.ts` incurs higher cognitive overhead now that it has reached 1007 lines, exceeding the repository's 700/1000 soft ceiling. The file houses 25+ responsibilities ranging from chunk vectorization and FTS indexing to pagination, ranking math, usage tracking, and quarantine management.

Furthermore, the predicate `AND m.quarantined_at IS NULL` / `AND quarantined_at IS NULL` is replicated across 10 constants in `memory-lifecycle.store.ts:14-61` and 8 distinct queries in `memory.store.ts`. If the quarantine schema evolves to support multi-state statuses (e.g., `'active' | 'quarantined' | 'soft_deleted'`), every query string will need manual, coordinated updates.

### 4. Where is this inconsistent with the rest of the repository?

1. **Inline SQL vs. Module Constants:** `MemoryStore` constructs all prepared statements inline within its method bodies (`memory.store.ts:346`, `:358`, `:833`, `:897`), whereas `MemoryLifecycleStore` defines uppercase constants at the top of the file and exposes them as `MEMORY_LIFECYCLE_SQL` (`memory-lifecycle.store.ts:11-75`). Both stores maintain internal consistency with their respective file conventions, but the two approaches diverge in design philosophy.
2. **Centralized Query Filtering:** As noted in Question 1, `MemorySearchService` channels all SQL filtering through `buildFilterClause()`, whereas `MemoryStore` writes ad-hoc WHERE clauses across its methods.

### 5. What would you have done differently?

1. **Identity Read Naming:** In a greenfield design or future major refactor, rename `getById` to `getRawById` and make `getActiveById` the default `getById`, preventing accidental leakage of quarantined memories to callers expecting active items.
2. **Shared Exclusion Constant:** Define a local SQL clause constant `const QUARANTINE_ACTIVE_CLAUSE = 'quarantined_at IS NULL'` to eliminate repeating the literal 22-character string across multiple methods.
3. **Keep `MemoryStore` Together for Batch 3:** Refactoring `MemoryStore` into collaborators (e.g. `MemoryQuarantineStore` or `MemoryRankingStore`) just to satisfy the 1000-line cap during Batch 3 would violate the facade rule and destabilize concurrent batches (B4, B5). Deferring the split to a dedicated technical debt ticket is the correct engineering decision.

## Blocking issues

None established within the reviewed batch.

## Serious issues

None established within the reviewed batch.

## Minor issues

### 1. File size exceeds the 1000-line soft ceiling — Minor

- **File:** `lib/memory.store.ts:1-1007`
- **Problem:** Monorepo coding standards set a soft file ceiling of 700 lines (warning) and 1000 lines (warrants a deliberate look). Adding the quarantine operations (`getActiveById`, `getMergeTarget`, `listQuarantined`, `restoreQuarantined`) expanded `memory.store.ts` from ~880 to 1007 lines.
- **Impact:** Elevated cognitive load for developers navigating the class, and higher risk of merge conflicts during parallel feature branches.
- **Recommendation:** Do not split in this batch. Splitting `MemoryStore` now would disrupt concurrent batches (B4 search service, B5 merge collector) and downstream callers. Log a future debt item to extract specialized collaborators (e.g., quarantine management or indexing) using the facade pattern.

### 2. Export barrel length exceeds the 150-line rule — Minor

- **File:** `index.ts:17-21`, `:219`
- **Problem:** The repository convention limits barrel files (`index.ts`) to 150 lines. The barrel already contained 217 lines before this change; Batch 3 added 2 lines (`QuarantinedMemoryRow`, `QuarantinedMemoryPage`) to an existing grouped `export type` block.
- **Impact:** Minimal. The change is purely type exports (+2 lines) within an existing block, but it compounds pre-existing barrel bloat.
- **Recommendation:** Acceptable as recorded in the plan (`task/implementation-plan.md:484-486`). Address the barrel size repo-wide in a general cleanup pass.

### 3. Unrelated formatting diff noise — Minor

- **File:** `lib/memory.store.ts:689-690`, `:734-735`
- **Problem:** The leading pipe in multi-line union return types was reformatted (e.g. `| { workspace_root: string | null; tier: MemoryTier }` became `{ workspace_root: string | null; tier: MemoryTier }`).
- **Impact:** Trivial formatting noise in lines untouched by quarantine logic.
- **Recommendation:** Ensure automated formatting configurations do not alter lines outside the scope of the task. No action needed for this batch.

## File-by-file

### `lib/memory.store.ts`

Score 8/10 — 0 B, 0 S, M1, M3. Implements quarantine exclusion in `findMergeCandidates` (:411), `list` (:450), `listAll` (:492), `setPinned` (:548), `recordUse` (:659, :669), and `stats` (:779). New methods `getActiveById` (:345) and `getMergeTarget` (:357) handle exact scope and active status. `listQuarantined` (:806) correctly applies limit/offset clamps `[1, 500]` and provides 200-character excerpts. `restoreQuarantined` (:870) encapsulates its update in a transaction, caps distinct ids at 500 with debug logging, invokes `connection.handleFatalWriteError(err)` upon fatal error, clears only the two quarantine columns, and invalidates write caches via `markWorkspacesChanged`. Exceeds the 1000-line soft ceiling (1007 lines, M1).

### `lib/memory.store.spec.ts`

Score 9/10 — 0 B, 0 S, 0 M. Comprehensive test suite on real SQLite with production schema migrations up to 0048 (`:1901-2231`). Tests cover read exclusion (`:1954`), active-by-id roundtrip (`:1997`), write freeze on `recordUse` and `setPinned` (`:2010`, `:2037`), sorting and tri-state scoping in `listQuarantined` (`:2051`), multi-selector restoration (`:2104`), cross-scope isolation between NULL and named workspaces (`:2146`), idempotence and cache bumping (`:2172`), the 500-id cap (`:2197`), and `getMergeTarget` constraints (`:2217`). In addition, the two hand-written test fixtures (`:1305`, `:1584`) were correctly updated with the new columns.

### `lib/memory.types.ts`

Score 9/10 — 0 B, 0 S, 0 M. Declares `QuarantinedMemoryRow` and `QuarantinedMemoryPage` (`:135-155`) with strictly `readonly` properties, proper domain types (`MemoryId`, `MemoryKind`, `MemoryTier`), and clear JSDoc descriptions. Sits neatly adjacent to `MemoryListResponse`.

### `index.ts`

Score 8/10 — 0 B, 0 S, M2. Re-exports `QuarantinedMemoryRow` and `QuarantinedMemoryPage` within the existing grouped `export type` block (`:20-21`). No runtime symbols are exposed. Barrel exceeds the 150-line guideline (219 lines, M2), which was anticipated and documented in the implementation plan.

### `lib/knowledge-agents/corpus.store.ts`

Score 9/10 — 0 B, 0 S, 0 M. Adds `AND m.quarantined_at IS NULL` to `getCorpusMemoriesForPriming` (`:314`). Defense-in-depth measure ensuring that quarantined rows never reach corpus priming even if inadvertently linked.

### `lib/knowledge-agents/corpus.store.spec.ts`

Score 9/10 — 0 B, 0 S, 0 M. Adds a real-SQLite test suite (`:366-403`) verifying that a quarantined member is excluded from priming queries while its underlying corpus membership is preserved, and that restoring the row immediately restores priming visibility. Clean setup and teardown via `openRetentionTestDb` and `removeRetentionTempDirs`.

### `lib/retention/memory-lifecycle.store.ts`

Score 9/10 — 0 B, 0 S, 0 M. Appends the quarantine filter (`quarantined_at IS NULL`) to all 10 SQL query constants (`:14`, `:20`, `:26`, `:32`, `:40`, `:46`, `:54`, `:58`, `:65`, `:72`). Table aliases (`m.quarantined_at` vs `quarantined_at`) are applied correctly matching the table references. The service layer (`runStep`) and schema execution logic are left untouched.

### `lib/retention/retention-sqlite.test-support.ts`

Score 9/10 — 0 B, 0 S, 0 M. Updates the `memorySchema` migration list from `[2, 7, 10, 15, 16, 17, 18, 19, 43, 44, 47]` to include `48` (`:220`). Clean single-line change enabling real-SQLite lifecycle specs to construct tables with quarantine columns.

### `lib/retention/memory-lifecycle.quarantine.spec.ts`

Score 9/10 — 0 B, 0 S, 0 M. Newly authored 338-line specification verifying M5 lifecycle criteria on real SQLite. Proves that archival rows past grace and recall rows past cutoff remain untouched while active control rows are deleted/archived (`:140-226`). Verifies that over-cap workspace counts exclude quarantined rows (`:228-298`). Confirms that direct batch deletion and archival statements refuse quarantined IDs even when directly targeted (`:300-336`).

## Pattern compliance

| Repository rule or nearby convention                     | Status       | Evidence                                                                                                                    |
| -------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Parameterized queries only (no raw interpolation)        | PASS         | `memory.store.ts:430`, `:470`, `:830`, `:890`; `memory-lifecycle.store.ts:13-73`                                            |
| Error handling via `connection.handleFatalWriteError`    | PASS         | `memory.store.ts:916` (matches `insertMemoryWithChunks:309`)                                                                |
| Write counter invalidation on mutation                   | PASS         | `memory.store.ts:551` (`setPinned`), `:920` (`restoreQuarantined`)                                                          |
| Idempotency and atomic transactions                      | PASS         | `memory.store.ts:907` (`db.transaction(...)`)                                                                               |
| Types naming and immutable modifiers (`readonly`)        | PASS         | `memory.types.ts:139-154` (`QuarantinedMemoryRow`, `QuarantinedMemoryPage`)                                                 |
| Structured logging with domain prefix                    | PASS         | `memory.store.ts:882`, `:921` (`[memory-curator] ...`)                                                                      |
| Strict type narrowing (`instanceof Error` / `unknown`)   | PASS         | `memory.store.ts:915` (`catch (err: unknown)`)                                                                              |
| File size under 700/1000 lines                           | FAIL (Minor) | `memory.store.ts` reached 1007 lines (Finding 1)                                                                            |
| Barrel file under 150 lines                              | FAIL (Minor) | `index.ts` is 219 lines (Finding 2)                                                                                         |
| Dedicated real-SQLite specifications with proper cleanup | PASS         | `memory.store.spec.ts:1901-2231`, `memory-lifecycle.quarantine.spec.ts:1-338`                                               |
| No cross-library boundary leaks                          | PASS         | Imports confined to `@ptah-extension/persistence-sqlite`, `@ptah-extension/memory-contracts`, `@ptah-extension/vscode-core` |

## Maintenance debt

- **Introduced:** `memory.store.ts` grew beyond 1000 lines (+125 lines). Two new type exports were appended to a barrel that already exceeds 150 lines. Inline query predicates add repetition across 8 store methods and 10 lifecycle constants.
- **Retired:** Unresolved quarantine gaps in the core store and lifecycle layers are closed. Quarantined records are safely sealed from ranking, listing, stats, corpus priming, and lifecycle eviction.
- **Net:** Manageable and justified growth. The storage layer invariants are robustly protected without premature abstraction or risky refactors mid-feature.

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH** (all source read in full, real-SQLite suites pass 44/44, lint and typecheck clean).
- Key concern: `MemoryStore` is growing large (1007 lines) and relies on inline queries without a shared exclusion builder, requiring vigilance when adding future queries.
- What a 10/10 version would do differently:
  1. Extract a specialized collaborator (e.g. `MemoryQuarantineManager`) behind the `MemoryStore` facade to bring line count below 700 lines.
  2. Prune the `src/index.ts` barrel to adhere to the 150-line ceiling.
  3. Introduce a shared SQL predicate constant/builder for the quarantine condition across store queries.
