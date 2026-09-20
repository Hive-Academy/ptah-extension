# Track A Merge Candidate Review — `TASK_2026_473_c9f4`

## Verdict

ACCEPT

## Defects

_(No verified functional defects found. All investigated logic, bind ordering, NULL handling, SQL expression equivalences, caller contracts, and edge cases behave correctly as specified.)_

---

## 1. Window Query Correctness and Bind Order

### Bind Order Verification

In `libs/backend/memory-curator/src/lib/memory.store.ts:367-406`, the SQL query is constructed and executed:

```sql
WITH candidates AS (
   SELECT m.id AS id,
          m.subject AS subject,
          m.content AS content,
          LOWER(m.subject) AS subject_key,
          ${salienceRankExpression('?')} AS rank_score
   FROM memories m
   WHERE m.workspace_root IS ?
     AND m.subject IS NOT NULL
     AND LOWER(m.subject) IN (${placeholders})
 ), ranked AS (
   SELECT id,
          subject,
          content,
          rank_score,
          ROW_NUMBER() OVER (
            PARTITION BY subject_key
            ORDER BY rank_score DESC, id DESC
          ) AS subject_rank
   FROM candidates
 )
 SELECT id, subject, content
 FROM ranked
 WHERE subject_rank <= ?
 ORDER BY rank_score DESC, id DESC
 LIMIT ?
```

The parameters bound to `.all(...)` at `memory.store.ts:396-401` are:

1. `Date.now()` — bound to placeholder #1 inside `salienceRankExpression('?')` (`MAX(0, ? - m.last_used_at)`).
2. `workspaceRoot` — bound to placeholder #2 in `WHERE m.workspace_root IS ?`.
3. `...keys` — bound to placeholders #3 through #(2 + keys.length) in `LOWER(m.subject) IN (?, ?, ...)`.
4. `perSubjectLimit` (default 5) — bound to placeholder #(3 + keys.length) in `WHERE subject_rank <= ?`.
5. `totalLimit` (default 50) — bound to placeholder #(4 + keys.length) in `LIMIT ?`.

Every positional placeholder corresponds exactly to its intended parameter value. There is no off-by-one or parameter inversion.

### Quota and Window Correctness

- `PARTITION BY subject_key`: Candidate rows are grouped strictly by case-folded subject (`LOWER(m.subject)`).
- `ROW_NUMBER() OVER (PARTITION BY subject_key ORDER BY rank_score DESC, id DESC)`: Ranks candidate rows independently within each subject partition.
- `WHERE subject_rank <= ?`: Caps each subject partition to at most `perSubjectLimit` rows before applying global sorting.
- `ORDER BY rank_score DESC, id DESC LIMIT ?`: Orders the partitioned candidates globally by salience score (and ties broken deterministically by `id DESC`) and limits total returned candidates to `totalLimit`.
- The live ten-subject measurement (reported by task owner) confirmed that all 10 subjects received their exact quota of 5 candidates each, totaling 50 candidates, resolving the starvation previously suffered by quiet or older subjects.

---

## 2. Workspace Root NULL Handling (`workspace_root IS ?`)

In SQLite, standard equality `workspace_root = ?` fails when matching NULL values because `NULL = NULL` yields `NULL` (falsy in SQL predicate evaluation).

Using `m.workspace_root IS ?`:

- When `workspaceRoot` is `null`, SQLite evaluates `m.workspace_root IS NULL`, which matches all unscoped global rows.
- When `workspaceRoot` is a string (e.g. `'/ws/A'`), SQLite evaluates `m.workspace_root IS '/ws/A'`, which behaves identically to equality.
- Verified in unit test `it('does not return a matching subject stored under a different workspace root')` (`memory.store.spec.ts:167-182`), which confirms that passing `null` returns unscoped rows (`row-null`) and does not cross-contaminate scoped workspaces (`/ws/A` vs `/ws/B`).

---

## 3. `salienceRankExpression` Extraction and Byte-for-Byte Invariance

In `libs/backend/memory-curator/src/lib/salience-ranking.ts:29-38`:

- `salienceRankExpression(placeholder: '?' | '@rankNow')` was extracted to return the unadorned SQL score arithmetic.
- `salienceRankOrderBy(placeholder)` was refactored to:
  ```ts
  export function salienceRankOrderBy(placeholder: '?' | '@rankNow'): string {
    return `ORDER BY ${salienceRankExpression(placeholder)} DESC, m.id DESC`;
  }
  ```

### Byte-for-Byte Comparison

