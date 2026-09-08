# Future Enhancements — TASK_2026_380 (Electron cold-start fix)

Consolidated from every deferred item scattered across this task's deliverables
(`implementation-plan.md`, `batches.md`, `code-logic-review.md`,
`code-style-review.md`, `test-report.md`). Task itself is `done`
(five commits `0c7e4d05c`..`5d0f0356b`); nothing below blocks that work —
every acceptance criterion passed and Finding F-1 (the integrity worker's
`require('better-sqlite3')` under ESM) was already fixed inside Batch 5.

| #   | Title                                                                                  | Priority | Effort | Files affected    |
| --- | -------------------------------------------------------------------------------------- | -------- | ------ | ----------------- |
| 1   | Move the daily/pre-migration 1 GB backup copy off the main thread                      | HIGH     | M      | 2                 |
| 2   | ~15 s of post-first-RPC jank from CLI/SDK detection                                    | HIGH     | M      | 3+ (RPC handlers) |
| 3   | Backfill five write-dropped settings keys in `FILE_BASED_SETTINGS_KEYS`                | MEDIUM   | S      | 2                 |
| 4   | Integration spec: `BOOT_READINESS` resolves to the Electron adapter under real DI      | MEDIUM   | S      | 1 (new spec)      |
| 5   | Bounded escalation for consecutive `unavailable` integrity verdicts                    | MEDIUM   | S      | 1                 |
| 6   | Give `CronScheduler` an event surface so user-defined jobs reach the ticker            | MEDIUM   | M      | 2-3               |
| 7   | Add a `degraded` readiness producer                                                    | LOW      | S      | 1-2               |
| 8   | `SessionLoaderService` resume failure is log-only, empties Agents panel silently       | MEDIUM   | S      | 1                 |
| 9   | Stale `VALID_VIEWS` in webview `app.ts`                                                | LOW      | XS     | 1                 |
| 10  | `withActivityEmit` outcome branch → exhaustive switch                                  | LOW      | XS     | 1                 |
| 11  | `measure-boot-rpcs.mjs --keep-db` flag + kill probe by PID, not image name             | MEDIUM   | XS     | 1                 |
| 12  | Export `SkillMdMigrationMarkerOutcome` from the skill-synthesis barrel                 | LOW      | XS     | 1                 |
| 13  | Alphabetise the `boot` manifest entry in `rpc-handlers`                                | LOW      | XS     | 1                 |
| 14  | Hoist duplicated `BootPhase → label` maps into one shared export                       | LOW      | XS     | 2                 |
| 15  | Document the Nx-daemon-serves-stale-`project.json` gotcha                              | LOW      | XS     | 1 (docs)          |
| 16  | Fold the integrity worker's backup-validation pass in (rejected-alternative follow-up) | LOW      | M      | 1-2               |

---

### 1. Move the daily/pre-migration 1 GB backup copy off the main thread

**Priority**: HIGH
**Effort**: M — the integrity worker this task built is the direct template; mostly wiring, not new design.
**Dependencies**: none technical; benefits from this task's worker-process pattern already existing.
**Business value**: eliminates a second, larger instance of the exact freeze this task just fixed (main-thread `quick_check`).

**Context**: This task deleted `runBootChecks`'s inline `PRAGMA quick_check` from the boot path because it blocked the main thread for 20-26 s cold on a ~1 GB file. The same fault class remains, uncorrected, in two other call sites this task deliberately left untouched.

**Current pattern**: `SqliteBackupService`'s pre-migration backup (`libs/backend/persistence-sqlite/src/lib/migration-runner.ts:88-99`) and the daily cron backup handler (`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:207-251`) both run `db.backup()` (a full ~1 GB copy) plus `PRAGMA quick_check`, `incremental_vacuum` and `optimize` synchronously on the main process.

**Proposed pattern**: Route the backup + validation pass through the `IIntegrityWorkerProcessFactory` / worker-process infrastructure this task added under `libs/backend/persistence-sqlite/src/lib/integrity/`, following the same three-valued verdict and never-block contract.

**Affected locations**:

- `libs/backend/persistence-sqlite/src/lib/migration-runner.ts:88-99` (1 occurrence)
- `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:207-251` (1 occurrence)

**Implementation notes**: `implementation-plan.md`'s "Rejected alternatives" #1 explicitly named absorbing the backup's validation pass into the integrity worker as a follow-up, not done now, because coupling integrity reporting to backup success was rejected for this task's narrower scope. Sequence after item 16 below (same rejected-alternative note) if both are picked up together.

**Expected benefit**: removes a measured 27 s / 3.2 s-lag-spike main-thread stall (the same class of number this task measured for `quick_check`) from both the pre-migration path and the nightly cron path.

**Source**: `implementation-plan.md` Named follow-ups #1; `batches.md` Completion → Follow-ups #1 (measured: "27 s with 3.2 s lag spikes on the first boot that applies `0042`" — note: that specific 27 s number is the one-time migration-apply cost `test-report.md` measured, cited here as the same fault class, not a repeat measurement of the backup path itself).

---

### 2. ~15 s of post-first-RPC jank from CLI/SDK detection

**Priority**: HIGH
**Effort**: M — requires profiling which of several RPC handlers can be deferred, cached or moved off the critical path; no design exists yet.
**Dependencies**: none.
**Business value**: this is the next user-visible freeze after this task's fix — the user still feels ~15 s of intermittent stutter right when the UI becomes interactive.

**Context**: This task's fix (criteria 1-3) removed the ~26 s freeze before the first RPC. `test-report.md`'s cold-boot measurement found a new, smaller residual: once the shell becomes interactive, several slow handlers contend for the main thread.

**Current pattern**: Measured lag spikes up to 1073.7 ms across ~14 s after the first RPC, caused by `auth:getAuthStatus` (2243.8 ms), `config:models-list` (2296 ms), `session:list` (2290-2291 ms), `git:info` (2475.5 ms), and `autocomplete:agents` (4094.9 ms) — CLI/SDK subprocess spawns (`claude.EXE`/`codex.CMD`) and model-list calls all landing at once.

**Proposed pattern**: Stagger or defer these calls (e.g. the same `bootScanDelayMs`-style arm-instead-of-run pattern this task applied to the skill boot scan), or parallelize the subprocess spawns off the main thread.

**Affected locations**:

- RPC handlers behind `auth:getAuthStatus`, `config:models-list`, `session:list`, `git:info`, `autocomplete:agents` (5 measured call sites; exact handler files not enumerated by the test report).

**Implementation notes**: `batches.md` Completion → Follow-ups #2 and `test-report.md` "Risks a reader should know about" both flag this as real but out of scope. Any fix should re-run `measure-boot-rpcs.mjs` cold (per this task's own re-measurement gate rule) before adding any new deferral, rather than guessing at the fix.

**Expected benefit**: quantified — collapses the measured ~15 s / up-to-1073.7 ms jank window to something closer to the criterion-2 threshold (500 ms).

**Source**: `test-report.md` Criterion 2 and "Risks a reader should know about"; `batches.md` Completion → Follow-ups #2.

---

### 3. Backfill five write-dropped settings keys in `FILE_BASED_SETTINGS_KEYS`

**Priority**: MEDIUM
**Effort**: S — same one-line-per-key pattern this task already applied to its own two new keys.
**Dependencies**: none.
**Business value**: closes a silent settings-write-drop bug — a user-facing "I changed the setting and it didn't stick" defect.

**Context**: This task registered its own two new keys (`skillSynthesis.triggers.bootScanDelayMs`, `…bootScanIdleBackoffMs`) in both `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`, because an unregistered key falls through to an in-memory default on Electron and is silently un-writable (`libs/backend/platform-electron/src/implementations/electron-workspace-provider.ts:90-102`). Five pre-existing keys have the same bug and were left alone.

**Current pattern**: `memory.triggers.bootScanDelayMs`, `memory.triggers.bootScanIdleBackoffMs`, `skillSynthesis.drain.bootDeferralMs`, `skillSynthesis.triggers.turnComplete.enabled`, `skillSynthesis.triggers.skillInvocationTelemetry.enabled` are declared only in their libs' own config files, absent from `libs/backend/platform-core/src/file-settings-keys.ts`.

