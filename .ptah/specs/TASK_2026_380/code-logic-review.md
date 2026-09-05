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

## Batch 2

## Summary

| Metric              | Value           |
| ------------------- | --------------- |
| Overall score       | 8/10            |
| Assessment          | APPROVED        |
| Blocking issues     | 0               |
| Serious issues      | 0               |
| Moderate issues     | 2               |
| Failure modes found | 4 (all handled) |

Scope reviewed: `apps/ptah-electron/src/services/platform/electron-integrity-worker-factory.ts`
(+ `.spec.ts`), `libs/backend/cli-engine/src/lib/thoth/cli-integrity-worker-factory.ts`,
`apps/ptah-electron/tsconfig.integrity-worker.json`, `apps/ptah-cli/tsconfig.integrity-worker.json`,
`apps/ptah-electron/src/di/phase-2-libraries.ts`,
`libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`,
`apps/ptah-electron/project.json`, `apps/ptah-cli/project.json`,
`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` (+ `.spec.ts`), all read in
full via `git diff 0c7e4d05c` per file plus a full read of the two new factories and
their specs. Cross-checked against `batches.md` Batch 2, `implementation-plan.md`
components 4-5, `batch-2-report.md`'s five named deviations, and the Batch 1 code this
batch wires (`worker-process.port.ts`, `integrity-check.service.ts`,
`integrity-worker.ts`). Per the brief, every other dirty file in this worktree
(platform-core, vscode-core, rpc-handlers, `rpc.types.ts`, `bootstrap.ts`/`main.ts`,
boot-readiness/boot-coordinator) belongs to a concurrent Batch 3 agent and was not
reviewed or scored here.

## Five logic questions

### 1. How does this fail silently?

- A wrong `INTEGRITY_WORKER_PATH` (e.g. a packaging step that drops
  `integrity-worker.mjs`) is the one failure this wiring can silently produce.
  `utilityProcess.fork`/`new Worker(...)` on a missing file surfaces as an early
  `'exit'` or a thrown spawn, both of which `runWorker` already maps to
  `settle(null)` (`integrity-check.service.ts:183-200`, reviewed in Batch 1) — no
  record is written and the only trace is a `logger.warn`. This batch does not add
  a new failure mode here; it is the same "correct degrade, no escalation" gap
  already flagged as moderate in Batch 1, now reachable for real once the path is
  wired.
- `registerIntegrityCheckJob`'s own registration try/catch
  (`start-thoth-cron.ts:386-402`) swallows any registration-time exception into a
  `console.warn` and no rethrow — a host on which `CRON_JOB_STORE`/`CRON_HANDLER_REGISTRY`
  resolve but throw mid-call (e.g. a corrupted job table) loses the integrity cron
  entirely with only a console line, and nothing surfaces that to the user-facing
  cron list UI. This mirrors the identical pattern already used for the daily
  backup and skill-drain blocks in the same function, so it is consistent, not a
  regression — but it is a real "the feature silently never existed on this host"
  path worth naming.
