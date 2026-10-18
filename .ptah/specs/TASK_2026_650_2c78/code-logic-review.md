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

---

## Phase 3 review (B04-B06)

Scope: commits 649e7a3cc (B04), f79b795ae (B05), ddf655a63 (B06) and, briefly, e0a4fec0a (Phase 2 follow-ups). Read in full: launcher, `TabManagerService` additions, route validator/persistence, shell, workflow store, event adapter, handoff store, open handler, `WizardRpcService` additions, host handoff (`setup-wizard.service.ts`, Electron service, `setup-agents-command.ts`). I also read the real `StreamingHandlerService.processStreamEvent`, `TurnStateApplier.apply` and `TabManagerService.acceptsTurnState/applyTurnState`, which the adapter spec replaces with a double. No heavy checks run.

| Metric | Value |
| --- | --- |
| Score | 5.5/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 3 |
| Moderate | 7 |
| Minor | 6 |

### Phase 2 follow-ups (e0a4fec0a)

N1 closed: the commit flag is a run-local `generationCommitting` and the lock-wide owner is only recorded when `generationOwner === owner` (`enhanced-prompts.service.ts:517, 710-716`); the timeout check reads `generationCommittingOwner !== owner` (`:330`). N3 closed: `NaN` from `Date.parse` makes an orphaned running manifest `interrupted` (`wizard-generation-binding.ts:54-55`). N4 closed: `canonicalWorkspace!` is safe because `retryBinding` is built only when `canonicalWorkspace` is set (`wizard-generation-rpc.handlers.ts:1297-1301`). No new issue.

### Serious (must fix before B07)

**S1. A second terminal on a never-chatted tab is rejected by the turn-state guard, so the transcript never finalizes and the tab stays "busy".**
- File: `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.ts:142-165` (revision at `:155`), against `tab-manager.service.ts:1760` and `acceptsTurnState` (`:1902-1940`).
- Scenario: a workflow tab has `claudeSessionId = null` (the normal case: the launcher created it and nobody chatted in it). Run 1 terminal: `last === undefined`, so it is accepted, and `applyTurnState` records `lastTurnStateRevision = 0`, `lastTurnStateSessionId = undefined`. Run 2 terminal (retry after failure or cancel, or a second generation): `bound` is null, `last = 0`, `0 > 0` is false, and the heal branch needs `Boolean(bound)`, so `canApplyTurnState` returns false. `TurnStateApplier.apply` then has no targets: it neither calls `finalizeCurrentMessage` nor `applyTurnState`. The run-2 wizard message stays as `streamingState.currentMessageId`. `isTabBusyGenerating` (`message-dispatch.service.ts:83-99`) then reports busy forever, chat Stop appears, and `canStartInChat` (`generation-workflow.store.ts:135-151`) rejects every later run with "Finish this chat reply first". A normal chat Send is queued and nothing drains it. Reload is the only exit.
- The adapter spec uses a streaming double, so it cannot see this. The comment "Same revision invokes the terminal heal" is only true for a tab bound to a real session.
- Fix: do not drive finalization through `turn_state` for a tab that has no real session. Preferred: use a narrow finalize call (for example `MessageFinalizationService.finalizeCurrentMessage(tabId, false)` plus the idle transition) for both cases, and add a spec that runs two terminals against the real `TabManagerService`/`TurnStateApplier`. If `turn_state` is kept for a null-session tab, use `(last ?? -1) + 1`.

**S2. The synthetic terminal is emitted for any terminal run observation, including a restored one, and on a real-session tab it overwrites real chat state.**
- File: `generation-run-event-adapter.ts:35-42, 142-165`.
- Scenario: `finish()` runs whenever the store shows a terminal run for the bound tab, even when this page lifetime never streamed a wizard message (`messageId === null`, and a fake `wizard-terminal-message-N` id is used). Example: the user generated agents, then chatted in the same tab (real session S), then switches to the other workflow tab and back, or reloads and reopens the shell. Bind refreshes the settled terminal run, `finish()` fires, and `acceptsTurnState` takes the same-floor heal (bound to S, `revision == last`, terminal). `TurnStateApplier.apply` then runs `finalizeCurrentMessage` on the tab's current tree, drains the session's hard-deny bucket, and `applyTurnState` forces `status = 'loaded'`, clears `_streamingTabIds`, calls `clearAbortController(tabId)` (`tab-manager.service.ts:1798`), and overwrites `pendingBackgroundTasks`, `pendingSessionCrons` and `lastTerminalReason` with `[]`, `[]`, `null`. Liveness is marked idle for S. If the real turn was streaming, awaiting background, or sleeping, it is finalized early and loses its abort controller and background-task list.
- Likelihood is low-to-moderate (a terminal run plus a live or background real session on the same tab), but the damage lands on the user's real chat.
- Fix: emit the closing event only when this adapter opened a message for the run (`this.messageId !== null`) and the tab's `streamingState.currentMessageId === this.messageId`. Skip it when the tab status is `streaming`, `awaiting-background` or `sleeping`. Prefer the narrow finalize call from S1 so no real-session fields are written. Add a spec using the real services with a tab that has a real session and an idle or streaming last turn.

**S3. The shell binding does not react to route param changes, so the guidance handoff from the agent tab lands on the wrong tab.**
- File: `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:61-66`.
- Scenario: the computed reads `this.route.snapshot.paramMap` but depends on no route signal. With the default `RouteReuseStrategy` (none is installed; `app.config.ts:278`, `app.routes.ts:47`), navigating from `/setup-wizard/generation/setup-agent-generation/A` to `/setup-wizard/generation/setup-project-prompt/B` reuses the same component instance and only updates the snapshot. Nothing in the computed changes, so the binding, the embedded `tabId` input and the store stay on tab A while the URL says tab B. `launcher.open` then calls `switchTab(B)`, which does not touch `tabs()`. Persistence stores the B URL; the chat renders A. This is exactly the agents-to-guidance handoff (`manualContinue`/`openAndStart` with `focus:true`). The spec mocks `ActivatedRoute` and never changes params.
- Fix: derive the params from `route.paramMap` with `toSignal` (initial value from the snapshot) and read that signal in the computed. Add a spec that emits a second param map on the same instance.

### Moderate (can wait with the batch named)

