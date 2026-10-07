Verdict: APPROVED

| Round-3 finding | Status | Evidence |
| --- | --- | --- |
| A given-up ledger row could not reopen after a later failed file generation; normal-scan success left stale terminal diagnostics. | RESOLVED | The upsert reopens a `given_up` row only when its stored generation differs, resets it to attempt 1, and treats legacy NULL as changed (`libs/backend/memory-curator/src/lib/triggers/boot-scan-failure-ledger.ts:28-51`). The normal scan supplies `fs.stat().mtimeMs` and removes any-status ledger row on success (`boot-scan-runner.ts:270-312`). Positive, negative, and cleanup tests cover these cases (`memory-trigger.boot-scan-budget.spec.ts:612-672`). |
| Retry-first work could consume every shared hourly slot and delay normal scans by an unbounded number of boots. | RESOLVED | With eligible normal work, each retry first consults `retryAllowed`; refusal defers remaining retries without spending an attempt and allows the scan to run (`boot-scan-runner.ts:355-405`). The memory trigger only permits a retry when two slots remain, reserving one for the scan; an off limit is correctly unlimited (`memory-trigger.service.ts:804-815,990-1000`). The one-slot case is explicitly exercised (`memory-trigger.boot-scan-budget.spec.ts:675-704`). |
| The status-only index did not serve the workspace-filtered, ordered retry query. | RESOLVED | Migration 0053 adds `(workspace_fingerprint, status, last_failed_at, session_id)` and removes the redundant status-only index (`libs/backend/persistence-sqlite/src/lib/migrations/0053_memory_boot_scan_failure_generation.ts:20-24`). The query-plan test asserts use of that index and no temporary sort (`0053_memory_boot_scan_failure_generation.spec.ts:130-145`). |

New findings

None.

Check results

- Mtime handling is consistent: normal scanning and retry failure recording use `fs.stat().mtimeMs` (`boot-scan-runner.ts:194-198,270-280,455-463`); SQLite's `IS NOT` comparison handles NULL legacy rows as changed (`boot-scan-failure-ledger.ts:40-51`). A backward/same mtime does not become newly eligible, which is the pre-existing watermark contract rather than a correction-introduced loss path.
- With exactly one eligible normal session, `curateSlotsLeft() >= 2` rejects a retry and retains the one scan slot. `retriesDeferred` is the count of remaining entries in the bounded retry batch and is emitted in the boot-scan event and rendered by the activity feed (`boot-scan-runner.ts:395-401,342-352`; `memory-trigger.service.ts:1090-1102`; `event-feed.component.ts:146-159`).
- Migration 0053 is registered as version 53 (`persistence-sqlite/src/lib/migrations/index.ts:382-391`) and standard SQL migrations execute with their bookkeeping in one transaction (`migration-runner.ts:169-188`), so its intentionally non-idempotent `ADD COLUMN` is safe under the version-keyed runner. Its upgrade-path test preserves version-52 data and confirms NULL generation (`0053_memory_boot_scan_failure_generation.spec.ts:93-125`).
- `git diff --check d5bf2c947 c42ea0ee4` passed. The fourteen existing migration-spec edits are maximum-version expectations from 52 to 53; the remaining changes are task-scoped source, migration, and test coverage.
- `npx nx run-many -t typecheck,test,lint -p @ptah-extension/memory-curator @ptah-extension/persistence-sqlite @ptah-extension/memory-curator-ui --parallel=1`: passed all 9 targets. Nx Cloud emitted a non-fatal disabled-organization notice after successful completion.
- `npx prettier --check` on all 24 files changed in the round: passed.
