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
  (worker*threads \_can* deliver `null`) and is not exercised by any test with an
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

## Batch 3

## Summary

| Metric              | Value           |
| ------------------- | --------------- |
| Overall score       | 8/10            |
| Assessment          | APPROVED        |
| Blocking issues     | 0               |
| Serious issues      | 0               |
| Moderate issues     | 2               |
| Failure modes found | 4 (all handled) |

Scope reviewed: `libs/backend/platform-core/src/{interfaces/boot-readiness.interface.ts,
di/tokens.ts, index.ts}`; `libs/backend/vscode-core/src/{services/null-boot-readiness.ts,
services/null-boot-readiness.spec.ts, di/register-platform-agnostic.ts,
di/register-platform-agnostic.spec.ts, messaging/rpc-handler.ts}`;
`libs/shared/src/lib/types/rpc.types.ts`;
`libs/backend/rpc-handlers/src/lib/handlers/{boot-rpc.handlers.ts,
boot-rpc.handlers.spec.ts, boot-rpc.schema.ts, index.ts}`,
`libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`,
`libs/backend/rpc-handlers/src/index.ts`; `libs/backend/thoth-runtime/src/lib/
{activity-emitter.ts, activity-emitter.spec.ts, start-thoth-cron.ts,
start-thoth-cron.spec.ts}`, `libs/backend/thoth-runtime/src/index.ts`;
`apps/ptah-electron/src/activation/{boot-coordinator.ts, boot-coordinator.spec.ts,
boot-readiness-broadcaster.ts, boot-readiness-broadcaster.spec.ts,
boot-heavy-services.ts, post-window.ts, bootstrap.ts, boot-order.spec.ts}`,
`apps/ptah-electron/src/main.ts`,
`apps/ptah-electron/src/services/platform/electron-boot-readiness.ts`. Every
file was read in full via `git diff` (modified files) or a complete read (new
files), cross-checked against `implementation-plan.md` components 9, 10, 11,
14b, `batch-3-report.md`'s five named deviations for tasks 3.1-3.3 and two for
3.4, and `apps/ptah-electron/CLAUDE.md`'s ref/disposal rules. `libs/frontend/**`
and `apps/ptah-extension-webview/**` dirty files were explicitly excluded per
the brief (Batch 4 is mid-flight there) and not read.

## Five logic questions

### 1. How does this fail silently?

- `BootRpcHandlers.handleGetReadiness` (`boot-rpc.handlers.ts:69-95`) fails OPEN
  by design: a Zod parse failure on the (empty) params logs a warn and answers
  anyway (`:76-81`), and a throw from `IBootReadinessProvider.getReadiness()`
  degrades to a fabricated `{ readiness: 'ready', phase: 'settled' }`
  (`:83-94`). This is the documented, correct trade-off for a boot-screen probe
  — verified by `boot-rpc.handlers.spec.ts:80-98` — but it means a coordinator
  that is genuinely still warming, if its `snapshot()` ever threw, would report
  "done" to the renderer, which dismisses the boot screen while the backend is
  not actually ready. `BootCoordinator.snapshot()` (`boot-coordinator.ts:275-282`)
  is a plain object literal with no I/O, so this path is unreachable today, not
  a live defect — noted as the one place a coordinator regression would become
  invisible in the renderer.