- **M1 (B07, store). Early events dropped.** `matches()` needs `workflow.run().binding.runId` (`adapter:187-197`), but `runValue` is only set after the start RPC returns (`generation-workflow.store.ts:157-165`). Stream pushes that arrive before the accepted response are discarded with no buffer, so the first lines of the transcript can be missing. Buffer pre-accept events for the binding, or set a provisional run on `starting`.
- **M2 (B07, store). A stale refresh can regress a terminal state.** `refresh()`/`applyRun` have no sequence guard (`store:178-199, 231-251`). A slower non-terminal response arriving after a terminal one flips the state back to running and re-enables the bound guard and Stop. Ignore non-terminal results once the same `runId` is terminal.
- **M3 (B07, store). No watchdog after a lost push or failed lookup.** A failed lookup maps to `quiet` (`store:178-190`) and nothing re-polls. The run stays "bound" until the user presses Stop (which does recover, via `stop-unconfirmed` then reread). Acceptable for now, but the shell needs a visible "status unknown, retry" action and a bounded re-check for `quiet`.
- **M4 (B07, handoff). `openAndStart` skips the busy check.** `GenerationHandoffStore.openAndStart` calls `startBoundGuidance` directly (`generation-handoff.store.ts:94`), not `canStartInChat`. A background start onto an existing guidance tab with a live chat reply starts a run whose events the adapter drops (not bound). It also reports `manual-recovery` when the backend answers "already running" (a `startNow` plus `manualContinue` pair overwrites `started`). Nothing calls `schedule`/`manualContinue` yet; wire it with the busy check and distinguish rejection kinds.
- **M5 (B07, open handler). Silent drops.** `SetupGenerationOpenHandler` ignores a payload whose `workspacePath` is not byte-equal to `activeWorkspacePath` (`setup-generation-open.handler.ts:20`) and discards the launcher outcome (`:21`). Host `fsPath` spelling versus the webview path (drive-letter case, separators) can differ, and a not-yet-bootstrapped main drops the push although `postMessage` returned true. The user sees nothing. Compare canonically and surface a toast or the panel retry on `failed`. The panel stays open (the B06 decision is right), so this is recoverable.
- **M6 (B07/B08, launcher). Workspace re-check after the await.** `launcher.open` verifies the active workspace only before `navigateToSurface`; after it, `switchTab(tabId)` and `landed` are returned even if the workspace changed during navigation (`generation-workflow-launcher.service.ts:55-63`). Re-check `activeWorkspacePath` after the await. The shell fails closed, so this is not a data leak.
- **M7 (B07, route restore). Validator timing.** The validator consults `getWorkspaceTabs` at restore time (`app.config.ts:190-203`); if initial navigation runs before the tab store is restored, the route fails closed and falls back to chat. Safe, but generation routes may never restore. Check the order in `initial-navigation.ts` when B07 adds the restore test.

### Minor

- `tool_result` uses its own new id as `toolCallId`, not the matching `tool_start` id (adapter event build), so tool nodes never pair until finalize. All deltas use `blockIndex: 0`, so text after a tool call lands in the first block (B07 polish).
- `terminalPushRunId` is set on any matching `setup-wizard:error` push; if the following reread returns a non-terminal run, later stream events for that run are dropped.
- A launcher failure after tab creation (navigation `failed` or `cancelled`) leaves an empty tagged tab (`launcher:36-60`). Severity Minor: the next `open` reuses it through `findWorkflowTab`, it holds no session or run, and nothing starts a backend run. No cleanup needed.
- `createTab(..., activate=false)` in an empty workspace leaves no active tab until `switchTab`; only reachable with `focus:false` in an empty partition.
- Double Stop issues `cancelBoundRun` twice (`store:171-176`); backend cancel is idempotent per Phase 2.
- Chat Stop and the shell Stop are both visible while streaming (duplicate controls, B07 polish).

### Focus-point answers

1. **Route/partition isolation: OK, apart from S3.** The launcher refuses `focus` for a non-active workspace (`launcher:30-32`). `addTabToWorkspace` now rejects a missing `afterTabId` (`tab-workspace-partition.service.ts:430`). An unloaded partition gives `getWorkspaceTabs() = []`, so there is no anchor, `createWorkflowTabForWorkspace` returns null, and the result is `failed`. The restored-route validator is applied in both `navigateToUrl` and persistence and fails closed when the token is absent (`!undefined?.()` is true). A workspace change makes the shell binding null, shows the unavailable alert and unbinds.
2. **Event adapter: IDs are clean, finalization is not.** The event is a closed whitelist, `sessionId` is omitted so `attachSession` is never triggered (`streaming-handler.service.ts:392-395`), run and SDK IDs are redacted in text, and `fanOut:false` plus `tabId` routing keeps `processStreamEvent` and `TurnStateApplier.resolveTabs` to the one tab. Wizard events do not set the tab to `streaming`; busy comes from `currentMessageId`, which is why S1 sticks. S1 and S2 are the real-service failures the double hid. A normal chat turn after a clean first run is unaffected (`applyNewConversationStreaming` resets the revision).
3. **Composer contract: correct.** `handleSend` returns the guard reason before `sendOrQueueMessage` (`chat-input.component.ts:1645-1646`); `ChatView` guards its other three send paths; nothing is queued. `handleStop` consults the handler first and returns on `handled` (`:1722-1726`), synchronously, so it never reaches `chat:abort`; the store `stop()` is `void` and an async error ends in `stop-unconfirmed` plus a reread (`store:200-225`). The separate shell Stop is the right call, not a deviation: chat Stop is gated on `isActiveTabStreaming`, which only becomes true once a wizard message is open, so before the first event (and after a finalize) there would be no Stop at all. Plan section 5 ("show chat Stop even during a quiet stream") is only partly met by chat Stop; the shell control closes the gap. Keep both.
4. **Launcher leftover tab:** Minor, see above.
5. **B06 panel retention: OK.** No auto close on a true `postMessage`; false or a throw returns `Result.err` and the handler returns false so the panel stays for retry; Close is untouched. The payload is exactly `{workspacePath, workflow, origin}` and the panel handler validates workspace equality, workflow and origin before sending (`setup-wizard.service.ts:93-100, 162-171`); no `analysisDir`. `ptah.setupAgents` accepts only the two literal workflow values from a possibly non-object argument; anything else keeps the landing. The unbootstrapped-main case cannot strand the user, only confuse them (M5).
6. **No backend start on open: confirmed.** Nothing in the launcher, shell, open handler or route restore calls `submit`/`runWizard`; only `startAgents`/`startGuidance` and the handoff store do, and no UI or route calls them yet (B07 owns wiring and the busy check, M4).
7. **Handoff store: OK as built.** The deadline is one `setTimeout(5000)` from `schedule` (the stored `guidanceStartDeadline` is never read, harmless); `skip` clears it; closing or removing the agent tab skips through the `tabs()` effect and `tabClosed`; a workspace switch does not cancel it and a background start works via the `afterTabId` anchor; a reload drops the timer with no recovery affordance (`outcome` has no consumer yet, B07).

