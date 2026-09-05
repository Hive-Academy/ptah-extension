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