- `BootCoordinator.setPhase` (`:295-300`) is edge-triggered: a repeat call with
  the SAME phase but a DIFFERENT `detail` string is silently dropped, including
  the detail (`boot-coordinator.spec.ts:473-485` pins exactly this — "a
  different detail" never reaches the emitter). This is deliberate ("one
  message per transition") and documented, but it means any future call site
  that tries to update progress TEXT without changing the phase (e.g. "Opening
  the database (retry 2)") will silently do nothing — worth flagging for
  whoever adds the next anchor.
- `createBootReadinessBroadcaster` and `createActivityEmitter` both swallow
  every failure to `console.warn` (`boot-readiness-broadcaster.ts:44-65`,
  `activity-emitter.ts:66-93`) — a renderer that never receives a push looks
  identical, from the main process's perspective, to a renderer that received
  and ignored one. This is the documented, correct contract (a display update
  must never abort the boot it narrates) and is the same shape already
  reviewed and accepted in Batches 1-2 for the integrity check; not a new gap.

### 2. What user action produces unexpected behaviour?

- A renderer reload during an in-progress boot now gets a replay
  (`post-window.ts:116-119`, `on` not `once`), but the replay is UNCONDITIONAL
  on every `did-finish-load` — including a reload that happens AFTER the boot
  has already settled. That is correct and intended (a reloaded renderer that
  missed the one `settled` push needs to be told), and it is idempotent from
  the renderer's perspective since the payload does not change once settled.
  No defect found here.
- A user who force-quits during the `harness` phase (after
  `refreshUserLayer` but before the post-download callback's `reconcileHarness`
  fires) sees `emitActivity('harness', 'reconcile', ...)` never fire for that
  pass, and the readiness push may report `failed` with `phase: 'harness'` — a
  correct, honest answer per `boot-coordinator.spec.ts:536-555`. No unexpected
  behaviour, just partial narration, which matches the plan's "best effort"
  contract for the ticker.

### 3. What input data produces a wrong answer?

- None found specific to this batch's new code. `BootGetReadinessParamsSchema`
  is `.strict()` (`boot-rpc.schema.ts:14`) so an evolving caller that starts
  sending fields gets a parse failure that is logged and ignored — the method
  answers the same snapshot regardless, verified by
  `boot-rpc.handlers.spec.ts:110-122`. `withActivityEmit` derives its summary
  from `result.outcome === 'skipped'` only (`activity-emitter.ts:121`); a
  handler that returns some THIRD `outcome` value (not `'skipped'`, and no
  `summary`) falls into the `else` branch and emits the generic
  `"<name> completed"` fallback (`:129`, pinned by
  `activity-emitter.spec.ts:191-206`) — this is not wrong, since
  `JobHandlerResult.outcome` today has no third literal, but the wrapper's
  branching is coupled to that fact rather than exhaustively switched; a future
  outcome literal added to `cron-scheduler` would silently read as "succeeded"
  here with no compiler signal, because `withActivityEmit` narrows on a string
  literal comparison rather than an exhaustive `satisfies`/switch. Minor,
  forward-looking.

### 4. What happens when a dependency fails?

- **`TOKENS.WEBVIEW_MANAGER` absent or throwing**, at every one of the three new
  call sites (boot readiness broadcaster, activity emitter x2): each is
  `isRegistered`-guarded and wrapped in try/catch, verified by dedicated specs
  (`boot-readiness-broadcaster.spec.ts:71-93`, `activity-emitter.spec.ts:81-121`).
  No caller's own control flow (`setPhase`, the cron handler, `boot-heavy-services.ts`)
  can be affected.
- **A rejected `broadcastMessage`**: caught with a `.catch` on the returned
  promise in both emitters (`boot-readiness-broadcaster.ts:52-59`,
  `activity-emitter.ts:79-86`), verified by
  `boot-readiness-broadcaster.spec.ts:95-108` and
  `activity-emitter.spec.ts:123-138`. No unhandled rejection reaches the main
  process.
- **`IBootReadinessProvider.getReadiness()` throws** (Electron adapter reading a
  disposed/faulted coordinator, or the null adapter somehow throwing): caught
  in the RPC handler, degrades to a fabricated ready/settled answer (see Q1).
  Never propagates to the transport as an error.
- **A cron handler throws inside `withActivityEmit`**: the wrapper does not
  catch it — `await handler(ctx)` propagates the rejection to the caller and
  emits nothing (`activity-emitter.ts:119-132`, pinned by
  `activity-emitter.spec.ts:208-219`). This is the one place a dependency
  failure is deliberately NOT absorbed at this layer, on the stated reasoning
  that the cron scheduler's run-row is the correct failure channel — consistent
  with the Batch 2 finding that the cron handler bodies here have no
  try/catch of their own around `container.resolve`, an inherited, not new,
  gap.
- **`container.isRegistered`/`.resolve` mid-teardown for `PLATFORM_TOKENS.BOOT_READINESS`**:
  not applicable at the RPC layer — the token is injected once at
  `BootRpcHandlers` construction time via `@inject`, which happens during RPC
  surface registration (`wire-runtime.ts`, confirmed to run strictly AFTER
  `bootstrap.ts`'s `container.register(PLATFORM_TOKENS.BOOT_READINESS, …)` at
  `bootstrap.ts:361`), so the constructor always receives the Electron adapter
  on that host. A container disposed later would make the ALREADY-INJECTED
  `bootReadiness.getReadiness()` call fail only if the coordinator itself
  throws, which it structurally cannot (Q1).

### 5. What is missing that the requirements never mentioned?

- No test exercises the actual tsyringe override behaviour claimed by the
  report and the code comments — "last registration wins" for
  `container.register(TOKEN, { useValue })` after an earlier
  `container.registerSingleton(TOKEN, Class)` for the SAME token. This batch's
  unit tests (`register-platform-agnostic.spec.ts`) only prove the `isRegistered`
  guard skips re-registration when something is ALREADY registered on the same
  container instance — they do not reproduce the real sequence (null singleton
  registered by `registerVsCodeCorePlatformAgnostic` during `ElectronDIContainer.setup`,
  then overridden by `bootstrap.ts:361`'s `useValue` on the same container).
  Verified this is the existing, precedented idiom (`SESSION_ATTACHMENT_GUARD`
  is registered and overridden the identical way, unreviewed by any batch
  because it predates this task), so treated as low risk, but the very
  assumption the whole component 9 design rests on ("Electron's registration
  overrides the null default") has no assertion of its own beyond a code
  comment and an untested claim in `batch-3-report.md`.
- Nothing added distinguishes, from the renderer's side, "the coordinator threw
  and we faked ready" from "the boot genuinely finished" — both produce
  identical wire payloads. Acceptable for a boot screen (per Q1), but worth
  naming as a diagnostic gap if a live host is ever reported stuck on a
  spinner that the backend insists is `ready`.
- `degraded` is in the wire vocabulary (`BackendReadiness`) but nothing in this
  batch (or any prior one) ever sets it — `batch-3-report.md` names this
  explicitly as a handoff note for Batch 4's renderer. Confirmed still true by
  reading `boot-coordinator.ts` in full: only `warming`/`ready`/`failed` are
  ever assigned.

## Failure modes

### `setPhase` called from inside a fired-and-forgotten async callback race

- Trigger: `boot-heavy-services.ts`'s `contentDownload.ensureContent().then(...)`
  callback (`:199-245`) runs concurrently with the rest of the function body but
  calls no `setPhase` of its own — verified by reading the full callback body.
- Symptom without this property: if that callback DID call `setPhase`, it could
  race the main line's own phase advances (e.g. set `harness` again after
  `index` already fired), which `setPhase`'s edge-trigger would only partially
  guard against (a phase regression from `index` back to `harness` is NOT a
  repeat, so it would emit and the renderer would see progress run backwards).
- Evidence: `boot-heavy-services.ts:199-245` (no `setPhase` call in the
  detached callback), `boot-coordinator.ts:295-300` (edge-trigger only compares
  equality, not monotonic order).
- Current handling: correct by omission — this batch's only phase anchors are
  all on the synchronous main line of `bootHeavyServicesOnce`
  (`:154, 173, 335, 406`), never inside the detached `.then`. No regression is
  reachable today.
- Recommendation: none for this batch; if a future anchor is ever added inside
  a detached callback, `setPhase` will need a monotonic-order guard, not just
  an equality guard — worth a comment at the call site when that happens, not
  a change today.

### Renderer reload replay double-fires `notifyWindowLoaded` and the broadcaster

- Trigger: `did-finish-load` fires more than once in a single process lifetime
  (dev reload, a renderer crash-recover, or the update dialog's own navigation).
- Symptom without idempotence: the warmup barrier would re-arm or the
  broadcaster would push stale data after the boot already settled.
- Evidence: `post-window.ts:116-119` (`on`, not `once`);
  `boot-coordinator.ts:502-505` (`notifyWindowLoaded` gated by `warmupSettled`
  inside `evaluateWarmupBarrier`, `:513`).
- Current handling: correct — `notifyWindowLoaded` is a no-op past the first
  real barrier resolution, and `broadcastReadiness(coordinator.snapshot())` is
  a stateless read-and-push that is safe to repeat since `snapshot()` always
  reflects the CURRENT truth, never a cached one.
- Recommendation: none — correct by construction, and this is exactly the
  behaviour the report's deviation 3 argues for.

### A cron handler throws after `withActivityEmit` wraps it

- Trigger: `backup:daily`, `db:integrity`, or any `skills:drain:*` handler
  throws (e.g. `backupSvc.backup` rejects with a disk-full error not already
  caught inside the handler body).
- Symptom: the wrapped handler's promise rejects; the activity ticker shows
  nothing for that run.
- Evidence: `activity-emitter.ts:119-120` (no try/catch around
  `await handler(ctx)`), pinned by `activity-emitter.spec.ts:208-219`.
- Current handling: deliberate — the run row the cron scheduler already writes
  is the failure channel; emitting a fabricated success event here would be
  worse than emitting nothing. Consistent with the Batch 2 finding that these
  same handler bodies already have inconsistent resolve-guarding one layer
  down.
- Recommendation: none from this batch; the open question (does the real
  `CronScheduler` job runner actually catch and record the rejection as a
  failed run, distinct from an unhandled rejection?) is the same one Batch 2's
  review already raised and remains unanswered because `cron-scheduler`'s
  runner is outside every batch's file list so far.

### `BootRpcHandlers` constructed with a stale `IBootReadinessProvider` if RPC surface registration ever moved earlier

- Trigger: a future refactor that calls `registerRpcSurface` (which resolves
  `BootRpcHandlers` and, by DI, its `PLATFORM_TOKENS.BOOT_READINESS` dependency)
  BEFORE `bootstrap.ts:361`'s `container.register(PLATFORM_TOKENS.BOOT_READINESS, …)`
  runs.
- Symptom: the handler would be constructed holding the `NullBootReadinessProvider`
  (registered earlier via `registerVsCodeCorePlatformAgnostic` during
  `ElectronDIContainer.setup`) instead of `ElectronBootReadinessProvider`, and —
  because `@injectable()` classes here are typically resolved once and the
  constructor param is captured by value, not re-resolved per call — Electron
  would silently report "always ready" for the lifetime of the process.
- Evidence: `wire-runtime.ts:175` (`registerRpcSurface` call site, confirmed to
  run in `wireRuntimePreWindow`, itself confirmed to be called from `main.ts`
  strictly after `bootstrapElectron` — i.e., after `bootstrap.ts:361` — via
  `main.ts:67` then a later `wireRuntimePreWindow` call); `bootstrap.ts:361`.
- Current handling: correct today, by ordering, but ordering is enforced only
  by file layout and comments, not by a type or a runtime assertion. No test
  in this batch pins "the RPC handler resolves the ELECTRON adapter, not the
  null one, in the real Electron boot sequence" — `boot-rpc.handlers.spec.ts`
  constructs `BootRpcHandlers` directly with a hand-built port, which proves
  the handler's OWN logic but not the DI wiring that selects which port it
  gets.
- Recommendation: not a blocker — the ordering is correct and documented in
  three places (report, code comment, this review) — but an integration-level
  assertion (e.g. a `wire-runtime.boot-order.spec.ts` case resolving
  `BootRpcHandlers` after the real Electron DI sequence and asserting it is NOT
  the null adapter) would catch a future reordering that today only a manual
  reading catches.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **The tsyringe "last registration wins" override for `PLATFORM_TOKENS.BOOT_READINESS`
  has no test of its own** — see Failure Modes, "constructed with a stale
  provider". The precedent (`SESSION_ATTACHMENT_GUARD`) is real but also
  untested by any reviewed batch; this task adds a second port whose entire
  correctness depends on that same untested tsyringe behaviour.
- **`withActivityEmit`'s outcome branch is a literal string comparison, not an
  exhaustive switch** (`activity-emitter.ts:121`) — see Q3. A future third
  `JobHandlerResult.outcome` value would silently fall through to the "success"
  summary path with no compiler signal. Low probability (the type is
  cron-scheduler's, out of this batch's control) but cheap to harden with a
  `satisfies`-checked exhaustive switch when `cron-scheduler` next changes that
  union.

## Data flow

1. **Port registration** (component 9): `registerVsCodeCorePlatformAgnostic`
   registers `NullBootReadinessProvider` as a guarded singleton
   (`register-platform-agnostic.ts:85-90`) during `ElectronDIContainer.setup`;
   `bootstrap.ts:355-364` later registers `ElectronBootReadinessProvider` as a
   `useValue`, unconditionally, overriding it on the same container. VS Code and
   the CLI never call the Electron override, so they keep the null default.
   OK, by construction and by the codebase's own established idiom — see
   Moderate issues for the one gap (no direct test of the override itself).
2. **Pull path**: renderer → `boot:getReadiness` → `BootRpcHandlers.handleGetReadiness`
   → Zod validate (warn-only) → `IBootReadinessProvider.getReadiness()` →
   (Electron) `coordinator.snapshot()` / (null) constant. Every branch degrades
   to a valid `BootGetReadinessResult`, never a thrown error. OK.
3. **Push path**: `boot-heavy-services.ts` → `coordinator.setPhase(phase, detail)`
   → edge-trigger check → `emitCurrent()` → the registered emitter (
   `createBootReadinessBroadcaster`'s closure) → lazy `isRegistered` check →
   `webviewManager.broadcastMessage(BOOT_READINESS_CHANGED, snapshot)`. Every
   step from `setPhase` onward is wrapped in a swallow; nothing here can abort
   the boot it narrates. OK — matches the "never throws" contract in the plan
   exactly.
4. **Ordering invariant** ("nothing may be inserted between `bootThothRuntime`
   and `markPersistenceSettled`"): verified directly by reading
   `boot-heavy-services.ts:159-172` — the `harness` phase anchor
   (`coordinator.setPhase('harness', …)`) sits AFTER `markPersistenceSettled`
   (`:170-172`), not between the two calls the rule protects. OK, the rule is
   intact.
5. **Activity path**: `boot-heavy-services.ts` / `start-thoth-cron.ts` →
   `emitActivity(source, kind, summary, level?)` → lazy `isRegistered` check →
   `webviewManager.broadcastMessage(ACTIVITY_EVENT, payload)`. Same swallow
   shape as the readiness push, verified by a fully overlapping test suite. OK.
6. **Cron wrapper path**: `startThothCron` builds one `emitActivity`, wraps
   `backup:daily`, `db:integrity` and the three `skills:drain:*` handlers with
   `withActivityEmit`, verified by reading the full diff — every
   `handlerRegistry.register(...)` call for those five names now passes the
   wrapped function, and the wrapper returns the handler's ORIGINAL result
   object by identity (`activity-emitter.spec.ts:142-152`), so
   `job_runs.result_summary` persistence (out of this batch's files) is
   unaffected. OK.
7. **Manifest partition**: the new `boot` entry in `RPC_HANDLER_MANIFEST`
   (`manifest.ts:129-139`) carries `requires: []`, and no `Capability` member
   was added — verified by reading the diff for `capabilities.ts` (absent from
   the changed-file list, confirmed no new export needed since `requires: []`
   needs none). `rpc-allowlist.spec.ts` (not itself in this batch's file list,
   but asserted green by the verification run and independently plausible
   since the manifest is additive-only) is the gate that would fail if
   `'boot:getReadiness'` were left out of `RPC_METHOD_ENTRIES` — confirmed
   present at `rpc.types.ts:3756`. OK.

## Requirements fulfilment

| Requirement                                                                                                 | Status   | Gap                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `IBootReadinessProvider` port, synchronous, one method, type-only shared import                             | COMPLETE | none                                                                                                                            |
| Null default always registered when nothing else has; Electron overrides it                                 | COMPLETE | override behaviour itself untested (see Moderate)                                                                               |
| `boot:getReadiness` registered at all four sites, `requires: []`, no new `Capability`                       | COMPLETE | none                                                                                                                            |
| Never-throw contract for the RPC handler, safe fallback on port failure                                     | COMPLETE | none                                                                                                                            |
| `BootCoordinator` phase state: edge-triggered `setPhase`, `snapshot()`, `.then`/`.catch` semantics          | COMPLETE | none                                                                                                                            |
| Broadcaster: lazy `isRegistered`-guarded, swallowed failures, wired at first-container-existence point      | COMPLETE | none                                                                                                                            |
| Four phase anchors exactly as specified, no `skills` phase, no code between the two ordering-critical calls | COMPLETE | none                                                                                                                            |
| `did-finish-load` `once` → `on`, idempotent replay                                                          | COMPLETE | none                                                                                                                            |
| Activity emitter: lazy resolve, swallow, `withActivityEmit` preserves `JobHandler` contract                 | COMPLETE | outcome branch not exhaustively typed (Minor, see Q3)                                                                           |
| Three activity emits in `boot-heavy-services.ts`, only-first-reconcile rule, zero-count import emits too    | COMPLETE | none                                                                                                                            |
| No subsystem that already broadcasts gained a second broadcast                                              | COMPLETE | not independently re-verified in this review (trusted from the report's own audit table; out of this batch's diff to re-derive) |

Implicit requirements not addressed: an integration-level test proving the RPC
layer resolves the ELECTRON adapter (not the null one) through the real
Electron DI sequence, rather than only through a hand-built port in
`boot-rpc.handlers.spec.ts` (see Failure Modes).

## Edge cases

| Case                                                                                                        | Handled         | How                                                              | Concern                                                                              |
| ----------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `boot:getReadiness` called with `{}`                                                                        | YES             | `.strict()` schema accepts empty object                          | none                                                                                 |
| `boot:getReadiness` called with `undefined` params                                                          | YES             | `params ?? {}` before parse                                      | none                                                                                 |
| `boot:getReadiness` called with extra fields                                                                | YES             | parse fails, logged, still answers                               | none                                                                                 |
| Port throws inside the RPC handler                                                                          | YES             | fallback `{ ready, settled }`                                    | indistinguishable from a genuine finish (Q5)                                         |
| Two hosts both register `BOOT_READINESS`                                                                    | YES             | `isRegistered` guard + Electron's later `useValue` override      | override mechanism itself untested (Moderate)                                        |
| `setPhase` called twice with the same phase, different detail                                               | YES (by design) | edge-trigger drops the whole call, including the new detail      | intentional; flagged for future call-site authors                                    |
| Renderer reload mid-boot                                                                                    | YES             | `on('did-finish-load')` replay + idempotent `notifyWindowLoaded` | none                                                                                 |
| `WEBVIEW_MANAGER` absent (CLI, tests)                                                                       | YES             | `isRegistered` guard on both the readiness and activity emitters | none                                                                                 |
| Cron handler throws                                                                                         | YES (by design) | `withActivityEmit` rethrows, emits nothing                       | relies on `cron-scheduler`'s runner catching it — unverified, inherited from Batch 2 |
| `db:integrity` handler's `void dispatchIfDue()` not yet resolved when the "dispatched" activity event fires | YES (by design) | summary says "dispatched", not "done"                            | wording is accurate; no gap                                                          |
| `degraded` readiness                                                                                        | NO              | nothing sets it                                                  | explicit, named handoff to Batch 4 in the report                                     |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the entire component-9 design (Electron's real adapter silently
  overriding vscode-core's null default) rests on tsyringe's last-registration-
  wins behaviour for `container.register(TOKEN, { useValue })` after an earlier
  `registerSingleton(TOKEN, Class)` call — a real, precedented idiom in this
  codebase, but one with no test anywhere (this batch or before) that exercises
  the actual override on a live container rather than the `isRegistered` guard
  in isolation. If that assumption were ever wrong, Electron would silently run
  the "always ready" null adapter and never show a boot screen at all — a
  regression a boot-order or wire-runtime integration spec would catch and a
  unit spec cannot.
- What a robust implementation would add: one integration assertion (in
  `wire-runtime.boot-order.spec.ts` or equivalent) that resolves
  `PLATFORM_TOKENS.BOOT_READINESS` (or `BootRpcHandlers`) after the real
  Electron bootstrap sequence and asserts it is the Electron adapter, not the
  null one; and an exhaustive switch (or `satisfies`-checked branch) in
  `withActivityEmit` instead of a single string-literal comparison against
  `'skipped'`.

## Batch 4

## Summary

| Metric              | Value               |
| ------------------- | ------------------- |
| Overall score       | 7/10                |
| Assessment          | APPROVED WITH NOTES |
| Blocking issues     | 0                   |
| Serious issues      | 2                   |
| Moderate issues     | 3                   |
| Failure modes found | 4                   |

Scope reviewed: `boot-status.service.ts` + spec, `back-office-activity.service.ts`

- spec, `services/index.ts`, `skeleton-block.component.ts`,
  `boot-progress/*`, `activity-ticker/*`, `chat-ui/src/index.ts`,
  `app-shell.component.{html,ts}`, `electron-shell.component.ts`, `app.html`,
  `app.ts`, `app.config.ts`, `thoth-message-routing.spec.ts`. Every file was read
  in full and cross-checked against `batches.md` Batch 4, `implementation-plan.md`
  components 12/13/14d/14e, `batch-4-report.md`'s six deviations, and
  `rpc-readiness.types.ts` / `rpc-activity.types.ts` for wire-shape agreement.

## Five logic questions

### 1. How does this fail silently?

- `boot-status.service.ts:130-145` — `pullReadiness()` is issued exactly once,
  at construction. If a mid-boot push is lost — and it can be: the plan's own
  Task 3.3 requires the host's `setPhase` emit to be wrapped in a try/catch so
  a broadcaster exception "never propagates into the boot path" — the renderer
  has no periodic re-pull, no watchdog, and no visible symptom. The screen
  keeps rendering whatever phase it last received as if that were still true,
  forever, with nothing in this batch to notice or recover. This is a silent
  failure by construction: the service's own contract ("pull does NOT
  duplicate the push") assumes the push channel is reliable, but the plan it
  cites documents that channel as best-effort.
- `back-office-activity.service.ts:216-264` and the plain-cast mappers at
  `:315-379` — nine of the ten mappers narrow with a partial `typeof` check on
  one or two fields (e.g. `mapMemoryObservation:330-339` checks only
  `body.kind`), not the full-guard pattern `mapActivityEvent` uses via
  `isActivityEventPayload`. A malformed `timestamp` (wrong type, present but
  not a number) is not rejected — it flows straight into `ActivityItem.timestamp`
  via `makeItem`'s `fields.timestamp ?? Date.now()`, which only substitutes a
  default on `null`/`undefined`, not on a wrong type. The result renders (the
  ticker shows a line), so the failure is invisible; it just means a field
  typed `number` in `ActivityItem` can silently hold whatever the wire sent.
- `app.html:6,26,34` — see question 2 below: two branches can be simultaneously
  true, which is a rendering defect, not a crash, so nothing errors and nothing
  logs.

### 2. What user action produces unexpected behaviour?

- No user action is required — a boot failure that occurs during Angular's own
  `ngOnInit` produces a genuine overlap. `hasError()` (`app.ts:64-67`) is
  `initializationStatus() === 'error' || bootStatus.hasFailed()`, and
  `bootStatus.hasFailed()` is driven by an independent signal
  (`boot-status.service.ts:83-85`) that can flip to `true` at any time via a
  `boot:readinessChanged` push. `initializationStatus` starts at `'initializing'`
  synchronously in `ngOnInit` (`app.ts:85`) and only leaves that state after
  `handleInitialView()` resolves. If the host pushes `readiness: 'failed'`
  while that await is still pending — plausible, since a boot failure is
  exactly the scenario this batch exists to surface, and it can happen very
  early — then `isInitializing()` is still `true` (loading branch shows,
  `app.html:6`) **and** `hasError()` is also `true` (error branch shows,
  `app.html:34`) at the same time. Both `@if` blocks are independent siblings
  in the same `<main>`; nothing gates the error branch on `!isInitializing()`,
  unlike the shell branch, which D-2 correctly excluded from
  `isBlockingBoot()`. The user sees a spinner and an error alert stacked in the
  same screen.
- A user who watches the boot screen through a lost final push (see F-1 below)
  has no action available to recover except a full reload — there is no retry
  button, no timeout-driven re-pull.

### 3. What input data produces a wrong answer?

- Any of the nine loosely-cast `back-office-activity.service.ts` mappers given
  a payload whose `timestamp`/`completedAt` field is present but the wrong
  type produces an `ActivityItem` whose `timestamp` is not actually a number
  (see finding above) — a wrong value admitted as valid data, not a rejected
  message.
- `mapBootReadiness` (`back-office-activity.service.ts:296-313`) does not
  validate `body.detail`'s type before using it as `summary` — a non-string
  `detail` on an otherwise well-formed push produces an `ActivityItem.summary`
  that is not a string, in violation of that field's contract.
- `mapSkillSynthesis`/`skillSummary` (`:386-424`) read `stats['done']` /
  `stats['total']` / `stats['suggestionsCreated']` with `Number(x ?? 0)` —
  `Number(null)` is `0` but `Number('abc')` is `NaN`; a backend that sends a
  non-numeric string for one of these stats produces a line reading
  "Embedding candidates NaN/NaN…" rather than a dropped or generic message.

### 4. What happens when a dependency fails?

- `ClaudeRpcService.call('boot:getReadiness', ...)` rejecting or timing out
  (`boot-status.service.ts:130-144`) is handled correctly: caught, ready
  default retained, VS Code and any host with no `boot:` namespace are
  unaffected. This is the one dependency-failure path in scope and it is
  handled well.
- The `MessageRouterService` (pre-existing, not in this batch) calls every
  registered handler for a type in an unguarded loop
  (`message-router.service.ts:67-73`); both `BootStatusService` and
  `BackOfficeActivityService` register for `BOOT_READINESS_CHANGED`. Neither
  handler in this batch throws on a well-formed or malformed payload (verified
  by reading both `handleMessage` implementations), so this is not a live
  regression, but the batch adds a second handler to an unguarded dispatch loop
  without adding isolation — a defensive read, not a finding against this
  batch specifically.

### 5. What is missing that the requirements never mentioned?

- No liveness check for the boot screen itself: nothing in this batch asks "is
  it still true that a push will eventually arrive," and nothing surfaces to
  the user that the app may be waiting on one silently forever (F-1).
- No `data-testid` gap, but the two `webview-e2e-harness` cases in the plan's
  acceptance section were not written (D-6, openly flagged by the report) —
  the `isBlockingBoot` → shell handover and the ticker's real-postmessage path
  are therefore proven only at the unit level, not through the actual message
  bridge the production build uses.
- The canvas `@else` skeleton (`app-shell.component.html:686-699`) renders
  whenever `orchestraCanvasComponent` is falsy for **any** reason, not only
  during a boot — a DI wiring regression that made the token permanently
  unbound would present as an unaltered "still booting" skeleton instead of a
  visibly broken state. This matches the plan's literal instruction (already
  flagged as the report's Open Question 2) and is not this batch's defect to
  fix, but it is a real gap the requirements left open.

## Failure modes

### F-1 — Boot screen has no recovery from a single lost push

- Trigger: the host's edge-triggered `setPhase` emit throws internally after
  reaching `harness`/`sessions`/`index` but the exception is caught by the
  host-side wrapper (per `batches.md` Task 3.3's own requirement that the emit
  "never throw into the boot path"), so the corresponding push to the renderer
  never leaves the main process. No later phase transition will re-fire it
  because `setPhase` is edge-triggered ("ignores a repeat" is not the failure
  here — this is a genuinely unsent edge).
- Symptom: `isBlockingBoot()` stays `true` forever if the lost push was
  `database → harness` (the boot screen never hands over); `isBooting()` stays
  `true` forever if a later one is lost (the session-list and canvas skeletons
  never clear even once the app has fully booted).
- Evidence: `boot-status.service.ts:109-115` (one-shot pull, no retry loop),
  `:130-145` (`pullReadiness` has no caller after construction).
- Current handling: none — the mandatory pull is documented as covering "the
  first transition," not every subsequent one.
- Recommendation: either a periodic re-pull while `isBooting()` is true and no
  push has landed for N seconds, or a host-side acknowledgement/replay
  mechanism, so a lost edge cannot strand the renderer indefinitely.

### F-2 — Loading and error branches can render simultaneously

- Trigger: a `boot:readinessChanged` push carrying `readiness: 'failed'`
  arrives while `App.ngOnInit`'s `handleInitialView()` await is still
  in-flight.
- Symptom: `app.html`'s loading block (`:6-23`, via `isInitializing()`) and
  error block (`:34-48`, via `hasError()`) both render inside the same
  `<main>` at once.
- Evidence: `app.ts:64-67` (`hasError` independent of `initializationStatus`
  synchronization), `app.html:6` and `:34` (no mutual exclusion between the two
  `@if`s beyond what each condition alone provides).
- Current handling: none — D-2 added `!bootStatus.isBlockingBoot()` to the
  shell branch for exactly this class of overlap but the same treatment was
  not applied between the loading and error branches.
- Recommendation: gate the error `@if` on `!isInitializing()`, or fold
  `bootStatus.hasFailed()` into a state machine alongside
  `initializationStatus` rather than two independently-flipping booleans.

### F-3 — Partial-shape mappers admit type-wrong fields into `ActivityItem`

- Trigger: any backend push (memory, indexing, skill-synthesis) whose payload
  has the right keys present but a field of the wrong runtime type — e.g. a
  `timestamp` sent as a string, or a `detail` sent as a non-string.
- Symptom: the ticker/ring silently holds an `ActivityItem` whose declared
  `number`/`string` field is not actually that type; nothing crashes, but any
  future consumer that trusts the type (e.g. a "time ago" formatter, a sort by
  `timestamp`) reads garbage without warning.
- Evidence: `back-office-activity.service.ts:330-339` (`mapMemoryObservation`),
  `:341-357` (`mapMemoryCorpus`), `:296-313` (`mapBootReadiness`'s `detail`),
  `:386-397` (`mapSkillSynthesis`'s unchecked `timestamp`/`stats`), contrasted
  with the full-guard `mapActivityEvent` at `:284-294` via
  `isActivityEventPayload`.
- Current handling: partial `typeof` checks on the field(s) each mapper
  actually reads for control flow, none on the fields it passes through
  unchecked.
- Recommendation: either add a type guard per payload (mirroring
  `isActivityEventPayload`) or coerce/validate `timestamp` and any
  string-typed pass-through field before calling `makeItem`, consistent with
  the repository's "Zod/guard at every external boundary" standard
  (`CLAUDE.md` Coding Standards → Validation).

### F-4 — `skillSummary` can render `NaN` in a user-facing line

- Trigger: a `SkillSynthesisEventWire.stats` entry for `done`/`total`/
  `suggestionsCreated` that is present but not numeric (e.g. a string that
  does not parse, or a nested object).
- Symptom: the ticker/ring shows "Embedding candidates NaN/NaN…" or "…finished
  (NaN suggestions)" instead of a generic fallback.
- Evidence: `back-office-activity.service.ts:405-411` (`Number(stats[...] ??
0)` — `??` only guards `null`/`undefined`, not "not a number").
- Current handling: none.
- Recommendation: use `Number.isFinite(Number(x)) ? Number(x) : 0` or reuse
  whatever guard `skill-synthesis-live.service.ts` already applies to the same
  `stats` shape.

## Blocking issues

None.

## Serious issues

### Boot screen has no recovery from a lost push (F-1)

- File: `libs/frontend/core/src/lib/services/boot-status.service.ts:109-145`
- Scenario: a single dropped `boot:readinessChanged` push after the mandatory
  pull, on a host whose emit is documented (in the plan this batch depends on)
  to swallow broadcaster exceptions.
- Impact: the user is stuck behind either the full boot screen or a
  permanently-stale skeleton with no in-app recovery path other than a manual
  reload, and no diagnostic signal that this happened.
- Fix: add a bounded re-pull (e.g. every 3-5s while `isBooting()` is true) or
  document explicitly, with a test, that this is an accepted residual risk
  given the plan's edge-triggered contract.

### Loading and error branches overlap during app initialization (F-2)

- File: `apps/ptah-extension-webview/src/app/app.html:6-48`,
  `apps/ptah-extension-webview/src/app/app.ts:64-67,84-100`
- Scenario: a boot failure push arrives while `App.ngOnInit`'s
  `handleInitialView()` promise is still pending.
- Impact: the user sees a spinner and an "Initialization Error" alert stacked
  in the same view — a visibly broken screen at exactly the moment the batch
  is meant to make failures legible.
- Fix: exclude the error branch from the loading condition (or vice versa),
  matching the treatment `app.html:26` already gives the shell branch against
  `isBlockingBoot()`.

## Moderate and minor issues

- `back-office-activity.service.ts` — nine of ten mappers use partial-shape
  casts rather than full type guards (F-3); moderate because the practical
  blast radius is a mis-typed field in a passive, non-authoritative ticker, not
  a crash or data-loss path.
- `skillSummary`'s unguarded `Number(...)` coercion (F-4) — moderate, cosmetic
  but user-facing.
- `boot-status.service.ts:99-101` — `elapsedMs` is a `computed()` over
  `Date.now()`, which only re-evaluates when `_status` changes; it does not
  tick on its own. It is unused by any production caller (`boot-progress`
  keeps its own `now` signal with its own interval instead), so this is dead,
  possibly-misleading API surface rather than a live bug — minor.
- `app-shell.component.html:686-699` — the canvas skeleton renders on ANY
  falsy `orchestraCanvasComponent`, not only during a boot (already an open
  question in `batch-4-report.md`); minor, matches the plan's literal
  instruction.

## Data flow

1. Host emits `boot:readinessChanged` at `did-finish-load` (before Angular's
   listener exists) and on every phase edge thereafter — OK, documented gap
   covered by the mandatory pull.
2. `BootStatusService` constructor snapshots `VSCodeService.isElectron`
   (already populated, since `VSCodeService`'s own constructor runs
   synchronously from injected `window.ptahConfig` before this constructor
   executes) and issues one `boot:getReadiness` pull — OK, timing verified
   correct; see F-1 for what happens if the one push after this point is lost.
3. `handleMessage` narrows every push through `toReadinessSnapshot` before
   accepting it and sets `pushSeen` — OK, guards a late pull from clobbering
   newer state.
4. `app.html` derives `isBlockingBoot()`/shell/error branches from the
   service's signals — mostly OK; gap at F-2 between loading and error.
5. `app-shell.component.html` and `electron-shell.component.ts` read
   `bootStatus.isBooting()` / `activity.recent()` / `activity.isIdle()` for
   skeletons and the ticker — OK, all presentational, no injection beyond the
   documented exceptions (D-4).
6. `BackOfficeActivityService` maps ten push types into `ActivityItem`s,
   coalesces against the head, bounds the ring, and exposes `isIdle` off one
   interval cleared via `DestroyRef` — OK for the coalescing/ring/idle
   mechanics (verified against the spec's stated call-count assertions); gap
   at F-3/F-4 in the mapper validation.
7. `ActivityTickerComponent` rotates on its own timer, resets index only on a
   head-id change (not an in-place coalesce), and stays a click target while
   idle — OK, matches the acceptance criteria exactly, including the
   `index() % list.length` guard against a shrinking list.

## Requirements fulfilment

| Requirement                                                          | Status   | Gap                                                                                           |
| -------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `BootStatusService` ready default, degrade-safe                      | COMPLETE | none found                                                                                    |
| `isBlockingBoot` exact phase set                                     | COMPLETE | matches `{starting, database}` exactly                                                        |
| `pushSeen` beats a late pull                                         | COMPLETE | verified by spec and code                                                                     |
| Boot screen a11y (`role="status"`, real list)                        | COMPLETE | none found                                                                                    |
| Session-list / canvas skeletons at the two named sites               | COMPLETE | canvas site not boot-gated, per plan's literal text (open question)                           |
| Ticker rotation / idle collapse / reset-on-new-head                  | COMPLETE | none found                                                                                    |
| Ten activity mappers                                                 | PARTIAL  | nine use shallow validation vs. the full-guard pattern used elsewhere in this same file (F-3) |
| No new `chat-ui` dependency, no service injection in atoms/molecules | COMPLETE | verified across all touched files                                                             |
| `text-base-content/NN` ratchet (D-5)                                 | COMPLETE | verified via `text-base-content-muted` usage throughout                                       |
| Recovery from a lost mid-boot push                                   | MISSING  | not a stated requirement, but a real gap (F-1)                                                |

Implicit requirements not addressed: recovery from a single lost push (F-1); a
guard against the loading/error branch overlap (F-2).

## Edge cases

| Case                                                                | Handled         | How                                     | Concern                    |
| ------------------------------------------------------------------- | --------------- | --------------------------------------- | -------------------------- |
| Rejected/timed-out `boot:getReadiness` pull                         | YES             | ready default retained                  | none                       |
| Late pull after a push already landed                               | YES             | `pushSeen` latch                        | none                       |
| Malformed `boot:readinessChanged` push                              | YES             | `toReadinessSnapshot` full guard        | none                       |
| Single lost push after a successful pull                            | NO              | —                                       | F-1                        |
| Boot failure during `ngOnInit`'s own async window                   | NO              | —                                       | F-2                        |
| 60 rapid activity pushes                                            | YES             | ring capped at 50, newest-first         | none                       |
| 100 coalescible pushes 10ms apart                                   | YES             | one slot, stable id                     | none                       |
| Interleaved A,B,A within the coalesce window                        | YES (by design) | three slots, head-only coalescing       | matches plan's stated rule |
| Ticker list shrinking below current index                           | YES             | `index() % list.length`                 | none                       |
| Ticker with one item                                                | YES             | `advance()` no-ops at length ≤ 1        | none                       |
| Malformed field of the _right_ key but _wrong type_ in 9/10 mappers | NO              | passed through                          | F-3, F-4                   |
| Session list empty after `settled`                                  | YES             | `isBooting()` false → "No sessions yet" | none                       |

## Verdict

- Recommendation: APPROVE (with notes)
- Confidence: HIGH
- Top risk: a single lost `boot:readinessChanged` push (a scenario the plan's
  own host-side contract makes possible) can strand the renderer behind a
  stale boot screen or stale skeletons with no recovery path in this batch.
- What a robust implementation would add: a bounded re-pull/watchdog in
  `BootStatusService` while booting; a `!isInitializing()` guard on the error
  branch in `app.html`; full-shape guards (or targeted type coercion) on the
  nine partially-validated activity mappers, matching the pattern
  `mapActivityEvent` already demonstrates in the same file.

## Whole-task pass (Batch 5)

Scope: the seams between the four committed batches
(`0c7e4d05c`/`ee6ad1d8a`/`4a00d8c74`/`156637eb2`) on top of `7619bebd2`,
re-read against the boot path end to end, shutdown, the shared-database
contract, the readiness-provider registration race, activity fan-in, and the
settings round-trip. Per-file/per-batch logic was not re-litigated except
where a seam crosses batch boundaries or where a prior batch review recorded
an open item. Every file cited below was read in full at its current
(post-`156637eb2`) content, not from the diff hunks alone.

### Verified: the four Batch 4 fixes named in the brief are in `156637eb2`

- **Watchdog re-pull, monotonic rule**: `boot-status.service.ts:130,196-207`
  (`startWatchdog`/`stopWatchdog`, armed only while `warming`, `unref`-free
  but bounded by `stopWatchdog` on any terminal snapshot) plus the monotonic
  guard in `pullReadiness` (`:172-177`) via `isAtLeastAsAdvanced` (`:220-231`).
  A push is exempted from the monotonic rule (`handleMessage:151-156`,
  `adopt:186-194`), matching the doc comment's "a push is always
  authoritative" rule. Confirmed present, confirmed reasoned correctly: the
  watchdog is Electron-only (`startWatchdog:197`, `!this.isElectron` guard)
  and stops the instant a terminal snapshot lands.
- **Exclusive error → loading → shell chain**: `app.html:15,34,54` — one
  `@if`/`@else if`/`@else if` chain, error first, with the review comment at
  the top of the file (`:1-11`) explicitly naming the F-2 defect it replaces.
  Confirmed mutually exclusive: the three branches can no longer render
  together.
- **`Number.isFinite`/`typeof` guards in the mappers**:
  `back-office-activity.service.ts:278,286,332,347,352,387,403,423` — every
  numeric/string field the F-3/F-4 findings named now has an explicit
  `Number.isFinite`/`typeof` check before use. Confirmed present in all the
  cited mapper functions.
- **Boot-gated canvas skeleton**: `app-shell.component.html:688`
  (`@else if (bootStatus.isBooting())`), and the equivalent session-list
  skeleton at `:349` (`@if (bootStatus.isBooting())`). Confirmed: the
  skeleton now only shows during an active boot, not on every falsy
  `orchestraCanvasComponent`.

All four are real fixes, not partial patches — each closes the specific
scenario its Batch 4 finding described, not merely a symptom of it.

### New finding — the integrity worker is the one boot-path resource with no shutdown entry

This task adds exactly one new class of long-lived-during-boot resource that
none of the four batches ever wires into the disposal chain: the integrity
worker child process owned by `SqliteIntegrityService`
(`libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts`).

- `dispatchIfDue()` takes no `AbortSignal` parameter anywhere in its
  signature (confirmed: `grep -n "signal" integrity-check.service.ts` finds
  no match) and neither of its two Electron callers — the 60 s boot timer
  and the `db:integrity` cron handler, both `void`-fired
  (`start-thoth-cron.ts:213,222`) — ever passes `coordinator.abortSignal`
  into it, unlike `refreshUserLayer`/`reconcileHarness`/`scanAndImport`
  in the same file, which all thread `signal` through
  (`boot-heavy-services.ts:159-163,197,233-238,257-260,346-352`).
  `coordinator.abort()` therefore has no effect on an in-flight
  `dispatchIfDue()` call.
- `apps/ptah-electron/src/activation/shutdown.ts` has zero references to
  "integrity" (confirmed by grep across the file) and `BootRefs`
  (`boot-coordinator.ts:97-134`) has no field for the worker or the
  `SqliteIntegrityService` instance itself — the one resource this task adds
  is invisible to the exhaustive `nonFatal(...)` LIFO chain that
  `disposeBeforePersistence`/`disposeAfterPersistence` walk for every other
  handle (git watcher, cron scheduler, memory curator, symbol watcher,
  the CLI registry, the agent process manager, diagnostics — every one has an
  entry; the integrity worker has none).
- This directly contradicts `apps/ptah-electron/CLAUDE.md`'s own stated rule:
  "New long-lived resources must add a field to `BootRefs`
  (`src/activation/boot-coordinator.ts`) and a `nonFatal(...)` line in the
  right half of the chain."
- Consequence, traced end to end: a quit that lands while a worker-spawned
  check is in flight does not signal the worker to stop, and
  `disposeAfterPersistence` closes the host's write connection
  (`shutdown.ts:221`, `refs.sqliteConnection?.close()`) without regard to
  whether `SqliteIntegrityService.record()` is about to call
  `IntegrityCheckStateStore.write()` against it. The store's own `write()`
  swallows a failure into a `logger.warn` and drops the record
  (`integrity-check-state.store.ts:117-135`), so this is **not** a
  corruption path — it degrades to "one lost verdict, retried next window",
  consistent with the store's documented contract. The residual risk is
  narrower than data loss: an unkilled child process outliving the parent on
  a platform where Electron's `utilityProcess` lifecycle does not itself
  guarantee termination on `app.quit()` — a claim no batch, and no test in
  this repository, verifies either way.
- Severity: **Moderate**, not blocking — no corruption path, the existing
  worst case (a lost verdict) is the store's own designed degrade, and the
  5-minute budget timer (Batch 1, unref'd) already bounds how long a wedged
  worker can matter to the process's own liveness. But it is a real,
  concrete violation of this repository's own disposal convention, introduced
  by this task and uncaught by any of the four per-batch reviews because none
  of them had the shutdown chain in its file list at the same time as the
  worker factory.
- Recommendation: add `integrityService: SqliteIntegrityService | null` (or
  the worker handle directly) to `BootRefs`, thread `coordinator.abortSignal`
  into `dispatchIfDue()`, and add one `nonFatal('Integrity check abort', …)`
  line to `disposeBeforePersistence` — cheap, and brings this resource to
  parity with every sibling in the same file. File as a follow-up task rather
  than blocking this one, since the current behavior is a silent degrade, not
  a crash or a corruption path.

### Re-verified: seams named in the brief that are sound

- **End-to-end phase ordering**: `boot-heavy-services.ts:154` sets
  `'database'` as the first phase label, before `bootThothRuntime` is
  awaited; `'starting'` (the coordinator's initial phase,
  `boot-coordinator.ts:209`) and `'database'` are both in
  `PRE_SHELL_PHASES` (`boot-status.service.ts:66`), so a renderer that pulls
  before any `setPhase` call has landed still reports `isBlockingBoot() ===
true` off the initial snapshot — there is no window in which the boot
  screen fails to show because a pull outran `setPhase('database')`. The
  `harness` phase anchor sits strictly after `markPersistenceSettled`
  (`boot-heavy-services.ts:170-173`), preserving the one ordering invariant
  Batch 3's review already pinned. No regression found.
- **Ticker fan-in / `ACTIVITY_SOURCE_VALUES`**: every `emitActivity(...)`
  call site in `boot-heavy-services.ts` (`'harness'` x2, `'sessions'` x1) and
  the one call site inside `withActivityEmit` (`activity-emitter.ts:123,129`,
  hardcoded `'cron'`) use literals that are members of
  `ACTIVITY_SOURCE_VALUES` (`rpc-activity.types.ts:44-55`). Because
  `withActivityEmit` hardcodes its own source rather than accepting one per
  call, a typo at a cron call site cannot silently produce an invalid
  source — the free-text argument at each site is only `handlerName`
  (`kind`), which `isActivityEventPayload` does not restrict to an enum. No
  defect found; this closes the specific risk the brief named.
- **Settings round-trip**: `skillSynthesis.triggers.bootScanDelayMs` and
  `.bootScanIdleBackoffMs` are present in both
  `FILE_BASED_SETTINGS_KEYS`/`FILE_BASED_SETTINGS_DEFAULTS`
  (`file-settings-keys.ts:351-352,608-609`) and
  `SKILL_TRIGGER_SETTINGS_KEYS`/`SKILL_TRIGGER_DEFAULTS`
  (`skill-trigger-config.ts:19,25,47,49`), with matching 300000 ms defaults
  on both sides. Already verified for `0`-value semantics in the Batch 1
  review; no new gap found at the cross-batch seam.
- **Two hosts, one database**: the migration-0042 forward-only warning is
  unchanged and still holds (`persistence-sqlite/CLAUDE.md`'s existing
  warning, not modified by this task). The single-row UPSERT in
  `integrity-check-state.store.ts:66-74` uses `ON CONFLICT(id) DO UPDATE`,
  which SQLite resolves atomically at the statement level — two hosts
  racing a write each resolve to a consistent last-write-wins outcome, not a
  torn or duplicated row. No new race found beyond what Batch 1 already
  named as deferred to live verification (A-1: can a read-only connection
  open the WAL file while the host holds it open).
- **Readiness-provider registration race**: unchanged from Batch 3's
  finding — the ordering (`register-platform-agnostic.ts` registers the null
  default, `bootstrap.ts:361` overrides it with the Electron adapter) is
  correct by inspection and precedented, but still has no integration test
  exercising the actual tsyringe override on a live container. Whole-task
  reading of `bootstrap.ts` and `register-platform-agnostic.ts` found nothing
  that changed this between batches; the residual risk is exactly what Batch
  3 already recorded, not worsened or improved by Batch 4's renderer wiring.

### Follow-up items (separate tasks, not blockers for this one)

1. Wire `SqliteIntegrityService`'s worker lifecycle into `BootRefs` and
   `shutdown.ts`, and thread `coordinator.abortSignal` into `dispatchIfDue()`
   — closes the gap found in this pass.
2. Add an integration-level spec (e.g. extending
   `wire-runtime.boot-order.spec.ts`) that resolves
   `PLATFORM_TOKENS.BOOT_READINESS` after the real Electron DI bootstrap
   sequence and asserts it is the Electron adapter, not
   `NullBootReadinessProvider` — Batch 3's already-recorded open item.
3. Add a try/catch around the `db:integrity` cron handler body's
   `container.resolve` call to match the boot timer's own guard three lines
   away (`start-thoth-cron.ts:206-215` vs. `:217-228`) — Batch 2's
   already-recorded open item, still unresolved as of `HEAD`.
4. Confirm on a live packaged build (the senior-tester's cold-boot
   measurement currently in progress covers this) that: (a) a read-only
   `better-sqlite3` connection can open the WAL file while the host holds
   it open (A-1), and (b) `utilityProcess.fork`'d `integrity-worker.mjs`
   loads ABI-143 `better-sqlite3` at runtime — both are unverified by any
   unit test in any batch and were explicitly deferred to this measurement.
5. Harden `withActivityEmit`'s outcome branch (string-literal comparison
   against `'skipped'`) into an exhaustive switch — Batch 3's already-
   recorded minor item.

### Verdict

- Overall score: **7/10**
- Assessment: **APPROVED WITH NOTES**
- The four batches compose correctly at every seam the brief asked about:
  boot-phase ordering, the readiness pull/push race, activity-source
  validity, and the settings round-trip all hold up under a fresh,
  whole-task read. The four Batch 4 fixes are genuinely in `156637eb2`, not
  just claimed. The one new defect this pass found — the integrity worker's
  absence from `BootRefs`/`shutdown.ts` — is real, is a direct violation of
  this repository's own stated disposal convention, and was reachable only
  by reading the boot-heavy-services, thoth-runtime, and shutdown files
  together, which no single per-batch review had in its file list at once.
  It is a Moderate finding (no corruption path, a designed degrade already
  absorbs the failure mode) rather than a blocker, so it does not change the
  APPROVED verdict, but it should not go unfixed indefinitely.
- Confidence: **HIGH** for everything read directly in this pass (boot
  ordering, shutdown chain, activity sources, settings keys, the four
  Batch 4 fixes). **MEDIUM** for the two items this pass could not verify
  without running the app — the tsyringe override and the packaged
  ABI-143/WAL-readonly behavior — both already flagged by Batches 2/3 and
  explicitly reserved for the concurrent live cold-boot measurement.