### Verdict

REVISE (score 5.5). Route isolation, the composer contract and the host handoff are sound. The three Serious items are in code the batch specs could not catch because they stub the real chat services.

Must fix before B07 (revise round 1 of 2):
1. S1: terminal finalization must work for a null-session tab on the second and later runs (direct finalize or a monotonic revision), covered by a real-service spec.
2. S2: emit the closing event only when the adapter owns an open wizard message on that tab; never write real-session fields (`lastTerminalReason`, background tasks, abort controller, liveness) from the synthetic event.
3. S3: make the shell binding reactive to `route.paramMap` and add a param-change spec.

Defer M1-M7 and the Minor list to B07/B08 as labelled above.

---

## Phase 3 re-review (round 1)

Scope: uncommitted diff on `generation-run-event-adapter.ts` and `generation-workflow-shell.component.ts` (specs not re-run). I re-read the real `MessageFinalizationService.finalizeCurrentMessage`, `BatchedUpdateService.flushSync`, `TabManagerService.applyFinalizedTurn`, and the stream path of `StreamingHandlerService` to answer the coordinator's two questions.

| Finding | Status | Evidence |
| --- | --- | --- |
| S1 second terminal on a null-session tab | FIXED | `finish()` no longer sends a `turn_state`; it calls `finalizeCurrentMessage(tabId, false)` (`adapter:154-178`), which has no revision guard. Run 2 on the same tab finalizes the same way as run 1. |
| S2 synthetic terminal overwrites real chat state | FIXED for the case reviewed | No `turn_state`, so `lastTerminalReason`, background tasks, crons, abort controller and liveness are never written. Finalize runs only when `messageId`, `messageTabId` and `messageRunId` match the bound tab and run and the tab's `currentMessageId` is that message. A restored terminal run on a real-session tab has `messageId === null` and does nothing. A related leftover is N1 below. |
| S3 shell binding not reactive | FIXED | `toSignal(route.paramMap, {initialValue: snapshot.paramMap})` is read in the computed (`shell:60-69`); field order is valid (`route` is declared before it, injection context is the field initializer). |

### The coordinator's two questions

1. **Do the generator's forwarded events set the tab status to `streaming`? No.** The stream path in `StreamingHandlerService` only reads `activeTab.status` (`:281, 651-660`) and writes `streamingState`; it never writes tab status. Status becomes `streaming` only through `applyTurnState(generating)` and `markTabStreaming` (message sender), neither of which the adapter emits. So for a normal generator run the status is `fresh`/`loaded` and the early return on `streaming`/`awaiting-background`/`sleeping` is not taken; S1 does not come back. The guard fires only when a real turn is live, which is the intent. One loose end: `resuming` and `switching` are not in that guard; unlikely to coincide with a wizard message, Minor.
2. **Can `flushSync` plus `finalizeCurrentMessage` finalize a real message that became current in between? No.** The ownership check `tab.streamingState?.currentMessageId !== this.messageId` runs synchronously after `flushSync(tabId)` and `finalizeCurrentMessage` reads the same tab state and calls `flushSync()` again with no await or microtask in between (`finish()` is fully synchronous, `message-finalization.service.ts:144-156`). A real message that was already current earlier fails the id comparison. A real message cannot become current inside the call. Residual: `applyFinalizedTurn` flips the status in a microtask only if the tab is not in `_streamingTabIds`; a real `generating` that lands in that microtask is handled by that function's own guard (`tab-manager.service.ts:2252-2255`).

### New findings

**N1 (Serious). Ownership is dropped when the shell moves to another tab or workspace mid-run, which leaves the first tab permanently busy.**
- File: `generation-run-event-adapter.ts:38-50` (effect reset), `:154-178` (`finish` guard). Interacts with `generation-workflow.store.ts:135-151` and `conversation.service.ts:323-327`.
- Scenario: the agents run on tab A is streaming, so the adapter owns a wizard message in A's `streamingState`. The user opens the guidance tab B (the handoff path, or any tab or workspace switch). The store rebinds, `run()` becomes null, and the adapter effect sees `runId !== activeRunId` and sets `messageId`, `messageTabId`, `messageRunId` to null without finalizing. Events for A are now dropped (not bound), so the message is never closed. The run ends while the user is away. On return the store rebinds and rereads a terminal run; `finish()` sees `messageId === null` and returns. A's `currentMessageId` still points at the wizard message, so `isTabBusyGenerating` is true: chat Stop appears but does nothing (`abortCurrentMessage` logs "No active session to abort" for a null-session tab), a chat Send is queued, and `canStartInChat` refuses a new run. This is the S1 symptom reached by a different path, and it is the handoff flow the feature is built for.
- Before this revision the unconditional synthetic terminal happened to close it; the new ownership guard removed that by accident.
- Fix: do not forget the owned message when the binding changes. Either finalize it in the reset branch of the effect (before nulling, using the old `messageTabId`), or keep ownership in a map keyed by tab id and recognise adapter-owned messages by their `wizard-message-` id prefix, so `finish()` for any tab finalizes when `currentMessageId` carries that prefix. Add a spec: stream events for run R on tab A, rebind to tab B, rebind to A with R terminal, expect A not busy.

**N2 (Minor). Failed, cancelled and timed-out runs finalize as complete.** `finalizeCurrentMessage(tabId, false)` is used for every terminal status; pass `isAborted` for `failed`/`cancelled`/`timed-out` so unfinished tool nodes render as interrupted.

