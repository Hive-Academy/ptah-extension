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

## Phase 5 review (B08)

Review family: Claude; implementer family: codex.
Scope: `git diff 5b447dc96..5373c65a2 -- libs/ apps/` (B08A, B08B, B08C), read in full: both stores, the guidance page, run card, result panel, shell, handoff store, next-steps, RPC service diff, handler/supervisor paths. Lane reports treated as claims. No checks re-run; the orchestrator's passing results are taken as given. Passing specs do not cover the two Serious findings because the page spec mocks both stores and the guidance-store spec drives code the UI never calls.

**Verdict: REVISE. Score 5.5/10.** 0 Blocking, 2 Serious, 7 Moderate, 4 Minor.

Separating evidence: the host contract, committed-state gating, tabless compatibility, privacy and the B08C fixes are sound (7 band). The page that ships reads the wrong store for every run after the first, and rejections vanish (below the 6 band).

### Acceptance table

| AC / parity | Status | Evidence |
| --- | --- | --- |
| Start without analysis, derived source label, no `analysisDir` | PASS | `guidance-generation.store.ts:36-40` uses only `kind`/`reason` (reason is a closed union, `rpc-setup.types.ts:28`); page renders `guidance.source()` only |
| Accepted provider/model, unknown hidden | PARTIAL | `guidance-run-card.component.ts:21-27` is right, but the snapshot is stale after any second run (S1) |
| Success only from committed host state; `unchanged` | PARTIAL | Gate at `guidance-generation.store.ts:187-196` is correct and host `finish()` yields `committed` only on completed (`guidance-generation-run.supervisor.ts:84`). The page reads it only via the stale store (S1); shell sr-only `store.state()` (`generation-workflow-shell.component.ts:54`) reports ungated `completed` (m3) |
| Stop in a quiet stream cancels the exact run | PASS | `generation-workflow.store.ts:227-283`; page `generation-guidance-page.component.ts:33,81-82`; spec `generation-workflow.store.spec.ts:344-369` |
| Lost start/stop response reread, own-tab lookup | PASS (workflow store) | `generation-workflow.store.ts:154-156,265-283`; host start idempotent per tab (`enhanced-prompts-rpc.handlers.ts:629-650`). Guidance-store equivalents are dead code (M-g) |
| Reload neutral status unless cancellation verified | PASS | `guidance-generation.store.ts:188-190`, spec `:101` |
| Two stores do not disagree | FAIL | S1 |
| Rejections / busy-chat feedback | FAIL | S2 |
| Combined continuation (deadline once, same-workspace tab, manual fallback, never chains, Skip keeps agent outcome) | PASS with M-d | `generation-handoff.store.ts:39-120`, shell effect `generation-workflow-shell.component.ts:402-417`; independent guidance has no scheduler |
| Timer survives page destruction (plan line 97) | PASS | Root store timer `generation-handoff.store.ts:48`; shell has no destroy hook; spec `generation-workflow-shell.component.spec.ts:144-145`, `generation-handoff.store.spec.ts:65` |
| Tabless compatibility; optional validated regenerate `model` | PASS | `enhanced-prompts-rpc.schema.ts:62` (`min(1).max(200).optional()`), `rpc-setup.types.ts:564`, `wizard-rpc.service.ts:173-193`; bound handler reads `'model' in params`; schema and handler specs added |
| Privacy: no raw paths, no `[innerHTML]`, no raw host error text | PASS | No `innerHTML` in the new files; saved content interpolated inside `<pre>` (`generation-guidance-page.component.ts:67`) and pinned by the page spec; RPC service throws fixed text only (`wizard-rpc.service.ts:141-146`) |
| Parity rows 27-34 | PARTIAL | Rows that depend on live status (retry, regenerate result) inherit S1/S2; enabled toggle, cache, content, download exist (M-b, M-c) |

### B08C claims

| Item | Verdict | Evidence |
| --- | --- | --- |
| M1 | Real | `generation-workflow.store.ts:77,208` reset `lookupFailures` on bind/accept |
| M2, M3 | Real | `generation-workflow-shell.component.ts:268-277,418-423` |
| M4 | Real, pinned | Shell spec `:144-145` |
| M5 | Real | Shell `:94,109` |
| M9 | Real, pinned (validator only) | `app.config.ts:55-56`, `webview-routing.spec.ts:226-241`; see M-f |
| m1 | Real, pinned | `generation-handoff.store.ts:55`, next-steps spec `:34` |
| m2 | Real, pinned | Adapter `:70-79,130-139`, spec `:271` |
| m3 | Real, pinned | Shell `:361`, spec `:15` |
| m4 | Real | `wizard-landing.component.ts:251-264` |
| m5 | Plausible, not traced | `wizard-generation-rpc.handlers.ts:1088` |
| N1-N3 | Real, pinned | Adapter `:216-271`, agent store `:105-125`, specs |
| N4 | Real for agents only; guidance path drops the message (S2) | `generation-workflow.store.ts:115-124`; `submitGuidance` has no equivalent |
| Audit comments | Correct | All sit on logged or intentionally retried swallows (`wizard-generation-binding.ts:102,216`, `wizard-generation-rpc.handlers.ts:1785`, `generation-workflow.store.ts:292`, adapter `:108`) |

### Blocking

None.

### Serious

**S1. The guidance page's run card, snapshot and post-run status go stale after any run other than the first (two stores disagree).**
- Files: `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts:155-158,169-170,173-180`; `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.ts:78-86`; `libs/frontend/setup-wizard/src/lib/components/generation-workflow-shell.component.ts:387-390`.
- Scenario: the UI starts runs only through `GenerationWorkflowStore` (`page:34,41,59`). `GuidanceGenerationStore` never learns the new `runId`: its snapshot is set once (`:173`) and every `refresh()` looks up `snapshot.runId`. The host keeps a single `settled` run, so a lookup of old run X while Y is current returns X, and after Y settles it returns `not-running` (`guidance-generation-run.supervisor.ts:153-179`). Once the workflow store is no longer bound, the page shows `guidance.status()` (`page:85`).
  - (a) Run fails, user clicks Retry, Y succeeds: card still says "Guidance was not saved" with Retry, while the result panel shows saved guidance.
  - (b) Page reloaded (restoring, status idle), user clicks Generate, Y completes: card says "No active guidance run" and shows X's provider/model.
  - (c) Regenerate with a different model: card shows the old provider/model; the "already current" note keys off X's `committedState` (`page:47`).
- Impact: the user is told the opposite of the committed outcome, which is what the "success only from committed host state" criterion exists to prevent.
- Fix: one source of truth. Either make the guidance store adopt the workflow store's run (an `adopt(run)` that resets snapshot, `runValue` and `restoring` when `run.binding.runId` changes, called from the shell effect), or have `refresh()` request the workflow store's current `runId`. Keep the committed gate on the path the page reads. Add an integration spec with real `GenerationWorkflowStore` and `GuidanceGenerationStore` over a fake RPC: fail, Retry, success, and regenerate with a new model.

**S2. The guidance page drops start rejections and the busy-chat message, so a click can do nothing visible.**
- Files: `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.ts:37-45,59`; `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:144-157,180-184,200`. Rejection UI exists only in the agent branch (`generation-workflow-shell.component.ts:112-131`, `agent-selection-list.component.ts:125-144`).
- Scenario: Generate or Regenerate while a chat reply is streaming (`canStartInChat` sets `chatTurnRejection`), while another tab holds the guidance reservation (`blocked`), on `workspace-mismatch`, or when the provider/model cannot be resolved ("Guidance provider is unavailable"). The store sets state and signals; the guidance page renders none of them. A thrown start error is swallowed at `:154-156`; the N4 message is set only in `startAgents`.
- Impact: silent no-op on a primary action; N4 is not delivered for guidance.
- Fix: render `workflow.rejection()` (fixed text per reason, `ownerTabId` omitted), `chatTurnRejection()` and a guidance `startError` in `ptah-generation-guidance-page`; set `startError` in `submitGuidance`'s catch like `startAgents`. Spec each reason.

### Moderate

