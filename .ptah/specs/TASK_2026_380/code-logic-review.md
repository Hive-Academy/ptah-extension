# Code Logic Review — `TASK_2026_380`

## Batch 1

## Summary

| Metric              | Value                     |
| ------------------- | ------------------------- |
| Overall score       | 8/10                      |
| Assessment          | APPROVED                  |
| Blocking issues     | 0                         |
| Serious issues      | 0                         |
| Moderate issues     | 2                         |
| Failure modes found | 3 (all handled correctly) |

Scope reviewed: lane P (`libs/backend/persistence-sqlite/src/lib/integrity/*`,
migration `0042` + spec, `di/tokens.ts`, `di/register.ts`, `src/index.ts`,
`sqlite-connection.service.ts` deletion, the six migration-ratchet specs), lane
S (`skill-trigger.service.ts`, `skill-trigger-config.ts` + spec,
`skill-trigger.boot-defer.spec.ts`, `file-settings-keys.ts`,
`skill-md-migration.ts` + marker spec), and lane C (`rpc-readiness.types.ts` +
spec, `rpc-activity.types.ts` + spec, `message-constants.ts`,
`message-type.ts`, `payload-map.ts`, `libs/shared/src/index.ts`). Every file was
read in full, not only the diff hunks, and cross-checked against
`implementation-plan.md` components 1, 2, 3, 6, 7, 8, 14c and the three lane
reports.

## Five logic questions

### 1. How does this fail silently?

