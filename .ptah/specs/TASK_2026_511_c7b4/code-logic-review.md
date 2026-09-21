# Code Logic Review — TASK_2026_511

Reviewer: independent logic review of the uncommitted working tree.
Scope: every changed and untracked source file in the diff, read in full.

## Verdict

`accept with fixes` — the change does detect the exact incident it was written for, and the migration and the wire contract are safe, but the attempt counter treats deliberate deferrals as attempts (a real false alarm) and the two verdicts together cannot see an install that completed once and then never ran again.

## Findings

### 1. `disabled` and `boot-deferred` skips inflate the attempt counter, so a healthy install is flagged

- Severity: **major**
- Location: `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:185`, with `libs/backend/memory-curator/src/lib/retention/observation-retention.store.ts:169-175`
- Failure scenario: gate 1 runs before every other gate. With `memory.retention.enabled = false`, each hourly tick calls `skip('disabled')`, which calls `writeSkip`, which increments `attempt_count` and initializes `first_attempt_at`. A user who turns retention off for three days accrues 72 attempts over 72 hours with `last_completed_at` still null. The verdict stays hidden as `disabled` while the setting is off. The moment the user turns retention back on, and before the first run can execute, `computeRetentionHealthVerdict` returns `never-completed`. The panel then states "Memory retention has never completed despite repeated attempts over more than three days," which is false: retention was never asked to attempt anything.
- The same shape occurs without any user action. A laptop that stays on battery accrues 24 `on-battery` skips per day (`memory-retention.service.ts:248`). On a fresh install with no completed run, three days unplugged produce the same false `never-completed`. The author's own test encodes this path: `libs/backend/memory-curator/src/lib/retention/memory-retention.service.spec.ts:532-544` seeds `attemptCount: 71` and then fires one `on-battery` skip to trip the alarm.
- Recommended fix: count only ticks where retention was eligible and still produced no completion. At minimum, do not increment on `disabled`, and clear `attempt_count` and `first_attempt_at` when a `disabled` skip is recorded, so the counter measures the current enabled period. Consider excluding `boot-deferred` for the same reason. If `on-battery` must keep counting, raise the age bound well past three days, or add a separate deferral counter that the verdict subtracts.

### 2. After one completed run, a permanently skipping install can never be flagged

- Severity: **major**
- Location: `libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:41-51`
- Failure scenario: `never-completed` requires `lastCompletedAt === null`. `stalled` requires `state.backlogRemaining`, and `backlogRemaining` is written only by a run, as `status !== 'completed'` (`memory-retention.service.ts:585`). A skip never touches it. Take an install that completes one run cleanly, so `lastCompletedAt` is set and `backlogRemaining` is false, and that afterwards skips every tick for months — a laptop always on battery, or a host whose sessions are always shorter than the ten minute boot deferral. `observation_queue` grows without bound. Both fault branches are dead: the first because a completion exists, the second because the last run reported no backlog. The verdict stays `healthy` forever, the counter grows forever, and nobody is told. This is the same user-visible harm the task exists to prevent, one completed run later.
- Recommended fix: add a third fault that does not depend on the stored backlog flag. `readMemoryStorageHealth` already reads `live.pendingRows` (`memory-storage-health.ts:116`). Flag a fault when `now - lastCompletedAt` exceeds the stall window and live pending rows exceed a bound, whatever the last run's own backlog flag said.

### 3. An unreadable retention state reports `healthy`

- Severity: **minor**
- Location: `libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:120-125` and `:168-172`
- Failure scenario: `store.readState()` throws, for example while the connection is closing. The catch pushes a `retentionState:` entry into `readErrors` and leaves `state` as null. `computeRetentionHealthVerdict(enabled, null, now)` then returns `healthy`, because a null state also means "no row yet". A caller that reads only `retention.healthVerdict`, which is what the new banner does, sees a green verdict produced by a failed read. The same collapse hides the state read failure inside `warnRetentionHealth`, where the catch logs at `debug` (`memory-retention.service.ts:718-722`).
- Recommended fix: distinguish "no row" from "read failed" at the call site. Pass a flag, or return a distinct verdict, so an unreadable state is not reported as health.

### 4. The warning rate limit is module state with no reset, so a relapse is silent and the spec is order dependent