**N3 (Minor).** `terminalRunId` is set before the ownership guard, so a skipped finalize (live real turn on the tab) is never retried; the wizard message is then folded into the real turn's finalize. Acceptable, noted.

### Carried over, unchanged (B07/B08)

M1 to M7 and the earlier Minor list from the first Phase 3 review are untouched by this revision and remain scheduled as labelled there.

### Verdict

REVISE (round 2 of 2). Score 6.5/10. S1, S2 and S3 are fixed and the two coordinator questions come out clean. One Serious item (N1) remains, in the same ownership logic. It is small to fix, and it needs a real-service spec for the switch-away case so the same gap cannot return.

Must fix:
1. N1: keep or release adapter ownership correctly on rebind (finalize the old owned message before resetting, or recognise adapter-owned messages by id prefix), with a real-service spec for A to B to A.

Optional while in the file: N2 (`isAborted` for non-completed runs).

---

## Phase 3 re-review (round 2)

Scope: uncommitted `generation-run-event-adapter.ts` (plus round-1 diff). I did not run the specs. I read the full adapter and re-checked the interactions with `GenerationWorkflowStore.bind/refresh/unbind`, `canStartInChat` and the chat busy predicate from earlier rounds.

| Finding | Status | Evidence |
| --- | --- | --- |
| N1 ownership dropped on rebind | PARTIAL | Ownership now lives in `ownedMessages` per tab and survives rebind (`adapter:22-26, 175-196`). Return to the same shell tab finalizes through `bind` then `refresh` then the effect (`:38-50, 154-173`), and finalization deletes the entry so it closes once. The gap that remains is N5 below (closing depends on the shell being bound to that tab). |
| N2 failed/cancelled finalize as complete | FIXED | `finalizeCurrentMessage(tabId, status !== 'completed')` (`:168-171`). |
| S1 | no regression | Finalization has no revision guard; the entry is deleted after each close, so run 2 opens a new message. One exception: N4. |
| S2 | no regression | Nothing is written unless an owned entry matches the exact run and is still `currentMessageId`; no `turn_state` is ever emitted. |
| S3 | no regression | Shell file unchanged since round 1. |

### The coordinator's questions

1. **If the user never returns to tab A, does the terminal push finalize it? No.** `handleMessage` runs the push through `matches(message.payload)` (`:60-62`), which compares against the CURRENT binding and `run()` runId. While the shell is bound to tab B (or unbound by a workspace switch) the push for run A is dropped, and `finish()` is only reached from the effect for the current binding. A's owned message stays current in `streamingState`. **If the user then opens tab A through the normal chat (tab strip), nothing calls `bind`/`refresh`**, so A remains busy: `isTabBusyGenerating` is true via `currentMessageId`, chat Stop does nothing on a null-session tab (`conversation.service.ts:323-327`), a Send is queued, and the next run is refused by `canStartInChat`. It clears when the shell is next bound to A (launcher open, route, restore). That is recoverable through the feature's own entry points, so I rate it Moderate and deferrable (N5).
2. **Growth and leakage.** Keys are tab ids, which are unique and workspace-scoped in practice, and `matches()` includes `workspacePath`, so there is no cross-workspace leak. Size is bounded by the number of tabs that ever hosted a run. Entries are deleted only on a successful finalize; they are never removed on tab close, on a skipped finish, or when the tab is missing. That is a small bounded leak (Minor), but it causes the stale-entry bug N4.
3. **Regression to S1-S3: none**, apart from N4, which is a new edge in the new map.

### New findings

**N4 (Moderate, fix now: it is a two-line change). A stale ownership entry is reused for the next run on the same tab.**
- File: `generation-run-event-adapter.ts:175-196` (`ensureMessage`) and `:154-173` (`finish`).
- Scenario: a finish that returns early without deleting (a live real turn on the tab, `tab` missing, or an observation that never happened) leaves `ownedMessages[tab] = {messageId: m1, runId: R1}`. The next run R2 on that tab calls `ensureMessage`, finds the entry, sends no `message_start`, and streams into `m1` (which may already have been finalized by a real turn, or may be still current). On R2's terminal, `owned.runId !== binding.runId` makes `finish()` return, so R2's content is never closed and the tab is busy.
- Fix: in `ensureMessage`, treat an entry whose `runId` differs from the incoming run as stale: finalize it if still current, then replace it with a new message. Also delete the entry whenever `finish()` decides not to finalize (after setting `terminalRunId`), and drop entries when a tab closes.

**N5 (Moderate, defer to B07 with a named owner). Terminal push for a run on a tab other than the bound one is dropped, leaving that tab busy until the shell is bound to it.**
- Fix shape: handle `generation-complete`/`error` pushes by tab, not only by current binding. When the push's `tabBinding.tabId` has an owned entry with the same `runId`, finalize that message directly (aborted for `error`), without touching the workflow store. This is safe because it only closes the adapter's own transcript message; it makes no claim about run success. A second option is to make `canStartInChat`/the busy predicate ignore an adapter-owned message of a terminal run, but the push-by-tab fix is simpler.
- Owner: B07 (shell and handoff wiring), because B07 is where entering a generation tab from the strip and the agents-to-guidance handoff are wired, and the stuck state is only reachable through them. Put it in the B07 brief as an acceptance case: "A runs, user opens B, A completes, user opens A from the tab strip: A is not busy". If B07 instead routes strip clicks on workflow tabs through the shell, the existing `bind` then `refresh` path already covers this, and the item reduces to a regression spec.

### Carried over, unchanged

M1 to M7 and the Minor list from the first Phase 3 review remain scheduled for B07/B08 as labelled there.

### Verdict

APPROVE with deferrals. Score 7/10. No Blocking or Serious items remain: S1, S2, S3 and N2 are fixed, N1 is closed for the shell-return path, and the remaining gaps (N4, N5) are Moderate edge cases that need an earlier skipped or missed finish and recover through the feature's own entry points.

Fix with the next change to this file (cheap, no new risk): N4. Carry to the B07 brief: N5, plus M1 to M7.


## Phase 4 review (B07-B07D)

Scope: `git diff 9ddb2f0b7..f139d318f` (e1d173fa9, de74d39d5, 805de7457, f139d318f), read in full for the stores, adapter, shell, launcher, handoff store, selection list, run/next-steps/preview/packs/landing components, backend binding/checkpoint/handler/supervisor changes and the Zod manifest. Read-only review; no checks re-run. Revise round 1 of 2.

