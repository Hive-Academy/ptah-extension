VERDICT: APPROVED

# Code Logic Review (Fix Round 1) — Batch A3.1 (`@ptah-extension/session-organization`, `SessionOrganizationStore`)

Narrow re-check of findings F1, F2, and F3 from `code-logic-review-A3.1.md`.
Files reviewed:

- `libs/backend/session-organization/src/lib/session-organization.store.ts` (859 lines)
- `libs/backend/session-organization/src/lib/session-organization.store.spec.ts` (1223 lines)

---

## Finding F1: Rollback proof with forced-failure triggers — RESOLVED

- **Status**: RESOLVED
- **Evidence**:
  - `session-organization.store.spec.ts:390-419`: `linkTask` rollback test.
    A SQLite trigger `fail_link_insert BEFORE INSERT ON session_task_links WHEN NEW.task_id = 'T2'` is attached. In `linkTask` (`session-organization.store.ts:522-524`), `writeTaskLink` executes `ensureOrganization` (bumping `updated_at` to 2), then `demoteOtherPrimary` (demoting existing primary `T1` to `related`), before attempting `upsertTaskLink` for `T2`. The trigger fires on the `INSERT` of `T2` and raises `ABORT`. The test asserts that the transaction rolls back: `T1` remains the sole primary (`primaries(db, WS, 's1')` returns `[{ task_id: 'T1' }]`), `org?.tasks` keeps `role: 'primary'` with `createdAt: 1`, and `updatedAt` remains `1` (not `2`).
  - `session-organization.store.spec.ts:1162-1202`: `rekeySession` multi-workspace rollback test.
    `rekeyRoots` returns workspace roots ordered alphabetically (`WS` = `'d:/projects/ws-a'`, `WS_B` = `'d:/projects/ws-b'`). The trigger `fail_rekey_ws_b BEFORE UPDATE ON session_organization WHEN OLD.workspace_root = '${WS_B}'` aborts specifically when the second workspace begins its rekey. At that moment, `WS` has already completed its full sequence of moves and deletes (`moveOrganization`, `promoteSharedPrimary`, `demoteMovingPrimary`, `moveTaskLinks`, `deleteAllTaskLinks`, `movePrLinks`, `deleteAllPrLinks`, `rewriteParent`, `rewriteForkOf`). The transaction aborts and cleanly rolls back: `WS` rows remain intact under `OLD` with `priority: 'urgent'`, `T1` primary, PR links preserved, and `NEW` does not exist in `WS`.
- **Assessment**: Both tests fail mid-transaction after prior statements have already executed mutations, proving non-vacuously that partial writes roll back completely.

---

## Finding F2: Deterministic read order in `listWorkspace` — RESOLVED

- **Status**: RESOLVED
- **Evidence**:
  - `session-organization.store.ts:199-204`: `SQL.selectOrganizations` has `ORDER BY session_id` added:
    ```sql
    SELECT session_id, priority, status, pinned, worktree_path, branch,
           parent_session_id, fork_of_session_id, started_by, updated_at
      FROM session_organization
     WHERE workspace_root = ?
     ORDER BY session_id
    ```
  - Verified other read paths in `session-organization.store.ts`:
    - `SQL.selectTaskLinks` (:209): `ORDER BY session_id, created_at, task_id`
    - `SQL.selectTaskLinksForTasks` (:215): `ORDER BY task_id, created_at, session_id`
    - `SQL.selectPrLinks` (:220): `ORDER BY session_id, created_at, url`
    - `SQL.rekeyRoots` (:290): `ORDER BY workspace_root`
    - `SQL.countChildren` (:281): `GROUP BY parent_session_id`
- **Assessment**: Read ordering is deterministic across all queries; no read path lost its ordering.

---

## Finding F3: Rekey conflict preserves primary role — RESOLVED

- **Status**: RESOLVED
- **Evidence**:
  - `session-organization.store.ts:302-312`: `SQL.promoteSharedPrimary`:
    ```sql
    UPDATE session_task_links SET role = 'primary'
     WHERE workspace_root = ? AND session_id = ? AND role <> 'primary'
       AND task_id IN (
         SELECT old.task_id FROM session_task_links AS old
          WHERE old.workspace_root = ? AND old.session_id = ?
            AND old.role = 'primary')
       AND NOT EXISTS (
         SELECT 1 FROM session_task_links AS kept
          WHERE kept.workspace_root = ? AND kept.session_id = ?
            AND kept.role = 'primary')
    ```
  - Execution order in `rekeyInWorkspace` (`session-organization.store.ts:736-742`):
    1. `promoteSharedPrimary(root, newId, root, oldId, root, newId)`
    2. `demoteMovingPrimary(root, oldId, root, newId)`
    3. `moveTaskLinks(newId, root, oldId, root, newId)`
    4. `deleteAllTaskLinks(root, oldId)`
- **Behavior across all cases**:
  - **Case (a)** — _old: T primary; new: T related, no primary_:
    `promoteSharedPrimary` detects `old` has `T` primary and `new` has no primary; it updates `new`'s link for `T` to `primary`, keeping `new`'s existing `created_at` and `source`. Next, `demoteMovingPrimary` sees `new` now has a primary (`T`), so it demotes `old`'s `T` link to `related`. `moveTaskLinks` ignores `T` because `T` is already under `new`. `deleteAllTaskLinks` drops the old link. Final: `new` has `T` as primary, exactly one primary exists, old rows are gone.
  - **Case (b)** — _old: T primary; new: T related AND P primary_:
    `NOT EXISTS` in `promoteSharedPrimary` evaluates to false because `P` is primary under `new`. 0 rows promoted. `demoteMovingPrimary` demotes `old`'s `T` to `related`. `moveTaskLinks` leaves `T` under `new`. Final: `P` stays primary, `T` stays related.
  - **Case (c)** — _old: T primary; new: no link to T, no primary_:
    `promoteSharedPrimary` matches 0 rows under `new`. `demoteMovingPrimary` does not demote because `new` has no primary. `moveTaskLinks` moves `T` as primary to `new`. Final: `T` is primary under `new`.
  - **Case (d)** — _old: T primary; new: no link to T, P primary_:
    `demoteMovingPrimary` demotes `old`'s `T` to `related`. `moveTaskLinks` moves `T` as related to `new`. Final: `P` remains primary, `T` moves as related.
  - **Case (e)** — _old: T related; new: T related_:
    `promoteSharedPrimary` subquery finds no primary under `old`, 0 rows promoted. Final: `T` stays related under `new`.
- **Partial Unique Index Safety**:
  Because `promoteSharedPrimary` runs before `demoteMovingPrimary`, it inspects the pristine state of `oldId`. If it promotes `T`, `demoteMovingPrimary` immediately demotes `oldId`'s primary, so two primaries never exist under `newId` at any point. `ux_session_task_links_primary` cannot trigger.
- **Spec Coverage**:
  - `session-organization.store.spec.ts:1098-1130`: Verifies promotion of `T1` to primary, preservation of `newId`'s `source` (`'agent'`) and `createdAt` (`5`), and absence of leftover `OLD` rows.
  - `session-organization.store.spec.ts:1132-1160`: Verifies that if `newId` already has primary `T2`, `T1` remains `related`.

---

## New Findings

None. The surrounding implementation remains intact and conformant with repository and architectural standards.

---

## Summary

- **Verdict**: APPROVED
- **Score**: 10/10
- **Blocking**: 0
- **Serious**: 0
- **Moderate / Minor**: 0
- **Failure modes found**: 0
