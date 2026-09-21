## Files changed

| Path | Change |
| --- | --- |
| `libs/backend/persistence-sqlite/src/lib/migrations/0047_memory_retention_health.ts` | Added static, additive DDL for attempt_count and first_attempt_at; no backfill or table rebuild. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0047_memory_retention_health.spec.ts` | Tests registry placement, static SQL, defaults, and preservation of empty/existing state against the schema lineage through 46. |
| `libs/backend/persistence-sqlite/src/lib/migrations/index.ts` | Registered migration 47 after 46. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0028_gateway_conversation_workspace_root.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0030_skill_event_metrics.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0038_gateway_message_turn_state.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0039_reap_orphaned_queue_rows.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0040_skill_candidate_workspace_root.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0041_skill_md_migration_state.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0042_db_integrity_check_state.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0043_memory_retention.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0044_memory_lifecycle.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0045_skill_backlog_cleanup.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/persistence-sqlite/src/lib/migrations/0046_memory_merge_subject_index.spec.ts` | Advanced the existing latest-version assertion from 46 to 47; shipped SQL is untouched. |
| `libs/backend/memory-curator/src/lib/retention/memory-retention-config.ts` | Defines four documented health thresholds, including the 10,000 live-pending-row bound. |
| `libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts` | Counts finished runs and caller-designated eligible skips atomically; disabled resets attempt history; ordinary deferrals preserve it. |
| `libs/backend/memory-curator/src/lib/retention/observation-retention.store.spec.ts` | Real SQLite tests cover all run outcomes, counted foreground skips, uncounted deferrals, disabled resets, migrated rows, and timestamp preservation. |
| `libs/backend/memory-curator/src/lib/retention/retention-sqlite.test-support.ts` | Applies migration 47 in both real SQLite retention test harness variants. |
| `libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts` | Computes five verdicts with live pending rows, distinct failed-state reads, and nonnegative ages; retains the original lifecycle-settings warning. |
| `libs/backend/memory-curator/src/lib/retention/memory-storage-health.spec.ts` | Pins literal thresholds and tests age/count boundaries, live backlog, unknown versus absent state, disabled priority, and backwards clocks. |
| `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts` | Passes skip counting policy and live backlog to health evaluation; healthy recovery resets process-wide warning suppression; exports the test reset. |
| `libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts` | Mirrors the new counter policy in FakeStore and tests long deferrals, enabled-period resets, live-backlog faults, recurrence, and isolated warning state. |
| `libs/backend/memory-curator/CLAUDE.md` | Documents the counting/reset rule, five verdicts, live backlog, clock clamp, and warning recovery behavior. |
| `libs/shared/src/lib/types/rpc/rpc-curator-diagnostics.types.ts` | Defines the required healthVerdict field and five-value union, including unknown; retains the existing DTO shape otherwise. |
| `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.ts` | Adds a computed warning banner for the two faults within the existing OnPush panel. |
| `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/storage-health-panel.component.spec.ts` | Tests both fault banners, healthy/disabled/unknown/null omission, and reactive transitions. |
| `.ptah/specs/TASK_2026_511_c7b4/implementation-report.md` | Rewritten with all six review fixes, their regression tests, and the observed final gate results. |
| `.ptah/specs/TASK_2026_511_c7b4/agent-output-root.md` | DELETED the duplicate report; not recreated. |
| `libs/backend/memory-curator/src/lib/diagnostics.service.spec.ts` | Added only the required healthy verdict to the existing fixture. |
| `libs/frontend/memory-curator-ui/src/lib/components/diagnostics/memory-diagnostics-accordion.component.spec.ts` | Added only the required healthy verdict to the existing fixture. |
| `libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-rpc.service.spec.ts` | Added only the required healthy verdict to the existing fixture. |
| `libs/frontend/memory-curator-ui/src/lib/services/memory-diagnostics-state.service.spec.ts` | Added only the required healthy verdict to the existing fixture. |

## Design decisions

All six review findings are implemented. The required test, typecheck, and lint gate passes.

