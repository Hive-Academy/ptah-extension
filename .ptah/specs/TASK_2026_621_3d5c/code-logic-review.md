Verdict: REVISE

# Code Logic Review — `TASK_2026_621_3d5c`

## Summary

Score: **3/10** — REVISE. Two independently reachable paths still silently discard unprocessed observations, including one path introduced by the new outcome member. This is below 4/10 because the central safety invariant is not true across the stated paths; it is above 2/10 because the ordinary trigger/retention path has a real processed-at guard, bounded retry behavior, diagnostics, and passing scoped checks.

## Findings

1. **Blocking — boot scan converts the new `failed` outcome into success and advances its watermark.**
   - File: `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:1059-1063`
   - Failure scenario: an extract or resolve failure returns `outcome: 'failed'` from `CuratorActivityLog.recordError` (`libs/backend/memory-curator/src/lib/curator-llm/curator-activity-log.ts:342-382`) while the boot scan is processing a historical session. The callback handles only `stalled`, then returns `'ran'` for `failed`.
   - Impact: `BootScanRunner` increments success and advances/writes the watermark for every result other than `stalled` (`libs/backend/memory-curator/src/lib/triggers/boot-scan-runner.ts:177-200,218-224`). On the next boot its `mtime > watermark` selection skips that session, permanently dropping the failed extraction. This violates the required failed-outcome behavior and recreates the silent-drop mechanism on the boot path.
   - Required change: map `failed` to a non-advancing runner outcome (normally `stalled`), preserve/retry it under an explicitly bounded boot-scan policy, and add a negative-control spec proving a failed result does not write/advance the watermark.

2. **Blocking — migration 0039 still deletes unprocessed observations.**
   - File: `libs/backend/persistence-sqlite/src/lib/migrations/0039_reap_orphaned_queue_rows.ts:81-84`
   - Failure scenario: an installation upgrades from a schema before migration 0039 with an `observation_queue` row that has `processed_at IS NULL` and was captured over 30 days ago. The migration executes `DELETE FROM observation_queue WHERE processed_at IS NULL ...`.
   - Impact: the branch’s retention-store guard only protects its own deletes (`libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts:50-56`); it does not protect this migration. The observation is irreversibly deleted before retry/diagnostics can act, contrary to “retention never deletes … `processed_at IS NULL`” and the requested review of migration paths.
   - Required change: remove or revise the unprocessed-observation delete for installations which have not yet applied 0039, with a migration compatibility plan that does not claim recovery for rows already deleted. Add an upgrade-path test that seeds an old unprocessed row and proves it survives.

## Five logic questions

1. **How does this fail silently?** A boot scan receives `failed`, returns `'ran'`, and records a watermark as if curation succeeded (`memory-trigger.service.ts:1059-1063`; `boot-scan-runner.ts:198-224`). The migration deletes old unprocessed data without passing through the curator outcome/reporting path (`0039_reap_orphaned_queue_rows.ts:81-84`).
2. **What user action produces unexpected behavior?** Opening a workspace triggers the boot scan; one non-network extraction/resolve error makes that session disappear from later scans. Updating an older installation across migration 0039 can delete its long-pending observations.
3. **What input data makes this produce a wrong answer rather than an error?** A session JSONL whose extract/resolve call fails produces a valid `failed` stats object, but the boot callback labels it `ran`. An otherwise valid old queue row with `processed_at = NULL` satisfies migration 0039’s deletion predicate.
4. **What happens when a dependency fails, times out, or returns a shape it should not?** The regular trigger preserves rows for up to three failed outcomes (`memory-trigger.service.ts:887-918`), but the boot-scan consumer has no `failed` branch. A database upgrade does not depend on a failure: it deletes qualifying rows deterministically.
5. **What is missing that the requirements never mentioned?** A defined recovery/retention policy for legacy orphaned rows after the never-delete rule. The existing migration encodes the opposite policy and has no safe reconciliation mechanism.

## Verified behavior and residual risks

- The regular trigger path leaves rows unprocessed for failed passes, reattaches a detached episode, clears the counter after a consuming pass, and clears all counters on stop (`memory-trigger.service.ts:887-918,234-265`). The added specs exercise keep/re-drain, the fourth-pass give-up, and reset-after-ran (`memory-trigger.service.spec.ts:2689-2765`).
- Processed retention deletes re-check `processed_at IS NOT NULL` at deletion time (`observation-retention.store.ts:50-56,351-392`), so a concurrent state change cannot make that store delete an unprocessed row. Its session cursor reaches `exhausted` after the last session even if every visited row is unprocessed (`observation-retention.store.ts:361-391`).
- Unprocessed growth is surfaced through `pendingRows`, `oldestPendingAt`, and `stuckEligibleRows` (`observation-retention.store.ts:61-84,198-205`), and the service warns when `stuckKept > 0` (`memory-retention.service.ts:397-410`). The existing UI renders pending rows and oldest pending age (`libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts:161-175,359-365`).
- The legacy `stuckQuarantined` field is intentionally written as zero (`memory-retention.service.ts:642-652`) and remains displayed as “Quarantined” in the last-run UI (`storage-health-panel.component.ts:227-232,336-340`). This is accurate for the historic field, but it cannot show the current run’s kept count; live diagnostics remain the only UI signal for that count.

## Test adequacy

The new regular-trigger tests are meaningful positive and negative controls: removing the failed branch would make the “keeps … unprocessed” test fail, and removing the retry cap would make the give-up test fail. The retention tests cover the store guard, but no changed test exercises `failed` through `runBootScan` or an upgrade executing migration 0039. Therefore they would still pass with both blocking loss paths present.

## Check results

- `ptah_get_diagnostics` for the changed memory-curator/thoth-runtime production paths: **0 errors, 0 warnings**.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/memory-curator @ptah-extension/thoth-runtime --parallel=1`: **passed** (6/6 targets; 2 cache hits). Nx Cloud reported an unrelated disabled-organization 401 after the successful targets.
- `npx prettier --check` on all 16 changed files: **passed**.
- Review scope: all 16 changed files/diff, retention store/service and trigger/boot-scan outcome paths, all production `curate` consumers in `libs/backend`, the legacy unprocessed-delete migration, and diagnostics/UI consumers of the retention values. No `implementation-plan.md` or `code-style-review.md` exists in the task folder.
