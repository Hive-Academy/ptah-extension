# TASK_2026_620 rebase conflict resolution

Resolved while applying `f61144a33` onto the 621-hardened base. Only
`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` was
changed; the already-merged trigger spec required no correction.

## Conflict hunks

1. `stop()` cleanup
   - The 621 side clears `failedPasses` and directly cancels/aborts the boot
     scan, preserving session-end retry bookkeeping cleanup.
   - The 620 side clears idle timers and uses `cancelBootScan(false)`, resets
     `bootScanOwed`, and therefore preserves pause-switch boot-scan state
     ownership.
   - The resolution clears `failedPasses` and retains the 620 helper-based
     timer/boot-scan cleanup plus the owed-state reset.

2. `tryEpisodeCurate()` signature and pause gate
   - The 621 side keeps the shared `CurateEventKind`, optional ending-session
     identity, and `Promise<void> | null` contract required by the hardened
     session-end retry/rejection paths.
   - The 620 side adds the live `memory.enabled` guard at the common curate
     entry point.
   - The resolution keeps the 621 signature/return contract and returns
     `null` when memory is paused. This leaves the 621
     `dispatchEpisodeCurate()` caught-rejection handling intact.

3. `runBootScan()` runner options/callback
   - The 621 side supplies `BootScanFailureLedger` and reserves a normal-scan
     slot with `retryAllowed`, retaining boot-scan recovery hardening.
   - The 620 side makes an in-progress boot callback stall when
     `memory.enabled` is off, records that the scan is owed, and avoids a
     curate while paused.
   - The resolution retains both the ledger/retry options and the pause-aware
     callback guard.

The later commits `1b9a5131c` and `f69e512af` were not incorporated. In
particular, this resolution does not add their idle-timer resume changes or
their boot-scan generation/no-root release changes.

## Checks

- `npx jest -c libs/backend/memory-curator/jest.config.ts libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts --coverage=false --maxWorkers=2`
  - Passed: 1 suite, 93 tests.
  - Jest emitted a non-failing Windows native-module cache-copy `EPERM`
    warning and loaded the original module.
- `npx tsc -p libs/backend/memory-curator/tsconfig.lib.json --noEmit`
  - Passed with no output.
- `npx prettier --write libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`
  - Completed; file was already formatted.
- `git diff --check`
  - Passed with no whitespace errors.

## Conflict 2 — 1b9a5131c

Resolved while applying `1b9a5131c` onto the first 620 resolution and the
621-hardened base. The only textual conflict was in
`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`; its
spec merged cleanly and was left unchanged.

### Hunks combined

1. Boot-scan ownership generation
   - Kept the commit's `bootScanGeneration` and
     `activeBootScanGeneration` fields. `cancelBootScan()` advances the
     generation and clears active ownership; `maybeRearmBootScan()` allocates a
     fresh generation and passes it into `createBootScanScheduler()` / the
     boot-scan callback.
   - Kept the generation-identity `finally` release in `runBootScan()`, so an
     older cancelled scan cannot release a newer resumed scan. The 621
     `BootScanFailureLedger`, retry-reserve (`retryAllowed`), failed outcome,
     and extended event stats remain unchanged.

2. Resume and foreground idle re-arming
   - Kept `rearmIdleTimers()` and its calls when `ptah.memory.enabled` changes
     to enabled, on activity, and on session start. It arms only non-empty
     episodes without an existing timer.
   - Kept the existing pause-side `clearIdleTimers()` and
     `cancelBootScan(true)` behavior from Conflict 1. This is the
     `1b9a5131c` behavior; the later `f69e512af` restriction to resume-only
     idle re-arming was deliberately not applied.

3. Idle callback (the sole conflict)
   - Both sides clear `idleTimer` and `idleDueAt` before deciding whether a
     curate may run, so a timer that fires while paused cannot remain armed.
   - Retained HEAD's `dispatchEpisodeCurate()` instead of the commit's direct
     `tryEpisodeCurate()` call. The common `tryEpisodeCurate()` pause gate
     still prevents curation while disabled, while the dispatcher preserves
     621's caught background-rejection hardening. No duplicate pause guard was
     added.

