# Code Logic Review, TASK_2026_662 Phase D (batches 57-61, Tasks 59.0, 61.0)

Review family: reviewer Claude (Sonnet 5.5); implementers were codex lanes; the orchestrator (Claude, same family as this reviewer) made the test-only corrections O39 (rpc-handlers spec cast, TUI `skills-library.ts`) and O41 (deleted two pipeline reachability specs). Those lines are weaker evidence and are labelled below.

Scope read: `git diff 298fd2591..fe68b99ec` (modified source, not the 51k deleted lines), whole files for `di/register.ts`, `skill-invocation-event.store.ts` (moved methods), `skill-scorecard.service.ts`, `spec-harvester.service.ts`, `lane-runner.service.ts` (constructor, `fail`, usage paths), `skills-synthesis-rpc.handlers.ts` (METHODS, constructor, listClones, getClone, previewEnhancement, pause guard), `skill-synthesis-state.service.ts`, TUI `SkillsPanel.tsx` and `skills-library.ts`, plus DI hosts and thoth-runtime. I did not run tests or builds (scoped gates are recorded as passed in O37-O42).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Verdict | REVISE |
| Blocking | 1 |
| Serious | 0 |
| Moderate | 3 |
| Minor | 5 |

One defect is on a kept capability: the enhancement preview never runs the judge. The rest of Phase D holds up. The DI, the Task 61.0 moves, the RPC contract, the frontend and the TUI check out. Score bands: 7-8 would apply if the preview settings were complete. 6 reflects one silently dead quality gate that the unit test pins as correct.

## Findings

### Blocking

**B1. `previewEnhancement` passes a partial settings object, so the judge is silently disabled**