**Proposed pattern**: Add all five to `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`, satisfying the existing one-directional parity rule in `file-settings-keys.spec.ts:162-170`.

**Affected locations**:

- `libs/backend/memory-curator/src/lib/triggers/memory-trigger-config.ts:29,34,87,94` (2 keys)
- `libs/backend/skill-synthesis` config files (3 keys: drain + two trigger-enabled flags)
- `libs/backend/platform-core/src/file-settings-keys.ts` (target of the fix)

**Implementation notes**: `implementation-plan.md` explicitly rejected copying this pattern forward ("Rejected alternatives" #4) — the omission is a latent bug, not a precedent. Same fix shape as this task's Task 1.4.

**Expected benefit**: five settings become genuinely persistable instead of silently reverting to default on every restart.

**Source**: `implementation-plan.md` Codebase evidence table + Named follow-ups #2; `batches.md` Completion → Follow-ups #7.

---

### 4. Integration spec: `BOOT_READINESS` resolves to the Electron adapter under real DI

**Priority**: MEDIUM
**Effort**: S — one new spec extending an existing harness.
**Dependencies**: none.
**Business value**: closes a coverage gap on a boot-critical DI registration; today it is "correct by inspection," not by test.

**Context**: `platform-core`'s new `PLATFORM_TOKENS.BOOT_READINESS` port has a null default (`vscode-core`) and a real Electron adapter, with the registration override happening in `register-platform-agnostic.ts` / `bootstrap.ts:361`. No test exercises the actual tsyringe override on a live, fully-bootstrapped container — every batch's review left this open.

**Current pattern**: Verified only by static reading of `bootstrap.ts` and `register-platform-agnostic.ts`; whole-task code-logic-reviewer explicitly re-flagged it unresolved after Batch 4.

**Proposed pattern**: Extend `apps/ptah-electron/src/activation/wire-runtime.boot-order.spec.ts` (or equivalent) with a case that boots the real DI container and asserts `container.resolve(PLATFORM_TOKENS.BOOT_READINESS)` is the Electron adapter, not `NullBootReadinessProvider`.

**Affected locations**:

- `apps/ptah-electron/src/activation/wire-runtime.boot-order.spec.ts` (or sibling) (1 new spec)

**Implementation notes**: Named explicitly in `implementation-plan.md` Named follow-ups list is absent but the review chain calls it a "Batch 3's already-recorded open item" carried through every subsequent batch's review.

**Expected benefit**: turns a currently-inspection-only guarantee into a regression-proof one for the boot path's platform-port wiring.

**Source**: `code-logic-review.md` (Batch 3 and whole-task passes, line ~1526-1530); `batches.md` Completion → Follow-ups #4.

---

### 5. Bounded escalation for consecutive `unavailable` integrity verdicts

**Priority**: MEDIUM
**Effort**: S — a counter plus a threshold check inside `SqliteIntegrityService`.
**Dependencies**: none.
**Business value**: makes a systemically broken integrity worker on a given host discoverable without a manual log audit — directly relevant given F-1 already proved this exact failure mode can happen silently for an extended period.

**Context**: The service's degrade rule is correct — an `'unavailable'` verdict writes no record and retries next window — but nothing distinguishes "one flaky run" from "the worker can never succeed on this host" (which is literally what Finding F-1 was, before its Batch-5 fix).

**Current pattern**: `SqliteIntegrityService.dispatchIfDue()` warns once per `'unavailable'` result and returns; no counter, no escalation.

**Proposed pattern**: Track N consecutive `'unavailable'` results (in memory or in the state store) and promote to a single `logger.error` past a threshold, without ever writing a false "clean" record.

**Affected locations**:

- `libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts` (1 file)

**Implementation notes**: Batch 1's code-logic-reviewer named this explicitly as "what a robust implementation would add," not a defect blocking approval (8/10, APPROVED).

**Expected benefit**: converts a class of failure that historically took a dedicated tester investigation (Finding F-1) to find into a single log line.

**Source**: `code-logic-review.md` Batch 1 Verdict section (line 293-297).

---

### 6. Give `CronScheduler` an event surface so user-defined jobs reach the ticker

**Priority**: MEDIUM
**Effort**: M — new `onRun` emitter on `CronScheduler`/`job-runner.ts`, consumed by the same activity-emitter bridge this task built.
**Dependencies**: this task's `activity-emitter.ts` (already shipped) as the consumer.
**Business value**: today's back-office activity ticker only narrates Ptah's own four cron jobs (`backup:daily`, `db:integrity`, three `skills:drain:*` tiers); a user's own scheduled jobs are invisible to it, and `cron:runs` has no live channel either.

**Context**: Component 14b (this task) deliberately wrapped only the handlers `start-thoth-cron.ts` itself registers, because `CronScheduler` has no emitter (verified: none in `cron-scheduler.ts` or `job-runner.ts`).

**Current pattern**: `withActivityEmit` wraps individual handler registrations at the `start-thoth-cron.ts` call site; nothing upstream in `cron-scheduler` emits.

**Proposed pattern**: Add an `onRun` event to `CronScheduler`, which both a generic activity bridge and `cron:runs` can subscribe to.

**Affected locations**:

- `libs/backend/cron-scheduler/src/lib/cron-scheduler.ts` (scheduler-level emitter)
- `libs/backend/cron-scheduler/src/lib/job-runner.ts` (run-level emitter)
- `libs/backend/thoth-runtime/src/lib/activity-emitter.ts` (consumer wiring, if reused)

**Implementation notes**: Explicitly scoped out as "a separate task, separate lib" by `implementation-plan.md`.

**Expected benefit**: extends the ticker's coverage from 4 built-in jobs to every cron job Ptah or the user schedules; also gives `cron:runs` a live channel it currently lacks.

**Source**: `implementation-plan.md` Named follow-ups #5, Component 14b spec (line ~1039-1041); `batches.md` Batch 3 "Open notes / follow-ups" and Completion → Follow-ups #3.

---

### 7. Add a `degraded` readiness producer

**Priority**: LOW
**Effort**: S-M — depends on what condition should trigger it (not yet decided by any deliverable).
**Dependencies**: none technical, but needs a product decision on what "degraded" means operationally.
**Business value**: completes the wire vocabulary this task shipped — `degraded` exists as a valid `BackendReadiness` value with zero producers, so a legitimate half-healthy boot state currently cannot be represented.

**Context**: `BackendReadiness`'s three-value vocabulary (`ready`/`warming`/`degraded`, plus `failed`) was widened in this task, but only `ready`/`warming`/`failed`/`settled`-as-phase are ever emitted.

**Current pattern**: No call site in `apps/ptah-electron/src/activation/boot-coordinator.ts` or elsewhere ever calls `setPhase`/emits with `readiness: 'degraded'`.

**Proposed pattern**: Decide and wire a concrete trigger (e.g. the integrity worker reporting `'corrupt'`, or the escalation from item 5 above) to a `degraded` readiness transition.

**Affected locations**:

- `apps/ptah-electron/src/activation/boot-coordinator.ts` (producer site, 1 file)
- possibly `libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts` (trigger source)

**Implementation notes**: Batch 3's own report named this "explicit, named handoff to Batch 4" — Batch 4 did not pick it up either, so it is a genuine cross-batch gap, not an oversight of one batch.

**Expected benefit**: makes the readiness signal able to represent a real degraded-but-usable state instead of forcing every non-`ready` condition into `warming` or `failed`.

**Source**: `code-logic-review.md` line 813, 1016 (Batch 3 and cross-batch table).

---

### 8. `SessionLoaderService` resume failure is log-only, empties Agents panel silently

**Priority**: MEDIUM
**Effort**: S — add a user-visible error state to an existing failure path; no new architecture.
**Dependencies**: none.
**Business value**: real, independent UX defect — a resume failure today looks identical to "no agents," giving the user no signal anything went wrong.

**Context**: Surfaced while evaluating whether `chat:resume` needed a readiness guard (it does not — it is not SQLite-backed). In doing so, this task's plan found `refreshResumableSubagentsForSession` fails with nothing on screen.

**Current pattern**: `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:837-843` catches and logs the failure only; the Agents panel renders empty with no user-visible reason.

**Proposed pattern**: Surface a distinguishable error/retry state in the Agents panel when this resume path fails, instead of silently rendering the empty-state UI.

**Affected locations**:

- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:837-843` (1 occurrence)

**Implementation notes**: Named explicitly as "independent of readiness; worth a task of its own" — not something this task's scope should have absorbed.

**Expected benefit**: eliminates a silent-failure UX hole where "no agents" and "resume broke" are visually identical.

**Source**: `implementation-plan.md` Codebase evidence table (line 82) and Named follow-ups #3; `batches.md` Batch 1 anchors reference the same file/lines.

---

### 9. Stale `VALID_VIEWS` in webview `app.ts`

**Priority**: LOW
**Effort**: XS — add the missing string literals to an existing array.
**Dependencies**: none.
**Business value**: prevents a class of "valid view rejected by a stale allowlist" bug as more views are added to the Electron shell.

**Context**: Found while confirming the boot screen touches no view-routing logic; unrelated to this task's scope but the array is demonstrably out of date.

**Current pattern**: `apps/ptah-extension-webview/src/app/app.ts:100-109`'s `VALID_VIEWS` is missing `thoth`, `tasks`, `setup-hub`, `marketplace` — all views `ElectronShellComponent` already navigates to.

**Proposed pattern**: Add the four missing view names to `VALID_VIEWS`.

**Affected locations**:

- `apps/ptah-extension-webview/src/app/app.ts:100-109` (1 occurrence, 4 missing entries)

**Implementation notes**: Trivial fix; risk is only in verifying no other logic depends on the array's current (stale) contents.

**Expected benefit**: closes a latent navigation-rejection bug for four already-shipped views.

**Source**: `implementation-plan.md` Named follow-ups #4.

---

### 10. `withActivityEmit` outcome branch → exhaustive switch

**Priority**: LOW
**Effort**: XS — convert one string-literal comparison to a `satisfies`-checked switch.
**Dependencies**: none.
**Business value**: a future third `JobHandlerResult.outcome` value would otherwise silently fall through to the "success" branch instead of failing a type check.

**Context**: Flagged independently by two batches' reviews as the same minor item.

**Current pattern**: `withActivityEmit`'s outcome handling (`libs/backend/thoth-runtime/src/lib/activity-emitter.ts:121`) compares the outcome literal against `'skipped'` rather than switching exhaustively.

**Proposed pattern**: Replace with an exhaustive `switch`/`satisfies`-checked branch over `JobHandlerResult['outcome']`.

**Affected locations**:

- `libs/backend/thoth-runtime/src/lib/activity-emitter.ts:121` (1 occurrence)

**Implementation notes**: Batch 3's code-logic-reviewer named this a minor item; the whole-task review (`code-logic-review.md` line 1541-1543) re-confirmed it "still unresolved as of `HEAD`."

**Expected benefit**: a compile-time catch instead of a silent misclassification if `cron-scheduler` ever adds a third outcome value.

**Source**: `code-logic-review.md` line 925-929, 1541-1543; `batches.md` Completion → Follow-ups #5.

---

### 11. `measure-boot-rpcs.mjs --keep-db` flag + kill probe by PID, not image name

**Priority**: MEDIUM
**Effort**: XS — a CLI flag plus swapping `taskkill /IM electron.exe` for a PID-scoped kill.
**Dependencies**: none.
**Business value**: the process lesson from Batch 5 is a real safety gap — a probe run on any developer's machine can currently kill that developer's own unrelated running Electron apps.

**Context**: Batch 5's tester needed to inspect the persisted `db_integrity_check_state` row after a probe run, but `measure-boot-rpcs.mjs` deletes its temp DB copy on exit (`prepareDb()` / `fs.rm(db.dir, ...)`), forcing a manual re-run outside the script. Separately, the same investigation surfaced that a probe once force-killed the user's real running Ptah desktop app.

**Current pattern**: `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs` always deletes its DB copy on exit; process cleanup (in the ad-hoc tooling used during this task, not necessarily the script itself) used `taskkill /F /IM electron.exe`, which matches every Electron app on the machine by image name.

**Proposed pattern**: Add a `--keep-db` flag that skips the `fs.rm` cleanup; change any probe-side process cleanup to track and kill by the specific spawned PID.

**Affected locations**:

- `apps/ptah-electron-e2e/scripts/measure-boot-rpcs.mjs` (1 file, two independent changes)

**Implementation notes**: The taskkill incident did not corrupt the real database — the DB copy was untouched — but is a real safety gap worth closing before the script is used again by someone unfamiliar with this caveat.

**Expected benefit**: makes future A-1-style live verifications reproducible without manual DB copying, and removes the risk of a probe run collaterally killing a developer's own work.

**Source**: `implementation-plan.md` mentions the script under Codebase evidence (line 58); `batches.md` Completion → Follow-ups #6 and #9; `test-report.md` "A-1 live proof" section describes the workaround this flag would eliminate.

---

### 12. Export `SkillMdMigrationMarkerOutcome` from the skill-synthesis barrel

**Priority**: LOW
**Effort**: XS — one barrel export line.
**Dependencies**: none.
**Business value**: removes a five-minute detour for the next consumer of `readMarkerOutcome`'s return type.

**Context**: This task introduced `MigrationResult`'s new `markerOutcome` field and its backing union type in `skill-md-migration.ts`, but — unlike its sibling `MigrationResult` — the union type itself was not re-exported from the lib's public barrel.

**Current pattern**: `libs/backend/skill-synthesis/src/index.ts` re-exports `MigrationResult` but not `SkillMdMigrationMarkerOutcome`.

**Proposed pattern**: Add `export type { SkillMdMigrationMarkerOutcome }` beside the existing `MigrationResult` export.

**Affected locations**:

- `libs/backend/skill-synthesis/src/index.ts` (1 occurrence)

**Implementation notes**: Named in lane S's own Batch 1 report and independently in the whole-task style review's "what a 10/10 version would do differently" — still open as of the Completion section (`batches.md` Follow-ups #8).

**Expected benefit**: no consumer detour hunting for an un-exported return type.

**Source**: `code-style-review.md` line 48, 117, 1105; `batches.md` Completion → Follow-ups #8.

---

### 13. Alphabetise the `boot` manifest entry in `rpc-handlers`

**Priority**: LOW
**Effort**: XS — reorder one entry.
**Dependencies**: none.
**Business value**: cosmetic consistency only; the whole-task style review confirmed no functional risk (the manifest partition gate does not depend on ordering).

**Context**: Task 3.2's four-site RPC registration added the `boot` namespace entry out of alphabetical order relative to its neighbours.

**Current pattern**: `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:29-31,123-144` — `boot` sits out of order.

**Proposed pattern**: Move the `boot` import/manifest entry into alphabetical position with its neighbours.

**Affected locations**:

- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:29-31,123-144` (1 file)

**Implementation notes**: Flagged as `FAIL (cosmetic)` by the style reviewer, one point deducted from that batch's score for it; explicitly named as a "what a 10/10 version would do differently" item.

**Expected benefit**: none functional; codebase-consistency only.

**Source**: `code-style-review.md` line 312, 425, 509, 535.

---

### 14. Hoist duplicated `BootPhase → label` maps into one shared export

**Priority**: LOW
**Effort**: S — extract one `Record<BootPhase, string>` into `@ptah-extension/shared` and update two call sites.
**Dependencies**: none.
**Business value**: prevents the two label maps drifting apart the next time `BootPhase` gains a member — today a new phase can be added to one map and silently missed in the other, with no test catching it.

**Context**: The boot screen (frontend) and the back-office activity service (frontend, different file) each independently declared their own phase-to-label mapping for the same five-member `BootPhase` union.

**Current pattern**: `libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts:30-36` and `libs/frontend/core/src/lib/services/back-office-activity.service.ts:83-90` each declare their own `BootPhase → string` map.

**Proposed pattern**: Hoist one `Record<BootPhase, string>` into `@ptah-extension/shared`, imported by both.

**Affected locations**:

- `libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts:30-36` (1 occurrence)
- `libs/frontend/core/src/lib/services/back-office-activity.service.ts:83-90` (1 occurrence)

**Implementation notes**: Explicitly named by the style reviewer as "what I would have done differently," at the cost of one new export in a lib both `core` and `chat-ui` already depend on; flagged `FAIL (cosmetic)` for "one phase-label vocabulary per union member" but did not block approval (9/10).

**Expected benefit**: a future `BootPhase` addition fails a single source of truth instead of silently under-labelling in one of two places.

**Source**: `code-style-review.md` line 631-637, 853, 882-883.

---

### 15. Document the Nx-daemon-serves-stale-`project.json` gotcha

**Priority**: LOW
**Effort**: XS — a CONTRIBUTING/CLAUDE.md note.
**Dependencies**: none.
**Business value**: saves the next developer the exact debugging detour Batch 5's tester hit — a `project.json` edit that silently does not take effect until `npx nx reset`.

**Context**: While fixing Finding F-1, the tester edited `build-integrity-worker`'s esbuild options in `project.json`, rebuilt, and the bundle still lacked the fix — the Nx daemon was serving a stale cached project graph even with `--skip-nx-cache`.

**Current pattern**: No documented warning anywhere in the repo about this failure mode; the note in `test-report.md` is the only record.

**Proposed pattern**: Add a short note to the root `CLAUDE.md` (or a relevant lib's) Development Commands / gotchas section: "after editing a `project.json` target, run `npx nx reset` if the change appears not to take effect — `--skip-nx-cache` alone is not sufficient."

**Affected locations**:

- root `CLAUDE.md` or `apps/ptah-electron/CLAUDE.md` (documentation only)

**Implementation notes**: Purely additive documentation; no code risk.

**Expected benefit**: prevents a repeat of the exact "the fix looks like it didn't apply" confusion recorded verbatim in `test-report.md`.

**Source**: `test-report.md` line 398-401 ("Note for anyone reproducing... Run `npx nx reset` first, or the fix looks like it did not apply.").

---

### 16. Fold the integrity worker's backup-validation pass into `SqliteBackupService`

**Priority**: LOW
**Effort**: M — architectural decision about ownership between `SqliteBackupService.checkIntegrity` and the new integrity worker.
**Dependencies**: item 1 above (moving the backup off the main thread) is the natural first step; this is the second-order consolidation once both are worker-based.

**Context**: `implementation-plan.md`'s "Rejected alternatives" #1 considered deleting the boot check entirely and relying on `SqliteBackupService.checkIntegrity`'s existing validation of the backup copy, since that transitively answers the same question about the source file. It was rejected for this task because `db.backup()` writing a full 1 GB is a far more expensive way to learn the same thing than a cheap scheduled check — but was explicitly named as something "the integrity worker built here should later absorb."

**Current pattern**: `SqliteBackupService.checkIntegrity` (`libs/backend/persistence-sqlite/src/lib/backup.service.ts:231-255`) independently validates a backup copy; the new `SqliteIntegrityService` independently validates the live file. Two parallel validation paths.

**Proposed pattern**: Once item 1 moves the backup itself off the main thread, consider having the backup's post-copy validation delegate to (or share code with) the integrity worker's verdict classification, rather than maintaining two.

**Affected locations**:

- `libs/backend/persistence-sqlite/src/lib/backup.service.ts:231-255` (1 file)
- `libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts` (consolidation target)

**Implementation notes**: Named explicitly as "that is named as a follow-up, not done now" in the plan's rejected-alternatives section — sequence after item 1, not before.

**Expected benefit**: removes duplicated corruption-verdict logic between two parallel checks once both run out-of-process.

**Source**: `implementation-plan.md` "Rejected alternatives" #1 (line 193-200).