- The one place this batch could fail silently by design is the very thing it
  is built to prevent: an `'unavailable'` verdict writes no record
  (`integrity-check.service.ts:269-274`) and only a `logger.warn`. On a host
  whose logs nobody reads, an integrity check that keeps failing to run (e.g. a
  permanently locked file) looks identical to "never became due" from the
  outside — there is no counter or backoff distinguishing "healthy, not due"
  from "failing every attempt". This is the documented, deliberate trade-off
  (`backup.service.ts:44-53`'s rule), not an oversight, but it means a
  persistently broken worker factory is invisible to anything but a log grep.
  Noted as a moderate gap, not a defect.
- `IntegrityCheckStateStore.read()` degrades a real schema/driver error
  (`integrity-check-state.store.ts:105-113`) to the same `null` as "no row yet".
  Both correctly resolve to "due", so this is not a wrong answer, but a
  transient read failure and "never checked" are indistinguishable in the logs
  above `debug` level.
- `markerWritten: false` in `skill-md-migration.ts` collapses three distinct
  causes (skipped, walk-errored, store-write-threw) into one boolean
  (`skill-md-migration.ts:143-151`). This is intentional and documented, and the
  design explicitly relies on `errors` being empty to disambiguate the
  swallowed-write case — verified present in the marker spec's throwing-write
  case.

### 2. What user action produces unexpected behaviour?

- None found that isn't already gated. Toggling `skillSynthesis.triggers.bootScan`
  off skips the deferred scan entirely (`skill-trigger.service.ts:176-179`),
  matching old behaviour for that flag. Setting `bootScanDelayMs: 0` runs the
  scan synchronously from `start()` (`:816-819`), restoring pre-batch behaviour
  as documented.
- A user who repeatedly triggers foreground chat activity keeps the boot scan
  in perpetual backoff (`scheduleBootScan` recursion at `:829-836`). This is the
  documented, deliberate "unbounded while busy" behaviour, but it means a power
  user who never has an idle `bootScanIdleBackoffMs` window (default 5 min)
  never gets their session backlog scanned in that process lifetime. Acceptable
  per spec; flagged for awareness, not a defect.

### 3. What input data produces a wrong answer?

- `classifyQuickCheck` (`integrity-worker-protocol.ts:76-79`) treats any
  non-`'ok'` **string** as `'corrupt'`, including a string containing "ok" as a
  substring only after trim-mismatch — e.g. `' ok '` trims to `'ok'` and is
  accepted; a driver returning `'ok\n'`-with-embedded-null or a locale-cased
  `'OK'` would be misclassified as corrupt. This mirrors `better-sqlite3`'s
  actual contract (it returns the literal lowercase string), so this is a
  theoretical rather than practical concern given the pinned dependency.
- `IntegrityCheckStateStore.read()` maps `quick_check_ok` to boolean via
  `Number(row.quick_check_ok) === 1` (`:99`) — a row with `quick_check_ok = 2`
  (never written by this store, since `write()` only ever stores `0`/`1`) would
  read as `false`, which is the safe direction (treated as due). No wrong
  answer reachable through this store's own write path.
- `isActivityEventPayload` accepts an empty-string `summary` by design
  (deviation 2 in lane C's report), which is a considered widening documented
  in the guard's own comment and pinned by a spec case — not a defect, but
  worth flagging to the Batch 4 owner of the renderer fallback, as the report
  itself does.

### 4. What happens when a dependency fails?

- **Worker factory absent** (VS Code host): logged once at `info`,
  `dispatchIfDue()` returns cleanly (`integrity-check.service.ts:117-126`).
  Verified by test.
- **Worker spawn throws**: caught, warned, `settle(null)` (`:183-191`), no
  record written, single-flight flag released in the outer `finally`. Verified
  by test ("resolves when the factory itself throws on spawn").
- **Worker exits before replying**: `settle(null)` on `'exit'`
  (`:196-200`), no record. Verified by test.
- **Worker exceeds its 5-minute budget**: `budgetTimer` fires, warns, kills the
  worker, `settle(null)`, no record (`:202-208`). The timer is `unref`'d
  (`:210`), verified by a spy-based test asserting `unref` was called, so a
  pending check cannot hold the process open at quit.
- **`postMessage` throws** (e.g. worker already exited between spawn and post):
  caught, warned, `settle(null)` (`:217-224`).
- **Store read/write throws** (`PERSISTENCE_UNAVAILABLE` when the connection is
  closed): both `IntegrityCheckStateStore.read` and `.write` swallow into a log
  and return/no-op (`:92-135`); `isDue()`'s own call is additionally wrapped in
  `dispatchIfDue()`'s try/catch (`integrity-check.service.ts:128-137`) as a
  second line of defence even though the store itself is not supposed to throw.
- **`SkillMdMigrationMarkerStore.read`/`.write` throw**: both are caught at the
  call site in `skill-md-migration.ts` (`readMarkerOutcome:262-276`,
  `writeMarker:300-318`) and degrade to `'unreadable'` / `markerWritten: false`
  respectively, never aborting the walk.
- No dependency-failure path found that escapes into a caller as a thrown
  exception or an unhandled rejection. `dispatchIfDue()`'s "never throws, never
  rejects" contract is verified by the two explicit throw-injection tests
  (spawn-throws, store-read-throws) in `integrity-check.service.spec.ts:372-406`.

### 5. What is missing that the requirements never mentioned?

- No metric or counter for **consecutive** `'unavailable'` outcomes. If A-1 (can
  a read-only connection open the WAL file while the host holds it open) turns
  out false in the field, every check silently no-ops forever with nothing but
  a repeated warn log — there is no escalation path (e.g. "warn once, then stay
  quiet" vs. "warn every attempt forever"). The plan defers live verification to
  Batch 5, so this is a reasonable gap for Batch 1, but it is worth a Batch 5
  acceptance criterion: confirm the warn does not itself become log spam on a
  host where A-1 is false.
- Nothing in this batch calls `dispatchIfDue()` yet (correctly deferred to
  Task 2.3 per the lane P report) — the integrity check is inert code until
  wired. This is by design and stated by the plan and the lane report, not a
  defect, but it means Batch 1's tests are the only evidence this logic is
  correct until Batch 2 wires it.
- `INTEGRITY_WORKER_PATH` is declared as a token but registered by nobody in
  this batch (also correctly deferred).

## Failure modes

### Worker never replies and never exits (hang)

- Trigger: worker process wedges (e.g. blocked syscall) without exiting or
  posting.
- Symptom: without the budget timer, `dispatchIfDue()`'s promise would never
  resolve and `this.dispatching` would stay `true` forever, permanently
  disabling further checks.
- Evidence: `integrity-check.service.ts:202-210`.
- Current handling: `INTEGRITY_WORKER_BUDGET_MS` (5 min) timer fires, kills the
  worker, settles with `null`. Verified by
  `integrity-check.service.spec.ts:429-448` using fake timers.
- Recommendation: none — this is handled correctly.

### Two callers race `dispatchIfDue()` in the same tick

- Trigger: a boot timer and a cron handler both fire close together (component
  5, not yet wired in this batch, but the guarantee is tested here).
- Symptom without the guard: two worker spawns, double the I/O cost the whole
  feature exists to avoid.
- Evidence: `dispatching` flag set before the sole `await` in the function body
  (`integrity-check.service.ts:114-139`); no `await` occurs between the
  `if (this.dispatching) return` check and `this.dispatching = true`, so two
  synchronous calls in the same tick cannot interleave.
- Current handling: verified directly by
  `integrity-check.service.spec.ts:227-239` ("two concurrent dispatchIfDue()
  calls produce ONE spawn").
- Recommendation: none — correct.

### Boot scan re-arms indefinitely under sustained chat activity

- Trigger: `bootScanIdleBackoffMs > 0` and `onActivity` keeps stamping
  `lastActivityAt` faster than the backoff window elapses.
- Symptom: the boot scan (and the session backlog it would enqueue) never runs
  for the lifetime of a busy session.
- Evidence: `skill-trigger.service.ts:813-842`, recursive `scheduleBootScan`
  call at `:834`.
- Current handling: this is the documented design ("the re-arm is deliberately
  unbounded"), not a bug — `stop()` still clears the timer
  (`:209-212`), so the process cannot be held open by it, and the backlog is
  merely delayed, not lost (rows stay `queued`).
- Recommendation: none required for Batch 1; worth surfacing in product
  telemetry later if boot-scan starvation becomes observable in the field —
  out of this batch's scope.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **No escalation signal for a persistently `'unavailable'` host** —
  `integrity-check.service.ts:269-274`. See Five Logic Questions #1/#5. Suggest
  a Batch 5 acceptance check that this does not produce unbounded log growth
  and that a human has a way to notice "integrity checks have never once
  succeeded on this machine" — not a Batch 1 blocker since A-1 is explicitly
  deferred to Batch 5 for live verification.
- **`skill-synthesis/src/index.ts` does not export `SkillMdMigrationMarkerOutcome`**
  — flagged honestly by the lane S report itself
  (`batch-1-lane-S-report.md:117-121`) as an out-of-file-list observation, not a
  defect; no current consumer needs the type outside the lib. Minor, no action
  required for this batch.

## Data flow

1. **Migration path**: `migrations/index.ts` appends `{version: 42, ...}` after
   `41` (OK, static SQL, `IF NOT EXISTS`, single-row `CHECK (id = 1)` schema
   constraint — `0042_db_integrity_check_state.ts:62-72`). Idempotence and the
   two-row-rejection behaviour are both proven by a real (or `node:sqlite`
   fallback) SQLite instance in `0042_db_integrity_check_state.spec.ts:169-271`,
   not just asserted structurally. OK.
2. **Read path**: `SqliteIntegrityService.isDue()` → `IntegrityCheckStateStore.read()`
   → `connection.db.prepare(SELECT_SQL).get()`. Any throw at any layer resolves
   to `null`/"due". OK, every uncertainty resolves toward running a check, never
   toward skipping one — matches the plan's explicit contract.
3. **Dispatch path**: `dispatchIfDue()` → single-flight guard → factory check →
   `isDue()` guard → `runWorker()` → `record()`. Every branch (no factory, not
   due, in flight, spawn throw, exit-before-reply, budget expiry, malformed
   reply, `unavailable` verdict, `ok:false`, clean/corrupt verdict) is traced
   above and each resolves without throwing or leaking the worker process. OK.
4. **Write path**: only a conclusive verdict (`'ok'` or `'corrupt'`) reaches
   `store.write()` (`integrity-check.service.ts:256-284`); `'unavailable'` and
   `null` are filtered out before the write call. OK — matches the "no record
   for unavailable" contract exactly.
5. **Deletion path**: `sqlite-connection.service.ts` diff is deletion-only
   (verified via `git diff`, 47 lines removed, 0 added, 1 call-site line
   removed) — the file shrank from 839 to 797 lines per the lane report,
   consistent with the "must shrink, never grow" quality gate. OK.
6. **Skill boot-scan path**: `start()` → `readBootScanFlag()` →
   `scheduleBootScan(signal)` → (delay elapses) → activity-backoff check →
   `runBootScan(signal)` → `synthesis.enqueueAnalyze({source:'boot'})`. The
   activity stamp in `onActivity` sits above the `idleMs <= 0` early return
   (`:234` vs `:237`), exactly as required so the boot-scan deferral is never
   silenced by an unrelated idle-timer setting. OK.
7. **SKILL.md marker path**: `readMarkerOutcome()` runs strictly before any
   `readdirSync`/`readFileSync` call (`migrateSkillMdFiles:182-190`); only
   `'current'` short-circuits; every other token falls through to the walk.
   `writeMarker()` only runs when `errors.length === 0`
   (`:242-244`). OK.
8. **Wire-contract path** (`libs/shared`): `BootReadinessChangedPayload` widened
   in place (no `V2`), `ActivityEventPayload` added as a new, additive message
   type in `MESSAGE_TYPES`/`StrictMessageType`/`MessagePayloadMap`. `rpc.types.ts`
   deliberately untouched this batch (verified: `git diff` on that file is
   empty), correctly deferred to Batch 3 per the RPC manifest's total-partition
   requirement. OK.

## Requirements fulfilment

| Requirement                                                                                                                                                            | Status   | Gap                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| Migration `0042`, static SQL, single-row CHECK, append-only                                                                                                            | COMPLETE | none                                                                                                                        |
| `IntegrityCheckStateStore` degrades read→null, write swallows                                                                                                          | COMPLETE | none                                                                                                                        |
| Integrity worker: no `electron` import, `readonly`+`fileMustExist`, never `'corrupt'` on infra failure                                                                 | COMPLETE | none                                                                                                                        |
| `SqliteIntegrityService.dispatchIfDue()` never throws/rejects, single-flight, unref'd budget, kills worker on every path, writes no record for `unavailable`           | COMPLETE | none                                                                                                                        |
| `runBootChecks` deletion, no other change to `sqlite-connection.service.ts`                                                                                            | COMPLETE | none                                                                                                                        |
| Skill boot-scan deferral: no sync scan from `start()`, mirrors `memory-trigger.service.ts`, activity stamp above `idleMs<=0` guard, `stop()` clears timer before abort | COMPLETE | none                                                                                                                        |
| Settings keys in both `FILE_BASED_SETTINGS_KEYS` and `_DEFAULTS`, kept out of DTO/prefixes                                                                             | COMPLETE | none                                                                                                                        |
| SKILL.md rescan → 7 days; `markerOutcome`/`markerWritten` added; every non-`'current'` token walks                                                                     | COMPLETE | none                                                                                                                        |
| `libs/shared`: `BootPhase`/`isBootPhase`, `ActivitySource`/`ActivityLevel`/`isActivityEventPayload`, append-only message protocol                                      | COMPLETE | `rpc.types.ts` registry entry correctly deferred to Batch 3 per the manifest partition constraint (not a gap in this batch) |

Implicit requirements not addressed: none identified beyond the moderate items
noted above (escalation signal for persistent `unavailable`).

## Edge cases

| Case                                      | Handled        | How                                                | Concern                                                                            |
| ----------------------------------------- | -------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| No record ever written (fresh install)    | YES            | `isDue()` returns `true` on `null` state           | none                                                                               |
| Record exactly at the 7-day boundary      | YES            | `>=` comparison, pinned by test                    | none                                                                               |
| Clock skew (`checkedAt > now`)            | YES            | `isDue()` explicit check                           | none                                                                               |
| Two concurrent `dispatchIfDue()` calls    | YES            | sync single-flight flag                            | none                                                                               |
| Worker never replies                      | YES            | budget timer kill                                  | none                                                                               |
| Worker exits before reply                 | YES            | `settle(null)` on exit                             | none                                                                               |
| Malformed/unrecognised worker reply       | YES            | `asResponse()` narrows to `null`                   | none                                                                               |
| No worker factory registered (VS Code)    | YES            | one `info` log, no dispatch                        | none                                                                               |
| `bootScanDelayMs: 0`                      | YES            | runs boot scan synchronously from the timer branch | none                                                                               |
| `bootScanIdleBackoffMs: 0`                | YES            | `backoff > 0 &&` short-circuits, ignoring activity | none                                                                               |
| `stop()` mid-pending-scan                 | YES            | timer cleared, then controller aborted             | none                                                                               |
| Marker store `write` throws               | YES            | `markerWritten: false`, `errors: []` unaffected    | none                                                                               |
| Marker stamped in the future              | YES            | `'future-stamped'` → walk                          | none                                                                               |
| Empty `summary` in `ActivityEventPayload` | YES (admitted) | guard accepts, renderer expected to fall back      | fallback lives in a later batch (4.4), flagged by lane C — not this batch's defect |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: A-1 (whether a read-only `better-sqlite3` connection can actually
  open the WAL file while the host holds it open) is still unverified by any
  test in this batch — the code's degrade-to-`unavailable` behaviour is correct
  by construction and by unit test, but the real-world exercise of that path
  waits for Batch 5's live cold boot, and there is no consecutive-failure
  escalation if A-1 turns out false.
- What a robust implementation would add: a bounded "N consecutive `unavailable`
  results" escalation (e.g. promote to a single `logger.error` after some
  threshold) so a systemically broken worker on a given host is discoverable
  without a log audit; nothing else material is missing from this batch's
  scope.