- The cron handler body (`start-thoth-cron.ts:206-215`) calls
  `container.resolve<SqliteIntegrityService>(...)` with **no try/catch**, unlike
  the boot timer's callback which wraps the same resolve in a try/catch
  (`:217-228`). If the container is disposed (or the token unregistered) between
  `startThothCron` completing and a later cron tick, the handler's `async`
  function returns a rejected promise instead of a caught, logged failure. This is
  not unique to this batch — the pre-existing backup and drain handlers have the
  same shape (`resolve` inside the handler body, uncaught) — so it is consistent
  with the file's own precedent, not a new gap this batch introduced, and
  presumably `cron-scheduler`'s job runner already catches handler rejections
  (out of this batch's file list to confirm). Flagged for awareness, not a defect
  unique to Batch 2.

### 2. What user action produces unexpected behaviour?

- None found specific to this batch's wiring. A user who force-quits Electron
  within the first 60 s of a fresh launch races the boot timer against shutdown:
  the timer is `unref`'d so it never blocks quit, and if it fires after the
  container is torn down, `container.resolve` throws inside the boot timer's own
  try/catch and is logged, not crashed (`start-thoth-cron.ts:217-228`, pinned by
  the "swallows a boot-dispatch resolve failure instead of throwing" spec at
  `start-thoth-cron.spec.ts:496-516`). If it fires and the container is still
  alive but the SQLite connection has already been closed by
  `disposeBeforePersistence`, `dispatchIfDue()`'s own outer try/catch
  (`integrity-check.service.ts:140-149`, Batch 1) absorbs the resulting
  store-write failure. No user-visible crash on either timing.
- A user who runs the CLI gets a registered `IIntegrityWorkerProcessFactory` that
  is never invoked (A-2, `register-thoth-libraries.ts:80-88`) — not unexpected
  behaviour so much as a documented no-op; there is no user-facing surface (no
  `cron:list` entry, since `startThothCron` is never called for this host) that
  would make a user expect otherwise.

### 3. What input data produces a wrong answer?

- Electron's `on('exit', ...)` callback receives a `number` per Electron's own
  typing, and the port's declared contract accepts `number | null`
  (`worker-process.port.ts:22`, `electron-integrity-worker-factory.ts:31-46`). The
  Electron adapter narrows the callback signature to `(code: number)` before
  calling through — if Electron ever delivered `null` in practice (it does not,
  per its own types) the cast at `:42-44` would silently pass it through rather
  than reject it; this is a type-level widening for cross-transport compatibility
  (worker_threads _can_ deliver `null`) and is not exercised by any test with an
  actual `null` on the Electron side. Low risk given Electron's contract, but the
  factory's own test suite (`electron-integrity-worker-factory.spec.ts:90-99`)
  only asserts numeric codes `0` and `3`, never exercises the `null` branch the
  type signature advertises.
- `CliIntegrityWorkerFactory`'s `type: 'module'` option is force-cast through
  `unknown` (`cli-integrity-worker-factory.ts:64-66`) because `WorkerOptions` has
  no such field in Node's types — this is copy-pasted from
  `CliEmbedderWorkerFactory` verbatim (confirmed by the report) and is a known,
  pre-existing seam, not something this batch introduces incorrectly.

### 4. What happens when a dependency fails?

- **`utilityProcess.fork`/`new Worker` unavailable or throws at spawn**: caught by
  `SqliteIntegrityService.runWorker`'s own try/catch around `factory.spawn()`
  (Batch 1, `integrity-check.service.ts:183-191`); this batch's factories add no
  new try/catch of their own around the fork/Worker constructor call itself
  (`electron-integrity-worker-factory.ts:59-63`,
  `cli-integrity-worker-factory.ts:60-67`) — correct, since the service already
  owns that boundary and a factory-level catch would just re-throw or mask the
  same error one layer down.
  `IIntegrityWorkerProcessFactory` contract, which explicitly says `spawn()` may
  throw, no exceptions.
- **`container.isRegistered`/`.resolve` fails during registration** (torn-down
  or disposed container at `phase-2-libraries.ts:308-330` /
  `register-thoth-libraries.ts:80-88`): both registration blocks are wrapped in
  the file's existing outer try/catch (confirmed by reading the surrounding
  function in `phase-2-libraries.ts`, `register-thoth-libraries.ts:52` `try {`);
  a failure here is non-fatal to the rest of DI registration.
- **Cron scheduler job-store or handler-registry throws during registration**:
  caught by `registerIntegrityCheckJob`'s own call-site try/catch
  (`start-thoth-cron.ts:386-402`), logged, cron start proceeds without the
  integrity job. Verified structurally against the identical pattern for backup
  and drain jobs in the same function.
