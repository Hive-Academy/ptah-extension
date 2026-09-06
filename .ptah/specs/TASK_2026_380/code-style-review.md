# Code Style Review — `TASK_2026_380` (Batch 1)

## Summary

| Metric          | Value                                                           |
| --------------- | --------------------------------------------------------------- |
| Overall score   | 8/10                                                            |
| Assessment      | APPROVED                                                        |
| Blocking issues | 0                                                               |
| Serious issues  | 0                                                               |
| Minor issues    | 3                                                               |
| Files reviewed  | 28 (uncommitted diff/new files inside the seven in-scope paths) |

## Five style questions

### 1. What breaks in six months?

`SqliteIntegrityService.isDue` (`libs/backend/persistence-sqlite/src/lib/integrity/integrity-check.service.ts:100-107`) hard-codes the "future timestamp = due" and "any non-clean verdict = due" rules inline rather than through a shared predicate with `skill-md-migration.ts`'s `readMarkerOutcome`. Both now implement the same "cannot date this, treat as due" reasoning independently (`skill-md-migration.ts:222-225` is cited in the new header comment as precedent, not reused as code). A third similar store — and there will likely be one, given the pattern is now used twice — will either duplicate the reasoning a third time or someone will belatedly extract it. Not a defect today; worth watching once the memory-curator boot-scan pair also grows this shape.

### 2. What would a new team member misread?

The two-tier deferred/reverted RPC registration in lane C's report (`rpc.types.ts` hunk withheld until Batch 3) is invisible from the diff alone — `git diff libs/shared/src/lib/types/rpc.types.ts` is empty, so a reviewer scanning only the working tree would not know `'boot:getReadiness'` was ever implemented and pulled back. `BootGetReadinessResult` (`libs/shared/src/lib/types/rpc/rpc-readiness.types.ts:158-163`) is exported and unused by anything in this batch, which reads as dead code without the report's explanation that it is a forward declaration for Task 3.2. The type itself has a doc comment pointing at the reason, which mitigates this — a reader who opens the file (rather than just running `ts-prune`) gets the answer.

### 3. What does this cost to maintain?