| Metric | Value |
| --- | --- |
| Score | 5/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 5 |
| Moderate | 9 |
| Minor | 6 |

Evidence for the score: the backend facts (B07C) are sound (committed-record sourcing, optional Zod fields, push and lookup share `resultDetailsFromManifest`), safe output holds, and the countdown is a single absolute deadline. What separates this from 7: five defects on likely paths (resume transcript silently dropped, model choice ignored, retry on the wrong contract and never reflected, selection reset by input churn, stale-run auto-start). What keeps it above 3: no data loss, no secret leak, no path to a false "nothing written" claim.

### Serious (must fix before B08)

**S1. Bound Resume reuses the run ID, so the adapter drops the whole resumed transcript and never finalizes it**
- File: `libs/frontend/setup-wizard/src/lib/services/generation-run-event-adapter.ts:47-51,121-122,189` with `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-binding.ts:331` (accepted `runId = prepared.manifest.runId`; `prepareResume` keeps `manifest.runId`).
- Scenario: a run ends `failed`/interrupted/`cancelled`/`timed-out`; the store shows it terminal and the effect calls `finish()`, which sets `terminalRunId = R` unconditionally (line 190). The user presses the new bound Resume. `accept()` in the store sets the same run ID R back to `starting`. `activeRunId` is unchanged, so `terminalRunId` is never cleared. Every stream event is rejected at line 121 as "late after terminal"; the second terminal's `finish()` returns at line 189, so the owned message is never finalized and can stay streaming.
- Impact: the headline recovery feature (B07D gap 4) works on the backend, but the chat tab shows no activity for the resumed run and the transcript message is left open. Parity row 23 (live transcript) fails exactly in the recovery case.
- Fix: in the effect, when `run.binding.runId` equals `terminalRunId`/`terminalPushRunId` and `!isTerminal(run.status)`, clear both markers (and drop the stale `ownedMessages` entry). Add an adapter spec: terminal R, then `starting` R, event accepted, then terminal R finalizes.

**S2. The tab model picker is never sent to the host; the user's model choice is silently ignored**
- File: `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts:118-135` (no `model` param), `generation-workflow.store.ts:99`, `generation-model-picker.component.ts:49-53` ("This is the tab model used by generation and chat."), `wizard-generation-binding.ts:364-388` (host falls back to `tiers.sonnet`).
- Scenario: the user picks Opus in the picker (it only writes `overrideModel` on the tab) and presses Generate. The RPC carries only `tabBinding` and the agent IDs; the host resolves `requestedModel = undefined` and runs the default tier. The "Run model" line then shows the host's value, which contradicts the control the user just set.
- Impact: AC19 and parity row 7 (model choice) regress silently; cost and quality differ from what the UI promised.
- Fix: send `model: tab.overrideModel ?? sessionModel ?? global` in `startBoundAgents` (the backend already validates it and raises `INVALID_PARAMS`), surface that rejection, and add a store/RPC spec asserting the param.

**S3. Per-item Retry uses the tabless `wizard:retry-item` contract and the result is never reflected**
- File: `wizard-rpc.service.ts:231-236` (`{ itemId }` only), `agent-generation.store.ts:95-116` (no re-discover after success), shell `generation-workflow-shell.component.ts:70-75`; backend `wizard-generation-rpc.handlers.ts:1340-1376` (tabless path uses `this.lastCheckpoint` and `this.lastGenerationOptions ?? {}`).
- Scenario: a checkpoint from a previous host session (or another run) is shown; Retry on a failed agent runs with process-wide options that are empty after a reload (default model/threshold, no enhanced prompt, no analysis dir) and, with `lastCheckpoint === null`, passes no `onAgentOutcome`, so the outcome is not written to the checkpoint. The UI re-reads nothing, so the row still says `failed` after a successful retry, and the user burns the 3-attempt cap.
- Impact: rows 25/27 are only nominally met. The bound retry contract (`tabBinding` + `runId`, handler lines 1317-1352) built earlier is unused by the page.
- Fix: when the page has a bound run, call retry with `{ itemId, tabBinding: {..., runId} }`; call `discover()` (or apply the returned outcome) after every retry/resume attempt; keep the tabless call only for a tabless checkpoint.

**S4. The selection list is reset or refetched whenever the shell's `binding` object is re-created**
- File: `generation-workflow-shell.component.ts:240-256` (`binding` computed depends on `tabs.tabs()` and returns a new object each time), consumed as `[binding]="current"` (line 93); `agent-selection-list.component.ts:119-131` (effect depends on `binding()`).
- Scenario: any change to the tab list re-evaluates the computed: choosing a model in the picker (`setOverrideModel` -> `updateTabInternal`), a title update, another tab streaming. In saved-analysis mode the effect re-runs `selected.set(state.selectedAgentsMap)`, discarding the user's toggles and "Select recommended / Deselect all" work; in catalog mode it fires another `wizard:recommend-agents` (60 s timeout) and flips `loading`.
- Impact: lost selection on a normal action (change model, then Generate), and needless backend work. Found by reading; not reproduced by a run.
- Fix: give the computed a structural `equal` (compare tabId, workspacePath, workflow), or key the effect on those three strings. Add a component spec that toggles, changes the tab model, and expects the selection to survive.

**S5. A one-time "analysis-result-continue" origin can start a guidance run against a stale, already-completed agent run**
- File: `libs/frontend/chat-ui/src/lib/services/generation-workflow-launcher.service.ts:51-72` (origin is recorded for an existing tab too), `generation-workflow-shell.component.ts:281-290,296-309`.
- Scenario: the user generated agents earlier in the "Generate agents" tab (run R completed with verified facts), re-ran analysis, and presses Continue. The launcher reuses the existing tab and records the combined origin. The shell consumes it, `store.bind` looks up R (`completed`, verified), and the effect schedules the five-second deadline. Guidance (a model run) starts although no agent generation happened in this flow.
- Impact: unrequested paid run after plain navigation; contradicts "after a verified committed agent outcome" in the plan. Skip exists, but a user who looks away loses.
- Fix: arm the countdown only for a run this shell instance saw leave a non-terminal state (starting/running -> completed), or only when the tab had no terminal run at bind time; also clear `combinedTabId` after the first `schedule` (see M3).

