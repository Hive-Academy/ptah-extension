# Skills tab "Harvest now" - why nothing happens, and how skill learning works

Worktree: `.claude-worktrees/memory-skills-dead-actions`. Read-only investigation.
Paths below are relative to the worktree unless they start with `~`.

## 1. Verdict

"Harvest now" is not a dead button at the wiring level. The click reaches the backend and the harvester runs. The UI shows no result, because the component renders only a spec count and a stale count, and it never displays the harvest result or any error. The harvest also almost always has nothing new to do, so even a visible result would read `0 harvested, 0 reconciled`. The result is not a no-op bug. It is an observability bug plus a data-pipeline gap that the UI hides.

The only "curator" that exists in this tab is "Harvest now". The `ptah-memory-curator-tab` (`libs/frontend/thoth-shell/src/lib/components/thoth-shell.component.ts:232`) is the Memory tab, not Skills. The Skills tab (`libs/frontend/skill-synthesis-ui/src/lib/components/skill-synthesis-tab.component.ts`) hosts only these controls:
- the pause switch;
- the telemetry switch;
- the clones view, whose buttons are refresh, agent-sync, open-wizard and reconcile;
- the specs control.

There is no "synthesis run" or "promote candidate" button in the Skills tab. `skill-synthesis-rpc.service.ts:73` still carries the comment "CURATOR_MS: spec harvest reconciliation". That comment is the likely origin of the user's word "curator".

## 2. Click trace (verified by reading code)

1. `skill-specs-control.component.ts:15-17` - the button `data-testid=skills-specs-harvest` calls `onHarvest()`. This calls `state.harvestSpecs()` and discards the promise (`void`). The button is disabled while `specsLoading()`.
2. `skill-synthesis-state.service.ts:248-259` - `harvestSpecs()`:
   - sets `specsLoading` true and `error` null;
   - awaits `rpc.harvestSpecs()` and discards its return value (`SkillSynthesisHarvestSpecsResult {scanned, harvested, reconciled}`);
   - then awaits `refreshSpecs()`;
   - on a throw it only sets `this.error` (`:254-255`, signal declared `:32`).
3. `skill-synthesis-rpc.service.ts:487-497` - calls `'skillSynthesis:harvestSpecs'` with a 30 s-class `CURATOR_MS` timeout. It throws `Error(result.error || 'Failed to harvest specs')` on failure.
4. Handler: `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:1114-1127`.
   - It calls `requireDesktop(this.specHarvester)`. The harvester is injected as an optional dependency at `:192`.
   - If the harvester is null it throws `RpcUserError('...desktop app only', PERSISTENCE_UNAVAILABLE)` (`:1178-1190`).
   - Otherwise it runs `harvester.harvest()` with no argument, so the root comes from `IWorkspaceProvider.getWorkspaceRoot()`, falling back to `os.homedir()` (`spec-harvester.service.ts` `resolveWorkspaceRoot`).
5. Electron DI is wired:
   - `apps/ptah-electron/src/di/phase-2-libraries.ts:483` calls `registerSkillSynthesisServices`;
   - `libs/backend/skill-synthesis/src/lib/di/register.ts:83` registers `SPEC_HARVESTER_SERVICE`;
   - `apps/ptah-electron/src/di/phase-4-handlers.ts:52,135` registers `SkillsSynthesisRpcHandlers`.
   - The three spec methods are registered at `skills-synthesis-rpc.handlers.ts:174-176` and `:238-240`.
   - Runtime log shows the spec harvester resolved and executing, so the "never ran" theory is ruled out for Electron.
6. Backend `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts`, `harvest()` at about `:100-160`:
   - It reads `<root>/.ptah/specs/TASK_*` through `extractSpec` (`spec-extractor.ts`), which requires a valid `task.md` carrier.
   - `completed` means the frontmatter status is `done` or `cancelled` (`spec-extractor.ts:244-245`).
   - It skips any spec whose `.harvested.json` marker has `version == 2` and a matching `artifactDigest` (`:112`).
   - For each remaining spec it calls `events.reconcileSubagentEvent(...)` per batch. This flips `succeeded` and sets `reconciled_at` on `skill_invocation_events` rows, matched by slug and the spec's time window.
   - It then writes review grades into `skill_task_grades` and writes `<spec>/.harvested.json`.
   - It returns `{scanned, harvested, reconciled}` (`:157`). It logs `harvest complete` only when `harvested > 0` (`:150`). So a no-op run produces no log line and no UI change.

Writes: DB tables `skill_invocation_events` (UPDATE) and `skill_task_grades` (INSERT), plus a `.ptah/specs/TASK_x/.harvested.json` file per spec. `clearStaleSpecs` moves specs to `.ptah/specs/.archive/` or deletes them.

## 3. Root cause of "nothing happens" (runtime evidence)