- Severity: **minor**
- Location: `libs/backend/memory-curator/src/lib/retention/memory-retention.service.ts:81` and `:700-723`
- Failure scenario, runtime: `warnedHealthVerdicts` is a module-level `Set`. In a long-running Electron host, retention warns `never-completed` once, recovers, and relapses weeks later. The relapse produces no log line at all, because the verdict is already in the set. Only the panel banner remains, and the panel is the surface the incident already proved nobody opens.
- Failure scenario, tests: nothing resets the set between cases. `memory-retention.service.spec.ts:527` passes only because no earlier case in the file produces an unhealthy verdict, and `:584-595` relies on the set already holding `never-completed` from the same case. Moving the `health warnings` describe block, or adding an earlier case that reaches an unhealthy verdict, turns those assertions green or red for reasons unrelated to the code under test.
- Recommended fix: export a reset used by `beforeEach`, and key the suppression to the verdict plus a coarse time bucket, so a relapse after recovery warns again.

### 5. The verdict spec cannot detect a wrong threshold value

- Severity: **minor**
- Location: `libs/backend/memory-curator/src/lib/retention/memory-storage-health.spec.ts:11-12` and `:31-45`
- Failure scenario: every boundary case is expressed relative to `RETENTION_HEALTH_MIN_ATTEMPTS` and `RETENTION_HEALTH_MIN_AGE_MS`. Change `RETENTION_HEALTH_MIN_ATTEMPTS` in `memory-retention-config.ts:58` from 72 to 1, and the whole file still passes, while every install alarms after one skip. The test name says "at least 72" but nothing pins 72.
- Recommended fix: assert the three constants against their literal values once, then keep the relative boundary cases.

### 6. A clock that moves backwards silently suppresses the fault

- Severity: **minor**
- Location: `libs/backend/memory-curator/src/lib/retention/memory-storage-health.ts:44`
- Failure scenario: `now - state.firstAttemptAt` goes negative when the host clock is corrected backwards past the first attempt, for example a virtual machine restored from a snapshot, or a first boot with a wrong clock. The age bound fails and the verdict returns to `healthy` until wall time catches up, even though the attempt count is high and nothing ever completed. The failure is in the safe direction, but it is unbounded in time and there is no test for it.
- Recommended fix: derive the age from the stored attempt history, for example `max(firstAttemptAt, lastStartedAt)` against the newest recorded timestamp, or clamp a negative age to zero and warn.

## Questions answered

