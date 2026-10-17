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