- **`dispatchIfDue()` never settles** (worker wedges): out of this batch's scope
  — the 5-minute budget timer inside `SqliteIntegrityService.runWorker` (Batch 1)
  is what bounds it; this batch's cron handler and boot timer both correctly
  never `await` that promise (`void integrity.dispatchIfDue()` at
  `start-thoth-cron.ts:213` and `:222`), so neither the cron job slot nor the
  boot timer callback can be held open by a hung worker. Verified by the
  never-awaited spec (`start-thoth-cron.spec.ts:...`, "dispatches without
  awaiting when the cron handler runs").

### 5. What is missing that the requirements never mentioned?

- No log line (info or otherwise) records a cron tick that found the job **not
  registered** because `SQLITE_INTEGRITY_SERVICE` was absent from the container —
  `registerIntegrityCheckJob` returns silently at
  `start-thoth-cron.ts:199-201`. Every other guarded block in this file
  (`registerSkillDrainJobs:100-102`) has the same silent-return shape, so this is
  consistent with the file's own convention, not a new gap.
- Nothing in this batch verifies the packaged (`electron-builder`) path actually
  loads `better-sqlite3` at ABI 143 from inside a fork'd `integrity-worker.mjs` —
  the report names this explicitly as deferred to Batch 5's live cold boot. The
  build output was verified to exist (`dist/apps/ptah-electron/integrity-worker.mjs`,
  3400 bytes, confirmed present) but that only proves the bundle builds, not that
  it runs inside a packaged app.
- No metric distinguishes "boot dispatch fired and found nothing due" from "boot
  dispatch fired and the worker failed" from "boot dispatch never fired because
  the container was torn down inside the 60 s window" — all three produce either
  no log line or a generic warn, consistent with the Batch 1 gap already noted
  (no consecutive-failure escalation), not a new one.

## Failure modes

### Boot timer fires after container teardown

- Trigger: main process begins shutdown inside the 60 s window after
  `startThothCron` armed the timer.
- Symptom without handling: an uncaught exception on the timer's own stack
  (nowhere to propagate to, since `setTimeout` callbacks have no caller to
  reject).
- Evidence: `start-thoth-cron.ts:217-228`.
- Current handling: `container.resolve` is wrapped in its own try/catch inside
  the timer body; a throw is caught and logged via `console.warn`. Verified by
  `start-thoth-cron.spec.ts` ("swallows a boot-dispatch resolve failure instead
  of throwing on the timer").
- Recommendation: none — correct.

### Two `startThothCron` calls (re-activation) arm two boot timers

- Trigger: a workspace switch or re-activation calls `startThothCron` a second
  time in the same process.
- Symptom without the guard: two `setTimeout(60_000)` timers, each capable of
  calling `dispatchIfDue()` — collapsed by the service's own single-flight flag,
  but still two live timers and two log lines instead of one.
- Evidence: the boot timer is created **inside** the `!handlerRegistry.has(...)`
  guard (`start-thoth-cron.ts:205-234`), not outside it, so only the first call
  arms a timer.
- Current handling: correct, and it is the one plan deviation (deviation 3) the
  report calls out and justifies explicitly. Verified by the "arms exactly one
  unref'd boot dispatch at 60 s, across two calls" spec.
- Recommendation: none — correct, and better than the plan's literal reading.

### Cron tick lands while a boot-dispatch check is still running

- Trigger: the nightly `30 3 * * *` tick fires while the 60 s boot dispatch (or a
  previous nightly tick) has not yet resolved — plausible only in a
  long-uptime host that also just restarted the container, an edge case rather
  than a common one.
- Symptom without a guard: two concurrent worker spawns, doubling the I/O the
  feature exists to avoid.
- Evidence: both the boot timer and the cron handler call
  `SqliteIntegrityService.dispatchIfDue()` (`start-thoth-cron.ts:213`, `:222`),
  which is the same single-flight-guarded method reviewed and tested in Batch 1
  (`integrity-check.service.ts:114-115`, `dispatching` flag).
- Current handling: correct by construction — this batch adds two callers of an
  already-idempotent, single-flight method; it does not need its own guard
  because the guard lives one layer down and was proven in Batch 1.
- Recommendation: none — correct.

### Handler body's `container.resolve` is unguarded (pre-existing pattern, now shared by a fourth call site)

- Trigger: a cron tick for `db:integrity` fires after the container has been
  disposed but the process has not exited (a narrower window than the boot-timer
  case, since cron ticks are scheduled far apart).
- Symptom: the handler's returned promise rejects instead of resolving with a
  `skipped`/`summary` outcome.
- Evidence: `start-thoth-cron.ts:206-215`, no try/catch around
  `container.resolve` inside the handler, contrasted with the boot timer's
  explicit try/catch three lines above it (`:217-228`) for the identical
  resolve call.
- Current handling: none added by this batch; identical to the existing
  `backup:daily` and `skills:drain:*` handlers in the same file
  (`:305-350`, `:105-131`), so this is an existing, accepted risk this batch
  inherits rather than introduces. Presumably `cron-scheduler`'s job runner
  catches handler rejections (that lib is out of this batch's file list).
- Recommendation: not a Batch 2 blocker since the pattern is inherited, but worth
  a follow-up to confirm `cron-scheduler` actually catches a rejected handler
  and records it as a failed run rather than an unhandled rejection — a question
  this batch's tests do not answer because they call the handler directly, not
  through the real scheduler.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **Cron-handler `container.resolve` unguarded while the boot timer's identical
  resolve is guarded** — `start-thoth-cron.ts:206-215` vs. `:217-228`. See
  Failure Modes above. Inherited from the pre-existing backup/drain handler
  shape in the same file, so moderate rather than serious, and not unique to
  this batch's new code.
- **No escalation or distinguishing log** between "integrity job never
  registered" (no service in container), "registered but never fired" (torn
  down inside the 60 s window) and "fired but the worker failed" — all three
  read the same from outside the process. Consistent with the Batch 1 gap
  already on record; not a new defect, but this batch is where it becomes
  reachable at all four of the new call sites (boot timer, cron handler,
  two host factories).

## Data flow

1. **Factory registration** (`phase-2-libraries.ts:308-330`,
   `register-thoth-libraries.ts:52-89`): `INTEGRITY_WORKER_PATH` and
   `INTEGRITY_WORKER_PROCESS_FACTORY` are registered as `useValue` BEFORE
   `registerPersistenceSqliteServices(...)`, so `SqliteIntegrityService`'s
   `@inject(..., { isOptional: true })` constructor param resolves a concrete
   factory instead of falling back to `null`. Verified in both files by reading
   the surrounding function and confirming the line order via `git diff`. OK.
2. **Path derivation**: both hosts mirror the embedder factory's exact path
   expression — Electron's `dirnameGlobal ?? path.join(os.homedir(), '.ptah')`
   plus `'integrity-worker.mjs'` (`phase-2-libraries.ts:283-287` for the
   embedder, `:313-316` for integrity, identical shape); the CLI's
   `path.join(__dirname, 'integrity-worker.mjs')` (`register-thoth-libraries.ts:57`
   for the embedder, `:87` for integrity, identical shape). OK — a packaged app
   finds the worker the same way it already finds the embedder worker, which is
   already proven in production.
3. **Spawn path**: `SqliteIntegrityService.runWorker()` (Batch 1) calls
   `factory.spawn()` → `ElectronIntegrityWorkerFactory.spawn()` /
   `CliIntegrityWorkerFactory.spawn()` → `utilityProcess.fork(...)` /
   `new Worker(...)`, wrapping the child in a thin adapter that maps `message`/
   `exit`/`kill` onto the port. No `init` is posted by either factory, matching
   the port contract and the worker entry's single-shot design (the worker takes
   the db path on the `check` request, not on spawn). Verified by reading
   `worker-process.port.ts:27-34` and both factory implementations plus the
   Electron factory's own "posts no init" spec. OK.
4. **Message transport asymmetry**: `integrity-worker.ts` (Batch 1, unchanged)
   auto-detects `process.parentPort` (Electron) vs. `worker_threads.parentPort`
   and normalizes: Electron's child-side `parentPort.on('message', (e) =>
handler(e.data))` unwraps the `{ data }` envelope
   (`integrity-worker.ts:86-89`), while on the HOST side
   `ElectronIntegrityWorkerFactory`'s `child.on('message', cb)` receives the
   raw, already-unwrapped payload (Electron's `utilityProcess` message event is
   not itself `{ data }`-wrapped — only the child's `MessagePortMain` side is).
   This asymmetry is real but is the same asymmetry the embedder worker/factory
   pair already has in production; the factory's own spec
   (`electron-integrity-worker-factory.spec.ts:76-88`) asserts the raw,
   unwrapped shape is what a host listener receives, which matches Electron's
   actual API. OK, verified by test and precedent.
5. **Dispatch path**: cron handler / boot timer → `dispatchIfDue()` → (Batch 1)
   single-flight guard → `isDue()` → `runWorker()` → `record()`. This batch adds
   exactly two callers, both `void`-fired and never awaited
   (`start-thoth-cron.ts:213`, `:222`), so neither can hold a cron job slot or
   the boot timer's own tick open. OK.
6. **Build path**: `build-integrity-worker` targets in both `project.json`s
   bundle `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`
   to `integrity-worker.mjs` with `external: ["better-sqlite3"]`, `format: esm`,
   `platform: node`. Verified present in both files by `git diff`, and the
   Electron target's output was verified on disk
   (`dist/apps/ptah-electron/integrity-worker.mjs`, present alongside
   `embedder-worker.mjs`). All four consuming lists (`build.dependsOn`,
   `build-dev.commands`, `serve:watch.commands`, CLI's
   `restore-cli-manifest.dependsOn`) were independently confirmed edited via
   `git diff`, matching the report's claim. OK.

## Requirements fulfilment

| Requirement                                                                                      | Status   | Gap                                                                                   |
| ------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------- |
| Electron factory: `utilityProcess.fork`, no `init`, maps `message`/`exit`/`kill`                 | COMPLETE | none                                                                                  |
| CLI factory: `worker_threads`, no `init`, maps `message`/`exit`/`kill`                           | COMPLETE | none                                                                                  |
| Both factories + path registered BEFORE `registerPersistenceSqliteServices`                      | COMPLETE | none                                                                                  |
| Path derivation matches the embedder's per-host convention                                       | COMPLETE | none                                                                                  |
| Cron handler `db:integrity`, `has()`-guarded, upsert unguarded, `30 3 * * *` UTC                 | COMPLETE | none                                                                                  |
| Boot dispatch: one `unref`'d timer at 60 s, armed once per process, never awaited                | COMPLETE | none                                                                                  |
| `isDue()` pre-check with `skipped` outcome on a not-due tick                                     | COMPLETE | plan deviation 2, justified and tested                                                |
| All four build-target lists edited, `external: ["better-sqlite3"]` present                       | COMPLETE | none                                                                                  |
| Registration failure at any of the three new non-fatal try/catch sites degrades without throwing | COMPLETE | one inherited gap: cron handler body's own `resolve` call is unguarded (see Moderate) |

Implicit requirements not addressed: a distinguishing log/metric between
"never registered", "registered but torn down before firing" and "fired but
failed" (inherited gap, not new); confirmation that `cron-scheduler`'s job
runner actually catches a rejected handler (out of this batch's file list).

## Edge cases

| Case                                                                        | Handled         | How                                                                      | Concern                                                                                                      |
| --------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Two `startThothCron` calls in one process                                   | YES             | boot timer armed inside `!has()` guard; handler `has()`-guarded          | none                                                                                                         |
| Boot timer fires after container disposed                                   | YES             | try/catch around `resolve` inside the timer body                         | none                                                                                                         |
| Cron tick fires after container disposed                                    | NO              | handler's `resolve` is unguarded                                         | inherited from backup/drain handlers; presumably caught upstream by cron-scheduler, unverified in this batch |
| Worker exit code is Electron's raw `number`                                 | YES             | adapter narrows and forwards                                             | `null` branch (worker_threads-only) untested on the Electron adapter                                         |
| No `SQLITE_INTEGRITY_SERVICE` registered (VS Code, or a host that opts out) | YES             | `registerIntegrityCheckJob` returns before registering handler/timer/job | none                                                                                                         |
| CLI host: factory registered, never dispatched                              | YES (by design) | `startThothCron` is never called from `cli-engine`                       | documented as A-2, not a defect                                                                              |
| Packaged app loads `better-sqlite3` from the forked worker                  | NOT VERIFIED    | build output exists on disk                                              | deferred to Batch 5's live cold boot, per the report                                                         |
| Concurrent boot-dispatch and cron-tick dispatch                             | YES             | `SqliteIntegrityService`'s single-flight flag (Batch 1)                  | none                                                                                                         |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the packaged-app path (a `utilityProcess.fork`'d
  `integrity-worker.mjs` actually loading ABI-143 `better-sqlite3` at runtime,
  and a read-only connection actually opening the WAL file while the host holds
  it) is unverified by anything in this batch or Batch 1 — both are explicitly
  deferred to Batch 5's live cold boot, and until then this wiring is proven only
  by unit tests against mocked transports.
- What a robust implementation would add: a try/catch around the cron handler's
  `container.resolve` call to match the boot timer's own guard three lines away
  (cheap, closes the one asymmetry this review found); and, longer-term, the
  same consecutive-failure escalation Batch 1's review already recommended, now
  reachable through four call sites instead of zero.