- **M-a "Check again" does nothing for the guidance store's own unknown state.** `page:35` calls `workflow.refresh()`, but `unknown` comes from `guidance.status()` (`guidance-generation.store.ts:159-162`), which only refreshes when `store.run()` changes. A failed lookup at bind leaves the card stuck. Fix: wire `refreshRequested` to both stores, or resolve via S1.
- **M-b `actionFailed` is sticky and the toggle is not reverted.** `guidance-generation.store.ts:238,249,262,275` set it; only `submit()` (unused by the UI) and bind clear it. One failure keeps the alert after later successes. The uncontrolled checkbox (`guidance-result-panel.component.ts:27-33`) stays flipped when `setEnabled` fails. Fix: clear at the start of each action; re-read committed state on failure so `[checked]` is re-asserted.
- **M-c Stale content view after regenerate.** `content` is cleared only on bind/unbind (`guidance-generation.store.ts:78,90`), so "Saved guidance" keeps previous text after a new commit. Fix: clear when `generatedAt` changes. A `null` from `loadContent` gives no feedback (`:253-260`).
- **M-d Handoff outcome is wrong while opening.** `startNow`/`manualContinue` call `skip()` (`generation-handoff.store.ts:65,76`), which sets outcome `skipped`, so next-steps says "Project guidance skipped" during the open and RPC. After `started` there is no acknowledgement and the Continue invitation remains (`agent-next-steps.component.ts:39-52`). Fix: split a private `clearTimer()` from user-facing `skip()`; show a started line.
- **M-e Effect tracks guidance signals and fans out.** `shell:387-390` calls `guidance.refresh()` synchronously inside an `effect`, so its binding and snapshot reads become dependencies; at bind that is two identical concurrent refreshes plus one more when the snapshot is set. Bounded, not a loop. Fix: `untracked(() => void this.guidance.refresh())`.
- **M-f M9 restore ordering unverified end to end.** The validator now fails closed with no active workspace (`app.config.ts:55`); only the pure function is pinned. If the router restores before the workspace activates on a normal reload, the restored route drops to landing. The docstring at `:40` is now false. Fix: confirm the ordering or re-validate on workspace activation; correct the comment.
- **M-g Dead duplicate run engine.** `GuidanceGenerationStore.start/retry/regenerate/stop/submit` (`:93-148`) have no non-spec caller. The lost-response and exact-Stop specs (`guidance-generation.store.spec.ts:118,132`) exercise this dead path; the live path is the workflow store. Fix with S1: delete the dead methods or use them, and move the specs to the live path.

### Minor

- m1. Regenerate and Generate are not disabled while a run is bound; the click is a silent early return (`generation-workflow.store.ts:141`).
- m2. Between workflow terminal state and the guidance store's async refresh the card shows the last `guidance.status()` (running plus Stop) and Stop then no-ops (`stop()` requires `isBound`). Resolved by S1.
- m3. Shell sr-only live region prints raw `store.state()` (`shell:54`); `completed` is announced without the committed gate.
- m4. `generatedAt` is printed as a raw ISO string (`guidance-result-panel.component.ts:21`).

### Must-fix before B09

1. S1 — `libs/frontend/setup-wizard/src/lib/services/guidance-generation.store.ts:155-180`, `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.ts:78-86`, shell effect `generation-workflow-shell.component.ts:387-390`: one run source; rebase snapshot/run/restoring when the workflow store's run changes; add the two-real-stores integration spec.
2. S2 — `libs/frontend/setup-wizard/src/lib/components/generation-guidance-page.component.ts` and `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:154-156`: render rejection, busy-chat and model-unavailable messages on the guidance page, with specs.

### Defer

M-a through M-g and m1-m4 (M-a and M-g fall out of S1 if done as suggested; M-f needs a workspace-activation ordering check). B08C m6 and N5 stay deferred as recorded by the lane. Regressions worth adding alongside the fixes: guidance rebind mid-run; Start now and deadline firing with the shell unmounted (real handoff store, fake launcher); toggle-failure revert; content refresh after regenerate.

Review family: Claude; implementer family: codex

## Phase 5 re-review (round 1)

Review family: Claude; implementer family: codex.
Scope: `git show 70f2bac04`; read in full: `guidance-generation.store.ts`, `generation-workflow.store.ts`, `generation-guidance-page.component.ts`, the shell effects and template head, `generation-handoff.store.ts`, `agent-next-steps.component.ts`, `guidance-result-panel.component.ts`, `app.config.ts` validator and its two callers in `libs/frontend/core/src/lib/routing/`, the host guidance start handler (`enhanced-prompts-rpc.handlers.ts:600-700`) and the new specs. No checks re-run (orchestrator results taken as given). Passing specs do not pin two of the new Moderate findings below, because the reload scenario is only tested on the guidance store alone and the toggle revert only at store level.

**Verdict: APPROVE. Score 7.5/10.** 0 Blocking, 0 Serious, 4 Moderate (new or residual), 3 Minor. S1 and S2 are fixed on the paths users take. Separating evidence from 8: a reload now bypasses the "neutral status" rule (N1), a failed toggle can leave the checkbox visually flipped (N2), and the model-unavailable copy is unreachable for guidance (N3). Separating evidence from 6: the two-store disagreement is gone and there is a real two-store integration spec.

### Finding table

| Finding | Status | Evidence | Spec |
| --- | --- | --- | --- |
| S1 two stores disagree | FIXED | Shell effect `generation-workflow-shell.component.ts:395-403` calls `guidance.adopt(run)` (untracked) on every workflow run change; `guidance-generation.store.ts:80-98` resets snapshot/run/restoring when `snapshot.runId` differs; `refresh()` is guarded by `requestedRunId` (`:111-135`). Dead `start/retry/regenerate/stop/submit` removed | `generation-guidance-page.component.spec.ts:124` (real stores: fail, Retry, success with new provider/model, rebind) and `guidance-generation.store.spec.ts:64`. Caveat: that spec calls `adopt` by hand and the shell spec only pins `adopt`/`refresh` calls with mocks (`generation-workflow-shell.component.spec.ts:16-110`), so the shell-to-store hop is covered by two halves, not end to end |
| S2 start feedback | FIXED (generic); PARTIAL for model-unavailable | Page renders `rejection()`, `chatTurnRejection()`, `startError()` with fixed text and no `ownerTabId` (`generation-guidance-page.component.ts:47-67`); store clears and sets them (`generation-workflow.store.ts:145-166`). Host provider failure arrives as `rejection: not-running` and shows "could not start" (`enhanced-prompts-rpc.handlers.ts:690-695`). See N3 | `generation-guidance-page.component.spec.ts:13-60` (it.each, asserts no `private`), `generation-workflow.store.spec.ts` lost-response/unavailable-model test |
| M-a Check again | FIXED | `page.refresh()` calls both stores (`generation-guidance-page.component.ts:120-123`) | page spec asserts both called once |
| M-b sticky error / toggle not reverted | PARTIAL | Alert clears at the start of each action and `setEnabled` rereads committed state (`guidance-generation.store.ts:197-243`). The DOM checkbox is still uncontrolled: after a failed toggle the re-read yields the same `enabled`, so `[checked]` does not change and Angular does not rewrite the user-flipped property (`guidance-result-panel.component.ts:32-36`). See N2 | store spec `:143` only |
| M-c stale content | FIXED | content cleared when `generatedAt` changes (`guidance-generation.store.ts:177-181`); `null` content raises the alert (`:219-221`) | store spec `:143` |
| M-d handoff outcome | FIXED | private `clearTimer()` vs user `skip()` (`generation-handoff.store.ts:37-60`); `startNow`/`manualContinue` no longer set `skipped`; `started` line (`agent-next-steps.component.ts:38-39`, shell `:214`). Timer is held by the root store, so it survives shell destruction; `startNow` clears the timer and pending before awaiting, so the deadline and a click cannot both submit | `generation-handoff.store.spec.ts` new test: Start now then later deadline, 1 then 2 calls, no shell |
| M-e effect fan-out | FIXED | `untracked` around adopt/refresh (`shell:398,402`); no loop: the effect reads only `store.run()` and guidance writes never touch the workflow store | shell spec `:105-109` |
| M-f restore ordering | PARTIAL | Validator accepts a located tab while `activeWorkspacePath === null` (`app.config.ts:52-56`), docstring corrected, spec updated (`webview-routing.spec.ts:226-240`). Safety verified: the shell binds only from the active workspace's own tab list (`shell:318-351`), otherwise `store.unbind()`/`guidance.unbind()` and the template shows "This generation tab is unavailable in this workspace" (`shell:249`); no cross-workspace data renders. It does not leave the route (N4) | validator pure-function spec; shell spec `:275,337` covers mismatch |
| M-g dead engine | FIXED | methods gone from `guidance-generation.store.ts`; specs moved to adopt | store spec |
| m1 Generate during a run | FIXED | Generate hidden while bound, Regenerate `[disabled]="runActive()"` (`page:34-42`, `guidance-result-panel.component.ts:69`); the `[disabled]` on the first is redundant | page spec |
| m2 stale card between terminal and refresh | FIXED | adopt applies the terminal status synchronously (`guidance-generation.store.ts:80-98`) | page spec |
| m3 sr-only raw state | FIXED | uses `guidance.status()` for the guidance workflow (`shell:55-59`) | none specific |
| m4 raw ISO | FIXED | `date:'medium'` (`guidance-result-panel.component.ts:23-26`). Minor risk: `DatePipe` throws on an unparseable string, so a hand-edited `generatedAt` would break the panel render; the host writes ISO | panel spec |

### New findings

**Moderate**