Environment: Electron logs at `~/.config/Ptah/logs/Ptah Electron-2026-11-04.log`, DB at `~/.ptah/state/ptah.sqlite` (opened read-only), specs at `/home/amun/ptah-extension/.ptah/specs` (the workspace root per `[memory] stats {"workspaceRoot":"/home/amun/ptah-extension"}`).

Findings, in order of importance:

A. **The UI discards the result and the error.**
   - `SkillSpecsControlComponent` renders only `specs().length` and `staleSpecCount()` (`skill-specs-control.component.ts:15-16`).
   - `state.error` is set but never rendered anywhere. Grep shows that only `skillsSwitchError` is shown (in the pause switch).
   - `harvestSpecs()` throws away the `{scanned, harvested, reconciled}` result.
   - Success and failure look the same: the button greys out briefly, then looks as before.

B. **The harvest almost always does zero work, so even a visible result would read 0.**
   - 433 `TASK_*` folders sit in `.ptah/specs` (the 435-entry listing includes the `.archive` dir and one stray entry; exact split not checked).
   - 289 have a `task.md`. Statuses: done 117, cancelled 6, backlog 145, in_progress/in-progress 17, blocked 2, in_review 1. That makes 123 completed specs.
   - 241 specs already have a `.harvested.json` marker at `version 2`. Almost all were written 2026-10-27 and 2026-10-30; only 1 is dated 2026-11-04. The marker version is current, so a rerun skips them.
   - The log, written by `listSpecs`/`harvest` `warnOnSkipped`, shows `[spec-harvester] skipped 133 TASK_* folder(s) with no valid task.md carrier`. It repeats about every 5-10 minutes all day, at roughly 90 s after each chat Stop. These are the automatic harvests, not the button.
   - Conclusion: every eligible spec is already marked, 133 folders are structurally invisible, and the rest are not completed. The button therefore returns `{scanned:~156, harvested:0, reconciled:0}`.
   - I did not independently confirm that a button click happened (log lines do not distinguish RPC calls from auto-triggers; there is no per-RPC info log for `harvestSpecs`). Unverified.

C. **The pipeline output is nearly empty - harvest "works" but reconciles nothing.**
   - `skill_invocation_events`: 427 rows (54 slash-command, 373 subagent). `succeeded` is NULL for all of them and `reconciled_at` is NULL for all of them.
   - Of 241 markers, the sampled `.harvested.json` (TASK_2026_237) has `reconciledCount: 0`.
   - `skill_task_grades` has exactly 1 row (an old nx-video task, TASK_2026_001).
   - So the reconciliation key (slug plus spec time window / task_id) is not matching real events, or the marker is written without reconciliation (`marker ? [] : spec.batches` at `:116` skips reconciliation for any spec that already has a marker, even a legacy one).
   - Most markers predate the current events table's content (events run from `invoked_at` 1793027631767 to 1793824622549, which is roughly 2026-10-26 to 2026-11-04, so the cause is not simply "events too new").
   - Root cause of the zero reconciliation is not proven. This is the real data gap behind "skill learning doesn't seem to learn". Candidates: slug mismatch between event slugs such as `researcher-expert` and batch executor slugs; the time window; the `marker ? [] :` shortcut.

D. **Ruled out:**
   - Unregistered RPC (registered, see section 2).
   - Missing DI in Electron (wired).
   - Paused gate (harvest is not gated on the skills pause).
   - Wrong root (the log shows `/home/amun/ptah-extension`).
   - Timeout (the handler is local fs only; the log shows no slow-handler entry for harvest).

## 4. How skill learning works today (verified from code and DB)

There is no automatic "synthesis of a candidate skill" in this code path any more. The Skills tab manages a **library**, and the learning loop only produces **telemetry and grades**.

- **Observation (always on, if `skillSynthesis.enabled` and the telemetry switch are on).** `SkillTriggerService` (`libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`) registers four hooks:
  - SubagentStop: records a `subagent` invocation with transcript metrics;
  - PostToolUse: `Skill` and `Task` tools;
  - UserPromptExpansion: slash commands and prompt expansions;
  - Stop: schedules a harvest.
  - Each invocation is stored in `skill_invocation_events` by `SkillInvocationRecorder`, keyed by `skill_slug`, with `context_id` set to the workspace fingerprint and `succeeded` initially unset ("optimistic").
- **Grading (the thing Harvest does).** `SpecHarvesterService.harvest()` reads finished orchestration tasks (`.ptah/specs/TASK_*`) and:
  1. flips the matching events' `succeeded` using batch word statuses in `batches.md`;
  2. writes per-subject pass/fail grades into `skill_task_grades` from review artifacts.
  - `SkillScorecardService` aggregates these into success rates.
  - `getRecentFindings()` feeds review text to `SkillEnhancerService` (`SPEC_FINDINGS_TOKEN`).
