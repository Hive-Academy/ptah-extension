# Code Logic Review - `TASK_2026_650_2c78` (Phase 2: B02, B02G, B03)

Review family: implementer = codex (CLI lanes); reviewer = Claude (independent family, as batches.md requires).
Scope: `git diff a845931a5..HEAD -- libs apps` (B01 context only). Read in full: wizard-generation-binding.ts,
guidance-generation-run.supervisor.ts, wizard-generation-run.supervisor.ts, enhanced-prompts-rpc.handlers.ts
(bound sections), enhanced-prompts-rpc.schema.ts, wizard-generation-rpc.schema.ts, the service lock/runWizard/stream
sections of enhanced-prompts.service.ts, checkpoint service diff, setup-rpc.handlers.ts catalog diff, DI registration.
Not run: no tests executed (read-only review; the orchestrator's lane evidence was not re-verified). Residual
uncertainty is listed at the end.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6.5/10         |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 9              |
| Failure modes found | 14             |

Verdict: REVISE (one fix round for the two Serious items, then scoped re-review). The authorization, lock-ownership and
tabless-compatibility designs are sound and consistently applied. The two Serious items are both "tab left waiting with no
terminal state" failures, which is exactly the class this phase exists to remove.

Score evidence: above 5-6 because every authorization-before-I/O check, owner-token lock guard, exact-binding cancel and
D10 path I traced holds; below 7-8 because two stuck-state paths are reachable in normal operation (host restart, wedged SDK)
and the commit window has new partial-commit exits.

## Five logic questions

### 1. How does this fail silently?

- Wedged guidance run after the 30 s grace: the service force-releases its lock, but the supervisor is never told, so the
  owning tab stays `running`/`cancelling` forever with no terminal push (S1).
- Orphaned `running` agent checkpoint (host restart mid-run) reports `starting` with no result indefinitely (S2).
- Thrown (not returned) guidance failure emits no terminal broadcast unless the cause was a timeout
  (`enhanced-prompts-rpc.handlers.ts:807-822`).
- Agent finalize failure now skips propagation although files were written (`wizard-generation-rpc.handlers.ts:768-778`).

### 2. What user action produces unexpected behaviour?

- Pressing Stop on guidance at ~4:59 then letting it wind down past 5:00 reports `timed-out` instead of `cancelled`
  (`guidance-generation-run.supervisor.ts:75-79`, `timeout()` at 94-98 sets the flag after a user abort).
- A second Start from the same agent tab after a lost accepted response gets `blocked` with no run ID and no owner
  (`wizard-generation-binding.ts:84-99`) while the same action on guidance returns the existing run (`enhanced-prompts-rpc.handlers.ts:602-620`).
- Bound agent "resume" from any tab adopts the workspace's latest paused checkpoint, whatever tab started it
  (`wizard-generation-rpc.handlers.ts:529-542` passes `analysisDir=null` to `locateResumable`, then `prepareResume` overwrites `tabBinding`
  at `wizard-generation-checkpoint.service.ts:336-343`). The original tab can no longer find its run.
- Choosing a model the provider no longer offers shows "could not start. Please retry." and retry can never succeed (M3).

### 3. What input data produces a wrong answer?

- Workspace path spelling: guidance stores `host` (`getWorkspaceRoot()` string) in the run binding
  (`enhanced-prompts-rpc.handlers.ts:601`) but compares it by exact string with the client's `tab.workspacePath` in
  `cancel`/`lookup` (`guidance-generation-run.supervisor.ts:166-181`). Authorization is realpath-based and case-insensitive on
  win32 (`wizard-generation-binding.ts:101-123`), so a differently spelled but authorized path gets `refused`/`not-running`
  for its own run. The agent side stores the client string, so the two workflows disagree on the invariant (M6).
- Catalog mode returns `matchedCriteria: ['Deep codebase analysis', 'All agents recommended']` and `relevanceScore: 100` for a
  workspace nothing was analyzed for (`setup-rpc.handlers.ts:~650-665`). Misleading if rendered.
- Provider/model pair after resume: provider is overwritten with the current provider while the model keeps the old
  run's value (`wizard-generation-checkpoint.service.ts:346-358`), and resume skips model validation against the current provider.

### 4. What happens when a dependency fails?

- Provider resolution: bounded to 15 s with a cleared timer and a released reservation (`enhanced-prompts-rpc.handlers.ts:712-731, 673-684`). Good.
- Freshness/manifest lookup failure: degrades to `workspace-discovery` with `lookup-failed` (`wizard-generation-binding.ts:168-206`, `enhanced-prompts.service.ts:425-434`). Good.
- Checkpoint finalize failure: now throws (`wizard-generation-checkpoint.service.ts:415-425`); the supervisor converts it to `success:false`
  (`wizard-generation-run.supervisor.ts:293-305`). Plan-conformant, but see M5 for the tabless and propagation side effect.
- SDK ignores abort: lock force-released, tab stuck (S1).
- Timeout during commit: see M1.

### 5. What is missing that the requirements never mentioned?

- A staleness rule for `running` checkpoints with no live controller (S2).
- A supervisor-side terminal on force-release (S1).
- Trust validation of the new persisted fields `source.analysisDir`, `workspaceRoot` and `tabBinding.workspacePath` in `isTrusted` (M4).
- A user-readable error for malformed catalog requests (M7).

## Serious issues

### S1. Guidance force-release leaves the tab stuck with no terminal state

- File: `libs/backend/agent-generation/src/lib/services/enhanced-prompts/enhanced-prompts.service.ts:325-343`;
  `libs/backend/rpc-handlers/src/lib/handlers/guidance-generation-run.supervisor.ts:94-98`;
  `enhanced-prompts-rpc.handlers.ts:785-826`.
- Scenario: the SDK stream or a downstream await ignores the abort. At 5:00 the service aborts and calls `onTimeout`, which
  only sets `timedOut` and aborts the controller. At 5:30 the grace timer force-releases the service lock
  (`releaseGenerationLock(owner)`). Nothing calls `guidanceRuns.finish`, so `current` keeps `status: 'running'` (or `cancelling`).
  `getGuidanceRunState` for that tab keeps returning the stale live state; no `timed-out` push is ever sent (the broadcast at 790-806
  happens only when `runWizard` returns). If the stream never returns, the tab waits forever. If a new run starts from any tab,
  `start()` overwrites `current` (supervisor 36-48), the old run's later `finish` is a correct no-op, and the old tab then sees
  `not-running` or `blocked` instead of `timed-out`. When the old run finally returns, `lookup(runBinding)` (line 789) finds a different current
  run, `final` is undefined and the old tab receives lifecycle `failed` instead of `timed-out`.
- Impact: the exact stuck-tab condition the 5-minute timeout and grace timer were added to remove; the user gets neither a result nor a retry path.
- Fix: give the service an owner-scoped `onForceRelease` callback (or have `onTimeout` return a disposer) so the grace timer also runs
  `guidanceRuns.finish(binding, 'timed-out')` and broadcasts the terminal `timed-out` event with `committedState: 'unknown'`.
  Make `finish`/`lookup` for a superseded binding return the settled `timed-out` record instead of `failed`.

### S2. Orphaned `running` agent checkpoint maps to `starting` forever

- File: `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-binding.ts:29-43` (consumer `wizard-generation-rpc.handlers.ts:241-269`).
- Scenario: the host dies or reloads mid-run. The checkpoint stays `lifecycle: 'running'`. After restart the supervisor has no controller, so `isActive`
  is false and the fall-through branch returns `status: 'starting'` with no `result` (line 58 omits `result` for `starting`).
  The same happens when `runs.run` throws "already active" after an accepted response (`launchSubmittedRun` 637-666 finalizes `failed`, but only if finalize succeeds).
  The tab can poll forever and nothing tells it to offer Resume. No false failure, but a permanently stuck state.
- Impact: the lost-response/recovery contract (plan line 73, "stalled lookup shows unconfirmed state") is only half met. The stuck tab cannot distinguish "still starting" from "host lost the run".
- Fix: in `generationRunState`, when `manifest.lifecycle === 'running'` and `active` is null (no controller in this process) and `updatedAt` is older than a short bound
  (the launch window is synchronous, so about 30 s is safe), return a distinct terminal-looking status (for example `failed` with an `interrupted`/resumable
  hint, or a new `interrupted` lifecycle) so B07 can offer Resume. Keep `starting` only for the sub-30 s window.

## Moderate issues

- M1. Post-commit abort checks can split trace from state. `enhanced-prompts.service.ts:720-726` keep calling `ensureActive()` after `beforeCommit()` succeeded (line 700).
  User cancel is refused after commit begins, but the 5-minute timeout abort is not. A timeout between trace write and `stateStore.save` leaves a written trace
  with no saved state; between save and `cache.set` it reports failure for a committed prompt. The supervisor says `committedState: 'unknown'`
  (`guidance-generation-run.supervisor.ts:80-81`), which is honest but avoidable. Fix: once `beforeCommit` returns true, stop checking the abort for the remaining commit steps (or make the lock timer skip abort while `committing`).
- M2. Terminal broadcast missing in the thrown path. `enhanced-prompts-rpc.handlers.ts:807-822` broadcasts only `timed-out`. A thrown error that finishes the run as `failed` or `cancelled`
  (for example `regenerate`'s `cacheService.invalidate` throwing, or the broadcaster itself throwing inside the try) sends no push. Fix: broadcast `failed`/`cancelled` here too, as the success path does.
- M3. Bound agent submit swallows the explicit model error. `resolveProviderRoute` throws `RpcUserError(... 'INVALID_PARAMS')` (`wizard-generation-binding.ts:287-290`), called at
  `wizard-generation-rpc.handlers.ts:437-445` inside the `try` whose catch (374-394) replaces every error with "Agent generation could not start. Please retry." for bound calls. The user-fixable
  cause is lost. Fix: rethrow `RpcUserError` in that catch, or return a `rejection` reason for it.
- M4. `isTrusted` does not validate the new persisted paths. `wizard-generation-checkpoint.service.ts:281-296` checks `outputDirectory`, `analysisDir` and `manifest.analysisDirectory` only. Bound retry feeds
  `manifest.source.analysisDir` straight to the orchestrator (`wizard-generation-rpc.handlers.ts:1262-1265`), and `getGenerationRunState` returns it to the webview. Exploiting it needs a planted manifest whose
  `tabId`/`runId` match a live tab (a random UUID), so likelihood is low. Fix: add `source.analysisDir` (and `workspaceRoot`) to the `isTrusted` candidates.
- M5. Finalize now throws for tabless callers too, and skips propagation. `afterSettled` awaits `finalize` (768) before propagating written agents (777-779). A finalize failure (checkpoint missing or unwritable)
  turns a fully written tabless Settings/CLI run into `success:false` with "Generation finalization failed" and leaves rival-CLI copies unsynced. Plan line 73 requires "no done on finalize failure", so the failure itself is
  intended, but D10 says tabless meaning is kept and propagation should not depend on the checkpoint write. Fix: wrap finalize in try/finally around propagation (or run propagation first when `writtenCount > 0`), keeping the payload failure.
- M6. Workspace-path equality is exact-string while authorization is realpath. See Q3. Fix: store and compare the canonical path returned by `authorizeTabWorkspace` (guidance supervisor, agent supervisor `abortBound`, `locateBound`
  at `wizard-generation-checkpoint.service.ts:260-262`, `blockedSubmit`).
- M7. Catalog mode throws a raw ZodError. `setup-rpc.handlers.ts:503-523`: `catalogRequest.parse(rawAnalysis)` throws; `RpcHandler` (`rpc-handler.ts:239-252`) returns `error.message` (a JSON array of issues in zod v3) and
  reports it to Sentry as a server error. Fix: `safeParse` and throw `RpcUserError('Invalid catalog request.', 'INVALID_PARAMS')`.
- M8. Agent `analysisData` is parsed before authorization. `wizard-generation-rpc.handlers.ts:293` runs `WizardSubmitSelectionParamsSchema` (including `ProjectAnalysisResultSchema` on client data) before the tab/host check at 311-340.
  It is in-memory, side-effect free and ignored for bound runs (`:564`), so it is a contract deviation (plan line 78 / brief item 1) rather than an exploit. Fix: validate the `tabBinding` envelope and authorize first, then parse the rest (guidance already does this, `enhanced-prompts-rpc.handlers.ts:259-280`).
- M9. Lock timeout regresses slow tabless runs. The 5-minute lock abort (`GENERATION_LOCK_TIMEOUT_MS`) is shorter than `PROMPT_DESIGNER_TIMEOUT_MS` = 10 minutes (`enhanced-prompts.service.ts:236`), so legitimate Settings/CLI guidance runs of 5-10 minutes that used to finish
  (with the lock merely force-freed) are now aborted, and the 10-minute designer timeout is dead. This is plan-intended but is a D10-visible change; record it and consider a longer legacy timeout or a unified constant.

## Minor

- Guidance `finish` reports `committedState: 'unknown'` for every non-completed run, including a cancel before commit began (`committing === false`), where `'unchanged'` is known (`guidance-generation-run.supervisor.ts:80-81`). Conservative, but the type allows `'unchanged'`.
- Guidance `cancel` with a wrong `runId` on the correct tab returns `rejection: workspace-mismatch` (supervisor 111-117); `not-running` would be accurate.
- Idempotent guidance start for a run already `cancelling` returns `status: 'starting'` (`enhanced-prompts-rpc.handlers.ts:608-619`).
- A cancel that races a completed orchestrator marks a fully written agent run `paused`/`cancelled` (`wizard-generation-rpc.handlers.ts:762-767`); files are still propagated. Acceptable, but UI copy should not say "nothing was written".
- `retry-item` checks `runs.isActive` (1186) and only later calls `runs.run` after several awaits; a concurrent multi-tab submit in that window makes one `run()` throw "already active". Submit then returns `accepted` and finalizes `failed` with no terminal push (`launchSubmittedRun` 637-666). Narrow, multi-tab only.
- `locateBound` reads every analysis directory's generation manifest on each state lookup (`wizard-generation-checkpoint.service.ts:229-272`); fine now, watch polling frequency from B07.
- Known accepted follow-ups, not scored: `wizard-generation-rpc.handlers.ts` is 1705 lines; `registerRunWizard` (about 198 lines) and service `runWizard` (about 270 lines) were already long and grew slightly.

## Failure modes

### Wedged guidance run after grace
- Trigger: SDK/await ignores abort for more than 5:30. Symptom: tab shows running/cancelling forever. Evidence: `enhanced-prompts.service.ts:333-342`, supervisor 94-98. Current: lock freed, supervisor untouched. Recommendation: S1.

### Host restart mid agent run
- Trigger: reload/crash while `lifecycle: 'running'`. Symptom: tab `starting` indefinitely. Evidence: `wizard-generation-binding.ts:33-43`. Recommendation: S2.

### Timeout inside the commit window
- Trigger: 5:00 timer fires after `beforeCommit`. Symptom: trace without state, or failure for a committed prompt, reported `timed-out` with `unknown`. Evidence: `enhanced-prompts.service.ts:700-726`. Recommendation: M1.

### Thrown guidance error
- Trigger: exception outside `runWizard`'s own try. Symptom: no terminal push. Evidence: handler 807-822. Recommendation: M2.

### Finalize failure on a tabless run
- Trigger: checkpoint missing/unwritable at settle. Symptom: reported failure, no propagation, files written. Evidence: `wizard-generation-rpc.handlers.ts:768-778`. Recommendation: M5.

### Path-spelling mismatch
- Trigger: authorized but differently spelled tab path. Symptom: own run `refused`/`not-running`. Evidence: M6 locations. Recommendation: canonicalize.

### Cross-tab resume adoption
- Trigger: tab B resumes while tab A's run is paused. Symptom: tab A loses its run. Evidence: `wizard-generation-rpc.handlers.ts:529-542`, checkpoint service 336-343. Recommendation: for bound resume, require `locateBound` for the same tab (or document workspace-level resume and notify the previous tab).

### Cancel at the timeout boundary
- Trigger: cancel shortly before 5:00. Symptom: `timed-out` shown for a user cancel. Evidence: supervisor 75-79, 94-98. Recommendation: do not set `timedOut` when the controller is already aborted by cancel.

(Other modes: model-error swallowing M3, ZodError M7, retry/submit race, grace-period double writers noted below.)

Double writers after force-release: a timed-out run that is still alive after the lock was freed can later call `stateStore.save` while a new run
runs. The reservation token prevents lock theft but not late writes; `ensureActive()` before each write mitigates it only if the abort signal is honored. Covered by the S1/M1 fix direction.

## Orchestrator notes, answered

1. `GenerationContextSource.analysisDir`: it is sent to the webview in `accepted.source`, `getRunState.run.source`, `result.source`, completion payloads and persisted in the checkpoint manifest
   (`wizard-generation-binding.ts:136-139`, `generationRunState` 44-47). Logs: no `logger` call in the bound paths includes `source`; legacy `runWizard` logs `analysisDir` (`enhanced-prompts-rpc.handlers.ts` ~lines 330, pre-existing). No leak to a foreign workspace
   (host/tab authorization precedes every response). Flag for B07/B08: render only `kind`, `reason` and a derived label (analysis date/run id), never the path; do not put it in DOM attributes, tooltips, `title`, Sentry breadcrumbs or console logs; strip it before telemetry.
2. Bound submit needs a prior bound preview: confirmed (`wizard-generation-rpc.handlers.ts:446-465`). After restart or evicted entry (cap 64, lines 900-903) the submit returns `{ success:false, error: 'Generation targets changed. Review the preview and confirm again.' }`.
   Explicit and recoverable, but it has no `rejection` code and shares one message for "never previewed" and "targets changed"; the preview is consumed even if a later launch step fails. B07 must always call the bound preview immediately before submit, match this error (or request a `rejection.reason`), and re-open the preview dialog rather than show a generic failure.
3. Orphaned `running` to `starting`: no false failure, but it can stick forever. Serious S2.
4. Verified cancel ordering: `abortBound` (no state change) then the orchestrator settles, then `afterSettled` writes `paused` before the single completion broadcast (`wizard-generation-rpc.handlers.ts:762-768`; supervisor 293-327), so `paused` precedes the terminal `cancelled`. A late completion cannot overwrite it:
   exactly one `onSettled`/broadcast per run, `activeController` clears only after the broadcast (supervisor `finally`), and the only other lifecycle writer is `prepareResume` for a new run. `recordOutcome` writes only `agents`. One caveat: a cancel that lands after all agents wrote still records `paused`/`cancelled`.
5. Fallback `'anthropic'`/`'sonnet'`: reachable only for manifests without a snapshot. `locateBound` requires `manifest.tabBinding`, and every bound create passes `route`, so new bound runs always carry a snapshot (`wizard-generation-rpc.handlers.ts:551-558`); `acceptedSubmit` (binding.ts:236-241) and `completeWithoutWork` (740-742) also fall back,
   but only if the snapshot is missing. Resume overwrites provider but not model (see Q3). Low risk of a wrong provider shown; to be safe, return `effectiveProvider: undefined`/`'unknown'` rather than inventing `anthropic` and let the UI hide the line.

## Required checks, answered

1. Security: PASS with M8 and M4 noted. Guidance: workspace authorization (`enhanced-prompts-rpc.handlers.ts:587-600`) precedes the source/analysis work; bound path strips `analysisData` (`:259-280`); foreign directories return `foreign-directory` with no path;
   foreign workspaces get `workspace-mismatch` with no owner or run ID; same-workspace second tab gets only `ownerTabId` (`:633-643`; agent `blockedSubmit` 84-99). Agent: authorization precedes `resolveGenerationContext`, runtime resolution and checkpoint creation; `analysisData` ignored for bound.
2. Lock/abort/finalization: guidance service is the single lock owner, acquire is synchronous and precedes `accepted` (`enhanced-prompts.service.ts:374-378`, handler 632), release is in `finally` and owner-token guarded (351-383, 760-763), stale `finish` no-ops by exact binding. Timeout aborts, then force-releases only the timed-out owner after 30 s (S1 gap on the supervisor side).
   Abort checks cover discovery, SDK stream (`:1000-1006, 1060`) and pre-commit (`:699-701`). No success before trace and state (returns at 744 only after 722-726). No late progress after cancel: stream and progress callbacks are guarded by `signal.aborted`. Cancel is refused after commit begins (supervisor 100-107). `unknown` when not completed. `timed-out` vs `cancelled` mapping at supervisor 75-79 (edge in Q2).
3. D10: tabless `runWizard`, `regenerate`, `submit-selection`, `cancel` (still aborts a bound run, `wizard-generation-rpc.handlers.ts:1103`), `retry-item` remain awaited with unchanged shapes. Deviations: M5 (finalize), M9 (5-minute abort).
4. Agent and guidance locks are independent: separate supervisors and flags (`submitReserved`/`GenerationRunSupervisor` vs service `isGenerating`). PASS.
5. Catalog mode: bound authorization uses both `isAuthorizedWorkspace` and `authorizeTabWorkspace` (`setup-rpc.handlers.ts:524-538`); without a tab binding it returns the static catalog (no workspace data, harmless). Legacy analysis input is untouched (`catalogMode` only short-circuits when `mode === 'workspace-catalog'`).
   The ZodError issue is M7, and the misleading `matchedCriteria` text is in Q3.
6. DI: `registerSharedRpcHandlers` registers both supervisors as singletons (`register-shared-rpc-handlers.ts:57-59`) and is called by VS Code (`phase-3-handlers.ts`), Electron (`phase-4-handlers.ts`) and CLI (`cli-engine/src/lib/container.ts`). Both handler classes are singletons too, so start, cancel and lookup share one instance per process. PASS.

## Data flow (bound guidance)

1. RPC parse envelope: OK (no analysisData parsed). 2. Host and tab realpath authorization: OK. 3. Idempotent same-tab return: OK. 4. `authorizeAnalysisDir`: OK. 5. Atomic `acquireBoundGeneration`: OK, `blocked` with owner only for same workspace.
6. Source and route resolution (15 s bound): OK, reservation released on failure; lock timer already running (5 min includes this). 7. `guidanceRuns.start` then `accepted` returned: OK. 8. `executeBoundGuidance` background: gaps M2, S1.
9. Service `runWizard`: abort checks OK, commit window M1. 10. `finish` then terminal broadcast: OK on the returning path. 11. Release in `finally`: OK, token-guarded.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Host/tab authorization before I/O | COMPLETE | M8 (agent parses client data first, no I/O) |
| Foreign directory/workspace isolation | COMPLETE | none |
| Single guidance lock owner, atomic reserve | COMPLETE | none |
| 5-min timeout abort and owner-only force release | PARTIAL | supervisor not finalized on force release (S1) |
| No success before trace + state | COMPLETE | M1 post-commit abort exits |
| Cancel refused after commit | COMPLETE | timeout can still abort in commit window |
| `committedState: 'unknown'` | COMPLETE | never `unchanged` (minor) |
| Lost-response recovery (agent) | PARTIAL | orphaned `running` sticks (S2) |
| Lost-response recovery (guidance) | COMPLETE | settled slot holds only the latest run |
| Tabless D10 semantics | PARTIAL | M5, M9 |
| Catalog mode | PARTIAL | M7, misleading criteria text |
| DI/singleton on all hosts | COMPLETE | none |

Implicit requirements not addressed: staleness rule for orphaned runs, canonical path binding, trust check for new persisted paths.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Second tab, same workspace | YES | `blocked` + `ownerTabId` | none |
| Foreign workspace | YES | `workspace-mismatch`, no IDs | none |
| Duplicate start, same tab (guidance) | YES | returns existing accepted | reports `starting` while `cancelling` |
| Duplicate start, same tab (agent) | PARTIAL | `blocked` without ids | rely on getRunState |
| Cancel during commit | YES | `refused` | none |
| Cancel racing completion | YES | one terminal record | completed agent run shown cancelled |
| Stale run `finally` vs newer owner | YES | token-guarded release, exact-binding finish | none |
| Host restart mid-run | NO | `starting` forever | S2 |
| SDK ignores abort | PARTIAL | lock freed | supervisor stuck (S1) |
| Model unavailable | PARTIAL | message swallowed | M3 |
| Malformed catalog request | PARTIAL | raw ZodError | M7 |

## Notes for frontend batches B07/B08

- Never render, attribute-bind, log or send to telemetry `source.analysisDir`; show `kind`, `reason` and a derived label only.
- Always call bound `wizard:preview-generation` right before bound `wizard:submit-selection`; treat "Generation targets changed..." as "reopen the preview", not a generic failure. Resume skips the preview gate.
- Do not rely on the accepted response alone: after start, a lost response, a tab restore or a reload must call `wizard:get-generation-run-state` / `enhancedPrompts:getRunState`.
  Until S2 is fixed, apply a UI-side timeout to `starting` and offer Resume/Retry.
- Handle all rejection reasons: `blocked` (focus `ownerTabId` only when present), `workspace-mismatch`, `foreign-directory`, `invalid-binding`, `not-running`. Guidance cancel outcomes: `cancelled` (status becomes `cancelling`, not final), `already-finalized` (read the record), `not-running`, `refused` (commit in progress: show "finishing", disable Stop).
- Treat `committedState: 'unknown'` as "re-read the committed prompt status"; do not show success or "unchanged".
- Ignore events whose `tabBinding.runId` is not the tab's current run; a `cancelling` status can still end `completed`-never (cancel is refused after commit) but can end `timed-out`.
- Catalog mode: do not render `matchedCriteria` or `relevanceScore` as analysis-derived text; handle an `error` string that may be raw JSON until M7 is fixed.
- Pass the same workspace path string the host returned (do not re-case or normalize) until M6 is fixed.
- Provider/model line: show it from `accepted`/state; the `'anthropic'`/`'sonnet'` fallback may appear for old checkpoints and should be hidden when the run predates the snapshot.

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (code read in full for the focus files; no tests run)
- Top risk: a guidance or agent tab can wait forever with no terminal state (S1, S2).
- What a robust implementation would add: supervisor finalization on force-release; an interrupted/stale rule for orphaned `running` checkpoints; abort-immune commit window; canonical workspace binding; `isTrusted` coverage for persisted `source`/`workspaceRoot`; `RpcUserError` for catalog and model failures; propagation independent of checkpoint finalize; tests for the grace-timer path, host-restart lookup and the timeout-in-commit window.

Residual uncertainty: orchestrator internals (does it await `onAgentOutcome` and honor the abort signal between writes); frontend path-string provenance for M6; zod version behavior for M7 (assumed v3 JSON message); no spec execution.

---

## Re-review (round 1)

Scope: uncommitted `git diff` over 16 files on top of HEAD 725d982e6, read against the two lane reports. I read the
changed sections of the service lock/runWizard (`enhanced-prompts.service.ts:311-375, 490-540, 690-740`), the whole guidance
supervisor, the bound guidance handler (`enhanced-prompts-rpc.handlers.ts:574-905`), the binding helpers, the checkpoint
service (`locateBound`, `isTrusted`, `prepareResume`), the submit/preview/cancel/retry/resume hunks of
`wizard-generation-rpc.handlers.ts`, and the force-release and orphan specs. I ran no tests (orchestrator evidence accepted).

| Metric       | Value                                      |
| ------------ | ------------------------------------------ |
| Score        | 8/10                                       |
| Verdict      | APPROVE (no Blocking, no Serious open)     |
| New findings | 0 Blocking, 0 Serious, 3 Moderate, 3 Minor |

### Per-finding verification

| ID | Status | Evidence | Regression spec quality |
| -- | ------ | -------- | ----------------------- |
| S1 force-release leaves tab stuck | FIXED | Grace timer calls `generationOnForceRelease` then releases the lock (`enhanced-prompts.service.ts:334-347`), registered per run at `:524`, cleared on release `:365`. Handler callback `enhanced-prompts-rpc.handlers.ts:774-776` pushes only if `forceRelease` returned true; `forceRelease` finishes `timed-out`/`unknown` (`guidance-generation-run.supervisor.ts:110-115`). A late return hits `finish` -> `matches` false -> no second push, no overwrite (`handlers:764-775`). The lock owner check stops a stale `finally` freeing a new owner. | Real: supervisor spec `:184` asserts true/false on repeated release, late `finish` false, settled record intact with a newer run live; handler spec `:562` double-calls the callback, starts a second run, resolves the old run, and counts exactly one `timed-out` push for the old runId. Service spec at 12 min + 30 s asserts one `onTimeout` and one `onForceRelease`. Caveat N2. |
| S2 orphan `running` -> `starting` | FIXED | `generationRunState` returns `failed` + `interrupted` + `committedState: 'unknown'` for non-active `running` manifests older than 30 s (`wizard-generation-binding.ts:51-57, 76-90`); recent ones stay `starting`. `isActive` compares canonical paths on both sides (`wizard-generation-rpc.handlers.ts:259-269`), so a live run is never mislabelled. `findLatestResumableRun` accepts any non-`completed` lifecycle, so Resume works on an interrupted run. Contract fields added in `rpc-setup.types.ts`. | Real (spec `:473`, contract spec). Residual N3. |
| M1 timeout in commit window | FIXED (see N1) | Timer skips abort once committing (`service:330-333`); flag set only after `beforeCommit` succeeds (`:709-713`); post-commit `ensureActive` skipped (`:732-738`). | Real: "allows a committing run through the timer and past the designer timeout". |
| M2 thrown path no push | FIXED | Both paths use `broadcastGuidanceTerminal`, gated on a true `finish` (`handlers:764-787`). | Real. |
| M3 model error swallowed | FIXED | `if (error instanceof RpcUserError) throw error;` before Sentry and the generic reply (`wizard-generation-rpc.handlers.ts:387`); `submitReserved` is still released by the outer `finally`. | Real. Tabless cannot reach it (route resolved only when bound), so D10 is unaffected. |
| M4 `isTrusted` new paths | FIXED (lexical) | `workspaceRoot`, `tabBinding.workspacePath`, verified `source.analysisDir` validated (`checkpoint.service.ts:293-311`). | Real, 3 parameterized rejections. Lexical only, see N4. |
| M5 finalize failure on tabless | FIXED | `afterSettled` catches finalize, propagates written agents, then rethrows (`handlers:~877-905`): failure payload kept, files still synced. | Real, tabless regression at spec `:683`. |
| M6 path spelling | FIXED | Guidance stores the canonical host (`enhanced-prompts-rpc.handlers.ts:589-607`) and canonicalizes cancel/lookup after authorization (`:829-860`); agent submit/preview/cancel/retry store or pass the realpath (`wizard-generation-rpc.handlers.ts:307-308, 969-986, 1165-1185, 1290-1320`); `locateBound` and the resume owner checks use `sameWorkspacePath`. | Real (fake realpath `/FAKE/workspace` distinguishes raw and canonical). |
| M7 raw ZodError | FIXED | `safeParse` + `RpcUserError('Invalid catalog request.', 'INVALID_PARAMS')` (`setup-rpc.handlers.ts:519-524`); catalog criteria text no longer claims analysis (`:682-684`). | Real. |
| M8 parse before authorize | FIXED | Envelope check, then `authorizeTabWorkspace`, then parse with `analysisData` stripped for bound calls (`wizard-generation-rpc.handlers.ts:291-309`); the `analysisData` warning is tabless-only (`:361`). | Real. |
| M9 lock timeout 5 min | FIXED | `GENERATION_LOCK_TIMEOUT_MS = PROMPT_DESIGNER_TIMEOUT_MS + 2 min` = 12 min, declared after the designer constant (`service:228-233`); the designer timeout is live again. | Real (existing specs moved to 12 min). |
| Minor: pre-commit cancel reported `unknown` | FIXED | `finish` -> `unchanged` unless `committing` or forced `unknown` (`supervisor:81-85`). | Real. |
| Minor: wrong runId on own tab | FIXED | `sameOwnerTab` -> `not-running` (`supervisor:128-137`). | Real. |
| Minor: start during `cancelling` | FIXED | Returns `blocked` + own `ownerTabId` (`handlers:614-620`). | Real. |
| Cancel at timeout boundary | FIXED | `timeout()` no-ops on an already aborted (user-cancelled) controller (`supervisor:99-108`). | Real. |
| Cross-tab resume adoption | FIXED | `resume && tabBinding` loads the latest resumable; a trusted bound owner with a different tab or workspace returns `blocked` + `ownerTabId` before any state change (`wizard-generation-rpc.handlers.ts:453-476`); old unbound checkpoints can still be adopted (`:798-815`). | Real (two specs). Caveat N5. |
| Q2 model/provider after resume | FIXED | Route validated against the current provider and written to both `effectiveModel` and `input.model` (`checkpoint.service.ts:365-371`). | Real. |
| Q3 fabricated `anthropic`/`sonnet` | FIXED | Replaced by `unknown` in `binding.ts:71-72, 265-270`, `handlers:~853`, `run.supervisor.ts:326-327`. See reach check. | Real. |
| Preview rejection | FIXED | `preview-required` reason; confirmation checked with `consume=false` and deleted only after acceptance or a no-work completion (`handlers:482-496, 517-545`). | Real (spec `:405`, contract spec). |
| Retry race terminal push | FIXED | `.catch` reports the launch failure, then pushes one bound `failed` completion in a `finally` (`handlers:715-746`). | Real (`:702`). |

### Targeted checks

- Force-release vs late result: no double push and no overwrite. `finish` and `forceRelease` both require an exact `current` match; the lock is owner-scoped; broadcast failures are caught inside `createEnhanceStreamBroadcaster` (`:1061-1072`). Limitation: `settled` is a single slot, so once a newer run settles the old run's `lookup(runId)` returns `not-running`/`blocked` (`supervisor:140-179`). The terminal push is the primary signal (N2). A user-cancelled run that is then force-released reports `timed-out`, not `cancelled` (`supervisor:112`); Minor.
- Committing lock vs timer: correct on the bound path, but the flag is instance state (N1).
- Canonical-path comparison with a deleted folder: `authorizeTabWorkspace` and `sameWorkspacePath` fail closed on a `realpath` error (`binding.ts:34-36, 105-120`). With a deleted workspace, cancel/lookup return `invalid-binding`/`workspace-mismatch`, so the tab cannot cancel; the run fails by itself. Minor (M-a).
- Orphan with invalid `updatedAt`: `Date.parse` gives `NaN`, the comparison is false, the tab stays `starting` (N3).
- Preview retention after a failed launch: the key is tab + canonical workspace and the value is the full target signature (`consumeConfirmedPreview`, `binding.ts`). Changed targets fail the comparison; a stale confirmation matches only if targets return to the exact confirmed set, which is the intended meaning. No reuse hole found.
- `unknown` reach: produced only for UI state (`generationRunState`), the accepted response, and the supervisor completion payload when the request carries no route (`run.supervisor.ts:326-327`). Never written back to a manifest (`prepareResume` writes only truthy metadata, `checkpoint.service.ts:365-371`) and never fed to the orchestrator (`input.model` comes from the manifest). No non-UI consumer found.

### New findings

No Blocking or Serious findings.

- **N1 (Moderate). Shared commit flag can unguard a stale run.** `enhanced-prompts.service.ts:712, 732-738`: `generationCommitting` is an instance field reset at lock release. After a force-release a stale tabless or aborted run keeps executing; if a new bound run is inside its commit window, the stale run's `if (!this.generationCommitting) ensureActive()` is skipped, so it can still write `stateStore`/cache despite being aborted. Needs a force-released run plus a concurrent commit, so it is narrow. Fix: a local `let committing = false` inside `runWizard`; the instance flag is needed only for the timer. Follow-up in the next batch touching this service.
- **N2 (Moderate). Settled record is a single slot.** `guidance-generation-run.supervisor.ts:22, 94`. After a newer run settles, an older tab loses its `timed-out`/`cancelled` record on lookup. B07/B08 must rely on the push and treat `not-running` after reload as "outcome unknown"; or enlarge the slot to a small LRU later.
- **N4 (Moderate). Bound retry trust check uses the raw host root.** Retry hunk (`wizard-generation-rpc.handlers.ts:~1316-1330`) passes raw `workspaceRoot` to `locateBound`, and `isTrusted` compares the manifest's canonical `workspaceRoot`/`outputDirectory` lexically against it (`checkpoint.service.ts:290-298`; `isPathWithinRoots` is string-based). For a symlinked or junctioned workspace retry returns `not-running`. The `outputDirectory` half predates this revision; the revision adds two more paths to it. Fix: pass `canonicalWorkspace` (already computed). Next batch touching the file (B04).
- **N5 (Minor). A dead tab can own a paused run.** `wizard-generation-rpc.handlers.ts:453-476`. Resume from another tab is `blocked` with the dead tab's id; only a fresh run is possible. Correct per the cross-tab decision; B07/B08 must persist the tab id across reloads or offer "start over".
- **N3 (Minor). Unparseable or future `updatedAt`.** `binding.ts:51-54`: `NaN` or clock skew keeps `starting` indefinitely (the S2 symptom for a corrupt manifest). Fix: treat `Number.isNaN(Date.parse(...))` as stale.
- **M-a (Minor).** A deleted workspace blocks cancel (see above).
- **M-b (Minor).** Force release of a user-cancelled run reports `timed-out` instead of `cancelled` (`supervisor:110-115`).
- **M-c (Minor).** The grace-timer callback is `try/finally` with no catch (`service:342-346`); today's callees do not throw, but a throw would surface as an uncaught timer exception.

### Verdict (round 1)

APPROVE, 8/10. Every round-0 Serious and Moderate finding is fixed, and the regression specs I read would fail without the fix
(force release, orphan, cross-tab, path spelling, finalize propagation, preview). The remaining items are narrow or client-contract
concerns. Nothing must be fixed before commit. Cheap cleanups worth doing if a lane is already open: N1 (local commit flag),
N3 (NaN guard), N4 (pass `canonicalWorkspace` to retry). Otherwise carry N1/N4 into the next batch that touches these files and
N2/N5 into the B07/B08 briefs.