4. Boot-scan scheduling and cleanup
   - Kept the generation-aware scheduler/run signatures and the conditional
     release in `finally`. The existing early no-workspace-root return remains
     exactly as it was; the later `f69e512af` no-root release behavior was not
     included.

### Checks

- `npx jest -c libs/backend/memory-curator/jest.config.ts libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts --coverage=false --maxWorkers=2`
  - Passed: 1 suite, 93 tests. Jest emitted the non-failing Windows native
    module cache-copy `EPERM` warning and loaded from the original location.
- `npx tsc --noEmit --project libs/backend/memory-curator/tsconfig.lib.json`
  - Passed with no output.
- `npx prettier --write libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts`
  - Completed; the file was already formatted.

## Conflict 3 — f69e512af

Resolved while applying `f69e512af` (`fix(memory-curator): re-arm idle timers
only on resume and release no-root boot scans`) onto the reconciled 620 work
and the 621-hardened base. Only
`libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts` had a
textual conflict. Its spec merged cleanly and was not edited.

### Hunks combined

1. Resume-edge observation and idle re-arming
   - Kept the 620 `memoryWasEnabled` / `observeMemoryEnabled()` state tracking.
     Configuration changes, activity, and session-start events now re-arm quiet
     episodes only after a real disabled-to-enabled transition; foreground
     activity while already enabled does not re-arm every buffered episode.
   - Kept 620's admission gate for resumed idle retries: provider network
     back-off or an exhausted hourly curate bucket leaves the episode unarmed.
     The pre-existing 621 `HOUR_MS` is reused instead of retaining 620's
     duplicate hour constant.

2. Idle-fire callback (the textual conflict)
   - Kept the 620 live `observeMemoryEnabled()` pause check after clearing the
     timer fields, so a settings edit that has not delivered a configuration
     event cannot curate and still updates resume-edge state.
   - Kept HEAD's `dispatchEpisodeCurate()` rather than 620's direct
     `tryEpisodeCurate()` call. This preserves 621 commit `461877740`'s caught
     background-rejection handling. The common `tryEpisodeCurate()` pause gate
     remains in place; no duplicate curate path was introduced.

3. No-workspace-root boot scan release
   - Kept 620's `runBootScan()` `try` scope around workspace-root lookup. A
     missing root records `bootScanOwed` and returns through the
     generation-identity `finally`, releasing the armed scan so a later resume
     can schedule it again.
   - Retained 621's `BootScanFailureLedger`, retry slot reservation, expanded
     boot statistics, and generation-aware ownership release unchanged.

### Comparison with the final pre-rebase 620 version

`backup/task-620-s3-pre-rebase-0329ff421` is byte-for-byte identical to
`f69e512af` for this service. Every 620 behavior from that version is present:
resume-only idle re-arming, resume admission checks, live idle pause handling,
and releasing/re-owing a no-root boot scan. The only intentional structural
difference is reuse of HEAD's equivalent `HOUR_MS` constant, plus retention of
the 621 hardening described above. No 620 behavior is missing.

### Checks

- `npx jest -c libs/backend/memory-curator/jest.config.ts libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.spec.ts --coverage=false --maxWorkers=2`
  - Passed: 1 suite, 95 tests. Jest emitted the non-failing Windows native
    module cache-copy `EPERM` warning and loaded from the original location.
- `npx tsc --noEmit -p libs/backend/memory-curator/tsconfig.lib.json`
  - Passed with no output.
- `npx prettier --write libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts .ptah/specs/TASK_2026_620_a13e/rebase-conflict-resolution.md`
  - Completed successfully; Prettier formatted the service and reported the
    resolution record unchanged.