- File: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:340-342` (consumer `libs/backend/skill-synthesis/src/lib/skill-judge.service.ts:165`).
- The handler builds `{ minJudgeScore: PREVIEW_MIN_JUDGE_SCORE } as SkillSynthesisSettings`. The cast hides that `judgeEnabled` is now `undefined`. The old code used `this.synthesis.readSettings()`, which returned the full object with `judgeEnabled` defaulting to true (`file-settings-keys.ts:607`).
- `SkillEnhancerService.generateProposal` (`skill-enhancer.service.ts:380-387`) passes that object to `SkillJudgeService.judge`. The judge's first line is `if (!settings.judgeEnabled) return disabled(...)`. The lane runner is never called.
- Result: `judgeScore` is null and `judgeReason` is the "disabled" text. A manual request passes the gate (`skill-enhancer.service.ts:416-418`: `decision.status !== 'scored' || scoredPass`). The user gets a draft with no quality score, and there is no error. The judge, the lane runner and `minJudgeScore` are all unreachable from the only kept path that uses them. The wiring is intact; the input disables it.
- It also drops the user's `judgeEnabled` setting, which O38(b) did not record. O38(b) covers only `minJudgeScore`.
- Evidence the test locks the bug in (weaker evidence, same family): `skills-synthesis-rpc.handlers.spec.ts:1650-1654` asserts `generateProposal` is called with exactly `{ minJudgeScore: 6 }`. `skill-enhancer.service.spec.ts:46` and `skill-judge.service.spec.ts:54` use `judgeEnabled: true`, so no spec covers the handler-to-judge seam.
- Fix: pass both fields from named constants or the settings defaults, for example `{ judgeEnabled: true, minJudgeScore: PREVIEW_MIN_JUDGE_SCORE }` (or read both via `workspaceProvider.getConfiguration` with `FILE_BASED_SETTINGS_DEFAULTS`, as `assertSkillsNotPaused` does). Update the spec assertion. Add one test that wires the real enhancer and judge with a recorded lane runner and asserts a non-null `judgeScore`.

### Serious

None.

### Moderate

- **M1. No test resolves the kept graph end to end.** `di/register.spec.ts:44` checks `isRegistered` for the kept tokens. The Electron and CLI smoke specs call `registerSkillSynthesisServices` (`container.smoke.spec.ts:97` and `:94`), but I found no spec that resolves `SkillEnhancerService`, `SkillScorecardService`, `SpecHarvesterService` or the RPC handler with a real container. By static check every kept `@inject` token is registered (see Q2). A future token typo would still build cleanly and fail at runtime. Add one resolve smoke test.
- **M2. Preview settings are decoupled from the persisted settings keys.** `skillSynthesis.judgeEnabled` and `skillSynthesis.minJudgeScore` still exist in `file-settings-keys.ts:291-292, 607-608`, but nothing reads them. Users who tuned them are ignored without notice, and there is no setting-removal migration before batch 65. The loss of `minJudgeScore` is recorded (O38b); `judgeEnabled` is not (see B1). Add it to the decision log or fix it with B1.
- **M3. `SKILL_TASK_GRADE_STORE` is bound with `useToken: SkillTaskGradeStore` but the class is never `registerSingleton`'d** (`di/register.ts:71-73`; the same in the base commit, so not a Phase D regression). tsyringe constructs a fresh instance per resolve. The store is stateless over the shared connection, so there is no bug today, but it is fragile if a cache is added.

### Minor

- m1. Stale comments and test doubles still name the deleted service: `apps/ptah-electron/src/di/phase-2-libraries.ts:395` ("Library RPC handlers still inject SKILL_SYNTHESIS_SERVICE"; they do not, see the handler constructor at `skills-synthesis-rpc.handlers.ts:195-236`), and `apps/ptah-electron/src/activation/wire-runtime.spec.ts:246-258` registers a fake `SKILL_SYNTHESIS_SERVICE`.
- m2. `SKILL_SYNTHESIS_TOKENS` (`di/tokens.ts`) still declares about 24 tokens for removed services, and `SkillSynthesisDIToken` exports them. Any future `@inject` of one passes typecheck and fails only at runtime. Remove them in the cleanup phase.
- m3. `skillSynthesis:event` (`message-constants.ts:273`, `payload-map.ts:431`, baseline `:537`) has no emitter and no listener left.
- m4. Style, routed to code-style-reviewer: blank-line residue in `lane-runner.service.ts` header comments and the import block, an unused `_req` in `fail`, and an extra indent in the `skill-scorecard.service.ts:44` constructor parameter.
- m5. Moved queries now `safeParse`/`parse` their rows with Zod (`skill-invocation-event.store.ts:211, 232, 291`). In `reconcileSubagentEvent` a malformed row is read as "no match" (returns false), where it used to be used. In `getScorecardAggregates` a malformed row throws, and the scorecard callers catch it (`skill-scorecard.service.ts:82-95, 116-128`). Cosmetic given the fixed schema.

## Answers to the nine questions

1. **Preserve list (Electron).**
   - Library list/detail/edit/rebase/keep/revert: handlers and METHODS present (`skills-synthesis-rpc.handlers.ts:154-174`); deps injected as optional kept tokens. OK.
   - Preview: BROKEN as above (B1).
   - Scorecards: `SkillScorecardService` uses `events.getScorecardAggregates` (`:83, :118`) and the grade store. OK.
   - Spec control: handler -> `SPEC_HARVESTER_SERVICE`; frontend `listSpecs/harvestSpecs/clearStaleSpecs` (`skill-synthesis-rpc.service.ts:472-501`). OK.
   - Pause and telemetry switches: via `settings:get`/`settings:set` (`skill-synthesis-state.service.ts` keys `skillSynthesis.enabled`, `skills.telemetry.enabled`); the backend pause guard reads the same key (`handlers:1496`). OK.
   - Trigger, invocation recording, SKILL.md migration, repropagation: registered (`register.ts:42-71, 103-110`); `SkillTriggerService` deps are all kept tokens. OK.
   - No kept RPC resolves an unregistered token.
2. **DI.** `register.ts` registers the kept set. I extracted every `@inject(...)` in `libs/backend/skill-synthesis/src` and each is either registered there or supplied by the platform/SDK/persistence tokens as before. `SKILL_SYNTHESIS_TOKENS.<removed>` appears only in `register.spec.ts` (negative assertions) and the stale test double (m1); `container.resolve` of a removed token: none. Electron `phase-2-libraries.ts:397` and CLI `register-thoth-libraries.ts:137` both call the same function; the RPC surface is manifest-driven (`host-profile/manifest.ts:429-433`), so there is no per-host binding gap. VS Code lists the handler as expected-absent.
3. **Task 61.0 moves.** The SQL text, the two-pass exact/window logic and `applyReconciliation` are byte-equivalent to `skill-candidate.store.ts:1376-1560` at the base commit. Return types are identical. Only the row parsing changed (Zod, m5). The harvester calls `this.events.reconcileSubagentEvent` (`spec-harvester.service.ts:120`); the scorecard calls `this.events.getScorecardAggregates`. Pass.
4. **Lane runner.** No `queueItemId`, `budget`, `queue`, `recordUsage` or `isTransportLaneFailure` remains in `libs`/`apps`. `fail()` still returns `{status:'failed', failure}`, so the judge's `failed`/`unavailable`/throw handling is unchanged (`skill-judge.service.ts:170-205`). The enhancer is fail-soft by its own `catch` (`skill-enhancer.service.ts:466`). Constructor parameter order is preserved for the optional tail. Usage is still returned on `LaneRun` through a local interface. Pass.
5. **RPC contract.** METHODS (19), the `rpc.types.ts:1986-2058` map, the registry `true` list (`:3966-3984`) and the handler `register()` agree. The baseline lists the 15 host-source entries, which matches the base commit (the four agent-model/quarantine methods were never in it). No removed method is referenced by any caller (global grep: only comments and a data file). `PREVIEW_MIN_JUDGE_SCORE` replaces `minJudgeScore` at the one call site, but the surrounding object is incomplete (B1).
6. **Frontend.** The state service and tab use only retained facade members; deleted components are not referenced anywhere. `staleSpecCount` counts `status==='harvested' && ageDays>=7`; the backend uses `harvestedAt > cutoff` to skip, i.e. a floor of integer days from `harvestedAt`, with `DEFAULT_RETENTION_DAYS = 7` (`spec-harvester.service.ts:49, 255-264`). They agree. Edge: a harvested spec with no marker has `ageDays=null`, so the UI excludes it while the backend falls back to `windowEnd`; the backend only touches `spec.harvested` specs, so the marker is present in practice.
7. **TUI.** `SkillsPanel.tsx` reads only `skillSynthesis:listClones`, handles null/non-array results as a load error, and cancels stale loads. The CLI host gets the handler through the manifest. `skills-library.ts` is correct (weaker evidence for the O39 module).
8. **Data safety.** No Phase D code deletes or migrates user data. Runtime SQL grep over non-spec, non-migration sources finds no read or write of `skill_candidates`, `skill_suggestions`, `skill_synthesis_queue`, `skill_synthesis_budget` or `skill_synthesis_workspace_cursor`. Retired cron jobs are disabled, not deleted (O35). Pass.
9. **Silent behaviour loss without a decision.** B1 (the judge, `judgeEnabled`) and M2. The O41 deletion of the reachability specs is recorded and tests only deleted code (weaker evidence, same family).

## Data flow (preview)

1. UI `previewEnhancement` -> RPC schema parse: OK.
2. Pause guard (`skillSynthesis.enabled`): OK.
3. Registry lookup, `generateProposal(slug, settings, opts)`: GAP, `settings` lacks `judgeEnabled`.
4. Judge: returns `disabled` immediately; the lane runner is skipped.
5. Gate (manual): passes on `disabled`; the proposal is cached with `judgeScore: null`.
6. Result to UI: a draft with no score, no error.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Library CRUD paths | COMPLETE | none |
| Enhancement preview with judge | PARTIAL | judge not run (B1) |
| Scorecards, spec control, switches | COMPLETE | none |
| Pipeline RPCs, UI and registrations removed | COMPLETE | stale tokens and comments (m1-m3) |
| Data left intact until Phase F | COMPLETE | none |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Slug with no registry row | YES | `INVALID_PARAMS` | none |
| Skills paused | YES | `PAUSED` coded error | none |
| Malformed aggregate row | YES | caught in scorecard | m5 |
| Host without desktop services | YES | `requireDesktop` | none |
| Judge toggle set to off by a user | NO | ignored | M2 |

## Verdict

- Recommendation: REVISE (fix B1 only this round; M1-M3 and the minors can wait per the lean rule).
- Confidence: HIGH on B1 (two code sites and a spec that pins it), MEDIUM-HIGH on the rest (static reading plus recorded gates).
- Top risk: the preview quality gate never executes while the UI looks normal.
- A robust implementation would add: full preview settings (or a typed `PreviewJudgeSettings` constant instead of a cast), a handler-through-judge test asserting a non-null score, a container-resolve smoke test for the kept services, and a decision-log row for the dropped `judgeEnabled` setting.
