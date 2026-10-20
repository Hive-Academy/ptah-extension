# Code Logic Review - TASK_2026_662 Phase C (`78b5d7b9a..HEAD`, excluding `.ptah`)

Reviewer: Claude (code-logic-reviewer). Read-only. No tests run (no scoped Jest run was needed; findings are from source reading of the files named below).

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 5              |
| Minor issues        | 6              |
| Failure modes found | 9              |

Score band: 7 means sound with real but bounded gaps. Nothing found loses user-authored data or breaks a retained Library flow. The 7 (not 8-9) is because the persisted pipeline cron jobs keep firing with no handler (S1), and several user-visible behaviours were removed with no recorded decision (M1, M2).

Scope examined: grade store, harvester, extractor, scorecard, enhancer, catalog, trigger service, rpc handler call sites, thoth-runtime (`boot-thoth-runtime`, `start-thoth-cron`, `memory-retention-job`, `types`), cli-engine `thoth-runtime`, Electron boot/shutdown/DI/plugin-activation/tray/ipc-bridge, mirror write path, `scripts/export-skill-pipeline-archive.ts`, `skill-pipeline-archive.ts`, `candidate-row-diff.ts`, frontend providers state/commit, routing map, back-office activity, Skills tab, `PendingSettingsTab`, `app.config.ts`. The huge spec deletions and docs were not reviewed line by line.

## Five logic questions

### 1. How does this fail silently?

- Spec grades are pruned without any log line. `SkillTaskGradeStore.removeAbsent` now deletes every non-`spec:` grade of a task that is not in the keep list, including when the keep list is empty (`skill-task-grade.store.ts:172-184`; the old `if (keys.length === 0) return;` guard is gone). A re-harvest (spec digest changed) after the registry row or the invocation events for an attributed slug are gone silently drops that task's grades (`spec-harvester.service.ts:176-181`, call at `:194` region). See M4.
- Grade write failure is capped at 3 attempts per digest and then skipped for the rest of the process with no warning at the cap (`spec-harvester.service.ts:134-145`). The per-failure warn exists (`writeGrades` catch), the "giving up" is invisible. Minor.
- Harvest errors from the trigger are logged at `debug` only (`skill-trigger.service.ts` `fireHarvest`, the catch). Pre-existing, but now the only observer of a failing harvest.
- Orphaned pipeline cron jobs fail loudly in run history, not silently (S1).

### 2. What user action produces unexpected behaviour?

- User with `skillSynthesis.trayKeepalive` on: the app now stays alive with no windows for no skills work (O30d, user-reserved, recorded).
- User who relied on the Skills tab "Specs" panel (manual harvest, list, clear stale specs) no longer has any UI for it; backend RPCs remain (`skill-synthesis-rpc.service.ts:861-891`, state service `:698-725` are now unreferenced by the tab, which is 155 lines, `skill-synthesis-tab.component.ts`). No decision records this removal (M1).
- User with promoted skills that were "dormant" (residency budget) will see them propagated again into `.claude/skills/` after upgrade (M2).
- Upstream fast-forward of an unmodified clone no longer snapshots, so "revert" cannot go back to the previous upstream version (intended per Batch 49; see M3 for the partial-copy edge).

### 3. What input data produces a wrong answer?

- Review files with a conditional approval ("Recommendation: APPROVE with minor changes", "Status: passed with failures") parse as `pass` since the verdict regex now captures only the first word plus an optional `revision` (`spec-extractor.ts:108`, terminalVerdict `:76-82`). The spec pins the APPROVE case as intended (`spec-extractor.spec.ts:62`). "Status: Passed, but ..." also becomes a pass grade that feeds the success rate. Minor, accepted trade-off but worth a note in the docs.
- Grades whose `workspace_root` differs in form from `getWorkspaceRoot()` (for example SDK `cwd` pointing at a sub-folder or worktree, versus the folder the user opened) would not match on read. Both sides go through `normalizeWorkspaceRoot` (`skill-task-grade.store.ts:128,135,174,195,212`), which handles case and slashes only. Not a defect for the usual case; it would show "No grade" for sub-folder runs. Minor.
- Null/empty root: `workspace_root = NULL` binds no row, so "No grade" (`:193-199`, `:211-216`). Correct per U2.