- **`'?'` placeholder**:
  - Previously: `ORDER BY (m.salience * (604800000.0 / (604800000.0 + MAX(0, ? - m.last_used_at))) + 0.3 * m.hits / (m.hits + 3.0) + m.pinned) DESC, m.id DESC`
  - Current: Identical string byte-for-byte.
- **`'@rankNow'` placeholder**:
  - Previously: `ORDER BY (m.salience * (604800000.0 / (604800000.0 + MAX(0, @rankNow - m.last_used_at))) + 0.3 * m.hits / (m.hits + 3.0) + m.pinned) DESC, m.id DESC`
  - Current: Identical string byte-for-byte.

### Callers Checked

1. `libs/backend/memory-curator/src/lib/memory-search.service.ts:926` (`${salienceRankOrderBy('?')}`) — BM25 + salience fusion ordering.
2. `libs/backend/memory-curator/src/lib/memory.store.ts:316` (`${salienceRankOrderBy('@rankNow')}`) — named parameter listing in `list()`.
3. `libs/backend/memory-curator/src/lib/memory.store.ts:448` (`${salienceRankOrderBy('?')}`) — positional parameter search query in `search()`.
4. `libs/backend/memory-curator/src/lib/salience-ranking.spec.ts:74, 89-94` — unit tests verifying deterministic ordering and literal string equivalence.
5. `libs/backend/memory-curator/src/index.ts:28` — public API re-export.

All existing callers remain completely unaffected.

---

## 4. Unbounded Scan and Electron Main Thread Assessment

### Query Plan Analysis

An `EXPLAIN QUERY PLAN` on the live database (`C:\Users\abdal\.ptah\state\ptah.sqlite` with 36,278 memories, 35,255 under `D:\projects\ptah-extension`) shows:

```text
CO-ROUTINE ranked
  CO-ROUTINE (subquery-4)
    SEARCH m USING INDEX idx_memories_workspace (workspace_root=?)
    USE TEMP B-TREE FOR ORDER BY
  SCAN (subquery-4)
SCAN ranked
USE TEMP B-TREE FOR ORDER BY
```

Because the predicate evaluates `LOWER(m.subject) IN (...)`, SQLite cannot use the existing `idx_memories_subject ON memories(subject)` or `memories_subject_tier_idx ON memories(subject, tier)`. There is no index on `LOWER(subject)` or `(workspace_root, LOWER(subject))`. Consequently, SQLite uses `idx_memories_workspace` to locate the workspace rows, and scans all 35,255 rows in that workspace to evaluate `LOWER(subject)` and compute the salience score.

### Performance Measurement & Cold-Start Analysis

- **Cold process / First call**: 6.9 seconds on cold start (measured by task owner).
- **Warm database / Repeated calls**:
  - Independent verification script over 50 iterations: Min 72.3 ms, Median 85.4 ms, Avg 87.5 ms, Max 129.5 ms (including temp B-tree construction for 50 rows across all matching subjects).
  - The task owner's first warm figure of 0 to 3 ms was WRONG and is withdrawn. That script bound
    the workspace root and the rank timestamp in the wrong order, so the query matched no rows and
    timed an empty result. Re-measured correctly over 30 iterations: new query median 89.2 ms
    returning 50 rows. This agrees with the independent measurement above.
- **Old `list({ limit: 200 })` query**: median 77.1 ms warm returning 200 rows, re-measured with
  the same corrected bindings. The new query costs about 12 ms more than the path it replaces.

### Main Thread Impact & Risk Assessment

`better-sqlite3` executes synchronously on the V8 thread.

- **Is the 6.9s cold start an OS cache artifact?** Yes, primarily. When cold, the OS must fault in sqlite database pages from physical disk into OS page cache. The old `list({ limit: 200 })` query would read index pages and stop after 200 rows without reading all table pages, whereas the new query touches the subject column of all 35,255 rows in the workspace.
- **Is it a real risk to the Electron main thread?**
  - **Severity in practice: Low to Moderate.** Memory curation does not run during typing or UI animation; it runs during background curation passes triggered after transcript activity or idle timeouts.
  - However, because it runs on the main process thread in Electron, an 80ms synchronous block (and up to several seconds if cold pages must be read from disk on slow storage) can cause momentary UI micro-stutters.
  - **Optimization opportunity**: If a functional index `CREATE INDEX idx_memories_ws_lower_subject ON memories(workspace_root, LOWER(subject))` were added in a future migration, SQLite could directly seek the matching subjects via B-tree index lookup in < 1 ms without scanning the 35k workspace rows. For the current track scope, the query is functionally correct and acceptable.

---

## 5. Caller Contract in `memory-curator.service.ts`

At `memory-curator.service.ts:606-612`:

```ts
const related = subjects.size > 0 ? this.store.findMergeCandidates([...subjects], input.workspaceRoot ?? null) : [];
```

- **Type Compatibility**: `findMergeCandidates` returns `ReadonlyArray<{ id: string; subject: string | null; content: string }>`. This matches the parameter expected by `resolveWithinBudget`: `related: readonly { id: string; subject: string | null; content: string }[]`.
- **Downstream Behavior**: In `this.llm.resolve(drafts, related, signal, options)`, `related` is serialized into the resolve prompt for merge decisions. When the LLM decides to merge, `r.mergeTargetId` is resolved via `this.store.getById(memoryId(r.mergeTargetId))` (`memory-curator.service.ts:652`). Downstream code does not depend on full `Memory` objects or any side effects of the old `list({ limit: 200 })` call.

---

## 6. Test Suite and Spec Coverage Analysis

### Test Suite Execution

- Running `npx nx test @ptah-extension/memory-curator --skip-nx-cache`:
  - 42 test suites passed, 721 tests passed (verified clean by task owner).
  - TypeScript typecheck clean across `@ptah-extension/memory-curator`.

### Analysis of the 8 Specs in `MemoryStore.findMergeCandidates — TASK_2026_473 Track A`

| #   | Spec Name                                                                              | Revert to Old Implementation Behavior | Analysis                                                                                       |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | `matches a stored subject that differs from the draft only by case`                    | **FAILS**                             | Old code used case-sensitive `subjects.has(m.subject)`. Correctly pins case-insensitivity.     |
| 2   | `finds a memory ranked far outside the 200-row recency window`                         | **FAILS**                             | Old code limited scan to top 200 rows. Correctly pins deep workspace horizon.                  |
| 3   | `returns nothing for an empty subject list and nothing for a subject with no rows`     | **PASSES**                            | Empty set or non-matching subjects also returned `[]` in the old implementation.               |
| 4   | `does not return a matching subject stored under a different workspace root`           | **PASSES**                            | Old `list({ workspaceRoot })` already partitioned by workspace root.                           |
| 5   | `caps each subject at 5 candidates and dedupes case-variant draft subjects`            | **FAILS**                             | Old code lacked a per-subject cap and would return all 7 rows instead of 5.                    |
| 6   | `caps the combined result at 50 rows across subjects`                                  | **FAILS**                             | Old code lacked the 50-row total cap and would return all 60 rows.                             |
| 7   | `gives a quiet subject its full quota when busy subjects fill the shared scan horizon` | **FAILS**                             | Busy subjects pushed quiet subject outside top 200 in old code; quiet subject returned 0 rows. |
| 8   | `ignores blank and whitespace-only subjects`                                           | **PASSES**                            | Blank strings produced no matches in old code as well.                                         |

**Specs that would still pass under the old implementation**: Specs 3, 4, and 8.

### Promised Behaviors Not Pinned by Specs

1. **Custom limits**: No test verifies calling `findMergeCandidates(subjects, ws, 2, 10)` with custom `perSubjectLimit` or `totalLimit` parameters.
2. **Within-subject ranking ordering**: Spec 5 checks `toHaveLength(5)` but does not assert that the 5 returned rows are the _highest-scoring_ rows (e.g. `busy-0` through `busy-4` vs older `busy-5` and `busy-6`).
3. **Deterministic tie-breaking**: No test pins `ORDER BY rank_score DESC, id DESC` tie-breaking behavior when two rows have equal salience.
4. **Draft subject whitespace trimming**: Spec 8 tests `['real-subject', '   ', '']`, but no test passes `['  padded-subject  ']` to verify trimming of surrounded whitespace.

---

## What I Checked and Found Correct

1. **SQL Injection Safety**: Dynamic placeholder generation `keys.map(() => '?').join(',')` uses strictly parameterized bindings for all keys, workspace root, timestamp, and limits.
2. **Window Function Syntax**: Validated compatibility on bundled SQLite 3.53.4 via better-sqlite3 13.0.3 (`ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`).
3. **Empty Input Short-Circuit**: Returns `[]` immediately if `keys.length === 0`, `perSubjectLimit <= 0`, or `totalLimit <= 0`, preventing malformed SQL `IN ()`.
4. **Case Deduplication in Arguments**: `[...new Set(subjects.map(s => s.trim().toLowerCase()).filter(s => s.length > 0))]` ensures draft subjects differing only by case or whitespace collapse into a single SQL parameter and quota partition.
5. **No Regressions on Shared Helpers**: Refactoring `salienceRankOrderBy` to delegate to `salienceRankExpression` preserves exact string output for both `?` and `@rankNow`.