### Moderate

- **M1. Watchdog budget never resets across bindings.** `generation-workflow.store.ts:38,211-213`: `lookupFailures` is reset only on a successful lookup, not in `bind()`/`unbind()`/`accept()`. After three failures in one tab, every later tab or run gets no watchdog and sits in `quiet`. Reset it in `bind`, `unbind` and `accept`.
- **M2. Countdown flashes a huge number.** `generation-workflow-shell.component.ts:230-240`: `now` is refreshed only by the 250 ms interval after `pending()` is set; until the first tick `remainingSeconds` is 5 plus the time since the component was created, announced via `role=status`. Set `now` when scheduling.
- **M3. Countdown can re-arm after Skip.** `combinedTabId` stays set for the shell lifetime; `scheduledRunId` only dedups the same run ID (lines 306-315). Skip, then a retry/new run that completes, gives a second five-second auto-start. Clear it after the first `schedule()`.
- **M4. Leaving the page cancels the countdown, contrary to the plan.** `implementation-plan.md` line 97: "Route destruction or tab switch does not stop the countdown; tab close counts as Skip". The shell's `onDestroy` calls `handoff.skip()` (lines 318-324), and a param change that reuses the component does not cancel at all (inconsistent). Pick one behavior; if the plan stands, remove the destroy skip and rely on `GenerationHandoffStore`'s tab-removal effect. The plan also asks for a "will use" model/provider preview during the countdown; `agent-next-steps` has none (B08).
- **M5. Stale and double Resume offers.** Shell lines 58-76: the tabless "Resume saved run" card is discovered once at mount, has no `!store.isBound()` guard, and is not hidden after a bound run starts or completes. During a live bound run the user can press it (the host rejects; the user sees a generic error). It also appears next to the bound Resume for the same checkpoint, and a tabless resume of a checkpoint owned by another tab runs without any tab binding (the backend owner check is only in the `tabBinding` branch, handler lines 455-476), so it produces no transcript. Hide the card while bound/terminal, re-discover after Resume, and offer only the bound path for a tab-owned checkpoint.
- **M6. Retry counters are global and never reset.** `agent-generation.store.ts:17,95-99`: keyed by agent ID in a root singleton, not by workspace/run. Three retries of `x` in any run lock `x` out of Retry in every later run and workspace until reload. Key by run ID or clear in `discover()` when the run changes.
- **M7. Stale `verifiedResult`/`propagation` after `prepareResume`, and misleading consent text.** `wizard-generation-checkpoint.service.ts:360-377` copies `...manifest`, so a resumed run starts with the previous `verifiedResult` and `propagation`; an interrupted resumed run then returns the old facts (`wizard-generation-binding.ts:162`). Separately, `wizard-generation-rpc.handlers.ts:903-913` records `{consent:'not-granted', status:'not-attempted'}` when a resume writes nothing, overwriting an earlier `completed`/`granted` record, and the panel prints "consent: not-granted" (shell lines 144-146). Reset both fields in `prepareResume`; do not overwrite a completed propagation with `not-attempted`; word the panel as "not attempted".
- **M8. Push and lookup can disagree after a post-settlement failure, and the monotonic guard prevents repair.** `wizard-generation-rpc.handlers.ts:904,923-927` can throw (`recordPropagation`, `loadAt`) after `finalize` succeeded; the supervisor (`wizard-generation-run.supervisor.ts:299-312`) then pushes `failed` with "finalization failed" and no facts, while the committed checkpoint says `completed` with `verifiedResult:true`. The store keeps the pushed terminal because `previous.result` exists (`generation-workflow.store.ts:271-276`). Catch propagation-recording errors separately (log, omit propagation), and let a lookup with `completed` verified facts replace a `failed` result whose only cause was finalization.
- **M9. Restore validator accepts any restored tab while no workspace is active.** `apps/ptah-extension-webview/src/app/app.config.ts:44-58`: when `activeWorkspacePath` is falsy it returns true for a tab in any workspace. The shell later renders "unavailable in this workspace" (safe, no cross-workspace data), but the restored route is not revalidated after workspace selection, so the user can be left on that dead page. Re-run the validator when the workspace becomes active, or fall back to the landing route.

### Minor (can wait)

- m1. `agent-next-steps.component.ts`: the manual-recovery "Skip guidance" calls `handoff.skip()` with nothing pending - a no-op button. (B08)
- m2. `generation-run-event-adapter.ts:33,106-111`: `pendingEvents` is never purged on unbind or tab close (up to 100 raw payloads per tab kept) and overflow drops the newest events silently. Cross-run replay is prevented because replay goes through `matches()`; this is only memory and partial transcript. (B09 cleanup)
- m3. Launcher `launchIntents` entries for `setup-project-prompt` tabs are never consumed (the shell consumes only for the agent workflow), and entries for tabs that never mount stay until reload. Bounded by tab count; delete on guidance shell bind or key by (tabId, workflow). (B08)
- m4. `wizard-landing.component.ts` `open()` shows "could not be opened" for `cancelled` (user declined a guard). Treat `cancelled` as no error.
- m5. `wizard-generation-rpc.handlers.ts:1051` preview warning embeds `harnessRoot` (an absolute path) and the dialog prints `current.warning` raw. Pre-existing, but it contradicts the safe-output rule; send fixed text.
- m6. Zod `propagation.targets` uses `z.enum(HARNESS_TARGET_IDS)` (`generation-checkpoint.types.ts`): a future change to that id list would make old manifests fail to parse as a whole. Use `z.array(z.string())` and filter on read. Old checkpoints without the new fields parse fine today.

### Parity table (rows 4-27, 35)

