VERDICT: APPROVED

# Code Logic Review — TASK_2026_580_9f77 (Batch A2.1)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor / Nit issues  | 2        |
| Failure modes found | 0        |

Score justification: The implementation of Batch A2.1 adheres with mathematical precision to the schema contracts in `implementation-plan.md:318-361`, the coordination requirements with TASK_2026_584 (`parent_session_id`, `fork_of_session_id`, `started_by`), and lane constraints L1, L2, and L12. The SQL is completely static, free of template interpolation, foreign keys, or CHECK constraints. The migration registry and 12 existing spec bumps are exact and clean. The test suite `0050_session_organization.spec.ts` provides comprehensive, non-vacuous coverage against real in-memory SQLite instances and fails loudly when native openers are unavailable. A score of 9.5/10 reflects exemplary execution, with only minor advisory observations for downstream consumers in Batch A3.

---

## Five Logic Questions

### 1. How does this fail silently?

- **Schema divergence under `IF NOT EXISTS`**: In [0050_session_organization.ts:25-66](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.ts#L25-L66), every DDL statement uses `CREATE TABLE IF NOT EXISTS` and `CREATE [UNIQUE] INDEX IF NOT EXISTS`. If a table or index by that name already existed with an incompatible shape (e.g. from an unmerged experimental branch or aborted test run), SQLite silently skips execution without validating or altering existing columns. This is guarded at the system level by the `schema_migrations` ledger, but if a dirty development database exists, it fails silently until a query hits a missing column.
- **Out-of-vocabulary enum values**: Because lane constraint L1 forbids `CHECK` constraints on SQLite enum columns ([0050_session_organization.ts:15-17](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.ts#L15-L17)), invalid values inserted directly (e.g. through raw queries or unvalidated layers) silently succeed at the database level. Downstream consumers must strictly enforce Zod boundary validation and tolerant fallback on read.

### 2. What user action produces unexpected behaviour?

- **Attempting to insert a second `primary` task link without prior demotion**: In [0050_session_organization.ts:53-54](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.ts#L53-L54), the partial unique index `ux_session_task_links_primary` enforces at most one `role = 'primary'` per `(workspace_root, session_id)`. If a user or UI action attempts to set a new primary task link by direct insertion or promotion without demoting the prior primary in the same transaction, SQLite throws `UNIQUE constraint failed: session_task_links.workspace_root, session_task_links.session_id`. Downstream store logic (Batch A3.1) must always demote first within `BEGIN IMMEDIATE` / `COMMIT`.
- **Linking identical PR URLs with trailing slash or casing variations**: In [0050_session_organization.ts:65](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.ts#L65), `PRIMARY KEY (workspace_root, session_id, url)` uses binary TEXT equality. If a user manually inputs `https://github.com/org/repo/pull/1/` and later `https://github.com/org/repo/pull/1`, both rows will be created unless sanitized at the boundary (L14).

### 3. What input data produces a wrong answer?

- **Unnormalized workspace roots**: All three tables partition data by `workspace_root TEXT NOT NULL`. Because SQLite TEXT comparisons are case-sensitive by default, differing path separators or drive letter casing (e.g. `d:/project` vs `D:\project`) will partition sessions for the same workspace into disjoint sets. All writers and readers must strictly pass roots through `normalizeWorkspaceRoot`.
- **Non-millisecond or non-integer timestamps**: In SQLite type affinity, inserting strings or floats into `updated_at` or `created_at` succeeds without error. If a caller passes an ISO timestamp string instead of an epoch millisecond integer, range queries or numeric ordering downstream will yield incorrect results.

### 4. What happens when a dependency fails?

- **SQLite binding failure during test**: If neither `better-sqlite3` nor `node:sqlite` loads in [0050_session_organization.spec.ts:33-52](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.spec.ts#L33-L52), `resolveOpener()` returns `null`. Test [0050_session_organization.spec.ts:105-107](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.spec.ts#L105-L107) asserts `expect(opener).not.toBeNull()`, and `openAtVersion49()` explicitly throws `Error('No SQLite binding loaded...')`. The test fails loudly instead of skipping.
- **Migration runner error during upgrade**: If SQLite throws (e.g. disk full or I/O error) while applying `0050_session_organization.ts`, `SqliteMigrationRunner` rolls back the transaction, does not write version 50 to `schema_migrations`, and closes the connection. `SqliteConnectionService` marks persistence as unavailable.

### 5. What is missing that the requirements never mentioned?

- **Session deletion cascade**: Because sessions live in the JSON store rather than an SQLite table, there are no foreign key relationships between `session_organization`, `session_task_links`, and `session_pr_links`. Deleting a session requires the application layer (`SessionOrganizationStore.deleteSession`) to explicitly issue deletes across all three tables. SQLite cannot garbage-collect orphaned links on its own.
- **URL collation in `session_pr_links`**: The `url` column lacks `COLLATE NOCASE`. Full responsibility for normalizing scheme, host casing, and trailing slashes falls on the service layer.

---

## Failure Modes

No active failure modes found. The reviewed files are pure DDL definitions, migration registration, and migration tests.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

### 1. [Nit] PR URL Case/Trailing-Slash Normalization Dependency

- **File**: [0050_session_organization.ts:59, 65](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.ts#L59)
- **Scenario**: `session_pr_links` defines `PRIMARY KEY (workspace_root, session_id, url)`. SQLite's default collation is binary.
- **Impact**: Without strict URL normalization in Batch A3.1/A3.2, URLs differing only in path casing, trailing slashes, or query fragments could result in duplicate PR links for the same session.
- **Fix / Advisory**: Ensure that Batch A3.1 `SessionOrganizationStore.addPrLink` and `SessionOrganizationService` strictly canonicalize PR URLs before database operations (as mandated by L14).

### 2. [Nit] Index Density on `idx_session_org_parent`

- **File**: [0050_session_organization.ts:39-40](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/persistence-sqlite/src/lib/migrations/0050_session_organization.ts#L39-L40)
- **Scenario**: `CREATE INDEX IF NOT EXISTS idx_session_org_parent ON session_organization (workspace_root, parent_session_id);` indexes all rows, including where `parent_session_id IS NULL`.
- **Impact**: In SQLite B-tree indexes, NULL values are indexed. Since the vast majority of sessions are root sessions (`parent_session_id IS NULL`), the B-tree index contains entries for all root sessions. A partial index `WHERE parent_session_id IS NOT NULL` would be leaner.
- **Fix / Advisory**: No code change required now as this matches the specification in `implementation-plan.md:333-334` verbatim. For future optimization, if the session table grows significantly, a partial index could reduce index overhead.

---

## Data Flow

1. **Migration Registration**: `index.ts` imports `sql0050SessionOrganization` and appends `{ version: 50, name: '0050_session_organization', sql: sql0050SessionOrganization }` to `MIGRATIONS`. [OK]
2. **Runner Execution**: `SqliteMigrationRunner.applyAll()` checks `schema_migrations`, detects version 50 is unapplied, executes `sql` inside a transaction, and records version 50 in `schema_migrations`. [OK]
3. **Table Creation**: `session_organization`, `session_task_links`, and `session_pr_links` are created with composite primary keys. [OK]
4. **Index Creation**: `idx_session_org_parent`, `idx_session_task_links_task`, and partial unique index `ux_session_task_links_primary` are created. [OK]
5. **Ledger Idempotency**: Subsequent runs skip version 50 via the `schema_migrations` ledger. [OK]

---

## Requirements Fulfilment

| Requirement                                                                               | Status   | Gap                                                                                                        |
| ----------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| Schema exact match with `implementation-plan.md:318-361`                                  | COMPLETE | None. Column names, types, nullability, defaults, primary keys, and indexes match character-for-character. |
| Coordination with TASK_2026_584 (`parent_session_id`, `fork_of_session_id`, `started_by`) | COMPLETE | None. Lineage columns are nullable and `started_by` defaults to `'user'`.                                  |
| Lane constraint L1: No `CHECK` constraints on enum columns                                | COMPLETE | None. Confirmed via regex assertions and code inspection.                                                  |
| Lane constraint L2: At most one primary task link per session                             | COMPLETE | None. Partial unique index `ux_session_task_links_primary` enforces this at the engine level.              |
| Lane constraint L12: Lazy row creation, defaults `'normal'`, `'active'`, `0`, `'user'`    | COMPLETE | None. All column defaults match specification.                                                             |
| Static SQL (no `${...}` template interpolation)                                           | COMPLETE | None. Static string template with ESLint/Semgrep header comment.                                           |
| Spec fails (not skips) when SQLite binding missing                                        | COMPLETE | None. `expect(opener).not.toBeNull()` and explicit throw in opener helper.                                 |
| 12 existing spec bumps from 49 to 50                                                      | COMPLETE | None. All 12 specs updated with the exact ratchet comment and assertion.                                   |

---

## Edge Cases

| Case                                                | Handled | How                                                                                  | Concern                                      |
| --------------------------------------------------- | ------- | ------------------------------------------------------------------------------------ | -------------------------------------------- |
| Re-running migration SQL against existing tables    | YES     | Guarded by `IF NOT EXISTS` on all statements; runner ledger prevents execution.      | None.                                        |
| Second primary task link for a session              | YES     | Partial unique index rejects insert with `UNIQUE constraint failed`.                 | Downstream must demote first in transaction. |
| Multiple non-primary task links for a session       | YES     | Allowed by partial index `WHERE role = 'primary'`.                                   | None.                                        |
| Multiple sessions having primary links to same task | YES     | Allowed (`session_task_links_task` index is non-unique).                             | None.                                        |
| Same session across different workspace roots       | YES     | Allowed; workspace root is part of composite primary key.                            | None.                                        |
| Out-of-vocabulary enum value inserted               | YES     | Allowed at SQLite level per L1; handled via tolerant read in store.                  | Boundary validation must be maintained.      |
| Child session created before parent has a row       | YES     | Allowed; no foreign key constraints exist.                                           | None.                                        |
| Re-running migration via `SqliteMigrationRunner`    | YES     | Tested in spec; returns empty `appliedVersions` and version 50 in `skippedVersions`. | None.                                        |

---

## Verdict

- Recommendation: **APPROVE**
- Confidence: **HIGH**
- Top risk: None for Batch A2.1. Downstream Batch A3 must strictly follow the demote-then-promote transaction order when updating primary task links to avoid triggering the partial unique index constraint.
- What a robust implementation would add:
  1. Downstream URL canonicalization in Batch A3.1 for `session_pr_links`.
  2. Transactional atomicity in `SessionOrganizationStore.deleteSession` to cleanly remove associated task and PR links when a session is purged.