- Finished completed, partial, and failed run records still count. Only foreground-active skips count; the service explicitly passes that decision to writeSkip. Disabled resets attempt_count and first_attempt_at while recording skip details. Boot-deferred, on-battery, already-running, and aborted preserve attempt history without incrementing it. Not-due and persistence-unavailable still write nothing.
- Counter changes remain atomic within the existing SQL upserts. A reset begins a new observation period; the next counted skip or run initializes its first timestamp.
- The five verdicts are disabled, unknown, never-completed, stalled, and healthy. Disabled retains priority. A successfully read absent row remains healthy. An undefined state identifies a failed read and yields unknown while preserving readErrors.
- Stalled requires a completion strictly older than seven days plus either stored backlog or strictly more than 10,000 live pending rows. Null pending-row readings cannot independently establish a fault. Both diagnostics and service warnings use the same pure function. The service consults the existing bounded live-storage reader when a completed, backlog-free record needs the fallback.
- Negative ages clamp to zero in both timestamp branches. Never-completed still requires at least 72 counted attempts and strictly more than 72 hours.
- Warning suppression is shared across service instances during an unhealthy episode. A healthy verdict in the write-time health check clears the set, permitting the same fault to warn after relapse. Tests call the exported reset in beforeEach. Disabled and unknown emit no health warning.
- The migration and its registration remain unchanged in this revision, as do the eleven approved latest-version assertions. The required DTO field and its single producer are retained; the only wire-union extension is unknown.
- The restored lifecycle-settings Logger input, import, warning, and service argument remain intact. Diagnostic reads never log the health verdict. The panel's OnPush strategy and computed banner remain unchanged; its existing default branch already omits unknown.
- No retention budget, execution gate, governor behavior, dependency, or DI registration changed. The four previously approved healthy fixtures remain valid and needed no further edits in this pass.

## Verification

The three requested commands ran against names read from the four project.json files, from `D:\projects\ptah-extension\.claude-worktrees\task-511-retention-health`. Each selected **4 projects** and exited **0**. All three reported **0/4 cache hits**.

### test — passed, exit 0

```powershell
npx nx run-many -t test -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/memory-curator-ui
```

Observed output:

```text
 NX   Running target test for 4 projects:
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/memory-curator:test
√  nx run @ptah-extension/persistence-sqlite:test
√  nx run @ptah-extension/memory-curator-ui:test
 NX   Successfully ran target test for 4 projects
  Cache:             0/4 hit (0%)
```

Full captured log: `%TEMP%/task-511-final-test.log`.

### typecheck — passed, exit 0

```powershell
npx nx run-many -t typecheck -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/memory-curator-ui
```

Observed output:

```text
 NX   Running target typecheck for 4 projects:
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/persistence-sqlite:typecheck
√  nx run @ptah-extension/memory-curator-ui:typecheck
√  nx run @ptah-extension/memory-curator:typecheck
 NX   Successfully ran target typecheck for 4 projects
  Cache:             0/4 hit (0%)
```

Full captured log: `%TEMP%/task-511-final-typecheck.log`.

### lint — passed, exit 0

```powershell
npx nx run-many -t lint -p @ptah-extension/persistence-sqlite @ptah-extension/memory-curator @ptah-extension/shared @ptah-extension/memory-curator-ui
```

Observed output:

```text
 NX   Running target lint for 4 projects:
√  nx run @ptah-extension/persistence-sqlite:lint
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/memory-curator-ui:lint
√  nx run @ptah-extension/memory-curator:lint
 NX   Successfully ran target lint for 4 projects
  Cache:             0/4 hit (0%)
```

Full captured log: `%TEMP%/task-511-final-lint.log`.

Nx suppressed detailed output for successful tasks, so no suite or test totals are inferred. The full test target ran the migration, store, service, verdict, diagnostics, and panel suites. Production typecheck targets exclude specs, as before.

Post-edit ptah_get_diagnostics, scoped to the health reader and panel spec, initially reported its compiler was still running. The completed result reported "**Errors:** 4 | **Warnings:** 0": only the four previously confirmed, unrelated UI spec errors listed below. No new retention or fixture diagnostics remain.

