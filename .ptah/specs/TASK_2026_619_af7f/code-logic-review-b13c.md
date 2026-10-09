# Code Logic Review — TASK_2026_619 Batch 13c

## Verdict: APPROVED — 8/10

The mid-census answer is built from the active run (`record.active`), never the previous settled run. The census, limit, selection and cap fields are set in one synchronous block, so there is no window with wrong numbers. The settled branch is unchanged: it calls the same extracted helper with the same inputs. Two small gaps remain: the active branch ignores `perFileTruncated`, and some negative paths are untested. Neither blocks approval.

## Findings

1. MODERATE — the active branch ignores `perFileTruncated`.
   - Evidence: `code-symbol-indexer.service.ts:604-607` passes `active.census` straight through. The settled branch at `:622-627` overrides it with `'truncated'` when `record.perFileTruncated` is set.
   - `recordWrite` (`:880-887`) drops per-file writes once `PER_FILE_RECORD_LIMIT` is hit and sets that flag. During a census this only happens when more than the limit of non-run files are reindexed.
   - Scenario: a large burst of saves during a census. Mid-run coverage says `census: 'complete'` with counts that omit the dropped writes. Once the run settles, the same state reports `'truncated'`.
   - Impact: low. `state: 'updating'` already blocks a clean answer (`updating` is a verdict reason). But the mid-run answer is more optimistic than the settled one for the same writes.
   - Fix: pass `record.perFileTruncated ? 'truncated' : active.census` in the active branch. A better fix is to move that ternary into `coverageForRun` so both branches share it.

2. MODERATE (pre-existing, now visible mid-run) — a deleted file can still count as analyzed.
   - Evidence: `deleteFileSymbols` (`:1233-1241`) tombstones the path and deletes the rows. Nothing removes the identity from `run.writes` or `record.perFile`.
   - Scenario: the census writes `a.ts` (analyzed), then `a.ts` is deleted during the census. Coverage still counts it as analyzed. The same happens in the settled answer today.
   - A selected file that is tombstoned before the census writes it is never written (`skippedTombstone`, `:1548`). It counts as unchecked: conservative and correct.
   - Fix: out of scope for 13c. Log it as a follow-up: delete the identity from `run.writes` and `perFile` in `deleteFileSymbols`.

3. MINOR — test gaps for the negative paths in the checklist.
   - Evidence: `code-symbol-indexer.service.spec.ts:689-790`.
   - There is no test that a second census, begun after a settled one, ignores the previous run's counts. The behaviour is correct (`beginRun` sets `settled = null` and clears `perFile`, `:818-821`), but nothing pins it.
   - There is no test of an aborted or failed census: during the run nothing clean, after settle `incomplete` with `unchecked > 0`.
   - There is no test of a per-file write for a file outside `selected`.
   - The settled-unchanged claim is covered only by the pre-existing tests plus the "after release" `?` comparison.
   - Fix: add two or three small cases using the same `holdingGovernor` harness.

4. MINOR — `coverageForRun` still reads `run.census === 'truncated'` for `omittedByCap` (`:681`) while the new `census` parameter can differ (see finding 1). This is harmless today because `omittedByCap` comes from the run itself. A one-line comment would stop a later reader from "fixing" it.

No BLOCKING or SERIOUS findings.

## Failure-mode checks

1. Active run used, not the previous settled run.
   - OK. `beginRun` (`:793-824`) sets `active`, clears `settled` and clears `perFile`. The active branch reads only `record.active`.
2. A file counted twice, or both analyzed and unchecked.
   - OK. `latest` is a `Map` keyed by identity. A census write and a per-file write for the same file collapse to the higher `seq` (`:637-643`).
   - `unchecked` is the `unchecked` outcomes in `latest` plus the selected identities that are not in `latest`. Those two sets are disjoint, so a file cannot be in both.
   - Writes for files outside `selected` count as analyzed or failed only. This is the same as the settled branch (see finding 2 for a related pre-existing gap).
3. Before-discovery detection.
   - The condition is `active.census === null`. `census`, `omittedByCap`, `censusLimit` and `selected` are assigned together at `:1075-1078` with no `await` between them, so there is no window where `census` is set but `selected` is not.
   - Discovery failure returns early at `:1050-1062` with `census` still null. The mid-run answer stays unknown and the settled answer stays `incomplete` with an unknown census.
4. Settled branch.
   - Same helper body, same arguments. The `perFileTruncated` ternary is kept in the settled branch (`:622-627`).
   - The `run.census === null` early return for settled is preserved (`:620`).
   - The `omittedByCap`, `censusLimit`, `unsupported*`, `failedByReason` and C-as-C++ approximation outputs are textually unchanged in the diff.
5. Aborted or failed census.
   - During the run, `state: 'updating'` always adds the `updating` reason, so `clean` is never true. `isCleanAnswer` requires `state` absent or `current`, per the verdict helper at `language-coverage.interface.ts:270-300`.
   - After settle, `settleRun` (`:846-857`) writes `incomplete`. Unwritten selected files stay in `unchecked`, so the answer is not clean.
6. Consumers.
   - `code-namespace.builder.ts:290-304` passes coverage through unchanged. `spanningRead` (`:551-558`) compares only `state`.
   - Counts that were `null` while `updating` are now numeric. `withCoverageVerdict` handles numeric counts, so the `?` reasons simply become real reasons.
   - I found no consumer under `libs/backend` that assumes null counts when `updating`. Only the `code-namespace.builder.ts` path was read in full; the other files returned by the `state ===` grep were not checked for coverage use and are unrelated by name.
7. Tests.
   - The tests use the real indexer with a holding governor. They are not tautological.
   - They cover before discovery, after discovery, a per-file write merged in, truncated with `censusLimit` and `omittedByCap`, and the `?` reason parity before and after settle. See finding 3 for the missing negative cases.

## Decisions

- Keep `unrecognised?` as accepted. It is not reported as a defect.
- Sharing the merge through a private `coverageForRun` is correct and removes the duplication risk.
- APPROVED with findings 1 and 4 as optional tidy-ups in the same file. Finding 2 should be tracked separately as a pre-existing issue.