| Row | Capability | Reachable where | Status |
| --- | --- | --- | --- |
| 4 | Launch from chat setup card | `SetupGenerationOpenHandler` -> launcher; landing card | OK; handler notice shows only on legacy pages |
| 5 | VS Code panel / Close | legacy path plus tab open | OK |
| 6 | Wizard step navigation | `wizard-view` stepper kept; landing cards open independent tabs | OK |
| 7 | Provider and model choice | landing "Provider and model for analysis" (collapsed) + tab picker | PARTIAL: tab model not sent (S2); provider is workspace-scoped per D11 |
| 8 | Resume unfinished analysis | `scan-progress` runner (`resumableAnalysis`, `ensureStarted`) via landing "Run analysis" | OK (not on the landing itself) |
| 9 | Four phase files / hand-off | untouched | OK |
| 10 | Browse/load analyses | landing "Previous analyses" and old Welcome | OK |
| 11 | Use saved analysis | landing `use()` mirrors Welcome | OK |
| 12 | Hide saved analysis | landing `hide()` | OK |
| 13 | Continue / Let Me Adjust | `analysis-results` unchanged + open-handler notice | OK |
| 14 | Cancel and partial recovery | scan-progress unchanged | OK |
| 15 | Recommendations / catalog | `agent-selection-list` (catalog mode via `wizard:recommend-agents`) | OK, see S4 |
| 16 | Select / recommended / deselect | selection list | OK; selection resets (S4) |
| 17 | Community packs | `community-packs-panel` (lazy browse, install one/all) | OK |
| 18 | Preview and renewed confirmation | preview dialog + `definiteTargets` compare | OK |
| 19 | Generate + submit errors | list -> `store.startAgents`; fixed copy | OK; model missing (S2) |
| 20 | Authorization / freshness | backend; source card | OK |
| 21 | Self-discovery / templates | backend | OK |
| 22 | Progress and failure counts | final counts in verified panel; saved-progress list | PARTIAL: no live per-item/overall progress during a bound run (transcript only) |
| 23 | Live transcript | adapter | PARTIAL: dropped on Resume (S1) |
| 24 | Cancel / no duplicate completion | Stop control, store, terminal monotonic | OK (M8 caveat) |
| 25 | Checkpoint / resume / retry | checkpoint offer, bound Resume, Retry | PARTIAL: S1, S3, M5 |
| 26 | Old-checkpoint offer | first-open tabless offer, read-only `discover` | OK (no start, no overwrite) |
| 27 | Retry cap / backoff | store: 3 attempts, 1/2/4 s, duplicate guard, remaining | OK in isolation; global counters (M6), result not reflected (S3) |
| 35 | Prompt failure / retry / skip / continue | next-steps Continue/Skip, manual recovery, handoff `manual-recovery` | OK for hand-off; guidance retry/skip belongs to B08 |

Nothing is unreachable: the old Welcome lives in the collapsed "Analysis and recovery options"; `<details>` keeps it instantiated, it duplicates landing's saved-analysis list, and its provider/model block still works.

### Focus checks
1. Parity: see table.
2. Safe output: `source.analysisDir` is not rendered or logged (`generation-source-status`; the `console.debug` in the open handler has no path). The adapter redacts it by exact string match only, so a differently-separated path in generator text passes through (low risk). Bound outcomes carry basenames (`basename(agent.filePath)`) and fixed error text. Unknown provider/model are hidden in store, picker and preview. No `[innerHTML]` introduced. Cancel copy ("Stopping may take a moment. Saved results remain available.", "Verified results unavailable") never claims nothing was written. Open item: m5.
3. Checkpoint: `discover()` is read-only and `resume()` explicit; resume keeps completed outcomes but reports them as `unchanged` (a resumed run shows "written 0, already current N" for agents written in the earlier attempt; push and lookup agree, but a copy line would help).
4. Retry: backoff, cap and duplicate guard are correct in `agent-generation.store.ts`; see S3, M6.
5. Countdown: one `setTimeout` plus a derived absolute deadline, cleaned on skip, tab removal and destroy. The origin Map is consumed once and not persisted. Leak/wrong-tab: keyed by tab ID so the wrong tab cannot consume it; unconsumed entries leak per tab (m3). Start twice: not on re-render (`scheduledRunId`), but yes after Skip plus a later run (M3). Returning to the tab does not restart it (origin consumed, new instance has none) except via S5.
6. B07C backend: facts come only from the re-loaded committed manifest; marker and propagation are optional Zod fields (old checkpoints parse; `lifecycle==='completed'` also yields facts for old records); tabless payloads are untouched (`settled.resultDetails` is set only when `bound`; `completeWithoutWork` adds facts only inside the `tabBinding` branch); failed-without-payload omits facts (`verifiedResult=false`). Issues: M7, M8, m6.
7. Store/adapter: terminal monotonicity is correct apart from M8; the watchdog is bounded (3 tries, 1/2/4 s) and released on bind/unbind/terminal apart from M1. The pre-start buffer is keyed by tab and replayed only through `matches()` (workspace, workflow, exact run ID), so buffered events cannot be replayed into another run or tab; S1 is the real adapter defect.
8. Restore validator: yes, it accepts a tab from another workspace while no workspace is active (M9); the shell re-checks, so nothing from that workspace is shown.

### Test depth
The short specs (run card, progress, next-steps, errors, stop, source, workflow card) assert rendering and one emit only. Missing regression tests that matter:
- Adapter: Resume of the same run ID after a terminal (S1); buffer purge and overflow (m2).
- RPC/store: `model` param sent on bound start (S2); retry sends `tabBinding`+`runId` and the checkpoint is re-read (S3); `lookupFailures` reset across bindings (M1).
- Selection list: selection survives a tab-list change (S4); catalog fetched once per binding.
- Shell/launcher: combined origin on an existing tab with a completed run does not schedule (S5); no second schedule after Skip (M3); correct countdown on first render (M2); leaving-the-page behavior (M4).
- Backend: `prepareResume` clears `verifiedResult`/`propagation` (M7); `recordPropagation` failure does not turn a committed `completed` into a pushed `failed` (M8); manifest parses with and without the new optional fields.
- Agent store: retry counters scoped per run; a successful retry updates visible status.

### Must-fix before B08
S1, S2, S3, S4, S5, plus M7 and M8 (cheap, backend-side). M1-M6, M9 and the minors may follow with B08/B09, each with a spec from the list above.

### Decisions
- Treated the plan's "route destruction does not stop the countdown" (implementation-plan.md line 97) as authoritative over the shipped `onDestroy` skip (M4), because D11 makes the plan the authority; reversible, and the plan can be amended instead if cancel-on-leave is the intended behavior.

## Phase 4 re-review (round 1)

Review family: Claude; implementer family: codex.