### 4. What happens when a dependency fails?

- SQLite not open in the CLI tier: `startSkillTrigger` registers hooks whenever the token resolves (`cli-engine/.../thoth-runtime.ts` new `startSkillTrigger`), no longer gated on a started synthesis service that opened the DB. Every tool-use hook then logs a `recordInvocation failed` warn (`skill-trigger.service.ts` recordInvocation catch). Log noise only, no crash. Minor (F8).
- `CRON_POWER_MONITOR` not registered: the retention handler returns `skipped / retention-service-unavailable` on every hourly tick (`memory-retention-job.ts:73-85`), visible in run history. Acceptable.
- Mid-copy failure during an upstream fast-forward: see M3.
- Archive export script with sqlite-vec unloadable: throws before export (good, `export-skill-pipeline-archive.ts:44-48`).

### 5. What is missing that the requirements never mentioned?

- Cleanup of the four persisted `scheduled_jobs` rows before 0057 (S1).
- A log line when grades are pruned (M4).
- A receipt field that binds the archive to the source DB (hash/size/mtime) (F9).
- Migration of the old `skillSynthesis.triggers.skillInvocationTelemetry.enabled` value is present (`file-settings-manager.ts:48-56`), so removing the fallback in `skill-trigger.service.ts:277-282` is safe. Verified, not a finding.

## Failure modes

### F1 Orphaned pipeline cron jobs
- Trigger: any existing profile has `@ptah/skills-drain-frequent|nightly|weekly` and `@ptah/skills-backlog-cleanup` in `scheduled_jobs` (written by the old `registerSkillDrainJobs`/`registerSkillBacklogCleanupJob`). Phase C removes the handler registration (`start-thoth-cron.ts`, `cli-engine/.../thoth-runtime.ts`, deleted `skill-drain-jobs.ts`, `skill-backlog-cleanup-job.ts`), nothing deletes the rows.
- Symptom: every tick (frequent slot every 15 minutes) `JobRunner.dispatch` throws `No handler registered under 'skills:drain:frequent'` (`cron-scheduler/src/lib/job-runner.ts:257`), producing failed `job_runs` rows indefinitely.
- Evidence: the cleanup is only planned in migration 0057 (`implementation-plan.md:128`), and batch 50/67 gaps (O34b) say the archive writer does not even export `scheduled_jobs`. No Phase C code deletes them.
- Recommendation: either guarantee Phase C never ships without 0057, or delete the four job ids from the job store at boot now (after the archive step for `job_runs`).

### F2 Grade pruning on empty attribution
- Trigger: re-harvest of a completed spec (digest changed) when its attributions come back empty or all skipped.
- Symptom: all non-`spec:` grades for that task and workspace deleted, success rates for the involved agents change retroactively.
- Evidence: `skill-task-grade.store.ts:172-184`, `spec-harvester.service.ts:176-181`.
- Handling: intentional per O32(a)/M2, no log. Recommendation: log count removed at info; skip prune when `findAttributions` returned zero rows and the task previously had grades only if the registry or events tables are unavailable.

### F3 Partial copy after upstream fast-forward
- Trigger: process exit or fs error between `clearCloneTrackedContent` and the end of `copyTree` (`user-layer-mirror.service.ts:1527-1529`, file variant `:1588-1589`).
- Symptom: clone content is partial, its hash no longer equals `sidecar.sourceHash`, so the next reconcile marks it `diverged` as if the user edited it (`markDivergedDir`, `:1532`). Before Batch 49 a history snapshot existed to restore from. User-authored content is not at risk (the clone was unmodified), upstream source still exists, and rebase/keep resolve it, but the user sees a false conflict.
- Recommendation: copy to a temp dir and swap, or keep the snapshot only when the copy fails.

### F4 Retention job foreground gate starts lazily
- Trigger: first hourly retention tick after process start.
- Symptom: `tracker.start()` is called inside the run (`memory-retention-job.ts:119-123`), so `msSinceLastActivity()` is `Infinity` for the first run. Previously the 15-minute drain slots started the tracker earlier. Retention may run during active use once per process.
- Recommendation: start the tracker at cron start or in boot.