- **N1. A reload no longer shows the neutral status for a restored terminal run.** `guidance-generation.store.ts:80-98`: `adopt` sets `restoring = false` whenever the run id differs from the snapshot. After a webview reload both stores call `getBoundRunState` for the bound tab (workflow `bind` first, `shell:367`; guidance `bind` second, `:370`). The workflow reply normally lands first, its terminal run reaches the effect, `adopt` sees a new run id, clears `restoring`, and the card shows `failed`/`completed`/`timed-out` from the previous session. Plan line 207 and AC18 require neutral wording after reload unless a run record verifies cancellation. Success stays committed-gated, so nothing false is shown; this is a requirement miss whose outcome depends on message order (if the guidance reply wins, the snapshot matches and neutral is kept). The store spec at `:106` passes because it never calls `adopt`. Fix: in `adopt`, keep `restoring` unless the run is non-terminal or `workflow.acceptedRun()?.runId === run.binding.runId` (pass a flag from the shell), and add a spec binding both real stores over a fake RPC that returns a settled `failed` run.
- **N2. Failed-toggle revert does not reach the DOM (completes M-b).** `guidance-result-panel.component.ts:32-36` with `guidance-generation.store.ts:197-210`. Toggle off, RPC rejects, alert appears, store re-reads `enabled: true`, the binding value is unchanged so the checkbox stays unchecked while saved state is enabled. Fix: set `enabledToggle.checked = saved.enabled` from an `effect` on `result()` after a failure, or re-render the control with a key signal. Add a component spec with a rejecting `setEnabled`.
- **N3. Model-unavailable message is unreachable for guidance.** `wizard-rpc.service.ts:158-176` throws only `Start unconfirmed` for `startBoundGuidance`; the host catches `RpcUserError('The selected model is unavailable...')` inside the start `try` and returns `rejection: not-running` with a provider message (`enhanced-prompts-rpc.handlers.ts:690-695`, `wizard-generation-binding.ts:387`). The page's `startError` branch (`page:60-64`) can only fire for a message the real service never throws for guidance, and the workflow-store spec mocks that throw. Users see "Project guidance could not start. Try again.", which is safe but suggests a retry that cannot succeed. Fix: map the guidance model error as `startBoundAgents` does (host must return it distinguishably) or drop the dead branch and record the decision.
- **N4. A restored route that the active workspace does not own becomes a dead end rather than a redirect.** `app.config.ts:52-56` passes the validator only while the workspace is null; once a different workspace activates nothing re-runs it for the current URL, so the user stays on the "unavailable in this workspace" alert (`shell:249`) with no action. Safe (no data shown) but the expectation that the shell "leaves the route" is not met. There is also a one-frame flash of the same alert while the workspace is still null on a normal reload. Fix: add a link to the landing in the unavailable block, or navigate away when `binding()` is null and the workspace is non-null.

**Minor**

- m-a. No in-flight indicator between handoff `startNow` and `started`: `outcome` is `idle` while `openAndStart` awaits, so "Continue to project guidance" is live and a second click re-runs `openAndStart` (`generation-handoff.store.ts:67-110`). Host start is idempotent per tab, so no duplicate run; add a `starting` outcome.
- m-b. `chatTurnRejection` stays set after the chat reply finishes until the next click (`generation-workflow.store.ts:210`); same as the agent branch.
- m-c. Orchestrator's lint fix (static `import type` of `SetupGenerationRunState`, `generation-workflow-shell.component.spec.ts:8`) is correct and changes no behaviour.

### Answers to the specific questions

- `adopt(run)` vs shell effect: a run-id change resets snapshot, run, restoring and status (`:86-92`); no loop (the effect reads only `store.run()`, writes are untracked and one-way); after `unbind`/rebind `adopt` ignores a run whose binding does not match (`:81-82`), so no stale run survives a rebind; late `refresh()` replies for an older run are dropped by the `requestedRunId` check (`:116-117`). The one gap is N1.
- M-f: verified safe; see table and N4.
- M-d: verified; the deadline and a click cannot both submit; `schedule` no longer reports `skipped`; the timer lives in the root store.

### Must-fix

None.

### Defer

N1 (reload neutral status; do it on the next touch of the guidance store, it is a plan requirement), N2, N3, N4, m-a, m-b, DatePipe hardening. Regressions worth adding: shell plus two real stores reload spec, rejecting-toggle component spec.

Review family: Claude; implementer family: codex

## Phase 6 review (B09-B11)

Review family: Claude; implementer family: codex.
Scope: `git show 90a6b0b39` (`setup-hub.component.ts` around the diff), `git show 3096dfbe5` (`setup-status-widget.component.ts`), `git show b53533535` (spec only; `project-setup-card.component.ts` read in full), plus `generation-workflow-launcher.service.ts` in full, `WorkspaceScopeService`, design-spec 2.6, parity rows 1-2 and AC1/2/12/15/17. Lane reports treated as claims. No checks re-run.

**Verdict: APPROVE. Score 8/10.** 0 Blocking, 0 Serious, 1 Moderate, 4 Minor. Above 7: the launcher is used with the right workflow and active workspace everywhere, tab reuse is delegated to the launcher's synchronous `findWorkflowTab` (`generation-workflow-launcher.service.ts:60-72`), copy is fixed text, cancelled is silent, no raw error reaches the UI. Below 9: inconsistent workspace source and copy between B09 and B11, no in-flight guard in the Hub, and the widget's failure state replaces its own content.

### Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Right workflow and active workspace | PASS | Hub `openGeneration` passes `workflow` from the static action list and `workspaceScope.activeWorkspacePath()`; widget `launchGeneration` passes `tabs.activeWorkspacePath`. The launcher re-checks `workspacePath !== tabs.activeWorkspacePath` before and after navigation and returns `failed` (`launcher:56-58,86-92`), so a wrong-workspace tab cannot open |
| Second click focuses same-workspace tab | PASS | launcher reuses `existing?.id` (`:62-71`); neither caller adds a second path. Component specs mock the launcher, so reuse itself relies on the B04 launcher spec |
| Failure copy safe | PASS | Hub: "Generation could not be opened. Try again." and "Open a workspace to start generation."; widget: "Could not open generation. Please try again." No caught error text is shown |
| Cancelled silent | PASS | Hub shows nothing for `cancelled` (only `failed` or a throw set copy, `landed` clears); widget errors only on `failed` |
| Missing workspace | PASS, inconsistent | Hub shows a specific message; widget shows the generic failure. Different sources: `WorkspaceScopeService.activeWorkspacePath` (`core/.../workspace-scope.service.ts:68`) vs `TabManagerService.activeWorkspacePath` (`chat-state/.../tab-manager.service.ts:860`). A momentary disagreement ends in the launcher's `failed` and the generic copy, never in a wrong tab |
| Independent starts never set combined origin | PASS | both callers pass `origin: 'independent-start'`; the launcher maps anything other than `analysis-result-continue` to `independent-start` (`:76-80`) |
| Analysis entry unchanged | PASS | the Hub diff touches no analysis card markup or handler; the widget's analysis button and `launching` flow are untouched |
| No `chat-ui -> chat` | PASS | the widget imports `chat-state` and the in-library launcher only; the card in `chat` imports `chat-ui` (allowed direction). Orchestrator lint is clean |
| B10 | PASS | The card has no generation buttons of its own; it embeds `ptah-setup-status-widget` (`project-setup-card.component.ts:108`), so B11 covers both surfaces. The spec asserts exactly one button per workflow and the launcher call shape; skills warning and marketplace retained. The spec begins with a BOM (route to style review) |
| Hub deviation (no running-only status line) | CONFIRMED as honest, gap recorded | design-spec 2.6 promises a "Running" line and an "Open running tab" label like the New Project card, but that card reads `workflowRequest.hasRunningMode(...)` (`setup-hub.component.ts:1359`) and no equivalent verified signal exists for generation inside `harness-builder` (run state lives in `setup-wizard`'s workflow store; tab existence does not prove a run). Showing "Running" from tab existence would present an unverified state. AC1/AC15 are met by second-click focus. Keep the deviation; update design-spec 2.6 or log it as a deferred enhancement |

### Findings

**Moderate**

- **M1. Widget failure replaces the whole status body.** `setup-status-widget.component.ts` `launchGeneration` sets the shared `error` signal, which switches the template to the compact error branch (`:72-84`) and hides the status summary and both generation buttons; its only action is "Retry", which calls `fetchStatus()` and does not retry the launch. A launcher `failed` (for example a workspace race) wipes the card until the user presses Retry, and the copy reads as a status failure. Not data loss and not misleading about the outcome. Fix: a separate `generationError` signal rendered inline under the buttons (as the Hub does), leaving `error` for status loading; spec that the buttons remain after a failed launch.

**Minor**

- m1. The Hub has no in-flight guard (`openGeneration`), unlike the widget's `launching()`. The card is `role="button"` with `(click)` and `(keydown.enter)` and contains a native `<button>` with no handler, so Enter on the inner button fires keydown (bubbles) then click (bubbles) and calls the launcher twice. The launcher is safe (the second call finds the tab created synchronously; the first navigation may resolve `cancelled`, which is silent), but add a pending flag. The pattern was copied from the existing cards.
- m2. Missing-workspace copy differs between B09 and B11, and they use different workspace sources. Use `TabManagerService.activeWorkspacePath` (the launcher's own source) in both with one message.
- m3. Hub `generationError` is not cleared on `cancelled`, so an earlier failure persists after a later superseded click; it clears on `landed` and by dismiss. Harmless.
- m4. The generation cards are rendered before the Workspace Analysis card (`@for` placed first), while the design review says the Hub keeps its own order untouched. A visual-review call; not blocking.

### Five logic questions (Phase 6)

1. Silent failure: none found; every non-landed outcome except `cancelled` produces copy; `cancelled` silence is by design.
2. Unexpected user action: Enter on the Hub card's inner button double-invokes (m1); a launcher `failed` hides the widget content (M1).
3. Wrong answer from input: path-format differences between the two workspace services end in a safe `failed`, never a wrong tab.
4. Dependency failure: a thrown launcher call is caught on both surfaces; the widget resets `launching` in `finally`.
5. Missing: a verified running or open-tab indicator on the Hub (recorded deviation); one shared missing-workspace copy.

### Must-fix

None.

### Defer

M1 (inline generation error in the widget), m1 (Hub in-flight guard and Enter double fire), m2 (single workspace source and copy), m4 (card order, for visual review), and the Hub running status line (needs a verified run-state signal exposed below `harness-builder`; update design-spec 2.6 to match what shipped).

Review family: Claude; implementer family: codex

## Phase 6 completion review (B12, P56F)

Verdict: APPROVE. Score: 8/10. Blocking 0, Serious 0, Moderate 2, Minor 3.
Review family: Claude; implementer family: codex.
Scope: `git show 3c80790a9` and `git show b0866c243`, whole changed components and stores read, plus callers of `setCurrentStep`, `consumeOrigin` and `origin:`. No wide checks run; the orchestrator's results were taken as given.

### Acceptance table

| AC / parity row | Status | Evidence |
| --- | --- | --- |
| B12 Continue sets the combined origin, and only Continue does | PASS | `analysis-results.component.ts:358-364` is the only producer of `analysis-result-continue` among user actions. Hub `setup-hub.component.ts:1446` and widget `setup-status-widget.component.ts:263` send `independent-start`. Landing sends `wizard-landing`, which `generation-workflow-launcher.service.ts:69-71` maps to `independent-start`. The only other producer is the guidance auto-chain `generation-handoff.store.ts:95` (`focus=false`), which is pre-existing and intended. |
| Origin consumed on the agent tab | PASS | `generation-workflow-launcher.service.ts:66-82` stores the intent and drops it on cancelled or failed. `generation-workflow-shell.component.ts:385-390` consumes it into `combinedTabId`. |
| Old landing stays a working landing (AC2, rows 6-12) | PASS | `wizard-landing.component.ts:255-268` now catches launcher exceptions and sets `openError`. The `use()` and analyze paths are untouched. |
| Saved analysis browse/load/hide, rows 24 and 27-35 | PASS | `welcome.component.ts:372-380` and `:426-447` keep the same RPC calls and state setters. Only the error surface changed (log replaced by an alert). The aria label now says "Hide", which matches the behaviour. |
| Old run resume/cancel (row 30) | PASS | `wizard-analysis-runner.service.ts:141-149` keeps the generation step and pending-to-failed marking. Only the message was made generic. |
| Four phase results unchanged | PASS | The `analysis-results.component.ts` template diff only adds the alert. |
| Failure copy safe (AC17) | PASS | The Continue alert, the welcome alerts and the resume message are all fixed strings. `catch {}` discards the exception text. |
| "Nothing deleted" is correct | PASS | The caller search shows `AgentSelection`, `GenerationProgress`, `PromptEnhancement` and `Completion` rendered by `wizard-view.component.ts:130-141`. `AgentSelection` is still reachable through the stepper (`canJumpToStep('selection')`, `setup-wizard-state.service.ts:399-401`, `wizard-view.component.ts:170-197`) once an analysis plus recommendations exist. `GenerationProgress` is reachable through resume (`wizard-analysis-runner.service.ts:141`). No capability disappeared. |
| AC18 reload neutral status, both reply orders | PASS | `guidance-generation.store.ts:97-100` clears `restoring` only for an in-session accept or a non-terminal run. `applyRun` (`:153-168`) shows `idle` for a restored terminal run other than `cancelled`. Pinned for both orders in `guidance-generation.store.spec.ts` (`it.each workflow first / guidance first`). |
| AC18 does not hide a run accepted this session | PASS | `generation-workflow-shell.component.ts:406-411` passes `acceptedRun().runId === run.binding.runId`. The store spec asserts `adopt(run, true)` gives `failed`. A `cancelled` status is already exempt in `applyRun`. A non-terminal run always clears `restoring`. |
| Controlled toggle revert | PASS | `guidance-result-panel.component.ts:39-42` resets `checked` to the saved value after emitting. On success the `[checked]` binding re-syncs when `saved.enabled` changes. The failure path is pinned by a spec. |
| Restored-route Back to chat | PASS | The `@else` branch of `generation-workflow-shell.component.ts:250-253` renders only a message and a button. No run, agent or guidance data from another workspace is shown. The spec asserts `navigateToSurface('chat')`. |
| Widget launch error separate | PASS | `setup-status-widget.component.ts:172` and `:252-272`. `launchError` no longer replaces the status block. |
| Hub in-flight guard | PASS | `setup-hub.component.ts:1433-1457`. The flag is released in `finally`, and also on the no-workspace early return. |
| Unreachable model-unavailable branch removed | PASS | `generation-workflow.store.ts:153-159` and the `generation-guidance-page` template. The catch still refreshes, so state is not left stale. |

### Findings

Moderate

1. D11 regression has no direct spec (the check you named). `generation-run-event-adapter.spec.ts:189-217` and `:617-720` prove the adapter clears the generator's own state: `currentMessageId` empty, `status` `loaded`, not streaming, `claudeSessionId` null, and a following generator start admitted. `chat-input.component.spec.ts` (`libs/frontend/chat`) has no generator-related case, and no spec sends a real chat turn through `ChatStore` or the composer on a tab after a generator run. The conclusion that a later chat turn streams and clears follows from the cleared state, but it is inferred. Fix: add one integration spec that finalizes a generator run, then sends a normal message and asserts it streams and finalizes. This can be deferred.
2. `AnalysisResultsComponent.onContinue` (`analysis-results.component.ts:352-370`) has no in-flight guard, while P56F added one to the Hub and the widget already had `launching`. A double click calls `launcher.open` twice. It is idempotent, because `findWorkflowTab` reuses the tab and the second navigation is the same route, so the harm is only a redundant navigation. It is also inconsistent with the stated Hub fix. Fix: add a `continuing` signal and ignore the click while it is set.

Minor

3. `guidance.adopt(run, acceptedThisSession)` is pinned with `false` only in the shell spec (`generation-workflow-shell.component.spec.ts`, `toHaveBeenCalledWith(run, false)`). The `true` wiring at `generation-workflow-shell.component.ts:406-411` is covered only by the store spec. A shell spec with `acceptedRun` set to the run id would pin the wiring.
4. The toggle revert (`guidance-result-panel.component.ts:39-42`) snaps the checkbox back at once, so a successful toggle shows the old value until the RPC returns. There is no pending indicator. The success path has no spec. Cosmetic.
5. A stale launch intent can remain in `launchIntents` when the agent tab is already bound with the same `discoveryKey` and `consumeOrigin` is not called (`generation-workflow-shell.component.ts:380-390`). This is pre-existing and every later `open` overwrites it, so the risk is very low.

### Must-fix

None.

### Defer

- Finding 1: one chat-turn-after-generator integration spec (suggest a follow-up).
- Finding 2: Continue in-flight guard.
- Findings 3-5.
- Removal of the four old presentation components: needs a separate owner to migrate the `WizardViewComponent` cases, the stepper jump and the resume route first, as the B12 report says.

### Five questions (brief)

- Silent failure: none new. The launcher's `failed` outcome and any thrown error surface the alert. `cancelled` is silent by design.
- Unexpected user action: double-click on Continue (finding 2).
- Wrong data: a restored terminal `failed` run reads neutral after reload. This is the intended AC18 behaviour, and an in-session run is exempt.
- Dependency failure: `launcher.open` rejecting is caught in Continue and in the landing. `refreshCommitted` failure sets `actionFailed`.
- Missing: no direct D11 composer spec (finding 1).

Review family: Claude; implementer family: codex

## V1 review (responsive shell)

Review family: Claude; implementer family: codex.
Scope: commit aa09eed28 (shell, generation-agent-sidebar, selection list `primary`, guidance page/run card/result panel, shell spec). Read whole files; compared the old shell template (aa09eed28^) with the new sidebar. No tests re-run.

**Verdict: REVISE. Score 6.5/10.** Parity and lifecycle are sound. Two Serious defects sit in the narrow sheet and both involve the preview dialog.

### Check results
1. Parity: PASS. Run card, Resume card, progress, guidance-missing alert, selection list, rejection, startError, verified results, next steps with countdown, guidance page, errors, stop control, status live region and the unavailable/Back-to-chat state are all present with the same bindings (generation-agent-sidebar.component.ts:37-189). The `now` input feeds the same countdown. The shell keeps unused duplicates (shell lines 221-223, 269-293, 294-300 `propagationConsentLabel`, `remainingSeconds`, `guidancePreviewModel/Provider`, `showNextSteps`; `models`/`providers` injections). That is dead code, so route it to the style reviewer.
2. Correctness: mostly PASS.
   - ResizeObserver is created once in `afterNextRender` (shell:357-366) and disconnected in `ngOnDestroy`. Signal writes under OnPush are fine.
   - Widening while the sheet is open runs the effect at shell:367-369, which sets `sheetOpen` to false, and `inert`/`aria-hidden` are derived from `narrow() && sheetOpen()` (shell:207-208). `inert` cannot stay stuck.
   - The focus target exists: the peek button is rendered whenever `narrow()` (shell:112).
   - Stop beside peek calls `store.stop()`, which guards on binding and `isBound()` (store:231-232). It is rendered only under `store.isBound()` (shell:134) and disabled in cancelling/stop-unconfirmed.
   - Escape is NOT correctly scoped, see S1.
3. One primary action: PASS. Guidance, no run: Generate is the only primary (guidance page:37-44). Guidance, saved: Regenerate is primary and Generate is hidden (result panel:71). Guidance, failed: Retry is outline, and Generate or Regenerate is the primary. Agents, no run: Generate is primary (`!handoff.pending()`). Agents, pending handoff: Start now is primary and the selection list is outline (next-steps:26). Running: the agent selection list is hidden. Guidance running shows a disabled primary Regenerate (see M1).
4. Accessibility: PARTIAL. The peek button has aria-expanded and aria-controls, and nothing traps the keyboard because the sheet is a sibling after the peek and Stop in tab order. The sheet itself has no role or label (see M2).
5. Spec depth: insufficient (see M3).

### Serious
S1. Escape handler closes the sheet underneath the preview dialog. File: generation-workflow-shell.component.ts:254-260 (host `keydown`), with agent-preview-dialog.component.ts:125-128.
- Scenario: at a narrow width the user opens the sheet and opens "Review generation targets", then presses Escape.
- The dialog calls only `preventDefault()` and `dismissed.emit()`. The event keeps bubbling to the shell host.
- The shell handler does not check `event.defaultPrevented`, so it also closes the sheet and moves focus to the peek button. One Escape dismisses two layers, and the dialog's own focus restore to its opener is overridden.
- Fix: in `onKeydown`, return early when `event.defaultPrevented`, and for stricter scoping act only when `event.target` is inside `#wizard-sidebar` or is the peek button. Add a spec that dispatches a prevented Escape from inside the sheet and expects the sheet to stay open.

S2. The sheet's entry animation leaves a transform that breaks the `position: fixed` preview dialog. File: shell:58-60 (`animation: ... both`), shell:164-174.
- `fill-mode: both` keeps `transform: translateX(0)` on `#wizard-sidebar` after the animation ends. A transformed ancestor becomes the containing block for `fixed` descendants.
- The preview dialog uses `fixed inset-0 z-50` (agent-preview-dialog:18), inside the selection list inside the sheet, which is also `overflow-y-auto`.
- In narrow mode with `.workflow-sheet-open` applied, the modal overlay is laid out and clipped relative to the scrolling sheet instead of the viewport. If the sheet has scrolled, the mandatory preview step can sit off-screen.
- I traced this from the CSS and did not run it in a browser, so the visual reviewer should confirm it. Under `prefers-reduced-motion` (`animation: none`) the bug does not occur, which makes it intermittent.
- Fix: use `animation: ... backwards` (or `none` fill) so no transform remains. Alternatively animate `opacity`, or render the sheet without `overflow-y-auto` and scroll an inner wrapper. Add a computed-style check in the visual pass.

### Moderate / minor
- M1. shell-hosted Regenerate (result panel:68-76) stays visible as a disabled primary button while a guidance run is active. This is a mild violation of the one-primary rule, so it should go outline or be hidden while running. The guidance tab also shows Stop three ways at narrow width (run card, stop control, peek Stop).
- M2. `#wizard-sidebar` (shell:164) has no `role="region"` or `aria-label`, and focus does not move into the sheet when it opens. Screen-reader users get an unlabelled disclosure target. Add `role="region" aria-label="Generation workflow details"`.
- M3. Spec gaps (shell.spec.ts, one new test, guidance workflow only). It sets `hostWidth` directly, so the `afterNextRender` and ResizeObserver path is untested. It does not cover: the wide-resize-while-open clearing (effect at shell:367), Escape from inside the sheet or with a prevented event, the agent workflow rendering through the sidebar, and Stop visibility on the agent tab. There is no spec for `generation-agent-sidebar.component.ts`. The shell spec also uses `NO_ERRORS_SCHEMA` with `imports: []`, so the sidebar is never rendered. Parity for the sidebar is therefore unproven by tests.
- M4. Errors, `rejection` and `startError` live inside the hidden sheet (shell:184-190). While the sheet is closed they are visible only to the sr-only status. Surface an attention dot or the error text on the peek row. If `binding()` goes null while `sheetOpen` is true, the state persists and the sheet re-opens on rebind. Reset `sheetOpen` when the binding changes.
- M5. Peek row and header both print the same status text in narrow mode (shell:102-106, 125-129). Visual redundancy only.

### Must-fix
1. generation-workflow-shell.component.ts:254-260: ignore Escape when `event.defaultPrevented` (and scope it to the sheet or peek button) so the preview dialog's Escape does not also close the sheet (S1).
2. generation-workflow-shell.component.ts:58-60: remove the lingering transform (`backwards` fill or opacity animation) so the fixed preview dialog is not trapped in the sheet (S2). Confirm visually.
3. generation-workflow-shell.component.spec.ts: add tests for S1 and resize-while-open, plus one test that renders the agent tab through the real sidebar (M3).

### Defer
M1, M2 (cheap; do them with the must-fix if convenient), M4, M5, and removal of the dead duplicated computeds and injections in the shell (style review).

## V1 re-review (round 1)

Scope: commit 11ddf3949, read in full: `generation-workflow-shell.component.ts`, `guidance-result-panel.component.ts`, the shell spec diff, and `agent-preview-dialog.component.ts` (the child that handles Escape). No tests were run (read-only per instructions).

### Per-item verdict

| # | Item | Verdict | Evidence |
| - | ---- | ------- | -------- |
| 1 | Escape ignores defaultPrevented, scoped to sheet | FIXED | Host `keydown` removed. `(keydown)="onSheetKeydown($event)"` is on the sheet element (shell.component.ts:180). The handler returns on `event.defaultPrevented` (:283). The preview dialog calls `preventDefault()` on Escape before the event bubbles (agent-preview-dialog.component.ts:125-127), so it closes only itself. Spec dispatches a prevented Escape (spec ~:229-237). |
| 2 | No transform left after animation | FIXED | Fill mode is `backwards` (:55), so the `translateX(100%)` keyframe applies only before and during the run. After 180ms the computed transform is `none`. A `fixed inset-0` preview dialog inside the sheet is then not re-parented by a transform containing block. `animation: none` under reduced motion (:63-65). Toggling `hidden` restarts the animation on each open. jsdom cannot assert the containing-block effect, so this is verified by reading only. |
| 3 | Specs | FIXED | Real-sidebar test (spec :21, with `overrideComponent` at ~:132). Prevented Escape keeps `inert` on the chat (~:237). Widening clears the sheet and removes `inert` (~:246-271). |
| 4 | Regenerate hidden during a run | FIXED, see N3 | `@if (!runActive())` (guidance-result-panel.component.ts, diff hunk ~:66-77). |
| 5 | Dialog semantics and focus | FIXED, see N1 | `role=dialog`, `aria-modal` only when open, `aria-label` and `tabindex=-1` (:176-179). `toggleSheet` uses `afterNextRender` with an explicit injector, so it runs after `hidden` is removed. It re-checks `sheetOpen()` and falls back to focusing the sheet (:266-281). |
| 6 | Reset on rebind | FIXED | The effect keys on workspace, tab and workflow (:364-373), not on object identity. Initial bind sets `false` to `false`, a no-op. It cannot fire on every `binding()` recompute because the key is a string compare. |
| 7 | Error badge on peek row | FIXED | `needsAttention` (:251-259) and the badge (:122-126). It is workflow-aware: guidance uses `actionFailed`, agent uses `error`. The signals exist (`rejection`, `chatTurnRejection`, `startError`, `actionFailed`, `error`). |
| 8 | Dead computeds and injections removed | FIXED | `ModelStateService`, `ProvidersSettingsStateService`, `remainingSeconds`, `guidancePreviewModel`, `guidancePreviewProvider`, `showNextSteps` and `propagationConsentLabel` are gone. The orchestrator reports typecheck and lint pass. |

### New findings

- N1 (Moderate): `aria-modal="true"` is set, but there is no focus trap. Tab from the last sheet control reaches the peek and Stop buttons, which sit outside the dialog (the chat is inert). Escape is only handled while focus is inside the sheet (:180). If focus is on the peek button, Escape does nothing. The peek button toggles, so users are not stuck. Suggest also listening for Escape on the peek row, or accepting this as documented.
- N2 (Minor): When the sheet closes through widening or a rebind, focus is not returned. It falls to `body` if it was inside the sheet. Escape and the peek toggle do restore focus (:287).
- N3 (Minor, per the no-capability-removed rule): Regenerate changes from disabled to absent during a run. It returns on completion, so no capability is permanently lost, but the control now appears and disappears with the run state. This matches review item 4's wording. The orchestrator may want to confirm the user is happy with that.
- N4 (Minor): The `needsAttention` badge shows even when the sheet that holds the error text is open. This is cosmetic.

No blocking or serious findings.

### Score and verdict

Score: 8/10. All 8 items are verified fixed by reading. The remaining gaps are accessibility polish and the unverifiable jsdom-only animation containing-block claim.

Verdict: APPROVE.

## PR 763 CodeRabbit fix review

Scope: uncommitted diff plus `active-workspace-tab-set.ts` and `generation-agent-sidebar.component.spec.ts`. I read the full touched regions of the service, handlers, supervisor, binding mapping, stores, sidebar, tab manager and the e2e spec. I ran no checks.

| Finding | Verdict | Evidence |
| --- | --- | --- |
| 4308395701 reservation kept until terminal state | Correct and complete | `enhanced-prompts.service.ts:779` skips the release only when `bound` is set. The supervisor `finally` at `enhanced-prompts-rpc.handlers.ts:826` runs after `finish` and the broadcast on success, failure and throw. Errors before ownership transfer are caught at `:679-686`, which release the reservation. `executeBoundGuidance` is an async function launched with `void`, so it cannot throw synchronously past that catch. Cancel aborts the controller, the service returns, and the supervisor releases. The lock timer and grace timer (`service.ts:325-352`) are not cleared by the skipped release, so a hang still force-releases. A late supervisor release after a force release is a no-op because `boundReservation` no longer matches. Unbound callers keep the old release. The regression spec (`enhanced-prompts-rpc.handlers.spec.ts` ~1013) covers the post-run status-read window. |
| 4308395717 partial-failure lifecycle | Correct, scoped to bound runs | `wizard-generation-rpc.handlers.ts:901-905` maps `completed` with `failedCount > 0` to `failed`, only when `bound`. The checkpoint finalize, the run-state RPC (`wizard-generation-binding.ts:121-135`, `failed` becomes status `failed` and `success: status === 'completed'`) and the supervisor payload (`wizard-generation-run.supervisor.ts:173` and `:321`, `success` requires zero failures) now agree. Legacy and tabless runs still pass `bound=false` (`:711-718`, `:1466-1473`), and apps/ptah-cli is untouched. `payload.failedCount` includes carried-over agents, which are never `failed`, so the mapping is not skewed. |
| 4308395721 VS Code null partition | Correct | `active-workspace-tab-set.ts:1-16`. A non-null partition keeps strict equality, so Electron partitioned paths are unchanged. A null partition is accepted only when `isVSCode` is true and the path matches the configured root. Electron has `isVSCode` false, so a null partition there is still rejected. Normalization handles backslashes, trailing slashes and Windows drive-letter case. POSIX stays case-sensitive, which is correct. The status widget falls back to `''` (the `VSCodeService` default), so `trim()` cannot throw. The launcher (`:53`, `:89`), open handler and widget all use the one helper. |
| 4308395724 resume through the bound path | Correct | `generation-agent-sidebar.component.ts:49-50` calls `store.resumeCheckpoint()` and disables the button while `isBound()`. `generation-workflow.store.ts:170-193` sends `startBoundAgents(binding, [], true)` and handles accepted, rejection and failure. The guard `runValue() !== null || isBound()` fits the button's `@if (!store.run())`. `AgentGenerationStore.resume()` is untouched for the old wizard. |
| 4308395726 stale rejection | Correct | `rejectionValue.set(null)` at each start path (`store.ts:105`, `:147`, `:187`) and in `accept` (`:243`). |
| 4308395734 runless 'quiet' forever | Correct for the reported case | An explicit `success === false` goes to `failStart` (`store.ts:115`, `:157`, `:193`). When lookups are exhausted and no run was ever accepted, `refresh` calls `failStart` (`:276-283`). A real in-flight run whose start response was lost is still found by the tab-keyed lookup, and the 1s/2s/4s retry watchdog is kept. |
| e2e `wizard-dom.spec.ts` | Will work | `wizard-view.component.ts:116-122` renders `ptah-welcome` inside a closed `<details>`, so the click on the summary text is needed before `toBeVisible` and before `wizard-next-btn` (`welcome.component.ts:212`). The phrase appears in only one place, so there is no strict-mode ambiguity. Both tests expand the details. |

### New findings

1. Moderate - `generation-workflow.store.ts:236-246` (`accept`). When the post-accept `safeLookup` returns null, the state is set to `quiet` and no watchdog is scheduled. If `refresh` later reaches `lookupFailures >= 3` with a non-null `lastRun`, it also stays `quiet` and schedules nothing (`:270-286`). The tab then depends on stream events to leave `quiet`. This predates the diff, but lane B's claim that "accepted runs retain their lookup watchdog" is only true for `refresh` entered from a failed start. If the terminal push is lost, the tab sticks. Suggest scheduling one `refresh` from `accept` when the lookup is null.
2. Minor - `generation-workflow.store.ts:206-219` (`failStart`). The exact-string allowlist is brittle: if the backend wording changes, users silently get the generic message. It is safe, because unknown text never leaks. Prefer a typed error code in the response.
3. Minor - `tab-manager.service.ts:1040-1044`. `createTab(..., activate = activeWorkspacePath === null)` activates the new workflow tab immediately in VS Code, while the partitioned path does not. If the surface navigation then fails, the launcher returns `failed` (`launcher.service.ts:87-92`) but the user's active tab has already switched and the new tab is orphaned. Create it inactive and let the launcher's `switchTab` activate it, as in the partitioned case. If activation is required for a reason I could not find, document it.
4. Minor - `tab-manager.service.ts:268-278` reads `window.ptahConfig` while the other callers use `VSCodeService.config()`. This is consistent with the existing direct read at `:729`. `updateWorkspaceRoot` is only called by Electron (`electron-layout.service.ts:545`, `:607`), so the two sources agree in VS Code. It is a duplicated source of truth, not a bug.
5. Minor - after a reload, a partial failure now maps to `failed` and not `interrupted`. The run card's resume (`resumeBoundAgents`) needs `interrupted`, and the "Resume saved run" button needs `!store.run()`. So the only recovery is the per-agent retry in the progress list. No capability is removed, because the retry exists. Confirm this is the intended product behavior.

### Answers to the specific checks

1. No permanent lock was found on any bound exit path (success, failure, throw, cancel, timeout grace, pre-supervisor errors).
2. Persisted checkpoint, completion payload and run-state RPC agree. Tabless, legacy and CLI behavior is unchanged.
3. The `resumeCheckpoint` guard is sound. The `failStart` allowlist is brittle but safe. The watchdog still protects a lost start response. The new `quiet` stuck path is finding 1 and predates the diff.
4. The helper is correct in VS Code and harmless in Electron (null partition still rejected). Only the activation inconsistency (finding 3) remains.
5. The e2e locators match.

Score: 8/10. Every finding is fixed; the open items are Moderate or Minor.
Verdict: APPROVE. Blocking findings: none.

## PR 763 CodeRabbit round 2 review

Scope: uncommitted diff of `wizard-generation-rpc.handlers.ts`, `generation-workflow.store.ts`, `wizard-rpc.service.ts`, plus new `bound-generation-tab.ts`; supervisor and tab-partition code read for context. Nothing executed.

| Finding | Status | Evidence |
| --- | --- | --- |
| CR 4308619380: retry success must not finalize the shared checkpoint as completed while another agent is failed | FIXED | `wizard-generation-rpc.handlers.ts:908-931` reloads the merged checkpoint, counts failed selected agents, forces `lifecycle='failed'` and rewrites payload (`success:false`, `failedCount` max, errors fallback) before `finalize` at :932. The broadcast reads the mutated `settled.payload` (`wizard-generation-run.supervisor.ts:296-336`), so the completion push says failed. |
| Retry RPC still reports success for the retried item | FIXED | Widened condition at `wizard-generation-rpc.handlers.ts:1503-1515` requires bound retry, no finalizationFailed, no abort/failure, summary completed and a written/unchanged outcome for `parsed.itemId`. Non-bound and failed-item retries fall through to the error path as before. |
| Retry with all failed agents fixed completes | OK | `recordedFailedCount` is 0, lifecycle stays `completed`, payload untouched, `success` true. |
| First-run bound runs | Unchanged in effect | The new block only fires when `summary.lifecycle==='completed'`. Runs with failures were already `failed` via the existing `failedCount>0` branch. The only addition is an extra checkpoint read that can now throw (see M1). |
| Tabless, legacy and CLI | Unchanged | Block gated on `bound`. `afterSettledWithoutCheckpoint` path untouched. `apps/ptah-cli` not in the diff. |
| New `throw 'checkpoint missing before settlement'` | Safe | Thrown inside the try, stored in `finalizeError`, rethrown after propagation (:975). The supervisor catches `onSettled` errors (:301-317), sets `finalizationFailed`, rewrites the payload to failed, and still broadcasts. Run and active-controller cleanup is in `finally`. No unsettled lock, run or tab. |
| CR 4308619384: VS Code bound tab treated as missing | FIXED for the four call sites | `bound-generation-tab.ts:5-17`. VS Code: the partition returns `workspacePath:null` (`tab-workspace-partition.service.ts:329-338`). The fallback `getWorkspaceTabs(root)` returns `_tabs()` when `isActiveWorkspaceTabSet` matches the configured root (`tab-manager.service.ts:887-896`). Used in `generation-workflow.store.ts:221` and `wizard-rpc.service.ts:126,154,173`. |
| Electron partitioned path | Unchanged | First equality branch returns before the fallback. |
| Electron with null partition | Still rejected | `isActiveWorkspaceTabSet` returns false when `!isVSCode`, then the partition lookup does not contain the tab, so the helper returns null. |
| Other strict `workspacePath ===` bound-tab checks | NOT FIXED, same VS Code bug | See S1. |

### Findings

**S1 (Serious, non-blocking for the two CRs but the same defect class).** Strict `located?.workspacePath === binding.workspacePath` checks remain, and they evaluate false in VS Code (null partition):
- `generation-run-event-adapter.ts:230-231` (finalize the owned message at terminal): `tab` is null, so it returns without `finalizeCurrentMessage`, leaving the streaming message unfinalized on every VS Code run.
- `generation-run-event-adapter.ts:255` (`correctFinalizedMessage`): never corrects the message.
- `generation-run-event-adapter.ts:353` (owned-message fallback in the run match): fallback never matches in VS Code.
- `generation-handoff.store.ts:103`: after a landed open, `tab` is null, so the outcome is always `manual-recovery` and guidance never auto-starts in VS Code.
- `agent-selection-list.component.ts:367,376`: blocked-owner label and `ownerInWorkspace` give wrong cosmetic results in VS Code.
Fix: reuse `findBoundGenerationTab` (or a workspacePath-taking variant) in these sites. Whether they were in scope for the CR is debatable, but the handoff store and adapter are the same "bound tab missing in VS Code" bug and will be hit by the same user.

**M1 (Moderate).** `loadAt` I/O errors in the new block (:913) now abort before `finalize` is attempted, so a transient read failure leaves the checkpoint `running` where `finalize` alone might have succeeded. The run is surfaced as a finalization failure (not silent), so this is acceptable. A narrower fallback (treat read failure as "unknown", still finalize with the computed lifecycle) would be more robust.

**M2 (Minor).** The fallback error text `'Some agents still failed.'` is generic and does not name the agents. Acceptable.

**M3 (Minor).** The helper has no sibling coverage for a binding whose workspace differs from the VS Code root (falls to null, correct by inspection). Specs for the helper paths were added in `wizard-rpc.service.spec.ts` and `generation-workflow.store.spec.ts`.

### Five questions (brief)
1. Silent failure: none new; the checkpoint-missing path is surfaced via finalizationFailed.
2. User action: VS Code user hitting terminal events or handoff, see S1.
3. Wrong data: retry payload `failedCount` is now reconciled against the checkpoint; correct.
4. Dependency failure: checkpoint read failure, see M1.
5. Missing: audit of sibling strict checks, see S1.

### Verdict
Score 8/10. Both CR fixes are correct and safely contained. S1 is a real adjacent defect, and I recommend fixing it in this PR or a tracked follow-up, but it does not invalidate the two requested fixes. Blocking findings: none.

Verdict: APPROVE

## PR 763 S1 re-review

Scope: uncommitted diff on 0ec32793f in libs/frontend/setup-wizard (7 files), read in full with the helper, `getWorkspaceTabs` (tab-manager.service.ts:887) and `isActiveWorkspaceTabSet` (chat-state/src/lib/active-workspace-tab-set.ts:2). No tests were run by me.

Helper semantics (bound-generation-tab.ts:11-18): exact partition match is accepted; a `null` partition is accepted only when `getWorkspaceTabs(binding.workspacePath)` contains the tab id. `isActiveWorkspaceTabSet` returns the active set only if the path equals the active workspace, or (VS Code only, no active workspace) equals the configured root. So VS Code null + configured root: accepted. VS Code null + other path: falls to the partition lookup, which will not hold the tab: rejected. Electron null: `!isVSCode` returns false, partition lookup: rejected. Electron partitioned path: exact match as before.

| Site | Status | Notes |
| --- | --- | --- |
| generation-run-event-adapter.ts:229 (finalize) | OK | Same `binding` shape; VS Code null accepted, Electron wrong-partition rejected. |
| generation-run-event-adapter.ts:253 (correction) | OK | Early `return` on `!tab` equals the old mismatch return. |
| generation-run-event-adapter.ts:345-355 (owned-terminal match) | OK with one nit | `tabId && workspacePath` guard keeps "absent path means no tab lookup". See M1. |
| generation-handoff.store.ts:103 | OK | `workspacePath` is the scheduled string; same helper contract. |
| agent-selection-list.component.ts:366 `ownerInWorkspace` | OK | `!!` of the tab; VS Code null owner now in-workspace. |
| agent-selection-list.component.ts:376 `ownerLabel` | OK | `tab?.title || 'Another tab'` preserves the fallback. |

Remaining instances of the bug class: grep of `workspacePath ===/!==` in libs/frontend/setup-wizard and libs/frontend/chat-ui finds only binding-to-binding comparisons (generation-run-event-adapter.ts:112,320,334; generation-workflow.store.ts:72,338,387; guidance-generation.store.ts:66,139,252; generation-workflow-shell.component.ts:339; generation-agent-sidebar.component.ts:224 compares to `activeWorkspacePath`, not a lookup) and an unrelated cache key (compact-session-summary-cache.ts:99). None compares a `findTabByIdAcrossWorkspaces` result. Outside the requested scope, libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:518-521 uses the same strict pattern (`lookup?.workspacePath === target.workspacePath`); it is not part of this PR's files and is noted only as a follow-up.

Specs: VS Code null partition is covered for the adapter (finalize + correction, terminal push), the handoff store and the selection list. The Electron regression ("another Electron workspace", workspacePath `/other`) is covered for the adapter only.

### New findings

- M1 (Moderate, generation-run-event-adapter.ts:343-355): semantic drift. Before, a candidate with `tabId` but no `workspacePath` was rejected (`'/ws'|null !== undefined`). Now the lookup is skipped, `tab` is null and `tab?.workflow === binding.workflow` is `undefined === undefined`, so a candidate that also lacks `workflow` but has the right `tabId` and `runId` is accepted. Needs a malformed push that already knows the owned runId; low exploitability. Fix: `&& !!tab && tab.workflow === binding.workflow`.
- M2 (Minor, specs): no test asserts that a `null` partition is rejected in Electron or for a non-root path in VS Code. The specs' `getWorkspaceTabs` mocks ignore the path argument (adapter spec `getWorkspaceTabs: () => [tab]`), so the helper's second condition is never negatively exercised. Add a case with `getWorkspaceTabs: () => []` and `workspacePath: null`.
- M3 (Minor, hygiene): the diff adds unformatted spec lines (long `expect(...)` lines in the adapter and selection-list specs); lint passed per orchestrator, run prettier on them before commit if lint-staged does not.

### Verdict

- Score: 8.5/10
- Verdict: APPROVE
- Blocking findings: none. S1 is resolved for all five production sites; M1 to M3 are non-blocking.

## PR 763 CodeRabbit round 3 review (grok)

Review family: implementer grok, reviewer Claude

Scope: uncommitted diff over 7becd482e in `wizard-generation-rpc.handlers.ts` and its spec; read `prepareResumedRun`, `registerCancel`, `GenerationCheckpointService.locateResumable`, `AnalysisStorageService.findLatestResumableRun`. No tests run (orchestrator reported typecheck, lint and test green).

### Per-finding table

| Finding | Status | Evidence |
| --- | --- | --- |
| 1 Major: unbound resume adopts a tab-bound checkpoint | Closed for the adoption, but introduces a shadowing regression (S1) | Guard at handlers.ts:803-804 returns null when `!metadata?.tabBinding && manifest.tabBinding`. Unbound call sites pass `metadata` undefined (handlers.ts:575-586), so the guard fires for every legacy/CLI resume. Explicit `analysisDir` pointing at a bound manifest is refused (correct). Unbound manifests resume unchanged (spec 2373-2393). Bound checks at 805-821 untouched. |
| 2 Minor: legacy cancel aborts a tab-bound run | Closed | handlers.ts:1289-1293 skips `runs.abort` when `runs.binding` is set. Unbound run still aborted. Session cancel still runs (1300-1327). The `!currentSession` branch returns `{cancelled:false}` when nothing was aborted (1315-1317), so no false claim. With a session present the response says `cancelled:true`, which is true (the wizard session is cancelled), and `progressSaved` falls back to `saveProgress` (1326). Bound cancel path (1262-1285) unchanged. No run state touched on the skip. |
| Spec change "keeps a cancelled bound run cancelled..." | Intent preserved | Spec 774-776 now cancels with the run's `tabBinding`; same assertions follow (cancelled true, late completion stays cancelled, 'cancelled' broadcast). The old legacy-aborts-bound behaviour it implicitly relied on is the thing finding 2 removes, and the new test at 788-835 pins the replacement behaviour (bound run keeps running, signal not aborted; unbound aborted with `user_cancelled`). Not hiding a regression. |

### New findings

- S1 (Serious): the refusal hides older unbound checkpoints. `locateResumable` with no `analysisDir` takes only the single newest unfinished run from `findLatestResumableRun` (checkpoint.service.ts:224-229; analysis-storage.service.ts:488-507, sorted by `updatedAt`). If a paused or failed tab-bound checkpoint is newest, the legacy wizard and CLI get `null` and the generic error `No resumable generation run was found for this workspace.` (handlers.ts:515-518), even when an older unbound resumable run exists. This blocks legacy resume until the chat tab finishes or is abandoned, and the message is misleading (a resumable run exists, it is just owned by a tab). The refusal should be a skip: for unbound requests with no `analysisDir`, iterate candidates and take the newest whose generation manifest has no `tabBinding` (add a filter option to `findLatestResumableRun`, or loop in `locateResumable`). Keep the explicit-`analysisDir` refusal. The same applies to the root-level (`slugDir: null`) generation manifest fallback (analysis-storage.service.ts:509-514). The new spec cannot catch this: it stubs `storage.resumable` to return one run directly (spec ~2349-2353), so no ordering with a mixed pair is exercised.
- M1 (Minor): for an explicit `analysisDir` pointing at a bound checkpoint, the generic "no resumable" message hides the real reason; a distinct message or code (for example "owned by a chat tab") would be clearer.
- M2 (Minor): spec 2340-2351 has a `seedCheckpoint(...)` call formatted across lines in a way prettier will rewrite; run prettier before commit.

### Answers to the checks

- Legacy wizard and CLI can still resume unbound checkpoints, with or without an analysis directory: yes (guard only rejects manifests carrying `tabBinding`). `apps/ptah-cli` unchanged.
- Newest bound checkpoint shadowing older unbound ones: yes, see S1; it should skip, not refuse.
- User-facing error acceptable only for the "nothing exists" case; misleading for the bound-owned case (M1).

### Verdict

- Score: 7/10
- Verdict: REVISE
- Blocking findings: 1. S1 at wizard-generation-rpc.handlers.ts:804 together with wizard-generation-checkpoint.service.ts:224-229 and analysis-storage.service.ts:494-516 (refusal instead of skipping bound manifests; add a mixed bound-newer / unbound-older test). Finding 2 is closed with no issues.


## PR 763 round 3 re-review (codex revision)

Review family: implementer grok then codex, reviewer Claude

Scope: uncommitted diff over 7becd482e in `analysis-storage.service.ts` (+spec), `wizard-generation-checkpoint.service.ts`, `wizard-generation-rpc.handlers.ts` (+spec). No tests run (orchestrator reports typecheck/lint/test green).

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Predicate drops nothing the old unbound lookup resumed; default callers unchanged | PASS with one note | `analysis-storage.service.ts:485-529`: with `accepts` undefined the code path is `return candidate` identical to before. Callers of `findLatestResumableRun`: `setup-rpc.handlers.ts:431` (no predicate), `wizard-generation-checkpoint.service.ts:226` (predicate, unbound only) and `:233` (no predicate, bound path), plus specs. `locateResumable` already did `if (!latest?.generation) return null` (`:235`), so a run with null `generation` was never resumed; the predicate's `!!run.generation` matches that. `lifecycle !== 'completed'` is the exact test the storage method already used (`:505`, `:520`); failed/paused/interrupted stay resumable as before. |
| 2 | Newest eligible unbound run chosen; bound manifest untouched | PASS | Runs sorted newest-first, loop continues past rejected candidates, then root checkpoint (`:507-528`). Handler spec "resumes an older unbound checkpoint when a newer tab-bound run exists" asserts the bound manifest `toEqual` its pre-state and the older one resumed. Lookup is read-only. |
| 3 | RpcUserError only for explicit analysisDir; surfaced correctly; CLI safe | PASS | With `analysisDir === null` the predicate excludes bound runs, so the throw at `wizard-generation-rpc.handlers.ts:805-810` is reachable only via an explicit (authorized) `analysisDir`. It propagates through `executeSubmitInWorkspace`'s catch (`if (error instanceof RpcUserError) throw error;`, ~`:385`), `finally` clears `submitReserved` (`:405`), and `rpc-handler.ts:224-236` returns `{success:false, error, errorCode:'INVALID_PARAMS'}`. CLI: `wizard.ts:204-224` never forwards `resume` (params built from selectedAgentIds/threshold/overrides/analysisData/analysisDir/model), and `setup.ts:232` likewise, so neither CLI path reaches `prepareResumedRun` with resume=true; both treat a failed response through existing generic error handling (`callRpc` throws with code; `ack?.success` check). No CLI behavior change. Legacy UI receives a plain `success:false` + message. |
| 4 | Bound resume and approved legacy-cancel fix unchanged | PASS | Bound call passes `unboundOnly=false` (`!metadata?.tabBinding && analysisDir === null` is false, and bound callers pass `analysisDir` null with metadata, so `findLatestResumableRun(workspaceRoot)` without predicate, `:233`). The mismatch/workspace checks at `:812-829` untouched. Legacy cancel at `:1295-1299` unchanged; the spec adds a bound-stays-running / unbound-aborts test. The `written`/`unchanged` hunk near `:1525` is formatting only. |
| 5 | Spec coverage | PASS (minor gap) | Storage: newer-bound skipped, older returned (`analysis-storage.service.spec.ts` ~626-662). Handler: newer-bound + older-unbound, explicit refusal with message regex, no-analysisDir bound refused with "no resumable" and manifest/writes untouched, unbound adoption path, and the `toHaveBeenCalledWith(WORKSPACE, expect.any(Function))` update. The fake `findLatestResumableRun` applies the predicate (`:1233-1241`). Gap: no storage test for the root-checkpoint branch with a rejecting predicate or an all-rejected `null`. |

### New findings

1. Minor (behavior shift, arguably improvement). `locateResumable` previously took the single newest resumable run and returned null if it had no generation checkpoint (e.g. a newer unfinished analysis-only run). With the predicate (`wizard-generation-checkpoint.service.ts:226-232`) such a run is now skipped and an older unbound generation run is resumed. This affects only unbound `resume:true` without `analysisDir` (legacy wizard); the CLI never sends it. Recommend no change; note in the PR text.
2. Minor (coverage). No storage-level test of predicate behavior on the root `generation` checkpoint branch (`analysis-storage.service.ts:518-527`) or of the all-rejected `null` return.
3. Minor. The predicate duplicates `lifecycle !== 'completed'`, which the storage method already enforces; harmless, but could drift.

Blocking: none. Serious: none.

Score: 8.5/10. Verdict: APPROVE. The earlier blocking defect (a newer bound checkpoint hiding an older resumable unbound run) is fixed with a predicate that preserves default behavior for all other callers.
