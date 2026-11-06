# Code Logic Review: Moderate Fix

- Review family: reviewer kimi, implementer claude
- Scope: the two Moderate items in `open-review-items.md` and all changes in `review-input/moderate-fix.patch`

## Verdict

**APPROVED — 9/10.** The fix closes both Moderate items. I found no new defect in the reviewed paths.

The score is above 8 because the compare-and-set, retry, error, caller, and test paths all have direct line evidence. The score is below 10 because the conflict tests use a fake database, not two processes that share a real SQLite database.

## Findings

No Blocking, Serious, Moderate, or Minor findings.

## Five Logic Questions

### 1. How does this fail silently?

It does not fail silently in the reviewed persistence path. `readRowResult` returns a failed read as `{ ok: false }`, and `persistLastRun` warns and returns `false` without a write (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:972-979,1328-1343`). A failed write also warns and returns `'failed'` (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:1032-1039`). Other `readRow` callers keep the old null fallback, as required (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:1323-1325`).

### 2. What user action produces unexpected behavior?

A completed census can meet a concurrent write or a SQLite error. A conflict causes a new read and a new order decision. Three conflicts cause a warning and a `false` result (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:971-1007`). For a succeeded census, `false` suppresses the complete event and produces one failed event (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:907-947`). This is honest failure reporting, not a success result with a missing summary.

### 3. What input data produces a wrong answer?

A null stored value does not bypass the guard. The query uses `last_run_json IS ?`, which matches both SQL NULL and the expected text value (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:1026-1031`). The column is nullable TEXT (`libs/backend/persistence-sqlite/src/lib/migrations/0070_indexing_last_run.ts:1-3`). Invalid stored JSON still reads as no usable last run through the existing validator (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:986-988,1118-1139`). I found no new wrong-answer case.

### 4. What happens when a dependency fails?

The read catch returns the error to `persistLastRun`. The write catch returns `'failed'`. Neither path writes after a failed read (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:972-979,1019-1039,1328-1343`). SQLite calls are synchronous, so there is no pending retry after a return. The `for` loop has a fixed bound of three attempts (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:163-167,971-1007`).

### 5. What is missing that the requirements never mentioned?

No required behavior is absent. The tests do not exercise retry exhaustion or a real cross-process SQLite race. These are residual test limits, not defects in the inspected logic. The bounded loop and the two conflict directions are visible at `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:971-1007` and `libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts:1752-1816`.

## Logic Checks

### Compare-and-set and retry

- `INSERT OR IGNORE` creates a missing row before the conditional update. The table definition supplies defaults for the other required columns (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:1021-1030`; `libs/backend/persistence-sqlite/src/lib/migrations/0012_indexing_state.ts:5-16`).
- The update compares the current `last_run_json` with the value from the same attempt's read (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:972-995,1026-1030`).
- `SqliteStatement.run` exposes numeric `changes`. The code returns `'written'` only for a positive count and treats zero as a conflict (`libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:63-78`; `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:1030-1031`).
- Every conflict starts another iteration. Every success, stale skip, read failure, or write failure returns. Three conflicts end the loop (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:971-1007`).

### State and caller consistency

- `newestPersisted` changes only after a successful compare-and-set. A conflict, failure, or stale skip does not install a false local write record (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:981-999`).
- A later read compares the stored JSON with that local record. A different writer therefore moves the decision back to persisted `startedAt` (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:981-988`).
- `settleCensus` maps `false` from a succeeded census to one `INDEXING_FAILED` event. A failed census still produces one failed event. A cancelled census produces no terminal push (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:907-947`).

### Existing guarantees

- The in-memory `seq` branch is unchanged, so clock-rollback order remains intact (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:981-988`). The existing clock-rollback test remains at `libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts:1652-1666`.
- A stale census returns before the update, so an older manual census does not replace a newer stored summary (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:989-994`). The existing late-manual case remains at `libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts:1305-1345`.
- `settleCensus` calls `persistLastRun` once. A successful update returns immediately. Failed compare-and-set attempts change zero rows. Thus one census has at most one successful last-run update or a stale skip (`libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:907,995-1007,1030-1031`).

### Test quality

- The fake compare-and-set branch runs before the generic update branch. It returns `changes: 0` when the row is absent or its current JSON differs from the expected value (`libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts:57-64`).
- Both conflict tests replace the `run` method on the same cached statement that the service uses. The first call changes the stored row before the fake compare-and-set executes. This forces a real miss through the service loop (`libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts:1763-1778,1798-1811`).
- The newer-row case proves that the service reads again and keeps the newer value. The older-row case proves that the service retries and writes its newer summary (`libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts:1780-1784,1813-1816`).
- The read-error case forces `SELECT` to throw and proves that no second last-run write occurs. It also checks the warning and the preserved summary (`libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts:1727-1750`).

## Verification Evidence

I read the full service and spec files, the patch, the open items, the task context, the implementation plan, and the earlier bounded review. I did not run git, builds, or tests, as instructed.

The coordinator reported that memory-curator lint and typecheck pass. The coordinator also reported 68/68 passing tests across the indexing-control spec and the retention integration spec. My two scoped `ptah_get_diagnostics` requests returned unavailable after 45 seconds, so they supplied no diagnostic result.

The remaining uncertainty is real SQLite behavior under two concurrent processes. The new unit tests exercise the service conflict path, but their fake database simulates the SQL comparison and `changes` result (`libs/backend/memory-curator/src/lib/control/indexing-control.service.spec.ts:57-64`).