### F5 Dormant promoted skills re-propagate
- Trigger: user had candidates with dormant status.
- Evidence: `phase-2-libraries.ts` removed the `readDormantSkillSlugs` fold-in (O30a). Registered decision exists, but the user-visible effect (previously suppressed skills return to the model's prompt) is not recorded as accepted.

### F6 Spec cleanup UI unreachable
- See M1.

### F7 Trigger shutdown ordering
- Verified OK. `refs.skillTrigger` is set at start in both tiers (`boot-thoth-runtime.ts` new block, `cli-engine thoth-runtime.ts` `startSkillTrigger`), `onSkillTriggerStarted` is still invoked (`boot-thoth-runtime.ts`, Electron `boot-heavy-services.ts:165-170`), `shutdown.ts:230` stop line removed with `refs.skillSynthesis`, and the CLI `disposeThoth` still stops the trigger. No reference to a removed service at quit. The unstarted `SkillSynthesisService` singleton is only resolved by RPC handlers (`register.ts:97,149`), which only call `readSettings()`.

### F8 CLI trigger without DB
- See Q4.

### F9 Archive receipt not bound to the source database
- Trigger: running `scripts/export-skill-pipeline-archive.ts`.
- Symptom: the copy-first and read-only discipline is correct (sidecar refusal `:20-23`, `COPYFILE_EXCL` `:31`, copy hash equality `:33-34`, readonly copy handle `:37`, source hash+size+mtime re-check after export `:55-58`). But the receipt (`skill-pipeline-archive.ts:77-88`) holds only `archivePath` and per-table digests, not the source DB hash, so the receipt cannot later prove which database it came from. The plan asks for a receipt keyed to DB identity (`implementation-plan.md:126`). The full DB copy `source-copy.sqlite` stays in the output root (`os.tmpdir()` by default); `chmod 0o700/0o600` are no-ops on Windows, so it relies on the default ACL.
- Minor. The default `archiveReceiptFile = 'pre-0057/receipt.json'` in `candidate-row-diff.ts` cannot match the real directory name (`pre-0057-` plus a `mkdtemp` suffix, `skill-pipeline-archive.ts:9,39`), so the default always fails with ENOENT unless the operator renames the folder; bench tooling only.

## Blocking issues

None.

## Serious issues

### S1 Persisted pipeline cron jobs keep firing with no handler
- File: `libs/backend/thoth-runtime/src/lib/start-thoth-cron.ts` (removed `registerSkillDrainJobs`/`registerSkillBacklogCleanupJob` calls), `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts` (removed same), `libs/backend/cron-scheduler/src/lib/job-runner.ts:257`.
- Scenario: any user who ran a pre-Phase-C build and upgrades to a build that has Phase C but not migration 0057.
- Impact: four jobs fail on every tick forever (up to 96 failed runs per day for the frequent drain), pollute cron history, may raise failure activity events.
- Fix: delete the four ids from the job store at cron start now (an idempotent `jobStore.remove` for each id, non-fatal), or gate Phase C release on 0057 and state that in batches.md. This is the only item that is a defect "now" rather than deferred.

## Moderate and minor issues

Moderate

- M1 Specs panel removed with no recorded decision. Old tab `ngOnInit` loaded specs (`git show 78b5d7b9a:...skill-synthesis-tab.component.ts:1028`), the new tab (`skill-synthesis-tab.component.ts:140-143`) does not; `harvestSpecs`/`clearStaleSpecs` UI paths are gone while the three RPCs remain. Auto-harvest on Stop still works (`skill-trigger.service.ts` `onStop` -> `scheduleHarvest`), so grades are fine, but archiving stale specs is no longer possible from the app. Record the decision or restore a minimal control.
- M2 Dormant-slug folding removed (`phase-2-libraries.ts:~246-253`, `plugin-activation.ts` deleted `readDormantSkillSlugs`). Intentional per O30(a) but the visible effect (F5) should be an explicit accepted decision.
- M3 Fast-forward without snapshot leaves a false `diverged` state on mid-copy failure (F3).
- M4 Grade prune silent and unconditional on empty keep list (F2).
- M5 Trigger now starts hooks regardless of SQLite state in the CLI tier, and the skills `onStarted` retry path is gone, so a DB that opens late never gets its trigger re-armed; the trigger is also never re-armed after a failed `skillTrigger.start()` (the catch sets `refs.skillTrigger = null`, `cli-engine thoth-runtime.ts` `startSkillTrigger`, and `boot-thoth-runtime.ts` new block). Start is synchronous and has no I/O, so the risk is low; moderate only because the old retry path existed for a reason.

Minor

- m1 `spec-harvester.service.ts:134-145`: the cap gives up silently; add a one-time warn when `attempts` reaches 3.
- m2 `skill-trigger.service.ts` `fireHarvest`: harvest failure at `debug`; raise to `warn`.
- m3 `spec-extractor.ts:108`: conditional approvals parse as pass (Q3).
- m4 `memory-retention-job.ts:119-123`: lazy tracker start (F4).
- m5 `scripts/export-skill-pipeline-archive.ts`: receipt lacks source identity and the temp DB copy stays on disk (F9).
- m6 `apps/ptah-cli/src/cli/router.ts`: the `ptah skill-synthesis` command group (including `invocations` and `stats`, which read retained telemetry) is deleted. If telemetry readers were meant to stay scriptable, this is drift; the ptah-cli gate was deferred to batch 59 (O33c), so nothing has typechecked that app since batch 42 other than the grep I ran (`apps/ptah-cli/src` has no remaining import of the removed command file).

## Data flow

1. Stop / SubagentStop / PostToolUse / PromptExpansion hook -> `SkillTriggerService` (`skill-trigger.service.ts:56-72`). OK; telemetry key read from `skills.telemetry.enabled` only (`:277-282`), migration covers the old key.
2. Invocation -> `recordInvocation` -> `SkillInvocationRecorder.recordSkillEvent`. OK, errors caught and warned.
3. Stop -> `scheduleHarvest` (90 s debounce per root) -> `SpecHarvesterService.harvest(root)`. OK; failure only at debug (m2).
4. `harvest` -> reconcile subagent events (guarded by marker) -> `writeGrades` -> `findAttributions` (root-filtered both sides) -> `upsert` (root normalised) -> `removeAbsent` (normalised). OK except F2.
5. Grades -> `SkillScorecardService.getInvocationStats/getScorecards/getWinRates/getScorecardDetail` with required root -> handler `agentScope() ?? null` at all call sites (`skills-synthesis-rpc.handlers.ts:1820,1865-1866,1906,2383`) and enhancer `resolveAgentScope() ?? null` (`skill-enhancer.service.ts:948`). OK. Verified there is no remaining call without the root (grep of `getInvocationStats|getScorecards|getWinRates|getScorecardDetail`).
6. Library: `listClones` -> `toCloneSummary` (stats read guarded, `:2381-2395`), `previewEnhancement` -> `generateProposal` (manual:true, pause check `skill-enhancer.service.ts:311-318`) -> `applyProposal` (write, `markEnhanced`, repropagate) -> `revertEnhancement`. OK. Provider/model/timeout come from `skills.enhancement.*` (`:745-763`), which the Providers UI writes (`providers-commit.service.ts` enhancement loop), so UI and backend agree. `minJudgeScore` still read via `synthesis.readSettings()` (recorded in O31a).
7. Boot: Electron `boot-thoth-runtime.ts` -> trigger start, `onSkillTriggerStarted` -> `refs.skillTrigger` -> shutdown stop. CLI `startSkillTrigger` -> `disposeThoth`. OK.
8. Cron: memory retention registered in both tiers with `createMemoryRetentionHandler` (`start-thoth-cron.ts:185-205`, `cli-engine thoth-runtime.ts:445-475`); `CRON_POWER_MONITOR` is resolved inside the handler (O29a restored). Legacy pipeline jobs remain in the store (S1).
9. Mirror: reconcile fast-forward writes without snapshot (`user-layer-mirror.service.ts:1527,1588`); user-edit/divergence paths, rebase, keep, revert still snapshot (those call sites were not touched by the diff, only the two fast-forward lines were removed). History readers are untouched.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Retained Library methods work | COMPLETE | `settings` source for `previewEnhancement` is transitional (O31a) |
| Invocation telemetry toggle, old fallback removed | COMPLETE | migration of the old key exists |
| Pause `skillSynthesis.enabled` | COMPLETE | gates `generateProposal`/RPC; harvest and telemetry continue while paused, as before |
| Spec harvest from task reviews | COMPLETE | Specs UI removed (M1) |
| Scorecards | COMPLETE | |
| U2 success rate per current workspace | COMPLETE | all callers pass root; null gives "No grade" |
| Task 44.2 verdict parse, retry cap, prune | PARTIAL | silent cap and prune (m1, M4) |
| Boot paths keep trigger and retention | COMPLETE | lazy tracker start (F4) |
| Batch 49 no snapshot on upstream-only fast-forward | COMPLETE | mid-copy edge (M3) |
| Batch 50 export script, copy-first | COMPLETE | receipt binding (F9) |
| Remove pipeline cron | PARTIAL | persisted jobs not removed (S1) |
| Frontend: Providers, routing map, activity, PendingSettingsTab | COMPLETE | `routing-background-more` removal is correct: only two roles feed the preview (`routing-map.component.ts:21-34`), matching U3 |

Implicit requirements not addressed: pipeline cron cleanup before 0057 (S1); decision record for Specs panel and dormant skills (M1, M2).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Null workspace root on grade read | YES | `workspace_root = NULL` matches nothing | none |
| Root with different case/slashes | YES | `normalizeWorkspaceRoot` on write, read, prune | sub-folder cwd not normalised to repo root |
| Same task id in two workspaces | YES | prune and attribution scoped by root | upsert key lacks root, but attribution keys are run/event ids, so no collision in practice |
| Grade write fails repeatedly | YES | cap 3 per digest, in-memory | silent cap; resets on restart |
| Re-harvest after event/registry loss | PARTIAL | prune removes grades | no log (F2) |
| Telemetry old key set to false | YES | migrated to new key | none |
| Paused skills with manual enhance | YES | `paused` skip reason, RPC asserts | none |
| App quit with trigger running | YES | `refs.skillTrigger.stop()` in both tiers | none |
| Persisted drain jobs after upgrade | NO | handlers gone, rows remain | S1 |
| Export script run against a live DB | YES | refuses WAL/journal sidecars, re-checks hash/mtime/size | a DB in rollback mode and open by the host could still change mid-copy; the post-check catches it |
| Upstream fast-forward interrupted | PARTIAL | no snapshot to recover | M3 |
| Hidden third routing role | YES | preview only has two roles | none |

## Orchestrator corrections O26-O34

- O27 (routing deep link, `assignments-heading`, role count 3): consistent with `orchestration-settings.component.ts:116,153,158`; no defect found. Note the routing map preview still lists two roles while Orchestration lists three (decision role); pre-existing.
- O29 (retention power-monitor double; `ARCHIVE_TABLES` import fix; `registerSkillSynthesisServices` kept): correct and necessary; the retention handler does resolve `CRON_POWER_MONITOR` (`memory-retention-job.ts:73-76`).
- O30 (deleting `readDormantSkillSlugs` instead of stubbing): right call; see M2 for the unrecorded user-visible effect.
- O31 (reverting the lane's `readEnhancementSettings`): correct, avoids reading keys batch 65 removes.
- O32 (assertion fix `skill-task-grade.store.spec.ts:121`): consistent with `removeAbsent` excluding `spec:%`.
- O33 (root threaded to handler and enhancer early): verified at all call sites; this prevented a universal "No grade".
- O34 (strictness edits to `skill-pipeline-archive.ts`): `entry === undefined` guard and `readUInt8` are behaviour-neutral for valid receipts, and now fail closed on a short table list.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (all findings are from reading the code and the git diff; no tests were run)
- Top risk: S1, the four persisted pipeline cron jobs keep running with no handler on every upgraded profile until migration 0057 lands.
- What a robust implementation would add: delete the four scheduled job rows at cron start (or hard-order 0057 before release); a warn when the grade write cap is reached and an info line with the prune count; swap-in copy (or retained snapshot on failure) for upstream fast-forward; a recorded decision for the Specs panel and dormant-skill removals; the source DB hash in the archive receipt; start the foreground tracker at cron start.