Two new host tokens (`INTEGRITY_WORKER_PROCESS_FACTORY`, `INTEGRITY_WORKER_PATH`) are registered with nothing consuming them yet — `libs/backend/persistence-sqlite/src/lib/di/tokens.ts:32-44`. That is deliberate seam-first sequencing (Task 2.2 owns the Electron/CLI factory), documented in the token comments and the lane report, and it costs nothing extra to carry since `SqliteIntegrityService` already degrades to a one-line `info` log when no factory is registered (`integrity-check.service.ts:117-126`). The five new settings keys (two skill-synthesis, plus the boot-phase/activity wire types) each got a symmetrical entry in every table they need to appear in, which is the cheapest shape this pattern can take.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere material. `integrity-worker.ts:123` calls `require('better-sqlite3')` in a production (non-spec) file — grepping the repo, every other production call site obtains `better-sqlite3` through a host-injected `SqliteDatabaseFactory`, and the only other `require('better-sqlite3')` occurrences are in `.spec.ts` files (`memory.store.spec.ts`, `memory-search.service.spec.ts`, `code-symbol.store.spec.ts`). This is not a copy of an existing production pattern — it's new, though the comment at `integrity-worker.ts:121-122` gives a load-bearing reason (the worker must resolve the ABI-matched build from whichever host bundled it, which a static `import` from the lib's own `node_modules` cannot guarantee across Electron/CLI/Jest). Given the worker is a leaf, bundled-in-isolation entry point that imports nothing else from the monorepo (confirmed at `integrity-worker.ts:41-43`), this is a defensible one-off rather than a boundary violation, and it mirrors how `embedder-worker.ts` also treats its native binding as host-resolved (though that file uses a different loading mechanism). Flagged as minor because it is a small precedent the next worker author will copy without necessarily re-deriving the reasoning.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have added a one-line note to `libs/backend/skill-synthesis/src/index.ts` exporting `SkillMdMigrationMarkerOutcome` at the same time the union was introduced (`skill-md-migration.ts`), rather than leaving it as an open question in the lane report for a future consumer to notice. It costs one line, `index.ts` is not in the file list so the omission is defensible, but the type is the return contract of a function two log call sites already spread — the next thing that wants to type against it will grep for the type and find it un-exported, which is a five-minute detour that a one-line addition avoids entirely.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts:123` — `require('better-sqlite3')` inside a production file, the only occurrence outside `.spec.ts` files in the repo. Well-justified in the surrounding comment (ABI must match whichever host bundled the worker), but it establishes a pattern with no other production precedent; worth a one-line pointer in `persistence-sqlite/CLAUDE.md`'s worker guidance once Task 2.2 lands the bundler wiring, so the next worker author copies the reasoning and not just the syntax.
- `libs/shared/src/lib/types/rpc/rpc-readiness.types.ts:158-163` — `BootGetReadinessResult` is exported from `libs/shared/src/index.ts` (via `export *`) with zero consumers anywhere in the tree after this batch (confirmed: only the three `rpc.types.ts` hunks in lane C's report would consume it, and that file is unchanged in this diff). This is explained in both the type's own doc comment and the lane report, and the plan explicitly defers the RPC-registry entry to Task 3.2 for the stated manifest-partition reason (`rpc-allowlist.spec.ts`'s total-partition assertion). Not a defect; flagged so the team-leader tracks it as an explicit IOU rather than something a later `ts-prune`-style pass might delete by mistake before Batch 3 lands.
- `libs/backend/skill-synthesis/src/index.ts` — `SkillMdMigrationMarkerOutcome` (introduced in `skill-md-migration.ts`) is not re-exported from the barrel, unlike its sibling `MigrationResult`. Noted as an open question in lane S's own report; low cost, but it is the return-contract type of `readMarkerOutcome` and the next consumer will hit a five-minute detour finding it un-exported.

## File-by-file

### `libs/backend/persistence-sqlite/src/lib/integrity/*` (8 files, new folder)

Score 9/10 — 0 blocking, 0 serious, 1 minor (the `require` call above). The folder passes the nameability test (`integrity/`, not `helpers/utils`), the worker port is declared locally per the documented `memory-curator/src/lib/embedder/worker-process.port.ts:1-8` precedent rather than in `platform-core`, and the dual-transport shim in `integrity-worker.ts:69-99` is a faithful, correctly-cited copy of `embedder-worker.ts:33-83`'s shape. `SqliteIntegrityService`'s public surface is exactly `isDue`/`dispatchIfDue` as required, and every failure path is `catch (error: unknown)` with `instanceof Error` narrowing throughout (`integrity-check.service.ts:130-149`, `integrity-check-state.store.ts:105-134`, `integrity-worker.ts:172-189`).

### `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts`

Score 9/10 — the deletion is exactly the boot-check method and its one call site (`:214` originally, `:602-635` originally), nothing else touched; file shrank 839→797 as claimed.

### `libs/backend/persistence-sqlite/src/lib/migrations/0042_db_integrity_check_state.ts`

Score 9/10 — static SQL, `IF NOT EXISTS`, the `CHECK (id = 1)` single-row constraint enforced at the schema level rather than by convention, and a header that states the measurements and the deliberate inversion of `0041`'s per-root key. Matches the migration idiom (`0041`) closely.

### `libs/backend/persistence-sqlite/src/lib/di/{tokens,register}.ts`, `src/index.ts`

Score 8/10 — `Symbol.for(...)` UPPER_SNAKE tokens grouped and documented; `registerSingleton` with a comment explaining why singleton matters; `export type` used correctly for the type-only re-exports (`IntegrityCheckState`, the two port interfaces, the protocol types) versus value exports (`SqliteIntegrityService`, `classifyQuickCheck`, `isIntegrityCheckRequest`). `IntegrityCheckStateStore` is injected by class token (`@inject(IntegrityCheckStateStore)`) rather than a `Symbol`, a deliberate deviation the lane report justifies (internal collaborator of one service, tsyringe resolves an `@injectable()` class with no registration) — judged against repo precedent this is consistent with how internal-only collaborators are handled elsewhere (e.g. stores injected by class in `memory-curator`), not a new pattern.

### `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`

Score 8/10 — the boot-scan arm/defer mechanism (`scheduleBootScan`, `readBootScanDelayMs`, `readBootScanIdleBackoffMs`, `readPositiveMs`, `lastActivityAt`) mirrors `memory-trigger.service.ts`'s already-documented pattern closely, including the "stamp above the idle guard" placement and `unref()` on the timer. The 17-argument constructor is untouched, as claimed. File is now 1018 lines (was ~922); the sibling `memory-trigger.service.ts` this batch copies from is 1275 lines, so this is not an outlier for the shape — noted, not penalized.

### `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts`, `libs/backend/platform-core/src/file-settings-keys.ts`

Score 9/10 — both new keys land in `FILE_BASED_SETTINGS_KEYS` and `FILE_BASED_SETTINGS_DEFAULTS`, both correctly excluded from `SKILL_TRIGGER_PREFIXES`/DTO with a stated reason, and the comment explicitly calls out the pre-existing `memory.triggers.*` omission as a bug rather than a precedent to copy — the right instinct, expressed without fixing out-of-scope code.

### `libs/backend/skill-synthesis/src/lib/skill-md-migration.ts`

Score 8/10 — the rescan interval change is justified with the correctness-vs-degraded-description distinction stated inline; `markerOutcome`/`markerWritten` additively extend `MigrationResult` without removing `skippedByMarker`. Deduct one point only for the un-exported union noted above.

### `libs/shared/src/lib/types/rpc/rpc-readiness.types.ts`, `rpc-activity.types.ts`, `message-constants.ts`, `message-type.ts`, `payload-map.ts`, `index.ts`

Score 8/10 — `ACTIVITY_EVENT: 'activity:event'` matches the `namespace:event` shape of `SKILL_SYNTHESIS_EVENT`/`HARNESS_HEALTH_CHANGED`; `index.ts` uses `export *` consistently with the adjacent `rpc-readiness.types` line, correct given the module exports value tuples and guards alongside types; the widened `BootReadinessChangedPayload` adds required fields (`phase`, `startedAt`) safely because the implementation plan verified zero production callers construct that payload today (confirmed independently: only `payload-map.ts` and `rpc-readiness.types.ts` itself reference the type outside spec files and docs). Doc comments were rewritten to state the display-only/edge-triggered contract precisely. The `rpc.types.ts` deferral is legitimate given `register-rpc-surface.ts`'s total-partition assertion, and is documented at three separate levels (type doc comment, lane report, and — implicitly — its absence from the diff), though see the Minor issue above.

## Pattern compliance

| Repository rule or nearby convention                                                 | Status                                 | Evidence                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker port declared locally, not in `platform-core`                                 | PASS                                   | `libs/backend/persistence-sqlite/src/lib/integrity/worker-process.port.ts:1-8` cites and follows `memory-curator/src/lib/embedder/worker-process.port.ts:9-20`                                              |
| No `electron` import in a lib                                                        | PASS                                   | `integrity-worker.ts:64-71` uses a structural `ElectronParentPortLike` type, no `import 'electron'` anywhere in the diff                                                                                    |
| `persistence-sqlite` is a foundation lib with no new monorepo imports                | PASS (pre-existing exception, not new) | `@ptah-extension/vscode-core` import in `integrity-check.service.ts:30` matches pre-existing usage in `backup.service.ts` and `vec-status.service.ts`                                                       |
| `skill-synthesis` never imports `cron-scheduler`                                     | PASS                                   | no such import appears in the diff or in `skill-trigger.service.ts`                                                                                                                                         |
| `Symbol.for(...)` UPPER_SNAKE tokens grouped in `di/tokens.ts`                       | PASS                                   | `libs/backend/persistence-sqlite/src/lib/di/tokens.ts:32-44`                                                                                                                                                |
| Registered in `di/register.ts`                                                       | PASS                                   | `libs/backend/persistence-sqlite/src/lib/di/register.ts:47-53`                                                                                                                                              |
| `catch (error: unknown)` + `instanceof Error` narrowing                              | PASS                                   | consistent across all new/modified files reviewed                                                                                                                                                           |
| No `@ts-ignore`                                                                      | PASS                                   | none found in the diff                                                                                                                                                                                      |
| `export type` for type-only re-exports                                               | PASS                                   | `persistence-sqlite/src/index.ts:37-49`, `libs/shared/src/lib/types/messages/payload-map.ts:126`                                                                                                            |
| Migration: static SQL, no interpolation                                              | PASS                                   | `0042_db_integrity_check_state.ts:62-72`; header cites the ESLint/Semgrep rule by name                                                                                                                      |
| Migration registry append-only                                                       | PASS                                   | `migrations/index.ts:70,321-325` appends only                                                                                                                                                               |
| Six ratchet spec bumps (41→42)                                                       | PASS                                   | confirmed present in `0028`/`0030`/`0038`/`0039`/`0040`/`0041` spec diffs                                                                                                                                   |
| Both new skill-synthesis settings keys in `FILE_BASED_SETTINGS_KEYS` AND `_DEFAULTS` | PASS                                   | `file-settings-keys.ts:345-350,606-609`                                                                                                                                                                     |
| Boot-scan keys kept out of `SKILL_TRIGGER_PREFIXES`/DTO                              | PASS                                   | `skill-trigger-config.ts:10-25`, confirmed by lane S's added spec assertion                                                                                                                                 |
| `ACTIVITY_EVENT` naming matches neighbours                                           | PASS                                   | `message-constants.ts:225` vs. `SKILL_SYNTHESIS_EVENT`/`HARNESS_HEALTH_CHANGED`                                                                                                                             |
| `rpc.types.ts` registry entry deferred to Batch 3 (not flagged as missing)           | PASS (per explicit instruction)        | not present in diff; documented in lane C's report                                                                                                                                                          |
| File size ceiling (700 soft, 1000 "deliberate look")                                 | NOT_APPLICABLE / observed              | `skill-trigger.service.ts` now 1018 lines; sibling `memory-trigger.service.ts` at 1275 lines for the same shape of service — consistent with existing repo precedent, no split warranted by the facade rule |

## Maintenance debt

- Introduced: one new folder (`persistence-sqlite/src/lib/integrity/`) with a self-contained worker/store/service triad; two new settings keys with full read/write registration; a widened boot-readiness payload and one new activity wire type, both additive; the deletion of a 47-line dead-end boot-check method.
- Retired: `SqliteConnectionService.runBootChecks` and its blocking call site; the five specs that tested it (replaced by one pragma-list assertion that is evidence-preserving, per lane P's own reasoning).
- Net: a small net reduction in `sqlite-connection.service.ts`, a small net addition spread cleanly across three libs behind their existing DI/settings/message-protocol conventions, and two explicit forward IOUs (the unregistered `INTEGRITY_WORKER_PATH`/`INTEGRITY_WORKER_PROCESS_FACTORY` tokens, and the reverted `rpc.types.ts` hunk) both tracked in writing for the batches that own them.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking; the only items worth a second look are the un-exported `SkillMdMigrationMarkerOutcome` and the precedent-setting `require('better-sqlite3')` in a production worker file, both minor and both already reasoned about in the lane reports.
- What a 10/10 version would do differently: export `SkillMdMigrationMarkerOutcome` from the skill-synthesis barrel in the same commit that introduced it; add a one-line cross-reference in `persistence-sqlite/CLAUDE.md` documenting the worker's `require('better-sqlite3')` exception so it reads as a stated policy rather than something the next reviewer has to re-derive from a code comment.

## Batch 2

## Summary

| Metric          | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Overall score   | 8/10                                                                                             |
| Assessment      | APPROVED                                                                                         |
| Blocking issues | 0                                                                                                |
| Serious issues  | 0                                                                                                |
| Minor issues    | 2                                                                                                |
| Files reviewed  | 10 (2 created + spec, 1 created CLI factory, 2 new tsconfigs, 4 modified — the exact scope list) |

Scope confirmed against `batch-2-report.md` and `git status`: two other agents (Batch 1, already committed at `0c7e4d05c`; Batch 3, in flight) have dirty files in this same worktree. Every file below was checked with `git diff -- <path>` individually; nothing outside the assigned list was read as a diff, only as a comparison template (`electron-embedder-worker-factory.ts`, `cli-embedder-worker-factory.ts`, `electron-power-monitor.spec.ts`, `agent-process-manager.service.ts`).

## Five style questions

### 1. What breaks in six months?

Nothing in the reviewed files depends on an assumption likely to flip soon. The one candidate: `registerIntegrityCheckJob`'s per-process boot-timer guard lives inside `!handlerRegistry.has(INTEGRITY_HANDLER_NAME)` (`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:184-224`) — correct today because `startThothCron` is only ever re-entered on the same `HandlerRegistry` instance. If a future host ever swapped the registry between calls (a scenario `registerSkillDrainJobs` above it does not need to guard against either, since it has no one-shot timer), the "one boot dispatch" guarantee this batch's tests pin (`start-thoth-cron.spec.ts:481-499`) would silently double-fire. Not a defect now — the same shape the file already uses for the drain block — but the constraint is implicit in the guard's placement, not stated as an invariant of `HandlerRegistry` itself.

### 2. What would a new team member misread?

`CliIntegrityWorkerFactory`/`ElectronIntegrityWorkerFactory` registered in `register-thoth-libraries.ts:82-99` with no CLI dispatch site anywhere in the codebase looks, on a `grep`-only read, like dead wiring or a half-finished feature. The comment at the registration site (`register-thoth-libraries.ts:83-91`) heads this off in full caps precisely because the report anticipated it, and it is accurate: `startThothCron` (the only caller of `registerIntegrityCheckJob`) is invoked from `thoth-runtime` hosts, never from `cli-engine` (confirmed: no `startThothCron` call exists under `apps/ptah-cli` or `libs/backend/cli-engine`). A reader who trusts the comment is fine; a reader who doesn't and searches for a call site will find none, which is the intended, documented state, not a gap in the search.

### 3. What does this cost to maintain?

Two brand-new esbuild targets and four list edits across two `project.json` files (`apps/ptah-electron/project.json:161-184,216,249`, `apps/ptah-cli/project.json:155-179,197`) are pure structural copies of `build-embedder-worker`'s shape with only the required substitutions (`main`, `outputFileName` already `integrity-worker.mjs`/reused, `tsConfig`). Same for the two new `tsconfig.integrity-worker.json` files, which are byte-for-byte the `tsconfig.embedder-worker.json` shape repointed at a different `include`. This is the cheapest kind of duplication the repo has: four near-identical JSON blocks that will need a fifth near-identical block the next time a worker is added, but nothing here invents a new mechanism to maintain — it is the established "one esbuild target + one tsconfig per worker" pattern, unchanged.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere material found. The Electron factory's constructor takes one argument (`workerPath` only) versus the embedder factory's two (`workerPath`, `modelCacheDir`) — a deliberate divergence, stated in the class doc comment (`electron-integrity-worker-factory.ts:10-14`) and consistent with the port contract (no `init` message exists for this worker). The CLI factory's `kill()` calls `void this.worker.terminate()` (`cli-integrity-worker-factory.ts:51`) — same as `CliEmbedderWorkerFactory`'s own `kill()`, confirmed by the report's citation of `cli-embedder-worker-factory.ts:14-40`.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have added one line to `IIntegrityWorkerProcessFactory`'s doc comment (or a comment at the CLI registration site pointing back at it) stating that a port with "exactly one implementation per host, and the CLI legitimately never dispatches" is now a second instance of that shape (the first being the pre-existing embedder/voice worker ports, which DO get dispatched from the CLI). Without that cross-reference, the next person adding a fourth host-scoped worker has to re-derive from scratch whether "registered but never dispatched" is an acceptable steady state for their case or a smell — this batch's A-2 comment answers it locally but doesn't generalize the answer for the next reader who isn't looking at this exact file.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:184-224` — the one-boot-timer-per-process guarantee depends on the boot-timer arm sitting inside the same `!handlerRegistry.has(...)` branch as handler registration, with no comment stating that as an explicit coupling (the comment at `:189-191` explains why the guard exists, not that the timer specifically depends on sharing it). A future edit that splits handler registration from timer arming (e.g., to re-arm the timer without re-registering the handler) could reintroduce a double-dispatch with no test catching it until `start-thoth-cron.spec.ts:481-499`'s two-call assertion is itself re-read for why it still passes.
- `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:83-91` — the A-2 comment is accurate and load-bearing but exists only at this one call site. `IIntegrityWorkerProcessFactory`'s own doc comment (in `persistence-sqlite`, out of scope for this diff) does not mention that the CLI registers-but-never-dispatches; a reader who finds the port definition first, rather than the registration site, has no forward pointer to this fact.

## File-by-file

### `apps/ptah-electron/src/services/platform/electron-integrity-worker-factory.ts` + `.spec.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor specific to this file. Faithful structural copy of `electron-embedder-worker-factory.ts:8-63` (`electron-integrity-worker-factory.ts:16-64`): same `import electron, { type UtilityProcess } from 'electron'; const { utilityProcess } = electron;` idiom, same private wrapper class shape, same `message`/`exit` overload signature. The one intentional deviation — no `init` postMessage, one-argument constructor — is documented in the class doc comment and mechanically necessary given the port has no init message type. The spec (`electron-integrity-worker-factory.spec.ts`) uses a local `jest.mock('electron', ...)` rather than extending the shared `apps/ptah-electron/__mocks__/electron.ts`; this matches the established local precedent in the same directory (`electron-power-monitor.spec.ts:6-12` does the same for `powerMonitor`, which the shared mock also omits) rather than deviating from it — judged against the sibling spec, not against a hypothetical shared-mock-first policy the repo does not enforce. 6 assertions are call-count/argument based (fork args, no-init, message/exit mapping, per-call child), none timing-based.

### `libs/backend/cli-engine/src/lib/thoth/cli-integrity-worker-factory.ts`

Score 9/10 — matches `cli-embedder-worker-factory.ts`'s `node:worker_threads` transport, the `type: 'module'` cast-not-any-not-ts-ignore seam (`cli-integrity-worker-factory.ts:61-66`), and `terminate()` on `kill()`. No spec file for this factory exists in the diff or report (the Electron sibling has one); the report does not call this out as a deviation and the acceptance criteria named the Electron spec only — a coverage gap worth naming but not treated as a finding since it was not in the assigned scope's contract.

### `apps/ptah-electron/src/di/phase-2-libraries.ts`, `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts`

Score 8/10 — both registrations land before `registerPersistenceSqliteServices` exactly as required (`phase-2-libraries.ts:311-326`, `register-thoth-libraries.ts:92-97`), both derive the worker path the same way their embedder sibling does (`dirnameGlobal ?? path.join(os.homedir(), '.ptah')` in Electron; `path.join(__dirname, ...)` in CLI), both use `useValue` for the path and the factory instance consistent with the embedder registration pattern. Deducted one point for the A-2 comment's isolation, noted above as a minor.

### `apps/ptah-electron/project.json`, `apps/ptah-cli/project.json`, `apps/ptah-electron/tsconfig.integrity-worker.json`, `apps/ptah-cli/tsconfig.integrity-worker.json`

Score 9/10 — all four list edits verified in the diff at the exact positions the report claims (`build.dependsOn`, `build-dev.commands`, `serve:watch.commands` in Electron; `restore-cli-manifest.dependsOn` in CLI). Both new `build-integrity-worker` targets carry the same option set as `build-embedder-worker` with only `main`/`outputFileName`/`tsConfig` changed, and the Electron/CLI difference in `dependsOn`/`outputs` shape mirrors the same difference already present between the two apps' embedder targets. Both tsconfigs are the embedder tsconfig's `extends`/`include`/`exclude` shape repointed at `integrity/`. The CLI tsconfig was not in the task's named file list but is justified in the report (deviation 1) by the same paths-map divergence that already justifies the CLI keeping its own `tsconfig.embedder-worker.json` — a defensible, well-reasoned addition, not scope creep.

### `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` (307 → 422 lines) + `.spec.ts` (457 → 656 lines)

Score 8/10 — `registerIntegrityCheckJob` (`:151-236`) is a nameable, self-contained addition matching `registerSkillDrainJobs`'s existing idiom one function above it: module-level constants for the cron expression/handler name/delay, a `has()`-guarded `register`, an unguarded idempotent `upsert`, and a non-fatal `try/catch` at the call site (`:386-403`) inside the same `CRON_JOB_STORE && CRON_HANDLER_REGISTRY` guard the drain block uses. `(bootTimer as { unref?: () => void }).unref?.()` (`:225`) matches the repo-wide guarded-cast idiom verified independently across 15+ call sites (e.g. `agent-process-manager.service.ts:1321-1322`, `memory-trigger.service.ts:890`, `gateway-chat-bridge.ts:599`) — not a one-off invention. `catch (bootErr: unknown)` and `catch (integrityErr: unknown)` both narrow with `instanceof Error` before `.message`. No `@ts-ignore`, no dead code, no feature flag. The seven new specs assert call counts and arguments throughout (`toHaveBeenCalledWith`, `mock.calls.filter(...).toHaveLength(...)`), and the boot-dispatch timing is captured via a `jest.spyOn(global, 'setTimeout')` mock rather than fake timers, so no test asserts a wall-clock duration — matching the brief's requirement exactly. Deducted one point for the coupling noted in Minor issues (guard sharing between handler registration and timer arming is correct but implicit).

## Pattern compliance

| Repository rule or nearby convention                                 | Status           | Evidence                                                                                                                                |
| -------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `electron` import confined to `apps/ptah-electron`                   | PASS             | Only `electron-integrity-worker-factory.ts:16` imports `electron`; `cli-integrity-worker-factory.ts` imports `node:worker_threads` only |
| `node:worker_threads` confined to `cli-engine`                       | PASS             | `cli-integrity-worker-factory.ts:20`; no `worker_threads` import added under `apps/ptah-electron`                                       |
| Nothing new imported into `persistence-sqlite`                       | PASS             | `git diff` shows zero changes under `libs/backend/persistence-sqlite` in this batch (Batch 1 already committed)                         |
| `thoth-runtime` imports no `electron`, no renderer type              | PASS             | `start-thoth-cron.ts` diff adds only a `type SqliteIntegrityService` import from `persistence-sqlite`                                   |
| `persistence-sqlite` never imports `cron-scheduler`                  | PASS (unchanged) | No such import in the diff; the seam stays in `thoth-runtime` as documented at `start-thoth-cron.ts:161-166`                            |
| Worker factory naming `{platform}-{capability}.ts`                   | PASS             | `electron-integrity-worker-factory.ts`, `cli-integrity-worker-factory.ts`                                                               |
| `catch (error: unknown)` + `instanceof Error` narrowing              | PASS             | `start-thoth-cron.ts:214-218,398-402`                                                                                                   |
| No `@ts-ignore`                                                      | PASS             | none found; `cli-integrity-worker-factory.ts:66` uses an explicit typed cast instead                                                    |
| `useValue` registration before dependent service registration        | PASS             | `phase-2-libraries.ts:317-326`, `register-thoth-libraries.ts:92-97`, both before `registerPersistenceSqliteServices`                    |
| `unref` guarded-cast idiom matches repo precedent                    | PASS             | `start-thoth-cron.ts:225` vs. `agent-process-manager.service.ts:1321-1322` and 13+ other sites                                          |
| Job registration idempotency: `register` guarded, `upsert` unguarded | PASS             | `start-thoth-cron.ts:184-224`, mirroring `registerSkillDrainJobs`'s existing shape                                                      |
| esbuild worker target option parity with `build-embedder-worker`     | PASS             | `apps/ptah-electron/project.json:161-184`, `apps/ptah-cli/project.json:155-179`                                                         |
| File size ceiling (700 lines, soft)                                  | PASS             | `start-thoth-cron.ts` at 422 lines, well under                                                                                          |

## Maintenance debt

- Introduced: two new host-adapter files (thin, templated, low-risk); two new esbuild targets and their JSON list wiring (four list-edit sites now need to stay in sync for any fifth worker); one new cron job + handler in an already-established registration idiom.
- Retired: nothing — this is additive wiring for Batch 1's already-landed service.
- Net: small positive addition to maintenance surface, proportionate to the feature; no shortcuts taken to reduce it (no shared factory abstraction was invented prematurely — two workers is not yet evidence for one).

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the boot-timer-arms-inside-the-registration-guard coupling in `start-thoth-cron.ts:184-224` is correct but implicit; a future refactor of `registerIntegrityCheckJob` that separates those two concerns without re-reading the guarantee could silently double-arm the timer.
- What a 10/10 version would do differently: add a one-line comment at `start-thoth-cron.ts:189` stating explicitly that the boot timer's one-per-process guarantee depends on being armed inside the same guard as handler registration, not just alongside it; add a matching forward-pointer in `IIntegrityWorkerProcessFactory`'s own doc comment (or its file header) noting that the CLI legitimately registers a factory it never dispatches, so the fact is discoverable from the port definition and not only from the one registration call site.

## Batch 3

## Summary

| Metric          | Value                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Overall score   | 8/10                                                                                                                              |
| Assessment      | APPROVED                                                                                                                          |
| Blocking issues | 0                                                                                                                                 |
| Serious issues  | 0                                                                                                                                 |
| Minor issues    | 3                                                                                                                                 |
| Files reviewed  | 27 (exact scope list: platform-core 3, vscode-core 5, shared 1, rpc-handlers 6, thoth-runtime 5, ptah-electron 8, minus overlaps) |

Scope confirmed against `batch-3-report.md` and `git status --short`: every
file in the assigned list was checked with `git diff -- <path>` (modified) or a
full `Read` (new). `libs/frontend/**` and `apps/ptah-extension-webview/**` dirty
files (Batch 4, in flight) were not opened as diffs — only their names were
noted in `git status` to confirm they are out of scope.

## Five style questions

### 1. What breaks in six months?

`ElectronBootReadinessProvider`'s constructor takes `Pick<BootCoordinator,
'snapshot'>` (`apps/ptah-electron/src/services/platform/electron-boot-readiness.ts:27-29`),
and `bootstrapElectron` now takes the same narrowed type as a second parameter
(`apps/ptah-electron/src/activation/bootstrap.ts:129`). Both are correct today
— the port needs exactly one method — but a future second method on
`IBootReadinessProvider` (a subscribe-style transition count, say) would need
the `Pick` widened at two call sites simultaneously, `bootstrap.ts` and the
adapter, with nothing forcing the second edit if the first compiles alone
(`Pick` degrades silently to a narrower-than-needed type, it does not error).
Not a defect — the narrowing is the right call for what exists now — but the
two sites are coupled by convention, not by the type system.

### 2. What would a new team member misread?

`registerIntegrityCheckJob` and `registerSkillDrainJobs` in
`libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:101-104,209-212` each
gained an `emit: ActivityEmitter` parameter with no default, so a reader
diffing this file against Batch 2's version sees two functions whose call
signature changed for a reason not visible at either function's own
definition — the reason (`thoth-runtime` must not know what a ticker is, so
the emitter is built once at the top of `startThothCron` and threaded down) is
stated in `activity-emitter.ts:1-29`'s header, not at the call sites
themselves. A reader who opens `start-thoth-cron.ts` first, without following
the import to `activity-emitter.ts`, sees a bare `ActivityEmitter` parameter
and has to go find out what it is for. The type name and the `emitActivity =
createActivityEmitter(...)` call two lines above (`start-thoth-cron.ts:283-288`)
mitigate this quickly, but there is no one-line comment at either function
signature pointing at the header that explains it.

### 3. What does this cost to maintain?

Two near-identical lazy-broadcast helpers now exist —
`boot-readiness-broadcaster.ts:40-67` and `activity-emitter.ts:62-94` — each
resolving `TOKENS.WEBVIEW_MANAGER` per-call behind `isRegistered`, each
duck-typing the same `{ broadcastMessage }` surface, each swallowing a
synchronous throw and a rejected broadcast with the identical two-`catch`
shape. `batch-3-report.md`'s stated reason for not sharing one helper — the two
carry different message types and payloads (`BootReadinessChangedPayload` vs
`ActivityEventPayload`) and routing readiness through the activity emitter (or
vice versa) would give one of them a second responsibility — holds for the
_payload_, but the _lazy-resolve-and-swallow_ mechanics around it are
identical enough that a generic `broadcastLazily<T>(container, messageType,
payload)` helper in a shared location (`vscode-core`, which both already
depend on) would have removed one of the two copies without merging the
concerns the report was protecting. This is a judgment call the report reasons
about rather than skips, so it is a recommendation and not a defect: two
call sites is thin evidence for an abstraction, and the existing repo norm
(`libs/backend/persistence-sqlite/src/lib/integrity/integrity-worker.ts`'s
paired transport shim, accepted as a "faithful copy" in Batch 1's review) is to
tolerate a second templated copy rather than force a premature shared helper.
Flagged so a _third_ lazy-broadcast site (there will likely be one, given the
ticker's own future-enhancements note) does not get built as a third copy
without someone re-reading this tradeoff.

### 4. Where is this inconsistent with the rest of the repository?

`RPC_HANDLER_MANIFEST`'s import block and its array both order every existing
entry alphabetically by key (`agent`, `auth`, `autocomplete`, `chat`,
`command`, …. — `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:28-77`,
`123-230`), and this batch's `boot` entry breaks that order in both places:
the import lists `AuthRpcHandlers`, then `BootRpcHandlers`, then
`AutocompleteRpcHandlers` (`manifest.ts:29-31`), and the manifest array puts
the `boot` object between `auth` and `autocomplete`
(`manifest.ts:123-144`) — alphabetically `boot` belongs after `autocomplete`,
before `chat`. Nothing depends on the order (the partition assertion in
`manifest.spec.ts` is order-independent, confirmed by reading the file's own
comment at `:14-18`), so this is cosmetic, not a defect. But every other
handler in both lists is exactly where alphabetizing would put it, so this is
the one entry a reader scanning for `'boot'` by eye, or a future diff adding a
`'br...'`-prefixed handler beside it, will trip over.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have added the one-line pointer questions 2 and 4 are missing: a
comment at `registerIntegrityCheckJob`/`registerSkillDrainJobs`'s `emit`
parameter referencing `activity-emitter.ts`'s header, and alphabetical
placement for the `boot` manifest entry and import. Both cost one line or a
cut-and-paste move, and both remove a small "go read a different file, or
notice by luck" tax the current shape imposes on the next reader — the same
category of finding Batch 1 and Batch 2's reviews both closed on, which
suggests this is a recurring gap in how the lanes hand off a batch rather than
a one-off.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts:29-31,123-144` —
  the `boot` entry is out of the alphabetical order every other import and
  manifest entry follows (`auth` → `boot` → `autocomplete`, should be `auth` →
  `autocomplete` → `boot`). No functional effect (the partition/disjointness
  invariants are order-independent), but it is the one entry that does not
  match the established scan order.
- `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts:101-104,209-212` —
  `registerSkillDrainJobs` and `registerIntegrityCheckJob` each gained an
  `emit: ActivityEmitter` parameter with no comment at the signature pointing
  back at `activity-emitter.ts`'s header, which is where the "why does this
  function suddenly take an emitter" question is actually answered. A reader
  who does not follow the import will have to guess or grep.
- `apps/ptah-electron/src/activation/boot-readiness-broadcaster.ts:40-67` and
  `libs/backend/thoth-runtime/src/lib/activity-emitter.ts:62-94` — two
  independently-written, structurally identical lazy-resolve-and-swallow
  helpers around two different payload types. `batch-3-report.md` reasons
  about this explicitly and the payload-merging alternative is rightly
  rejected, but a generic `broadcastLazily` helper for the _mechanics_ (not the
  payload) was not considered in the report and would have removed one of the
  two copies. Worth a look if a third such site appears.

## File-by-file

### `libs/backend/platform-core/src/{interfaces/boot-readiness.interface.ts,di/tokens.ts,index.ts}`

Score 9/10 — 0 blocking, 0 serious, 0 minor. `IBootReadinessProvider` is
correctly `I`-prefixed, one method, documented as synchronous-and-read-only
with the reason stated (`boot-readiness.interface.ts:9-13`); its only import is
`import type { BootReadinessChangedPayload } from '@ptah-extension/shared'`
(`:20`), which matches the CLAUDE.md-documented precedent of other
`platform-core` interfaces importing shared wire types type-only (confirmed by
grep: `app-updater.interface.ts` does the same). `platform-core` remains a
leaf with respect to other backend libs — nothing here imports
`vscode-core`, `rpc-handlers`, or any adapter lib. `BOOT_READINESS:
Symbol.for('PlatformBootReadiness')` is grouped with, and documented in, the
exact shape of `SESSION_ATTACHMENT_GUARD` (`tokens.ts:74-79,115-121`) as the
task brief asked. `index.ts` exports it as `export type` beside
`ISessionAttachmentGuard` (`:68-69`), consistent with every other port export
in the file.

### `libs/backend/vscode-core/src/{services/null-boot-readiness.ts,services/null-boot-readiness.spec.ts,di/register-platform-agnostic.ts,di/register-platform-agnostic.spec.ts}`

Score 9/10 — `NullBootReadinessProvider` follows the `NullSessionAttachmentGuard`
shape exactly: `@injectable()`, one method, a doc comment explaining why the
constant answer is honest for VS Code/CLI and not for Electron
(`null-boot-readiness.ts:5-18`). `startedAt` captured at construction, not per
call, with the reasoning stated and pinned by a dedicated spec case
(`null-boot-readiness.spec.ts:26-36`). `register-platform-agnostic.ts`'s new
block uses the identical `if (!container.isRegistered(PLATFORM_TOKENS.X))`
idiom as the `SESSION_ATTACHMENT_GUARD` block immediately above it
(`:74-90`), with a comment explaining registration order both ways. The new
`register-platform-agnostic.spec.ts` is the first spec file for this
registration function (its sibling `SESSION_ATTACHMENT_GUARD` path has none),
which is a net addition to coverage, not a gap.

### `libs/backend/vscode-core/src/messaging/rpc-handler.ts`

Score 9/10 — `'boot:'` appended to `ALLOWED_METHOD_PREFIXES` with a one-line
comment naming the method and why the renderer needs it first (`:90`). One
line, correctly placed, matches every neighbouring entry's comment style.

### `libs/shared/src/lib/types/rpc.types.ts`

Score 9/10 — the three re-applied hunks (import, `RpcMethodRegistry` entry,
`RPC_METHOD_ENTRIES` key) match `batch-1-lane-C-report.md`'s "Deferred to
Batch 3" section verbatim, confirmed line-for-line against the report's quoted
blocks. The doc comment above `'boot:getReadiness'` is unchanged from what was
deferred, so no drift occurred during the four months (in task time) the hunk
sat out-of-tree. `export type` used for the import, matching the rest of the
file's type-only cross-references.

### `libs/backend/rpc-handlers/src/lib/handlers/{boot-rpc.handlers.ts,boot-rpc.handlers.spec.ts,boot-rpc.schema.ts,index.ts}`, `host-profile/manifest.ts`, `src/index.ts`

Score 8/10 — `BootRpcHandlers` matches `persistence-rpc.handlers.ts`'s
`static readonly METHODS … as const satisfies readonly RpcMethodName[]` +
`register()` convention exactly (`boot-rpc.handlers.ts:43-52`); the file
header states the never-throw contract and cites `db:health` as the precedent
(`:17-25`); `BootGetReadinessParamsSchema = z.object({}).strict()`
(`boot-rpc.schema.ts:14`) is the empty-schema idiom the brief asked for, with
a comment explaining why an empty schema is still worth keeping. `export type
{ BootGetReadinessResult }` re-export (`boot-rpc.handlers.ts:39`) matches the
`export type` convention for result re-exports elsewhere in the lib. The
manifest entry correctly sets `requires: []` with a comment explaining why no
new `Capability` member was added (`manifest.ts:129-134`), and the spec's
`createRpcHandler()` test double enforces the real `ALLOWED_METHOD_PREFIXES`
allowlist rather than a hand-rolled one (`boot-rpc.handlers.spec.ts:30-45`),
so the double cannot drift into asserting a method name the real transport
would reject. Deducted one point for the ordering issue in Minor issues
(shared with `manifest.ts`, not this file's own defect).

### `libs/backend/thoth-runtime/src/lib/{activity-emitter.ts,activity-emitter.spec.ts,start-thoth-cron.ts,start-thoth-cron.spec.ts}`, `src/index.ts`

Score 8/10 — `createActivityEmitter` mirrors `boot-readiness-broadcaster.ts`'s
shape (lazy `isRegistered`-guarded resolve, duck-typed `BroadcastSurface`,
`void`ed broadcast with a `.catch`, whole body in `try/catch`) closely enough
that the two are recognizably the same idiom rather than independently
invented ones — see the Minor issue on whether that idiom should itself be
shared. `withActivityEmit`'s never-throw-on-success /
rethrow-on-failure contract is stated and tested
(`activity-emitter.spec.ts`'s "rethrows a failing handler while emitting
nothing" case). `JobHandler` is imported type-only from
`@ptah-extension/cron-scheduler` (`activity-emitter.ts:39`), which
`thoth-runtime`'s own `CLAUDE.md` lists as an existing dependency — not a new
boundary crossing. `start-thoth-cron.ts`'s wrapper usage
(`withActivityEmit(emit, name, handler)`) reads as a drop-in replacement at
each of the three call sites, and the diff shows no logic change inside any
wrapped handler body beyond the wrapping itself. Deducted one point for the
Minor issue on the un-cross-referenced `emit` parameter.

### `apps/ptah-electron/src/activation/{boot-coordinator.ts,boot-coordinator.spec.ts,boot-readiness-broadcaster.ts,boot-readiness-broadcaster.spec.ts,boot-heavy-services.ts,post-window.ts,bootstrap.ts,boot-order.spec.ts}`, `src/main.ts`, `src/services/platform/electron-boot-readiness.ts`

Score 8/10 — `boot-coordinator.ts` (569 lines, under the 700 soft ceiling)
keeps every import `import type` (confirmed: `IStateStorage`,
`BackendReadiness`/`BootPhase`/`BootReadinessChangedPayload`,
`DiagnosticsHandle`, `ThothRuntimeRefs`, `GatewayService`, `GatewayChatBridge`,
`UpdateManager` are all type-only, `:46-56`), so the file stays loadable under
ts-jest with no Electron runtime as its own header promises. The local
`BootReadiness` type is fully replaced by `BackendReadiness` — no alias or
re-export left behind (confirmed: the file's own comment at `:58-71`
documents the removal and gives the reason, and a grep for a local
`BootReadiness` type declaration in the file finds none). `setPhase` is
edge-triggered (`:295-300`) and every emit path is wrapped in
`try/catch`/`.catch` so a broadcast failure cannot propagate into the boot
critical path (`:302-314`, mirrored in `boot-readiness-broadcaster.ts:43-65`).
The four phase anchors in `boot-heavy-services.ts` land at exactly the lines
the plan specified (`database` before `bootThothRuntime`, `harness` after
`markPersistenceSettled`, `sessions` before `scanAndImport`, `index` before
`startThothCron`), and no `skills` phase was added, matching the stated reason
that `thoth-runtime` must not know a renderer exists. `post-window.ts:109-115`
carries an explicit comment explaining the `once` → `on` change and stating
that it is a best-effort replay, not a substitute for the `boot:getReadiness`
pull — the "why" a reviewer needs is right there, not left to be inferred from
the diff. `bootstrapElectron`'s new `Pick<BootCoordinator, 'snapshot'>`
parameter (`bootstrap.ts:129`) is a defensible narrowing over the alternative
the report names (wiring the registration into `wire-runtime.ts` instead,
which already holds the coordinator) — narrowing the constructor dependency to
exactly the one method used is consistent with the same narrowing already
done in `electron-boot-readiness.ts:27-29`, and the report's stated
alternative would have moved a platform-adapter registration out of the one
file that owns every other one. Question 1 above notes the maintenance cost of
this choice; it is not treated as a defect here because the alternative traded
one coupling for a worse one. `boot-order.spec.ts`'s new "boot phase sequence"
describe drives the phases through the real coordinator and asserts the exact
sequence with no timing dependency (`:550-560`), matching the acceptance
criterion precisely.

## Pattern compliance

| Repository rule or nearby convention                                                                | Status            | Evidence                                                                                                                  |
| --------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `platform-core` stays a leaf; only type-only import from `libs/shared`                              | PASS              | `boot-readiness.interface.ts:20`; grep confirms no other new import into `platform-core` from a backend lib               |
| `I`-prefixed port name                                                                              | PASS              | `IBootReadinessProvider`                                                                                                  |
| `Symbol.for(...)` UPPER_SNAKE token, documented in `SESSION_ATTACHMENT_GUARD` shape                 | PASS              | `platform-core/src/di/tokens.ts:115-121`                                                                                  |
| Null adapter in `vscode-core` with `if (!isRegistered)` idiom                                       | PASS              | `register-platform-agnostic.ts:85-90`                                                                                     |
| Electron adapter under `services/platform/`, `{platform}-{capability}.ts`                           | PASS              | `apps/ptah-electron/src/services/platform/electron-boot-readiness.ts`                                                     |
| `thoth-runtime` imports no `electron`/renderer type                                                 | PASS              | `activity-emitter.ts`, `start-thoth-cron.ts` diffs add no such import; `JobHandler` import is type-only                   |
| RPC handler class name ends `RpcHandlers`, file `*.handlers.ts` + `*.schema.ts`                     | PASS              | `BootRpcHandlers`, `boot-rpc.handlers.ts`, `boot-rpc.schema.ts`                                                           |
| `static readonly METHODS … as const satisfies readonly RpcMethodName[]`                             | PASS              | `boot-rpc.handlers.ts:43-45`                                                                                              |
| Manifest entry shape + barrel exports                                                               | PASS              | `manifest.ts:135-139` (ordering aside, see Minor); `handlers/index.ts:12`; `rpc-handlers/src/index.ts:20`                 |
| `export type` for result re-export                                                                  | PASS              | `boot-rpc.handlers.ts:39`                                                                                                 |
| `rpc.types.ts` hunks match Batch 1's deferred text verbatim                                         | PASS              | Diff compared line-for-line against `batch-1-lane-C-report.md`'s quoted blocks                                            |
| `'boot:'` in `ALLOWED_METHOD_PREFIXES`, in sync with `RpcMethodName`                                | PASS              | `rpc-handler.ts:90`                                                                                                       |
| Zod `.strict()` on the empty-params schema                                                          | PASS              | `boot-rpc.schema.ts:14`                                                                                                   |
| `catch (error: unknown)` throughout                                                                 | PASS              | consistent across all reviewed files                                                                                      |
| No `@ts-ignore`                                                                                     | PASS              | none found in any file in scope                                                                                           |
| `BootCoordinator` — every import `import type`, no runtime import                                   | PASS              | `boot-coordinator.ts:46-56`                                                                                               |
| Local `BootReadiness` replaced by `BackendReadiness`, no alias left behind                          | PASS              | `boot-coordinator.ts:58-71` (comment + removal), no local declaration found                                               |
| File size ceiling — `boot-coordinator.ts` 569 lines                                                 | PASS              | under the 700 soft ceiling                                                                                                |
| Specs assert call counts/sequence, not wall-clock timing (new "phase state"/"boot phase" describes) | PASS              | `boot-coordinator.spec.ts:434-556`, `boot-order.spec.ts:520-582` — no `setTimeout`/fake-timer advance in either new block |
| `post-window.ts` comment explains `once` → `on`                                                     | PASS              | `post-window.ts:109-115`                                                                                                  |
| Prettier applied                                                                                    | PASS (per report) | `batch-3-report.md`'s verification table records `npx prettier --write` run over every touched file                       |
| Import/manifest entries alphabetically ordered                                                      | FAIL (cosmetic)   | `manifest.ts:29-31,123-144` — `boot` out of order (see Minor issues)                                                      |

## Maintenance debt

- Introduced: one new port + two host adapters (Electron real, vscode-core
  null) with symmetric DI wiring; one new RPC namespace with the full
  four-site dual registration; `BootCoordinator` gained a phase-state machine
  (~100 lines) and a paired broadcaster file; a second lazy-broadcast helper
  in `thoth-runtime` structurally identical to the Electron one; three cron
  handlers wrapped to emit activity events.
- Retired: the app-local `BootReadiness` type (fully replaced, no dead alias);
  `once('did-finish-load')` (replaced by `on`, with the old single-fire
  behavior's limitation now documented rather than silently changed).
- Net: a proportionate addition for a four-component batch — one port, one RPC
  namespace, one state machine, one activity channel — with two small,
  named-and-reasoned IOUs (the manifest ordering, the un-cross-referenced
  `emit` parameter) and one worth-a-look-later observation (the two
  lazy-broadcast helpers) rather than any unreasoned shortcut.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking or serious; the manifest/import ordering slip in
  `manifest.ts` is the only place this batch visibly deviates from an
  established repo convention, and it has no functional effect.
- What a 10/10 version would do differently: alphabetize the `boot` import and
  manifest entry in `manifest.ts` to sit between `autocomplete` and `chat`;
  add a one-line comment at `registerSkillDrainJobs`/`registerIntegrityCheckJob`'s
  new `emit` parameter pointing at `activity-emitter.ts`'s header; extract the
  shared lazy-resolve-and-swallow mechanics of `boot-readiness-broadcaster.ts`
  and `activity-emitter.ts` into one generic helper in `vscode-core`, taking
  the message type and payload as parameters, so the swallow/log wording and
  the `isRegistered` guard have one definition instead of two hand-kept copies.

## Batch 4

## Summary

| Metric          | Value                                                                                                                               |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Overall score   | 8/10                                                                                                                                |
| Assessment      | APPROVED                                                                                                                            |
| Blocking issues | 0                                                                                                                                   |
| Serious issues  | 0                                                                                                                                   |
| Minor issues    | 2                                                                                                                                   |
| Files reviewed  | 21 (exact Batch 4 scope: `core` 5, `chat-ui` 8, `chat` 3, `apps/ptah-extension-webview` 4, plus the two skeleton-widget swap sites) |

Scope confirmed against `batch-4-report.md` and the exact file list in this
prompt; every file was read in full, not diffed against a base I do not have in
this context. `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/{plugin-status-widget,setup-status-widget}.component.ts`
were read whole to confirm the skeleton swap changed nothing else.

## Five style questions

### 1. What breaks in six months?

Two independent phase-label vocabularies now exist for the same `BootPhase`
union: `BOOT_STEPS` in `libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts:30-36`
(five entries, `'settled'` deliberately absent) and `BOOT_PHASE_LABELS` in
`libs/frontend/core/src/lib/services/back-office-activity.service.ts:83-90`
(six entries, `'settled'` present because the ticker's `mapBootReadiness`
early-returns on it at `:303` before the label would ever be read). The wording
overlaps almost exactly ("Opening the database" vs "Opening the database") but
is independently typed twice, in two different libs, with no comment on either
side pointing at the other. `BootPhase` is a six-member closed union
(`rpc-readiness.types.ts`), so a seventh phase is unlikely, but the next
person who renames a phase's label for one surface (say, changing "Syncing the
agent harness" to something else for the boot screen) has no signal that the
ticker's fallback text for the same phase now reads differently, and no test
in either file would catch the drift because each asserts only its own
component's output.

### 2. What would a new team member misread?

`app.html:6-23`'s `@if`/`@else` nesting is written as a single dense paragraph
(no line break between `@if (bootStatus.isBlockingBoot()) {` and the template
markup, and the closing `} }` on its own line at `:23`) rather than the
line-per-branch shape control-flow blocks take elsewhere in this app (e.g.
`app-shell.component.html:345-349`'s `@empty { @if (bootStatus.isBooting()) {`
is similarly compressed, but every other multi-branch `@if` in the same file,
such as `:686-702`, breaks each branch onto its own line). A reader scanning
`app.html` for the boot-screen condition has to un-flow two nested `{ }` pairs
sharing one line before finding it. This is a formatting artifact, not a logic
problem (the report states Prettier was run on every touched file, and this is
Prettier's html-in-inline-template default for short branches), so it is noted
as a minor readability tax rather than a defect.

### 3. What does this cost to maintain?

Very little beyond what the two new services already carry. `BootStatusService`
and `BackOfficeActivityService` (`libs/frontend/core/src/lib/services/boot-status.service.ts`,
`back-office-activity.service.ts`) both implement the same `MessageHandler`
shape, both leave a safe default on every failure path, and both are
independently good citizens of the "signal-first, no `BehaviorSubject`" rule
this lib documents (`libs/frontend/core/CLAUDE.md:47,69`). The one recurring
cost is the phase-label duplication in Question 1 — two hand-kept vocabularies
for one six-member union is a small, bounded liability, not a growing one,
because the union itself does not grow casually (it is the wire contract for
an Electron `BootCoordinator` state machine reviewed in Batch 3).

### 4. Where is this inconsistent with the rest of the repository?

Nowhere material. `ActivityItem` living in `libs/frontend/core` and being
imported by `chat-ui`'s `activity-ticker.component.ts:13` with `import type`
is the one boundary-shaped choice this batch makes, and it holds up against
both the tag rules and the lib's own stated shape: `chat-ui` is tagged
`scope:webview, type:feature` (`libs/frontend/chat-ui/project.json:7`), `core`
is `scope:webview, type:core` (`libs/frontend/core/project.json:7`), and
`eslint.config.mjs:227-236` permits `type:feature → type:core` while
`:249-252` forbids the reverse (`type:core` may only depend on `type:core`,
`type:util`) — so `core` structurally cannot import back from `chat-ui` and no
cycle is possible, confirmed independently of the report's own D-3 reasoning.
It also matches the existing pattern of a `core` service exporting its own
display-shaped type beside itself (`ThemeName`/`ThemeInfo` beside
`ThemeService`, `AgentSuggestion` beside `AgentDiscoveryFacade` — both in the
same barrel, `services/index.ts:11-14,39-41`), so `ActivityItem` beside
`BackOfficeActivityService` (`services/index.ts:50-56`) is the established
shape, not a new one.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have hoisted `BOOT_PHASE_LABELS`/`BOOT_STEPS`'s shared five labels into
one `Record<BootPhase, string>` exported from `@ptah-extension/shared` beside
`BootPhase` itself, with the boot screen consuming it for `label` and the
ticker consuming it for the fallback, each keeping their own list of _which_
phases they show (`'settled'` omitted vs included) but not their own wording
for the phases they share. That removes the one place this batch could drift
without a test noticing, at the cost of one export in a lib both `core` and
`chat-ui` already depend on (`libs/shared`) — cheaper than the two independent
copies it replaces.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `libs/frontend/chat-ui/src/lib/molecules/boot-progress/boot-progress.component.ts:30-36`
  and `libs/frontend/core/src/lib/services/back-office-activity.service.ts:83-90`
  — two independently-typed `BootPhase → string` label maps with overlapping
  but not identical membership and no cross-reference comment. Not a defect
  today (the wording still agrees), but the next label change on either side
  has no signal that it should be mirrored, and no test spans both files.
- `apps/ptah-extension-webview/src/app/app.html:6-23` — the boot-screen
  `@if`/`@else` nesting is compressed onto shared lines rather than one branch
  per line, unlike most multi-branch `@if` blocks elsewhere in the same
  component (e.g. `:26-31`, `:34-48`, which are each cleanly one statement per
  line). Cosmetic; Prettier-produced, not hand-written, and does not change
  what the block does.

## File-by-file

### `libs/frontend/core/src/lib/services/{boot-status.service.ts,boot-status.service.spec.ts}`

Score 9/10 — 0 blocking, 0 serious, 0 minor specific to this file.
`providedIn: 'root'`, `implements MessageHandler` with exactly
`handledMessageTypes`/`handleMessage` (`:58,62-64,121-127`), matching the
lib's documented pattern (`vec-embedder-recovery.service.ts` precedent cited
in `batches.md:773-775`). The `ready`/`settled` default
(`READY_DEFAULT`, `:51-55`) is signal-first with a header comment
(`:15-21`) that states the load-bearing reason precisely: the same bundle
runs in VS Code, which never emits `boot:readinessChanged`, so a `warming`
default would hang that host forever. Every degrade path — rejected pull
(`:141-144`), unsuccessful pull (`:138`), malformed push
(`toReadinessSnapshot`, `:148-171`, narrowing with the shared `isBackendReadiness`/`isBootPhase`
guards rather than hand-rolled checks) — provably leaves the default in place,
each with its own spec case. The constructor pull is gated on a **snapshot**
read of `VSCodeService.isElectron` (`:110-113`), not a reactive one, with a
comment pointing at the `app.ts:47` idiom it copies — checked, and `app.ts:56`
does the identical `signal(this.vscodeService.isElectron)` snapshot. The
`pushSeen` latch (`:107,125,137`) correctly resolves the "late pull vs. fresh
push" race and is the one behaviour with a dedicated spec case
(`boot-status.service.spec.ts:108-136`) that actually races a pending promise
against a synchronous push rather than asserting the two paths in isolation.
19 tests, all state/call-count based (`spec.ts:226-244`'s two elapsed-time
cases mock `Date.now` rather than waiting on a real clock).

### `libs/frontend/core/src/lib/services/{back-office-activity.service.ts,back-office-activity.service.spec.ts}`

Score 8/10 — `@ptah-extension/shared` is the only import source
(confirmed: no `ClaudeRpcService`, no `VSCodeService`, no backend package
anywhere in the file), matching the "no RPC, no backend import" requirement
exactly. Coalescing is a correctly-scoped mutation of the head slot only
(`push`, `:181-204`), keyed on `` `${source}:${kind}` `` against a
sliding window (`headArrivalAt` is reset on every arrival, not fixed at the
first one, so a steady stream of sub-750ms updates keeps coalescing
indefinitely rather than stopping after one window — this is the correct
"latest wins" reading of the requirement, not the "one replace per window"
alternative). `mapVecStatus`/`mapEmbedderStatus` are the only two mappers that
are instance methods rather than the pure `(payload) => ActivityItem | null`
functions the header comment (`:153`) describes, because they need
`isNewStatus`'s per-key fingerprint memory (`:210-214`) — a deliberate,
minimal exception scoped to exactly the two message types that need
re-broadcast suppression, not a drift from the stated shape. Skill-synthesis
phrasing is reused verbatim from `skill-synthesis-live.service.ts` rather than
re-invented, with a comment saying exactly why (`:381-385`). Deducted one
point jointly with the sibling file for the un-cross-referenced phase-label
duplication (Minor issues).

### `libs/frontend/core/src/lib/services/index.ts`

Score 9/10 — both services and all four re-exports (`ACTIVITY_RING_CAPACITY`,
`ACTIVITY_COALESCE_WINDOW_MS`, `ACTIVITY_IDLE_AFTER_MS`, `type ActivityItem`)
land in the same grouped-named-export idiom every other service in the barrel
uses (`:49-56` vs. `:38-45` for the discovery facades immediately above).

### `libs/frontend/chat-ui/src/lib/atoms/skeleton-block.component.ts`

Score 9/10 — genuinely presentational: `input()` only, no injection, no
timer, `aria-hidden="true"` on the whole block (correct — it is a loading
placeholder, not content a screen reader should announce). The extraction is
justified by real duplication (`plugin-status-widget.component.ts`,
`setup-status-widget.component.ts` each carried the identical markup before
this batch, confirmed by reading both — the diff in each is exactly the
inline skeleton block replaced by `<ptah-skeleton-block>` with the two width
classes promoted to inputs, nothing else touched). Five inputs is a
reasonable ceiling for "how many rows, with or without an avatar/action, what
width" — not over-configured for the two existing sites plus this batch's two
new ones (session sidebar, canvas region).

### `libs/frontend/chat-ui/src/lib/molecules/boot-progress/{boot-progress.component.ts,boot-progress.component.spec.ts}`

Score 8/10 — inputs only (`phase`, `readiness`, `startedAt`, `detail`, all
`input.required` except `detail`), no service injection, matching the
`chat-ui` presentational rule (`chat-ui/CLAUDE.md` guideline 1) exactly.
`role="status" aria-live="polite"` on the root (`:49-50`); the phase list is a
real `<ol>`/`<li>` (`:63-103`), not styled `<div>`s; an unknown phase degrades
to "Starting" with everything pending (`currentIndex === -1`, `:158-167`) per
the validation note in `batches.md:857-864`; the elapsed clock is a `DestroyRef`-cleared
interval (`:199-204`) exactly the shape `back-office-activity.service.ts`
uses for its own idle clock — two instances of the same idiom, not two
inventions. `text-base-content-muted` used throughout for the non-headline
text tiers (`:72,107,113,174`), with the sole exception of
`bg-base-content/30` on the pending-step dot (`:96`) — a background, not a
text color, so it is not what the ratchet spec (`no-alpha-base-content.spec.ts`,
per D-5) checks, and the distinction is correctly drawn. `prefers-reduced-motion`
kills the spin animation (`:136-140`). Deducted one point jointly with the
sibling activity-service file for the un-cross-referenced phase-label
duplication.

### `libs/frontend/chat-ui/src/lib/molecules/activity-ticker/{activity-ticker.component.ts,activity-ticker.component.spec.ts}`

Score 9/10 — `input.required` for `items`/`idle`, `input` with a default for
`rotateMs`, `output<void>()` for `activate` — the exact IO shape
`batches.md:902-904` specifies. No service injection. The `effect()` at
`:150-155` is scoped tightly to the one thing it needs to do (reset the
rotation index when the head **id** changes, not on every items() mutation),
reads `untracked` correctly to avoid re-triggering itself off the write it
makes, and is justified by a spec case that specifically proves a coalesced
in-place update does NOT reset the index (`activity-ticker.component.spec.ts:86-98`)
— the one case that would catch a naive "reset whenever items() changes"
mistake. The second `effect()` (`:159-163`) re-arming the timer when
`rotateMs()` changes, clearing the previous one first, is the correct pattern
for a reactively-configurable interval and is exercised by the "does not
rotate a single item" and "clears its rotation timer on destroy" cases. CSS-only
animation with a `prefers-reduced-motion` block (`:104-108`); `no-drag` is
present at both the outer `role="status"` div (`:54`) and the button
(`:61`) — belt and suspenders, matching the header row's convention that
every interactive child opts out of the macOS titlebar drag region. `max-w-[22rem]
truncate` present (`:61`). An empty summary correctly falls back to
`SOURCE_LABELS[item.source] ?? item.source` (`:135-140`), covering both the
known-source and an unrecognised-source case, with a spec proving the known
case only (`:100-104`) — a small, harmless gap, not counted as a finding
since the unknown-source fallback is a defensive default rather than a stated
requirement.

### `libs/frontend/chat-ui/src/index.ts`, `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/{plugin-status-widget,setup-status-widget}.component.ts`

Score 9/10 — barrel additions (`SkeletonBlockComponent`, `BootProgressComponent`,
`ActivityTickerComponent`) grouped with their neighbours, no reordering of
unrelated exports. Both widget files' only change is the skeleton swap
(`plugin-status-widget.component.ts:32,38-42`, `setup-status-widget.component.ts:42,48-52`);
their pre-existing service injection (`PluginCatalogService`, `ClaudeRpcService`)
is untouched and is the lib's own documented, named exception to the
no-service rule (`chat-ui/CLAUDE.md` guideline 1: "The `setup-plugins/`
molecules are the standing exception... Do not widen it"), which this batch
correctly does not widen — the two new components (skeleton, boot-progress,
ticker) all stay in the general no-injection rule.

### `libs/frontend/chat/src/lib/components/templates/{app-shell.component.html,app-shell.component.ts,electron-shell.component.ts}`

Score 8/10 — `app-shell.component.ts` injects `BootStatusService` and imports
`SkeletonBlockComponent` (D-4's necessary but unlisted file), consistent with
`chat/CLAUDE.md` guideline 2 ("If a new component injects... any service, it
stays here" — `chat`, not `chat-ui`). The two skeleton sites in
`app-shell.component.html` are exactly the two named in the plan (session
list `@empty`, `:345-355`; canvas `@else`, `:686-702`), each with a comment
stating why a skeleton is honest where the old copy or spinner was not.
`electron-shell.component.ts` places `<ptah-activity-ticker>` inside the
existing right-hand `no-drag` group immediately before `<ptah-theme-toggle />`
(`:212-221`, confirmed byte-for-byte against the plan's instruction), reuses
`openThoth()` including its `thothFirstRunDismissed` side effect
(`:353-356`) rather than duplicating navigation, and the header row's `h-10`
class is unchanged (`:93`, confirmed identical to the pre-batch anchor
`batches.md:51`). Scored with the sibling `.html` file below for the one
formatting minor.

### `apps/ptah-extension-webview/src/app/{app.html,app.ts,app.config.ts,thoth-message-routing.spec.ts}`

Score 8/10 — `app.ts` injects `BootStatusService` at the same `inject()` site
as every other service (`:53`), folds `hasFailed()` into the existing
`hasError` computed (`:64-67`) rather than adding a parallel error surface,
and `errorMessage()` (`:74-79`) prefers the host's boot `detail` with a
sensible fallback string. `app.config.ts` registers both services on
`MESSAGE_HANDLERS` with `useExisting`/`multi: true` in the exact idiom every
other handler in the file uses (`:252-260`), and the comment there states
correctly why registering `BootStatusService` for the VS Code host too is
safe (the `ready` default). `thoth-message-routing.spec.ts` adds
`BackOfficeActivityService` to the mirrored provider list and a case that
posts a genuine `window` `MessageEvent` with the literal `'activity:event'`
string through the real router (`:252-260`+), which is the stronger version
of a router test — it proves the wire string, not just the constant, is
correctly wired. Deducted one point for the `app.html` formatting minor
(shared with the `app-shell.component.html` note above).

## Pattern compliance

| Repository rule or nearby convention                                                                                              | Status          | Evidence                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OnPush` on every new component                                                                                                   | PASS            | `skeleton-block.component.ts:22`, `boot-progress.component.ts:45`, `activity-ticker.component.ts:51`                                                                  |
| `input`/`input.required`/`output` signal APIs, no `@Input`/`@Output`                                                              | PASS            | all three new `chat-ui` components                                                                                                                                    |
| No service injection in `chat-ui` atoms/molecules (outside the named exception)                                                   | PASS            | `skeleton-block.component.ts`, `boot-progress.component.ts`, `activity-ticker.component.ts` — none inject; `setup-plugins/*` keep their pre-existing, named exception |
| `MessageHandler` = `{ handledMessageTypes; handleMessage }`, not `messageType`/`handle`                                           | PASS            | `boot-status.service.ts:62-64,121`, `back-office-activity.service.ts:102-113,148`                                                                                     |
| Registration via `MESSAGE_HANDLERS` multi `useExisting`                                                                           | PASS            | `app.config.ts:252-260`                                                                                                                                               |
| Signal-first, no `BehaviorSubject`                                                                                                | PASS            | both new services and all three new components                                                                                                                        |
| `DestroyRef` for timers                                                                                                           | PASS            | `back-office-activity.service.ts:100,141-146`, `boot-progress.component.ts:145,199-204`, `activity-ticker.component.ts:113,165`                                       |
| `effect()` used sparingly, each justified                                                                                         | PASS            | `activity-ticker.component.ts:150-163`, both scoped and spec-pinned                                                                                                   |
| `chat-ui` → `core` import direction (`scope:webview`→`scope:shared\|scope:webview`, `type:feature`→`type:core`), no reverse cycle | PASS            | `eslint.config.mjs:127-129,227-236,249-252`; `activity-ticker.component.ts:13`                                                                                        |
| No `[innerHTML]` on AI markdown                                                                                                   | PASS            | none of the new files render markdown                                                                                                                                 |
| `text-base-content-muted` in place of the alpha ladder                                                                            | PASS            | `boot-progress.component.ts:72,107,113,174` (D-5); `bg-base-content/30` correctly exempt (background, not text)                                                       |
| Tailwind + daisyui only, no inline `style="..."`                                                                                  | PASS            | all three new components use class bindings; the two `styles: […]` blocks are keyframes/media queries, not inline styles                                              |
| `role="status"`/`aria-live`/`aria-atomic`                                                                                         | PASS            | `boot-progress.component.ts:49-50`, `activity-ticker.component.ts:55-57`                                                                                              |
| `no-drag` on interactive header children                                                                                          | PASS            | `activity-ticker.component.ts:54,61`; header group `electron-shell.component.ts:212`                                                                                  |
| Header `h-10` unchanged                                                                                                           | PASS            | `electron-shell.component.ts:93`                                                                                                                                      |
| Naming: kebab-case files, `*.component.ts`, atoms flat / molecules grouped                                                        | PASS            | `atoms/skeleton-block.component.ts`; `molecules/boot-progress/`, `molecules/activity-ticker/` match `molecules/agent-card/` etc.                                      |
| Barrel exports grouped with neighbours                                                                                            | PASS            | `chat-ui/src/index.ts:17,33-34`; `core/services/index.ts:49-56`                                                                                                       |
| No new `chat-ui` external dependency                                                                                              | PASS            | animation is CSS-only; no package added (confirmed against the report's own claim, no `package.json` diff in scope)                                                   |
| Coverage floor (`core`)                                                                                                           | PASS            | report cites 97.44/88.67/100/97.59 % against the 85/75/75/85 floor for the two new service files                                                                      |
| Fake timers / call-count specs, no wall-clock                                                                                     | PASS            | `boot-status.service.spec.ts:226-244` mocks `Date.now`; `activity-ticker.component.spec.ts` uses `jest.useFakeTimers()` throughout                                    |
| One phase-label vocabulary per union member                                                                                       | FAIL (cosmetic) | `boot-progress.component.ts:30-36` vs `back-office-activity.service.ts:83-90` (see Minor issues)                                                                      |

## Maintenance debt

- Introduced: two new `core` services (signal-first, `MessageHandler`-shaped,
  fully spec'd) with symmetric barrel and `MESSAGE_HANDLERS` wiring; one
  extracted presentational atom removing a two-site duplication and pre-empting
  a third and fourth; two new presentational molecules; two small template
  edits reusing the new atom; one header-row wiring addition reusing an
  existing navigation method. A second, independently-typed copy of the
  boot-phase label vocabulary (small, bounded, not evidence of a pattern that
  will repeat, since `BootPhase` is a closed six-member union owned by an
  already-reviewed wire contract).
- Retired: two duplicated skeleton-markup blocks (`plugin-status-widget.component.ts`,
  `setup-status-widget.component.ts`); a boot experience that was a bare
  spinner with no stage information.
- Net: a proportionate, well-bounded addition for a four-component batch — one
  push/pull service, one coalescing sink service, one extracted atom, two new
  molecules — with one named, low-cost duplication (the phase labels) and one
  cosmetic template-formatting note, neither blocking.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: none blocking or serious; the two independently-typed
  `BootPhase → string` label maps (`boot-progress.component.ts:30-36`,
  `back-office-activity.service.ts:83-90`) are the one place a future edit
  could silently drift without either file's own tests catching it.
- What a 10/10 version would do differently: hoist the shared phase labels
  into one `Record<BootPhase, string>` exported from `@ptah-extension/shared`
  so the boot screen and the ticker consume one wording and only diverge on
  which phases they choose to show; reformat `app.html:6-23`'s nested
  `@if`/`@else` onto one branch per line to match the rest of the file's
  control-flow style.