The changed retention files and panel spec were formatted with Prettier. No Nx reset or git command was run. The duplicate report remains absent.

## Open risks

- Confirmed documentation drift outside this task: the tree carries Angular 22.1.7, Nx 23.2.1, TypeScript 6.0.3, and Electron 44.4.3; root CLAUDE.md still documents Angular 21, Nx 22.6, TypeScript 5.9, and Electron 40. Root CLAUDE.md remains untouched.
- The four pre-existing frontend spec diagnostics remain untouched: three cast/index-signature errors in corpus-build-dialog.component.spec.ts and one invalid tier literal in memory-rpc.service.spec.ts. Passing UI Jest tests use isolatedModules and do not establish whole-spec type correctness.
- The requested zero clamp is implemented, but it cannot reconstruct elapsed time lost to a backwards wall-clock correction. An age-based verdict still waits until the recorded timestamp is sufficiently old according to the corrected clock. No alternate time source or new persistence was introduced.
- Verification covers the automated four-project gate, not a live host UI session. Existing databases start with zero attempts and a null first timestamp; historical attempts remain intentionally unbackfilled.

## Resolution

The earlier scope question remains resolved: the four approved diagnostic fixtures carry a healthy verdict. The pre-existing lifecycle-settings warning remains restored. implementation-report.md is the sole deliverable; agent-output-root.md remains deleted. The independent review was read in full, all six requested corrections were applied, and the full required gate passed.

## Review fixes

| Finding | Implemented change | Regression test |
| --- | --- | --- |
| 1. Deferral skips inflate attempts | Explicit countsAsAttempt argument; only foreground-active counts; disabled resets both history fields; other listed deferrals do not increment; FakeStore mirrors this policy. Finished records and no-write paths retain their behavior. | observation-retention.store.spec.ts: “does not count %s on a fresh state row”, “preserves existing attempt history on %s”, “counts foreground starvation and preserves its first timestamp through a run”, and “disabled resets attempt history and the next counted skip starts a new period”. memory-retention.service.spec.ts: “does not accrue attempts during three days on battery or while disabled”; the existing no-write-path test remains. |
| 2. Completed-once installs evade detection | Stalled accepts stored backlog OR live pending rows above 10,000, with the existing strict seven-day age bound. Both call sites supply live data when needed. | memory-storage-health.spec.ts: “detects an old clean completion when live pending rows strictly exceed the bound”, including null, 9,999, 10,000, and 10,001. memory-retention.service.spec.ts: “detects live pending backlog after one completed run and only deferrals”. |
| 3. Unreadable state claims healthy | Failed read is undefined and yields unknown; absent row is null and remains healthy. readErrors and disabled priority remain intact. Unknown renders no banner. | memory-storage-health.spec.ts: “distinguishes a failed state read from an absent row, with disabled taking priority”; the service's failed-state-read test now asserts unknown. storage-health-panel.component.spec.ts includes unknown in omission and reactive-transition cases. |
| 4. Rate limit suppresses relapse and leaks across tests | Healthy write-time verdict clears warning suppression. Exported resetRetentionHealthWarnings runs in the service spec's beforeEach. Repeated faults still suppress across instances until recovery. | memory-retention.service.spec.ts: “warns again for the same stalled verdict after recovery” and “counts foreground starvation and suppresses repeated warnings across instances”. |
| 5. Threshold values are not pinned | One test pins 72, 259,200,000 ms, 604,800,000 ms, and 10,000 rows independently of the implementation constants. Relative boundary tests remain. | memory-storage-health.spec.ts: “pins all four health thresholds to the agreed literal values”. |
| 6. Backwards clock produces negative ages | Math.max(0, age) is applied to both first-attempt and last-completion ages. No other clock behavior changes. | memory-storage-health.spec.ts: “clamps ages when the clock moves backwards past recorded timestamps”, covering a corrected clock before firstAttemptAt, subsequent threshold expiry, and a future lastCompletedAt. |