Scope: uncommitted working tree on top of f139d318f (`git diff -- libs/`, 18 source and spec files), read against `lane-P4R1A-report.md` and `lane-P4R1B-report.md`. Read-only; no checks re-run (orchestrator reported typecheck, lint and tests green for the six projects).

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVE |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 2 new |
| Minor | 3 new |

Evidence for the score: all five Serious findings and both must-fix Moderates are closed with a pinned regression spec. The remaining new items are cosmetic or rare-path. Not higher than 7 because the S1 and M8 correction paths leave one visible inconsistency (N1) and the retry cap has an untested reset edge (N2).

### Status of prior findings

| Finding | Status | Evidence file:line | Regression spec |
| --- | --- | --- | --- |
| S1 resume transcript dropped | FIXED. Effect clears both terminal markers and the stale owned message when the same runId turns non-terminal. Late non-terminal lookups cannot reopen a finished run because `applyRun` drops them for a terminal same-run state (`generation-workflow.store.ts:281-297`); only `accept()` writes `starting` directly. | `generation-run-event-adapter.ts:48-62` | `generation-run-event-adapter.spec.ts:209,318` |
| S2 model ignored | FIXED. `overrideModel ?? currentModel()` sent on start and resume; an empty `currentModel()` is falsy and falls to the host default. | `wizard-rpc.service.ts:125-135` | `wizard-rpc.service.spec.ts:349` |
| S3 retry contract / not reflected | FIXED. Bound retry sends `tabBinding` with `runId`, rejects unsuccessful data, then calls `discover()`. Tabless path kept only when the checkpoint run is not the current bound run. | `wizard-rpc.service.ts:238-251`; `agent-generation.store.ts:99-118`; `generation-workflow-shell.component.ts:70-75` | `wizard-rpc.service.spec.ts:303`; `agent-generation.store.spec.ts:69` |
| S4 selection reset on binding churn | FIXED. Binding computed has an identity `equal`; list tracks identity only. | `generation-workflow-shell.component.ts:270-294`; `agent-selection-list.component.ts:206-225` | `agent-selection-list.component.spec.ts:153,170` |
| S5 stale-run auto-start | FIXED. Combined guidance gated on an `acceptedRun` revision recorded in `accept()`. | `generation-workflow.store.ts:39,182-186`; `generation-workflow-shell.component.ts:325-349` | `generation-workflow-shell.component.spec.ts:25` |
| M6 retry counts across runs | FIXED. Counts reset when the bound run id changes. | `agent-generation.store.ts:23,103-108` | `agent-generation.store.spec.ts:69` |
| M7 stale facts on resume / misleading consent | FIXED. `prepareResume` drops `verifiedResult` and `propagation`; earlier completed propagation restored only on a zero-write resume; UI says "not attempted". | `wizard-generation-checkpoint.service.ts:356-366,392-399`; `wizard-generation-rpc.handlers.ts:844-858,935-945`; `generation-workflow-shell.component.ts:153,225` | `wizard-generation-checkpoint.service.spec.ts:175`; `wizard-generation-rpc.handlers.spec.ts:286`; shell spec `:14` |
| M8 post-finalize failures flip a committed run to failed | FIXED. Propagation persistence and committed reload are caught with degradation-audit comments and omit unrecorded facts; a precise `finalizationFailed` marker lets the store accept a verified completed lookup, only for that failure. | `wizard-generation-rpc.handlers.ts:919-975`; `wizard-generation-run.supervisor.ts:302-319`; `generation-workflow.store.ts:285-298`; `rpc-setup.types.ts:66` | `wizard-generation-rpc.handlers.spec.ts:320,352`; `generation-workflow.store.spec.ts:33` |

### Evaluation of the named points

- `retryGenerationItem` fixed message (`wizard-rpc.service.ts:246-250`): correct per the plan (no raw host text in the UI). The only other caller, `generation-progress.component.ts:538-541`, catches and uses its own fixed message, so no caller loses information.
- `TabManagerService` from `@ptah-extension/chat-state` in `wizard-rpc.service.ts:3,83`: direction is fine; setup-wizard already depends on chat-state (selection list, shell, handoff store, landing). No cycle introduced.
- Supervisor `finalizationFailed` (`wizard-generation-run.supervisor.ts:302-319`): set only when `onSettled` throws, and all post-finalize steps that previously threw are now caught, so the overwrite of `resultDetails` can only drop facts from a run whose finalize really failed. Acceptable.
- `AgentGenerationStore.retry` reset: stable for a given checkpoint because the binding argument is derived from the matching checkpoint run id (see N2 for the edge).

### New findings

Moderate
- N1. After the finalization-failure correction (failed to completed, same runId), the transcript message stays finalized as an error. `finish()` returns early on the already-set `terminalRunId` (`generation-run-event-adapter.ts:199`), so a run the store now reports as completed keeps an error-styled message. Rare path (finalize threw but manifest committed); no data loss. Fix: in the effect, clear `terminalRunId` when status changes between terminal values, or let `finish()` re-finalize on a corrected status. Defer to B08.
- N2. `retryRunId` flips between `null` and a run id when the shell passes `undefined` (checkpoint run differs from the current bound run) and later a binding (`agent-generation.store.ts:103-108`). Each flip clears all counts, so the 3-attempt cap can be reset by an action that changes which run is bound. No spec covers the flip. Low likelihood; the backend remains the real guard. Defer to B08.

Minor
- N3. `discover()` failure after a successful retry sets `errorValue(true)` (`agent-generation.store.ts:117-119`) and shows a retry error although the retry succeeded. Separate the two awaits.
- N4. `startBoundAgents` rejection with `INVALID_PARAMS` for an unavailable model surfaces only as "Start unconfirmed" (`wizard-rpc.service.ts:138-139`); the user gets no model-specific message. Defer.
- N5. When `finalizationFailed` is set, `settled.resultDetails` is replaced wholesale (`wizard-generation-run.supervisor.ts:319`), discarding any propagation facts already attached. Harmless today; note for B09 if more fields are added.

### Must-fix before commit

None.

### Defer to B08/B09

1. N1 (error-styled message after corrected completion) and N2 (retry count reset on run binding flip), with specs.
2. N3, N4, N5 (minor).
3. Carry-over from the Phase 4 review: M1-M5, M9 and m1-m6 remain as recorded in that section; none was in this round's must-fix set.