1. **Counter semantics.** Only two statements write `memory_retention_state`: `WRITE_RUN_SQL` (`observation-retention.store.ts:125-166`) and `WRITE_SKIP_SQL` (`:169-176`). Both increment `attempt_count` and set `first_attempt_at` with `COALESCE`, atomically inside the upsert. `not-due` (`memory-retention.service.ts:282`) and `persistence-unavailable` (`:268`, `:272`) return without any write, so they contribute nothing. The literal rule holds. The set of counted ticks is nevertheless wrong for `disabled`, and arguably for `boot-deferred` — finding 1.
2. **Verdict boundaries.** Correct on every case checked: a null state to `healthy` (`memory-storage-health.ts:40`), zero attempts to `healthy` through the `>=` test (`:42`), `firstAttemptAt === null` guarded explicitly with `!== null` so epoch zero passes (`:43`), both age bounds strict (`:44`, `:49`), and `disabled` first and therefore outranking (`:39`). A backwards clock fails safe — finding 6. `stalled` requiring `backlogRemaining` does hide a real fault — finding 2.
3. **False alarm risk.** Found, twice. The most plausible healthy install is a user who disables retention for three days and re-enables it. The alarm is then guaranteed, not probabilistic. The second is a fresh install left on battery for three days. Finding 1.
4. **Missed detection risk.** The original livelock **is** caught. Each run ended non-completed, so `completedAt` stayed null (`memory-retention.service.ts:664`) and `backlogRemaining` stayed true (`:585`). A true backlog defeats the `not-due` gate (`:276-283`), so every hourly tick ran and wrote. 72 recorded attempts accumulate in three days and `never-completed` fires. The task is not invalidated. A near neighbour of that incident is missed — finding 2.
5. **The log rate limit.** Module scope, process lifetime, no reset. A second service instance in the same process shares it, which is intended. A host restart clears it, so a persistent fault warns once per launch, which is reasonable. Recovery then relapse is silent, and the spec is order dependent. Finding 4.
6. **Migration safety.** Clean. `0047_memory_retention_health.ts:12-15` is a static template literal with no interpolation, two bare `ALTER TABLE ... ADD COLUMN`, no rebuild, no backfill and no `INSERT`. It matches the `0044_memory_lifecycle.ts:31-39` convention exactly; `0043` differs only because it creates tables. It is registered once at `migrations/index.ts:351-355`, and `0047_memory_retention_health.spec.ts:30-33` pins both the single registration and its position as the highest version. The spec runs the real lineage through 46 against in-memory SQLite, with and without an existing row, and proves the row survives with `attempt_count = 0` and `first_attempt_at = NULL`. No finding.
7. **The required DTO field.** One producer only: `readMemoryStorageHealth` (`memory-storage-health.ts:147-193`), which sets `healthVerdict` at `:168`. No RPC mapping rebuilds the DTO; `diagnostics.types.ts:51` and `rpc-curator-diagnostics.types.ts:200` pass it through by reference. The frontend never constructs one: `memory-diagnostics-state.service.ts:34` holds `signal<MemoryStorageHealthDto | null>(null)`. The panel reads the field through optional chaining with a `default` branch (`storage-health-panel.component.ts:312-320`), so an older backend that omits the field renders no banner instead of crashing. No runtime hole. No finding.
8. **Unintended removals.** Restored and clean. The lifecycle settings `logger.warn` is present at `memory-storage-health.ts:109-111`, and `memory-retention.service.spec.ts:611-625` pins that two reads emit two settings warnings and zero verdict warnings. A line-level scan of every removed production line in the diff returns only the changed `WRITE_SKIP_SQL` text, one import line, two SQL column-list lines, one doc comment, and the test-support version array. No behaviour was dropped.
9. **The banner.** `changeDetection: ChangeDetectionStrategy.OnPush` is intact at `storage-health-panel.component.ts:116`. The banner is a `computed` over the `input()` signal (`:312`), so it is genuinely reactive. `storage-health-panel.component.spec.ts:118-150` proves it by driving `setInput` through three verdicts and then null. The banner sits inside `@if (vm(); as v)`, and `vm()` is null only when `storage()` is null (`:330-332`), so it is reachable whenever the backend reports a fault. No finding.
10. **Test honesty.** The migration spec, the store spec and the panel spec all exercise real SQLite or a real DOM, and they would fail on wrong production code. Two weaknesses. `memory-storage-health.spec.ts` cannot detect a wrong threshold constant — finding 5. `memory-retention.service.spec.ts:151-202` gives `FakeStore` its own re-implementation of the counter arithmetic, so service-level assertions such as `:520` and `:546` verify the fake, not the shipped SQL. The real SQL is covered separately in `observation-retention.store.spec.ts:479-547`, so the pair is acceptable, but no single service test proves the counter end to end. I found no test that asserts the implementation back to itself outright.

## What I verified by running

```
$ git status --short
```

27 modified files and 4 untracked paths, matching the diffstat of 449 insertions and 30 deletions across 27 files.

```
$ git diff -U0 -- libs/backend/memory-curator/src libs/shared libs/frontend libs/backend/persistence-sqlite/src ":(exclude)*.spec.ts" | grep "^-" | grep -v "^---"
-import { readMemoryStorageHealth } from './memory-storage-health';
-   preview_over_cap)
-   @previewOverCap)
-const WRITE_SKIP_SQL = `INSERT INTO memory_retention_state (id, last_skipped_at, last_skip_reason)
-VALUES (1, @at, @reason)
-  /** Record a closed gate. Touches ONLY `last_skipped_at` and `last_skip_reason`. */
-    ? [2, 7, 10, 15, 16, 17, 18, 19, 43, 44]
-    : [16, 43];
```

Used for question 8. No production behaviour was removed.

```
$ grep -rn "memory_retention_state" --include=*.ts libs apps | grep -v "\.spec\.ts"
```

Confirms exactly two write statements, both in `observation-retention.store.ts`. Used for question 1.

```
$ grep -rn "MemoryStorageHealthDto" --include=*.ts libs apps | grep -v "\.spec\.ts"
```

Eleven hits and one producer. Used for question 7.

```
$ npx nx run-many -t test -p @ptah-extension/memory-curator @ptah-extension/persistence-sqlite --skip-nx-cache
 NX   Running target test for 2 projects:
√  nx run @ptah-extension/memory-curator:test
√  nx run @ptah-extension/persistence-sqlite:test
 NX   Successfully ran target test for 2 projects
  Run duration:      55.6s
  Cache:             Skipped (--skip-nx-cache)
```

Both backend suites pass with the cache skipped. No `nx reset`, no git history command, and no source file was edited.