- **Triggers.**
  - Automatic: a harvest 90 s after each chat Stop (`HARVEST_DEBOUNCE_MS = 90_000`, `skill-trigger.service.ts:23,143-165`). Failures are logged at `debug` only (`:158-162`).
  - Manual: the "Harvest now" button.
  - A boot-scan config key exists (`skillSynthesis.triggers.bootScan`) but its consumer was not found in this lib. A comment in `skill-trigger-config.ts` refers to a `skill-synthesis.service` curator interval that is not present in `libs/backend/skill-synthesis/src/lib`. Unverified whether it exists elsewhere.
- **"Promotion".** The user-facing flow is the Library/clones view (`skill_registry`, 45 rows): sync plugin skills to user paths, "enhance" via LLM with a preview drawer, and diverged/reconcile. It is manual and not driven by success rates.
- **Data lives in** `~/.ptah/state/ptah.sqlite` (tables `skill_registry`, `skill_invocation_events`, `skill_task_grades`, `skill_session_verdicts` (0 rows) and others), `~/.ptah/settings.json` (the `skillSynthesis.*` keys), and `<workspace>/.ptah/specs/TASK_*/.harvested.json` markers.

## 5. Observability gaps and existing tests

UI shows after a click:
- Only the `N specs, M stale` line, which usually does not change.
- The button is disabled while loading, and nothing else changes.

It should show:
- last harvest time;
- the `scanned/harvested/reconciled` counts of the last run, with copy such as "Nothing new to harvest";
- how many specs are waiting (`complete-unharvested`) and how many folders are skipped for lacking a carrier;
- the error text (`state.error`, an `role="alert"` element);
- an explanation of what harvest does, for the user who does not understand skill learning.

Backend: `harvest()` logs only when `harvested > 0`. The skipped-carrier warn includes the folder list, but there is no per-click RPC log.

Existing tests:
- `libs/frontend/skill-synthesis-ui/src/lib/components/skill-specs-control.component.spec.ts` - three cases: renders counts, click calls harvest, loading disables buttons. None asserts result or error display.
- `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.spec.ts:132-138` - mocks `harvestSpecs` as resolving `{}` and asserts only that the call happened and the list refreshed. It does not check the returned value, and does not cover the error branch.
- `libs/backend/skill-synthesis/src/lib/spec-harvester.service.spec.ts` (harvest, marker re-harvest, grade warn, clear-stale), `spec-harvester.concurrent-attribution.spec.ts` and `triggers/skill-trigger.service.spec.ts` cover the backend.
- `apps/ptah-electron/src/activation/wire-runtime.spec.ts` mentions harvest. Not inspected in detail.

## 6. Fix proposal (minimal)

1. `libs/frontend/skill-synthesis-ui/src/lib/services/skill-synthesis-state.service.ts`
   - Add `lastHarvest = signal<{at:number; scanned:number; harvested:number; reconciled:number} | null>(null)`.
   - In `harvestSpecs()`, keep the result (`const r = await this.rpc.harvestSpecs(); this.lastHarvest.set({...r, at: Date.now()})`) and set it before `refreshSpecs()` (which clears `error`).
   - Make `refreshSpecs()` not wipe a harvest error, or set the error after the refresh.
2. `libs/frontend/skill-synthesis-ui/src/lib/components/skill-specs-control.component.ts`
   - Render `state.lastHarvest()` as a status line ("Last run HH:MM - scanned N, harvested X, reconciled Y; nothing new" when X is 0).
   - Render `state.error()` in a `role="alert"` paragraph.
   - Optionally show the pending count (`status === 'complete-unharvested'`).
   - Use a busy label, "Harvesting...", on the button.
   - Add a short "How skill learning works" help paragraph (see section 4).
3. `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts`
   - Log `harvest complete` at `info` also when `harvested === 0` (or at least at `debug` with counts).
   - Optional: extend `HarvestResult` with `skipped` and `pending` for the UI. This needs matching changes in `libs/shared/src/lib/types/rpc.types.ts:2793` and `rpc-handlers/.../skills-synthesis-rpc.handlers.ts`.
4. `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:158-162` - raise the auto-harvest failure log from `debug` to `warn`.
5. Reconciliation gap (separate investigation, larger): determine why `reconcileSubagentEvent` never matches real events. Candidates are slug mismatch, window mismatch, and the `marker ? [] : spec.batches` shortcut at `:116`. Verify with a repro against the real DB copy.
6. Tests: extend `skill-specs-control.component.spec.ts` (renders the last-run summary and the error alert); extend `skill-synthesis-state.service.spec.ts` (harvest stores the result; the error branch sets `error`).
   Run: `npm run verify -- -t test -p skill-synthesis-ui,skill-synthesis`. The project names are not confirmed.

Out of scope here: the 133 carrier-less folders. They are a data-migration issue, not a bug in the button.
