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
