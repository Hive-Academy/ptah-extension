# Implementation Plan - TASK_2026_857_f660

Revision: r3 (revises r2 after the Gate 2 re-review in `implementation-plan-rereview.md`, verdict
REVISE, new findings 1-3; `decisions.md` row 10 folded into Req 1. r2 revised r1 after
`implementation-plan-review.md`, all eight findings accepted in `decisions.md` row 8).

All paths are relative to the worktree `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing`.
"Verified" means the cited line was opened during a design pass (r1 or r2). "Assumption" carries the
check that resolves it.

## Changes in r3

| Re-review finding                                                                                  | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Sections                                                                           |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| N1 (Serious) stale deliverable and exit-0 API limit counted as `delivered` (`decisions.md` row 10) | The lane verdict requires `writtenAfterSpawn !== false`, like `sessionChildVerdictOf` (`lane-completion-notifier.service.ts:174-187`). New pure `matchesApiRateLimit` (sibling of `lane-auth-classifier.ts`). It runs at every lane exit: on exit 0 over the current turn's `error` segments only, on a failed exit over the existing `laneFailureTexts`. The ptah-cli stream loop turns a success result with `is_error` and `api_error_status === 429` (or a 429 wording in `result`) into one fixed `error` segment with no provider text. The match is held in memory on `TrackedAgent.rateLimitMatched`, reset per turn, never persisted. It is carried as `LaneCompletionContext.rateLimited`. Verdict `failed` unless every deliverable is fresh; `failureClass` `usage-limit`; `failureKind` and the limit ledger stay unchanged. Integration cases: stale file, exit-0 429 with that file, fresh file, fresh file with 429 text. Each case asserts the signal and the persisted row. B10 split into B10a/B10b/B10c (each ≤ 6 files, 1 lib). | Codebase evidence; Component 10; Integration architecture; D-20, D-21; batch table |
| N2 (Serious) an older scope answer overwrites a newer turn                                         | Each `assess` carries its admission generation `g` and an immutable conversation snapshot. On settle, `g !== state.generation` → the answer is discarded before any rule runs: no change to revision, continuity, `pendingScope`, nudge, pre-flight or cache. The latest admission's window is never written by a settle. A deferred two-turn spec resolves the assessments in reverse order, including a stale `new-task` after a newer settled answer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Component 16 (Assessment ordering); D-22                                           |
| N3 (Moderate) disabling during an in-flight pre-flight still queues a reminder                     | `HostRoutingSetting.isEnabled()` is checked again when a scope answer or a pre-flight settles. When disabled, the result is discarded and the tab is reset: `cache.markUnknown(tab)`, `queue.discard(latestSessionKey)`, routed/attempted/nudged revisions cleared, `inFlight = null`. After re-enable, reuse requires a fresh `confirmRevision` from a new admission. New alias-aware `NextTurnReminderQueue.discard` (Component 15, same files). Deferred toggle-off spec.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Components 15, 16; D-23                                                            |

## Changes in r2

| Finding                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Sections                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| F1 (Blocking) early lane reviews rejected                           | A review for a missing lane **or** subagent target is held durably (24 h, 500 cap). Lane rows are inserted through the same held-report join as subagent stops, so a held review applies on the lane insert. Expiry goes to the rejected ledger. Integration cases for APPROVED, REJECTED and REVISE before a lane row.                                                                                                                                                                                                     | Component 7; Integration architecture; D-13; batch B8 |
| F2 (Blocking) repeated nudges                                       | New per-tab scope state machine. Initialising the first scope (revision 0 → 1) is separate from a revision change. A revision increments only on a confident `new-task` or a confident material change. Unknown continuity never increments. At most one nudge per revision. The no-repeat test drives the real state machine.                                                                                                                                                                                              | Component 16 (state machine table); D-14              |
| F3 (Serious) duplicate pre-flight per revision                      | The coordinator tracks `inFlight = { revision, promise }`. Unchanged turns share it. Its result is delivered only if its revision is still current, to the latest session key. One attempt per revision, including failures. Deferred-promise test.                                                                                                                                                                                                                                                                         | Component 16; D-15                                    |
| F4 (Serious) no conversation input                                  | Bounded `ScopeConversation` input (pending scope, previous user turn, last assistant reply, last routed scope) for the scope check, and a bounded scope summary for pre-flight. The last assistant reply is read from `SdkAdapterEvents.onTurnEnded` (`sdk-adapter-events.service.ts:42-50,231-234`, emitted at `stop-hook-handler.ts:105-113`). Char budgets fit `REQUEST_TEXT_MAX_CHARS` 8000 and the route_decide `request` max 8000; payload stays under `REQUEST_SIZE_LIMIT_BYTES` 64 KiB. Multi-turn acceptance test. | Components 13, 16; D-16                               |
| F5 (Serious) no user-facing setting                                 | D-6 overturned. New Electron-only `HostRoutingSettingComponent` in the existing Context Management tab (`orchestration-settings.component.ts`), backed by `agentOrchestration.hostRouting`. Conditional default and zero-call behaviour kept. "UI change, no new surface": visual-reviewer captures before/after, dark and light. Own batch for frontend-developer.                                                                                                                                                         | Component 19 (new); Component 17; D-6; batch B20      |
| F6 (Serious) stale cache reuse                                      | `PreflightReuseCache` tracks the coordinator's current revision per session and a continuity state. `get` validates the stored revision against it, refuses while continuity is pending or unknown, and clears everything when host routing is disabled. Cache tests for disabled, malformed answer and scope change.                                                                                                                                                                                                       | Components 13, 14, 16; D-17                           |
| F7 (Moderate) missing public exports                                | `taskKindForRole` exported through the lane-outcomes barrel (`src/index.ts`). `BUILTIN_SUBAGENT_ROLES` exported from `phase-plan.ts` through the lane-routing barrel. Every barrel and owner file is named in the batch table.                                                                                                                                                                                                                                                                                              | Components 6, 9, 13, 14; batches B9, B14              |
| F8 (Moderate) required field breaks recorder input and early checks | `LaneCompletionOutcomeInput` omits `taskKindSource`; the recorder sets it. The field is introduced optional in B1, every literal is updated in B2/B7/B11, and B11 makes it required. Every record literal is named. Each batch compiles on its own.                                                                                                                                                                                                                                                                         | Components 1, 6, 11; batch table; Verification points |
| Review spot-checks 11-13, minor notes                               | A1 resolved (the KV store overrides each mutation, so both new methods need overrides). The Nx tag line is corrected (platform-core is `scope:shared`). `BUILTIN_ROLES` is private today; now exported.                                                                                                                                                                                                                                                                                                                     | Inputs; Assumptions; Component 4                      |

## Inputs and constraints

- Requirements used: `task-description.md` (r2, approved at Gate 1), `task-description-review.md`
  (r1 findings and r2 re-review, including Minor N1 and N2), `decisions.md` (rows 1-8), `context.md`,
  `task.md`, `implementation-plan-review.md` (Gate 2, r1), `implementation-plan-rereview.md`
  (Gate 2 re-review of r2), `decisions.md` rows 9-10.
- Corrections applied: N1 and N2 from `task-description-review.md` (D-3 and D-9). Gate 2 findings
  F1-F8 (see "Changes in r2"). Re-review new findings 1-3 and decision row 10 (see "Changes in r3").
- Design handoff used: none. The one UI change is a toggle inside an existing settings tab, using the
  tab's existing row pattern (Component 19). No new surface, so no design handoff is needed; the
  visual-reviewer captures before/after screenshots.
- Missing decision-critical input: none.
- Live evidence (Req 3, Req 7): `ptah_outcome_report` deliverables reports for
  `subagent:a54e57cf3f6dd665a` and `subagent:a6d8ec5afc1b49aa6` returned `recorded: held`.
  `held` is returned only when no row exists and no `subagent-stop` op is pending for that run id
  (`libs/backend/lane-outcomes/src/lib/write/outcome-write-pipeline.ts:239-241,261,281-332`).
  So no stop producer enqueued a row for those agents. Components 5, 9 and 11 close both possible
  causes (D-4).
- Repository rules applied: `CLAUDE.md` (Electron first; every host keeps compiling; scoped
  `npm run verify -- -p ...` only; no build, serve or e2e). Nx tags: the backend feature libs are
  `scope:extension`; `platform-core` is `scope:shared`/`type:util`
  (`libs/backend/platform-core/project.json:6`); the frontend `chat` lib is
  `scope:webview`/`type:feature` (`libs/frontend/chat/project.json:7`). No new edge is added.

## Codebase evidence

| Evidence                                                                                                                                                                                                                                                                                                        | Location                                                                                                                                                                                                                                                        | Architectural implication                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lib import graph (from `@ptah-extension/*` imports): lane-routing → shared, platform-core; agent-sdk → lane-routing; lane-outcomes → agent-sdk, persistence-sqlite; cli-agent-runtime → lane-outcomes, agent-sdk; vscode-lm-tools → cli-agent-runtime, lane-outcomes, lane-routing; rpc-handlers → all of these | grep over `libs/backend/*/src` (r1 pass); `chat-session.service.ts:52` (rpc-handlers → vscode-lm-tools)                                                                                                                                                         | lane-routing may not import lane-outcomes or agent-sdk (cycle). Ports go in `shared`. The host coordinator goes in rpc-handlers.                           |
| Failure-classifier port: interface in shared, implementation in lane-routing, alias in lane-outcomes                                                                                                                                                                                                            | `libs/shared/src/lib/types/lane-outcome.types.ts:175-199`; `libs/backend/lane-routing/src/lib/failure-class/decision-model-failure-classifier.ts:121-139`; `apps/ptah-electron/src/di/phase-2-libraries.ts:295-297`                                             | Task-kind classification reuses this exact three-part pattern.                                                                                             |
| Recorder keeps per-run classification input in memory and classifies after insert                                                                                                                                                                                                                               | `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts:32-35,59-97`                                                                                                                                                                               | Async post-insert seam for Req 2. The brief stays in memory and never enters the journal.                                                                  |
| `LaneCompletionOutcomeInput` = `Omit<LaneOutcomeRecord, 'executorKind'\|'telemetryJoin'\|'skillsLoaded'\|'sessionEvidenceClass'>` & …                                                                                                                                                                           | `lane-outcome-recorder.service.ts:24-29`                                                                                                                                                                                                                        | A new required record field would leak into the caller (F8). It must be omitted and set inside the recorder.                                               |
| Record literals typed `LaneOutcomeRecord`/`LaneOutcomeRow`                                                                                                                                                                                                                                                      | `lane-outcome-recorder.service.ts:45,100`; `store/store.test-support.ts:4`; `agent-signals.spec.ts:4`; `lane-outcome-reader.service.spec.ts:13`; `subagent-join.spec.ts:8` (`LaneOutcomeRow`); `vscode-lm-tools/.../tools/outcome-report.tool.spec.ts:42`       | Every one must gain `taskKindSource` before the field becomes required (F8).                                                                               |
| Pipeline: lane rows use `insertIfAbsent` and fire `onLaneRecordInserted`; subagent stops use `insertStopWithHeldReports`                                                                                                                                                                                        | `outcome-write-pipeline.ts:605-639` (`:609,623-626`)                                                                                                                                                                                                            | Lane rows never join held reports today.                                                                                                                   |
| `insertStopWithHeldReports` is generic on `run_id`: inserts, joins every held report for that run, deletes them, in one transaction                                                                                                                                                                             | `store/sqlite-lane-outcome.store.ts:178-230`; `store/in-memory-lane-outcome.store.ts:29-60`; interface `store/lane-outcome.store.ts:70-80`                                                                                                                      | The lane insert can reuse it unchanged: this is the F1 join path.                                                                                          |
| Admission: a report to a missing non-subagent target is refused; a subagent review is refused without held deliverables                                                                                                                                                                                         | `outcome-write-pipeline.ts:281-298`; apply-time `:654-661`                                                                                                                                                                                                      | Both sites change for F1.                                                                                                                                  |
| Hold bounds: `HOLD_LIMIT = 500`; expiry logs `Outcome hold expired` and writes the rejected ledger                                                                                                                                                                                                              | `outcome-write-pipeline.ts:93,320,502-512,663`                                                                                                                                                                                                                  | An early review to a run that never arrives ends in the existing diagnostic, not silently.                                                                 |
| Report receipts dedupe by `reportId`; the tool mints a random UUID per call                                                                                                                                                                                                                                     | `persistence-sqlite/src/lib/migrations/0054_lane_outcome_records.ts:11-14`; `vscode-lm-tools/.../tools/outcome-report.tool.ts:182`                                                                                                                              | A deterministic `reportId` gives `(reviewed, reviewer)` dedupe with no new table.                                                                          |
| `applyOutcomeEffect` overwrites `taskKind` with any report kind                                                                                                                                                                                                                                                 | `libs/backend/lane-outcomes/src/lib/store/lane-outcome.store.ts:45-65`                                                                                                                                                                                          | The provenance-precedence rule goes here, as the single effect function.                                                                                   |
| Row schema has nullable join fields and no `taskKindSource`                                                                                                                                                                                                                                                     | `libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts:34-69`                                                                                                                                                                                               | Add `taskKindSource`. The join fields already accept null.                                                                                                 |
| Table definition; latest migration is 0063                                                                                                                                                                                                                                                                      | `0054_lane_outcome_records.ts:38-95`; `persistence-sqlite/src/lib/migrations/index.ts:448-452`                                                                                                                                                                  | New migration is **0064**. Bare `ALTER` (precedent `0060_provider_account_lease_epoch.ts:21-28`).                                                          |
| SQLite store maps named columns                                                                                                                                                                                                                                                                                 | `store/sqlite-lane-outcome.store.ts:17-50`                                                                                                                                                                                                                      | Add one column mapping.                                                                                                                                    |
| KV store overrides each mutation with `this.write(() => super.x())`                                                                                                                                                                                                                                             | `store/key-value-lane-outcome.store.ts:94-114,158-195`                                                                                                                                                                                                          | A1 fails as written: both new store methods need explicit overrides.                                                                                       |
| Stop callback is gated on transcript path, a derived child session id and a resolved parent session id; `agentType` falls back to `'unknown'`                                                                                                                                                                   | `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts:508-559` (`:527`)                                                                                                                                                                              | Root of the Req 3 gap inside the host.                                                                                                                     |
| The second stop producer emits `subagentEnded` with SDK `agent_type` and `last_assistant_message`; it needs a session id and cwd                                                                                                                                                                                | `subagent-stop-hook-handler.ts:56-107`; `sdk-adapter-events.service.ts:62-78,243-247`                                                                                                                                                                           | Second producer for Req 3; host-observed review text for subagents (Req 7).                                                                                |
| Main-thread turn end: `SdkAdapterTurnEndedEvent { sessionId, cwd, lastAssistantMessage, … }`, `onTurnEnded(listener) → unsubscribe`, emitted by the Stop hook from `input.last_assistant_message`                                                                                                               | `agent-sdk/src/lib/helpers/sdk-adapter-events.service.ts:42-50,231-234`; `stop-hook-handler.ts:105-113`; SDK `StopHookInput.last_assistant_message` `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:9058-9064`; exported `agent-sdk/src/index.ts:277,283` | Source of the "assistant clarification" for F4. No transcript read is needed.                                                                              |
| Tab id → real session id fan-out: `SessionIdResolvedPayload { tabId, realSessionId, previousSessionId? }`; `register(cb) → unsubscribe`                                                                                                                                                                         | `session-id-resolved-callback-registry.ts:44-65`; `callback-registry.base.ts:22`; token `agent-sdk/src/lib/di/tokens.ts:195`                                                                                                                                    | The coordinator maps turn-end session ids back to tab state.                                                                                               |
| SDK `SubagentStopHookInput` has `agent_type` and optional `last_assistant_message`                                                                                                                                                                                                                              | `sdk.d.ts:9096-9105`                                                                                                                                                                                                                                            | Confirms both fields exist upstream.                                                                                                                       |
| Stop payload consumers: lane-outcomes recorder and skill-synthesis trigger                                                                                                                                                                                                                                      | `lane-outcome-recorder.service.ts:99`; `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts:97-114`                                                                                                                                          | A nullable payload needs a guard in skill-trigger.                                                                                                         |
| Lane enqueue returns silently when the recorder is absent                                                                                                                                                                                                                                                       | `cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts:26-27`; `cli-agent-runtime/src/lib/di/register.ts:300-313`                                                                                                                                     | Req 1 requires a diagnostic here.                                                                                                                          |
| (r3) `checkLaneDeliverable` sets `writtenAfterSpawn = stat.mtime >= startedMs` when `startedMs` is finite. `sessionChildVerdictOf` requires `writtenAfterSpawn !== false`. The lane `verdictOf` checks only existence and size                                                                                  | `lane-completion-notifier.service.ts:113-136,174-187,667-679`; call site `:596-600`                                                                                                                                                                             | Root of the stale-file `delivered` (decision row 10). The lane rule adopts the child rule; an absent flag keeps today's behaviour.                         |
| (r3) `classifyLaneFailureClass` returns null for `delivered`/`unverified` and maps only `failureKind === 'quota'` to `usage-limit`; exported from the lib barrel                                                                                                                                                | `limits/lane-failure-class.ts:7-27`; `cli-agent-runtime/src/index.ts:3`                                                                                                                                                                                         | A rate-limit input must be added as an **optional** field so external importers keep compiling.                                                            |
| (r3) `handleExit` classifies quota and auth only when `code !== 0` (`status === 'failed'`), from `laneFailureTexts` (last 8 error segments × 4 KiB + 16 KiB stdout tail), before `outputBuffer.discard`; `authMatched` lives on `TrackedAgent` and reaches the notifier through `LaneCompletionContext`         | `agent-process-manager.service.ts:117-120,2741-2778,2822-2860,2978-3000`; `tracked-agent.ts:68-69`; `lane-completion-notifier.service.ts:280-287,353-360`                                                                                                       | An exit-0 run is never classified today. The rate-limit flag follows the `authMatched` path exactly.                                                       |
| (r3) `matchesAuthFailure(texts)` is a conservative, vendor-independent, pure pattern list                                                                                                                                                                                                                       | `limits/lane-auth-classifier.ts:1-16`                                                                                                                                                                                                                           | Template for `matchesApiRateLimit`.                                                                                                                        |
| (r3) `classifyLaneLimit` treats a plain 429 as quota only for `ollama-cloud`, and never on an unknown ptah-cli provider, because an Anthropic rate limit prints the same words                                                                                                                                  | `limits/lane-limit-classifier.ts:52-54,141-156`                                                                                                                                                                                                                 | A rate limit is **not** quota: the new match sets `failureClass` only. It never sets `failureKind` and never writes the limit ledger (`recordLaneLimits`). |
| (r3) `accumulatedSegments` is appended across turns (capped at `MAX_ACCUMULATED_SEGMENTS`) and reset only at spawn; `continueConversation` resets `hasExited` and status per turn                                                                                                                               | `agent-output-buffer.service.ts:103`; `agent-process-manager.service.ts:1126,2199-2217`                                                                                                                                                                         | Exit-0 detection must read only the current turn's segments (a per-turn start index).                                                                      |
| (r3) ptah-cli result handling: a success result emits `info` and calls `reportTurnSuccess` only when `!msg.is_error`; exit code stays 0. An error result emits an `error` segment with exit code 1                                                                                                              | `ptah-cli/helpers/ptah-cli-stream-loop.service.ts:599-641`                                                                                                                                                                                                      | A rate-limited ptah-cli turn (SDK success result with `is_error`) leaves no `error` segment today.                                                         |
| (r3) SDK `SDKResultSuccess` carries `is_error: boolean`, `api_error_status?: number \| null`, `result: string`                                                                                                                                                                                                  | `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5418-5449`                                                                                                                                                                                                | A structured 429 signal for ptah-cli lanes. No text match is needed when the status is present.                                                            |
| `AgentProcessInfo.task` (brief), `role` and `deliverables` reach completion; the notifier holds `IFileSystemProvider`                                                                                                                                                                                           | `libs/shared/src/lib/types/agent-process.types.ts:137,167,177`; `cli-agent-runtime/src/lib/di/register.ts:305`                                                                                                                                                  | Transient brief for classification; the lane review deliverable is readable at completion.                                                                 |
| Spawn args: optional `taskKind`, free `role`                                                                                                                                                                                                                                                                    | `vscode-lm-tools/src/lib/code-execution/mcp-core/agent-spawn-args.schema.ts:91-98`                                                                                                                                                                              | Explicit source = spawn `taskKind`. Mapped source = role.                                                                                                  |
| Phase-kind → default role (private `DEFAULT_ROLE`, private `BUILTIN_ROLES`) and phase-kind → task-kind tables                                                                                                                                                                                                   | `libs/backend/lane-routing/src/lib/pipeline/phase-plan.ts:37-50,349-372`; barrel `lane-routing/src/index.ts:10-71` has no role export                                                                                                                           | F7: export the role set through the barrel.                                                                                                                |
| lane-outcomes barrel exports recorder, reader, `subagentRunId` but no mapping helper                                                                                                                                                                                                                            | `lane-outcomes/src/index.ts:2-67` (`:49-50,58`)                                                                                                                                                                                                                 | F7: add `taskKindForRole`.                                                                                                                                 |
| Local derivation: drops null kinds, five-sample gate, raw rates                                                                                                                                                                                                                                                 | `lane-routing/src/lib/matrix/local-derivation.ts:129,247-307`                                                                                                                                                                                                   | Blend replaces the gate and the raw score.                                                                                                                 |
| `MINIMUM_SAMPLE_COUNT` also enforced by the cell schema and the reasons compiler                                                                                                                                                                                                                                | `matrix/matrix.schema.ts:41`; `reasons/compile-reasons.ts:228-240`                                                                                                                                                                                              | Both drop to a minimum of 1.                                                                                                                               |
| Seed is per family/model, implement kind only; layer order user > local > seed                                                                                                                                                                                                                                  | `matrix/seed-matrix.ts:58-102`; `matrix/capability-matrix.store.ts:186-196`                                                                                                                                                                                     | Prior = exact seed cell score, else `NEUTRAL_SCORE` (`routing-constants.ts:21`).                                                                           |
| Pre-flight is one fixed-question request; caller kinds `unset`/`blocked`/`structured`/`system-one`                                                                                                                                                                                                              | `lane-routing/src/lib/route-decide.service.ts:128-170,306-376`                                                                                                                                                                                                  | The scope check and the classifier reuse the same dispatch (Component 8).                                                                                  |
| `RouteDecideService` takes one `deps` object, built by `useFactory`                                                                                                                                                                                                                                             | `route-decide.service.ts:86-113,114-126`; `lane-routing/src/lib/di/register.ts:115-125`                                                                                                                                                                         | An optional `reuse` dependency is added without changing callers.                                                                                          |
| Text limits: `REQUEST_TEXT_MAX_CHARS = 8000`; route_decide `request` `.max(8000)`; `REQUEST_SIZE_LIMIT_BYTES = 64 * 1024`                                                                                                                                                                                       | `decision-model/decision-payload.ts:5`; `contracts/route-decide-args.schema.ts:41,47`; `routing-constants.ts:145`                                                                                                                                               | Budgets for the F4 conversation input.                                                                                                                     |
| Constants: `DECISION_REQUEST_TIMEOUT_MS = 3000`, `CONFIDENCE_THRESHOLD = 0.5`, `OVERALL_CALL_BUDGET_MS`                                                                                                                                                                                                         | `routing-constants.ts:110,135-142`                                                                                                                                                                                                                              | Bounds for every new decision request.                                                                                                                     |
| Decision model setting read through `IWorkspaceProvider.getConfiguration('ptah', 'agentOrchestration.decisionModel')`; invalid or missing reads as `unset`                                                                                                                                                      | `decision-model/decision-model.config.ts:162-164,188-205`; `decision-model.types.ts:137-138`                                                                                                                                                                    | lane-routing can read `agentOrchestration.hostRouting` the same way (F6 disable gate).                                                                     |
| File-based setting registry and defaults; `settings:set` writes any file-based key except the decision model                                                                                                                                                                                                    | `libs/backend/platform-core/src/file-settings-keys.ts:79-88,98-140,323-355,469`; `rpc-handlers/src/lib/handlers/settings-rpc.handlers.ts:69-78,153-181`                                                                                                         | Storage for the toggle. It creates no UI row (F5).                                                                                                         |
| Shared `ADVANCED_SETTINGS` table and groups render generic rows with a static default                                                                                                                                                                                                                           | `libs/shared/src/lib/types/advanced-settings.types.ts:21-28,65-68,83-121,123+` (boolean precedent `:226-234`); renderer `libs/frontend/chat/src/lib/settings/advanced/advanced-settings-group.component.ts:258-274,350-352`                                     | A static default cannot express "ON only with a decision model", so the toggle is a dedicated component (D-6).                                             |
| Context Management tab (internal id `orchestration`) hosts lane guards and the advanced groups                                                                                                                                                                                                                  | `libs/frontend/chat/src/lib/settings/ptah-ai/orchestration-settings.component.ts:25-34,60-73`                                                                                                                                                                   | Insertion point for the toggle.                                                                                                                            |
| Toggle precedent: standalone, OnPush, signals, save through `SettingsSaveFeedbackService` with read-back and recheck                                                                                                                                                                                            | `ptah-ai/copilot-auto-approve-toggle.component.ts:31-126`; `feedback/settings-save-feedback.service.ts:44-51,157` (`saveGeneric`)                                                                                                                               | Row and save pattern for Component 19.                                                                                                                     |
| Decision model status read in the webview: `ClaudeRpcService.call('agent:getConfig')` → `decisionModel: DecisionModelStatusDto { selection, … }`                                                                                                                                                                | `providers/decision-model-row.component.ts:440,570-593`; `libs/shared/src/lib/types/rpc/rpc-agents.types.ts:167-180,312`; `providers/decision-model-row.view.ts:348`                                                                                            | The toggle reads `selection.kind === 'unset'` to show the effective OFF state.                                                                             |
| `settings:get`/`settings:set` contracts                                                                                                                                                                                                                                                                         | `libs/shared/src/lib/types/rpc.types.ts:1769-1776`                                                                                                                                                                                                              | Typed calls through `ClaudeRpcService`; no new RPC method.                                                                                                 |
| Electron-only mounting in settings                                                                                                                                                                                                                                                                              | `providers/main-agent-reassign-popover.component.ts:310` (`inject(VSCodeService).isElectron`); `ptah-ai/go-vet-consent-config.component.ts:58`                                                                                                                  | The toggle is mounted only in Electron, where the coordinator exists.                                                                                      |
| Chat turn admission: `startSession` → `launchSdkSession`; `continueSession` → context injector → `sendMessageToSession`                                                                                                                                                                                         | `rpc-handlers/src/lib/chat/session/chat-session.service.ts:592,595,697-714,1057,1155,1189-1195`                                                                                                                                                                 | Admission hook points; optional collaborators use `@inject(..., { isOptional: true })` (`:316-321`).                                                       |
| `UserPromptSubmit` returns `additionalContext` on the main thread; gate on `agent_id`                                                                                                                                                                                                                           | `agent-sdk/src/lib/helpers/user-prompt-submit-hook-handler.ts:60-109` (`:85-88`), `:148-177`                                                                                                                                                                    | Next-turn reminder injection point.                                                                                                                        |
| MCP caller identity: `callerSessionId` only for Ptah sessions                                                                                                                                                                                                                                                   | `vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.ts:21-40,75-77`; `protocol-dispatcher.ts:2366-2377`                                                                                                                                        | Distinguishes host-owned from external-client subagents (D-4); normalises the cache key to the tab id.                                                     |
| Candidate source port; its only implementation is in vscode-lm-tools over `ptah.agent`                                                                                                                                                                                                                          | `lane-routing/src/lib/route-candidate-source.port.ts:1-10`; `vscode-lm-tools/.../namespace-builders/route-namespace.builder.ts:79-111`                                                                                                                          | The reminder candidate list reuses `buildRouteCandidateSource`, exported.                                                                                  |
| `PtahAPIBuilder.build()` is not memoised; an RPC handler memoises it once                                                                                                                                                                                                                                       | `rpc-handlers/src/lib/handlers/lane-plan-limits-rpc.handlers.ts:72-77`                                                                                                                                                                                          | Precedent for the coordinator's agent namespace access.                                                                                                    |
| Electron-only value `PLATFORM_TOKENS.HOST_KIND = 'electron'`; Electron composition                                                                                                                                                                                                                              | `apps/ptah-electron/src/di/phase-1-infra.ts:93`; `phase-2-libraries.ts:290-298,406`; `phase-4-handlers.ts:91`                                                                                                                                                   | Electron-only registration points.                                                                                                                         |
| DI guard specs                                                                                                                                                                                                                                                                                                  | `apps/ptah-electron/src/di/{expected-resolvable.ts,container.smoke.spec.ts,rpc-surface.spec.ts,surface-composition.spec.ts}`                                                                                                                                    | New Electron tokens go into `expected-resolvable.ts`. No RPC methods are added.                                                                            |
| Degradation audit ratchet                                                                                                                                                                                                                                                                                       | `tools/degradation-audit/check-degradation.ts:1-60`; `tools/degradation-audit/baseline.json`                                                                                                                                                                    | Every deliberate swallow carries `// degradation-audit: reported - <reason>`.                                                                              |

## Architecture decision

- **Chosen approach.** Five slices, built in this order:
  1. **Learning integrity** (Req 1, 2, 3, 7) inside the existing outcome pipeline. One shared
     column and one migration. The SDK stop payload becomes nullable, the stop callback fires
     without its gates, and the recorder subscribes to the second producer. The recorder resolves
     task kind and its source, with a post-insert classifier port. A strict review-deliverable
     parser runs at lane completion and at subagent end. Reviews that arrive before their target
     row are held durably for both lane and subagent targets and join on insert (F1).
  2. **Prior blending** (Req 8) as a pure change in `local-derivation.ts`.
  3. **Host routing** (Req 4, 5, 6). An Electron-only `HostRoutingCoordinator` in rpc-handlers,
     fired from `ChatSessionService` without awaiting. It owns a per-tab scope state machine
     (F2), one in-flight pre-flight per revision (F3), and a bounded conversation window fed by
     turn text and `onTurnEnded` (F4). It uses a lane-routing `ScopeCheckService`, the existing
     pre-flight, a revision-validated `PreflightReuseCache` (F6), and an agent-sdk
     `NextTurnReminderQueue` drained by the `UserPromptSubmit` hook.
  4. **Setting UI** (Req 4): one Electron-only toggle in the existing Context Management settings
     tab (F5).
  5. **Composition**: the Electron root wires it. VS Code and CLI get the shared types and no new
     calls.
- **Rationale.** Each slice extends a pattern already in the tree: the failure-classifier port and
  post-insert seam (classifier); report receipts (dedupe); held reports joined inside
  `insertStopWithHeldReports` (review before row, now for lanes too); UserPromptSubmit
  `additionalContext` (reminder); optional chat collaborators (admission); the Copilot toggle row
  (setting UI). No new table, RPC method, settings surface or library is needed.
- **Rejected alternatives.**
  - Prepending a `Routing:` block to the user prompt in `continueSession`, as the
    interrupted-agents injector does (`chat-subagent-context-injector.service.ts:229-242`). It
    covers only continue turns, edits user-message content, and would insert into the turn being
    dispatched, which Req 5 forbids.
  - Draining the reminder through `MainThreadNoticeQueue`. That queue drains into the next tool
    result, not the next model turn (`post-tool-use-hook-handler.ts:83-84,227-244`).
  - A new review-receipts table. Deterministic report ids reuse `lane_outcome_report_receipts`.
  - A spawn-time `reviewsRunId` argument. It needs a shared `AgentProcessInfo` change and a spawn
    schema change; Req 7 asks for a deliverable-borne reference.
  - Running the scope check in lane-routing, triggered from agent-sdk. agent-sdk cannot know a
    turn is human; only `chat:start`/`chat:continue` are (`chat-rpc.handlers.ts:240,248`).
  - A seed lookup passed into `deriveLocalMatrix`. The function already imports `seed-matrix.ts`.
  - (F1) Rejecting early lane reviews as unknown targets (r1). Req 7 does not restrict the run kind
    (`task-description.md:105-109`); expiry gives the unknown-target diagnostic instead.
  - (F4) Reading the transcript JSONL for the recent exchange (`session-history-reader.service.ts`,
    `jsonl-reader.service.ts`). It is file I/O on every turn; the Stop hook already hands the
    last assistant message to `onTurnEnded`.
  - (F5) A boolean row in `ADVANCED_SETTINGS`. Its static `default` (`advanced-settings.types.ts:65-68`)
    and generic renderer (`advanced-settings-group.component.ts:350-352`) cannot show "OFF because
    no decision model is set", and the row would also appear in VS Code where it has no effect.
- **Assumptions** (each has a check for the implementer):
  - A1 (resolved): `KeyValueLaneOutcomeStore` overrides each mutation
    (`key-value-lane-outcome.store.ts:158-195`). Both new store methods get overrides (B3).
  - A2: `deps.getSessionTabId` is wired in Electron's HTTP MCP server
    (`http-mcp-server.service.ts:422`). Check that the Electron composition builds that server.
  - A3: `UserPromptSubmitHookHandler` is built by `agent-sdk/src/lib/di/register.ts:380-391`.
    Confirm the factory shape before adding the optional queue.
  - A4: no other open branch has claimed migration version 64. Re-check `migrations/index.ts` and
    take the next free number.
  - A5: `skill-trigger.service.ts` `recordInvocation` needs non-null `workspaceRoot` and
    `transcriptPath`. Confirm the parameter types when adding the guard.
  - A6: `settings:get` returns `FILE_BASED_SETTINGS_DEFAULTS` for an unset file-based key
    (`file-settings-keys.ts:469` merges defaults). Check the `settings:get` handler in
    `settings-rpc.handlers.ts`; if it returns `undefined`, Component 19 treats `undefined` as the
    default `true`.
  - A7: the Stop hook fires once per main-thread turn and its `resolvedSessionId` equals the SDK
    UUID that `SessionIdResolvedPayload.realSessionId` reports (`stop-hook-handler.ts:63-113`).
    Check with the existing stop-hook spec; if not, the coordinator also keys by the hook's id
    through the same alias map.
- **Effect on existing code.**
  - Replaced: the five-sample gate (`MINIMUM_SAMPLE_COUNT` deleted); the transcript/parent gate on
    the stop fan-out; the `'unknown'` agent type fallback; the silent null-recorder return; the
    "review needs held deliverables" rule; the "lane reports are never held" rule for reviews; the
    lane-row `insertIfAbsent` call in the pipeline (now `insertStopWithHeldReports`); `BUILTIN_ROLES`
    becomes the exported `BUILTIN_SUBAGENT_ROLES`.
  - Unchanged: the gate-0.1 path (`route-decide.service.ts:172+`), the model-call report path, the
    capability-matrix layer order, VS Code/CLI chat behaviour, the deliverables-report rule for
    missing lane targets (still rejected).

## Component specifications

### 1. Shared outcome contracts (shared)

- Purpose: one definition of the new record field and the task-kind classifier port.
- Responsibilities:
  - Add `OUTCOME_TASK_KIND_SOURCES = ['explicit','mapped','classified','unclassified'] as const`
    and `OutcomeTaskKindSource`.
  - Add `taskKindSource` to `LaneOutcomeRecord` (`lane-outcome.types.ts:62-104`) in two steps so
    every batch compiles (F8):
    - B1: `readonly taskKindSource?: OutcomeTaskKindSource | null`.
    - B11, after every literal carries it: `readonly taskKindSource: OutcomeTaskKindSource | null`.
      null is allowed only for pre-migration rows; the recorder always writes one of the four.
  - `LaneOutcomeSummary` (`:107-124`) stays as it is.
  - Add `LaneTaskKindClassificationInput { runId; executorKind: OutcomeExecutorKind; role: string | null; brief: string }`
    and `LaneTaskKindClassifier.classify(input): Promise<OutcomeTaskKind | null>` beside the failure
    classifier (`:171-199`). It never rejects. An unset model returns null after zero requests.
  - Amend the privacy header (`:6-7`): `brief` is the one transient text field; never persisted or
    logged.
- Verified contracts: `lane-outcome.types.ts:17-25,61-104,171-199`.
- Dependencies: none new.
- Integration points: lane-outcomes (record, port consumer); lane-routing (port implementer).
- Failure behaviour: types only.
- Quality: the brief is bounded by its producer (Component 6: at most 4000 chars).
- Verification seam: typecheck of `shared` and of every dependent host after B1 and B11.
- Files: MODIFY `libs/shared/src/lib/types/lane-outcome.types.ts` (B1, then B11).

### 2. Migration 0064 `task_kind_source` (persistence-sqlite)

- Purpose: persist the provenance column.
- Responsibilities:
  - `ALTER TABLE lane_outcome_records ADD COLUMN task_kind_source TEXT;`. Nullable, no default, no
    CHECK (same rationale as `0054_lane_outcome_records.ts:26-30`).
  - Existing rows stay null; no backfill (historical provenance cannot be reconstructed).
  - Register `{ version: 64, name: '0064_lane_outcome_task_kind_source', sql }` after `:448-452`.
- Verified contracts: `migrations/index.ts:448-452`; `0060_provider_account_lease_epoch.ts:21-28`.
- Failure behaviour: the runner owns BEGIN/COMMIT/ROLLBACK (`0060…ts:24-25`). A failed migration
  leaves the DB at 63 and the outcome store reports `isPersistent()=false`.
- Verification seam: a real `node:sqlite` spec in the style of `0060_provider_account_lease_epoch.spec.ts:21-36`:
  apply 0054 then 0064; an old row reads `task_kind_source IS NULL`; a new insert stores each of
  the four values.
- Files: CREATE `libs/backend/persistence-sqlite/src/lib/migrations/0064_lane_outcome_task_kind_source.ts`,
  CREATE `…/0064_lane_outcome_task_kind_source.spec.ts`, MODIFY `…/migrations/index.ts`.

### 3. Outcome row schema, report args and effect precedence (lane-outcomes)

- Purpose: validate the new field at the write edge and own the provenance rule.
- Responsibilities:
  - `LaneOutcomeRowSchema` (`lane-outcome.schema.ts:34-69`): add
    `taskKindSource: z.enum(OUTCOME_TASK_KIND_SOURCES).nullable().default(null)`. The default lets
    old journal and KV JSON rows decode. (Lands in B2 with the literal fixes, because `LaneOutcomeRow`
    literals such as `subagent-join.spec.ts:8` then require the key.)
  - `OutcomeReportArgsSchema` review branch (`:24-30`): add optional
    `reviewerRunId: z.string().min(1).max(200)` (B2).
  - `OutcomeReportEffect` review variant (`lane-outcome.store.ts:36-39`) stays verdict-only.
  - `applyOutcomeEffect` (`lane-outcome.store.ts:45-65`), deliverables branch: when `effect.taskKind`
    is set and the row's source is not `explicit`, set `taskKind = effect.taskKind` and
    `taskKindSource = 'explicit'`. When the row is already `explicit`, keep its kind. Never write
    null. Rank: explicit > mapped > classified > unclassified.
  - Add `deterministicReviewReportId(reviewedRunId, reviewerRunId)` → `review:${reviewedRunId}|${reviewerRunId}`
    in `write/report-effect.ts`. Host capture and the tool both use it.
- Verified contracts: as cited; `write/report-effect.ts:8-31,54-82`.
- Failure behaviour: an invalid row is refused by `safeParse` and logged as today
  (`lane-outcome-recorder.service.ts:54-57`).
- Verification seam: `lane-outcome.schema.spec.ts` (four sources, null legacy row, missing field
  defaults to null, `reviewerRunId` bounds) and `write/report-effect.spec.ts` (precedence matrix:
  each existing source × report kind; null never written; deterministic id format).
- Files: MODIFY `libs/backend/lane-outcomes/src/lib/lane-outcome.schema.ts` (B2),
  `…/store/lane-outcome.store.ts` (B3), `…/write/report-effect.ts` (B3),
  `…/lane-outcome.schema.spec.ts` (B4), `…/write/report-effect.spec.ts` (B4).

### 4. Outcome stores: column, conditional classification, join enrichment (lane-outcomes)

- Purpose: persist `taskKindSource` and two narrow updates.
- Responsibilities:
  - SQLite store: add `['taskKindSource','task_kind_source']` to the column list
    (`sqlite-lane-outcome.store.ts:17-43`).
  - New `LaneOutcomeStore.setClassifiedTaskKind(runId, kind): Promise<boolean>`:
    `UPDATE … SET task_kind = ?, task_kind_source = 'classified', updated_at = ? WHERE run_id = ? AND task_kind IS NULL`.
    Returns whether a row changed, so a later explicit kind is never overwritten.
  - New `LaneOutcomeStore.fillMissingSubagentJoin(runId, { subagentSessionId, parentSessionId, workspaceRoot }): Promise<boolean>`
    using `COALESCE(column, ?)` per field ("later producer enriches", Req 3).
  - Update the doc comment of `insertStopWithHeldReports` (`lane-outcome.store.ts:70`): it inserts
    any row kind and joins that run's held reports (used for lanes from Component 7). The name is
    kept (D-13).
  - In-memory store implements the same semantics. KV store adds `override` wrappers through
    `this.write(...)` for both new methods (A1, `key-value-lane-outcome.store.ts:158-195`).
  - `write/pipeline.test-support.ts:138` CREATE TABLE gains the column.
- Verified contracts: `lane-outcome.store.ts:67-122`; SQLite statements `:45-50,150-165,178-230`.
- Failure behaviour: SQL errors propagate to the pipeline and its retry/rejection path
  (`outcome-write-pipeline.ts:1-10`). Callers of `setClassifiedTaskKind` log and leave the row
  unclassified (Component 6).
- Verification seam: `sqlite-lane-outcome.store.spec.ts`, `in-memory-lane-outcome.store.spec.ts`,
  `key-value-lane-outcome.store.spec.ts`: classified update applies only when the kind is null;
  enrichment fills only nulls; the column round-trips; the KV store persists both new mutations
  (reload from storage shows them).
- Files: MODIFY (B3) `…/store/lane-outcome.store.ts` (interface + effect, shared with Component 3),
  `…/store/sqlite-lane-outcome.store.ts`, `…/store/in-memory-lane-outcome.store.ts`,
  `…/store/key-value-lane-outcome.store.ts`, `…/write/pipeline.test-support.ts`;
  MODIFY (B4) `…/store/sqlite-lane-outcome.store.spec.ts`, `…/store/in-memory-lane-outcome.store.spec.ts`,
  `…/store/key-value-lane-outcome.store.spec.ts`.

### 5. SDK stop payload and ungated fan-out (agent-sdk, skill-synthesis)

- Purpose: every SubagentStop with an `agent_id` reaches the stop callback.
- Responsibilities:
  - `SubagentStopPayload` (`subagent-stop-callback-registry.ts:8-16`): `subagentSessionId`,
    `parentSessionId`, `workspaceRoot`, `transcriptPath` and `agentType` become `string | null`.
    `agentId` and `timestamp` stay required.
  - `SubagentHookHandler` (`subagent-hook-handler.ts:508-559`) calls `notifyAll` whenever
    `input.agent_id` is non-empty: `subagentSessionId` = derived id or null; `parentSessionId` =
    resolved id or null; `workspaceRoot` = `workspacePath || null`; `transcriptPath` =
    `input.agent_transcript_path || null`; `agentType` = `input.agent_type || record?.agentType || null`
    (replaces the `'unknown'` literal at `:527`). The two existing warnings become debug facts.
  - `SkillTriggerService.onSubagentStop` (`skill-trigger.service.ts:97-114`) requires non-null
    `workspaceRoot` and `transcriptPath`, so it records exactly the stops it recorded before (A5).
- Dependencies: none new.
- Failure behaviour: `notifyAll` stays inside the existing try/catch (`:521-541`); subscriber errors
  are isolated by `CallbackRegistryBase` (`callback-registry.base.ts:22-53`).
- Verification seam: the `subagent-hook-handler` spec covers a stop with no transcript, one with an
  unparseable transcript name, and one with no parent; each notifies once with nulls and
  `agentType` from `input.agent_type`. The skill-trigger spec checks a null transcript is not
  recorded.
- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/subagent-stop-callback-registry.ts`,
  `…/helpers/subagent-hook-handler.ts`, `…/helpers/subagent-hook-handler.spec.ts` (Assumption: the
  spec exists; create it if not), `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`,
  `…/triggers/skill-trigger.service.spec.ts`.

### 6. Recorder: task-kind resolution, classifier, subagent producers, review capture (lane-outcomes)

- Purpose: build every row with provenance, run classification after insert, and apply
  host-observed reviews.
- Responsibilities:
  - **Input contract (F8).** `LaneCompletionOutcomeInput` (`lane-outcome-recorder.service.ts:24-29`)
    adds `'taskKindSource'` to its `Omit<…>` list. Callers never pass it; the recorder sets it on
    every row it builds. B2 does the minimal step (`input.taskKind ? 'explicit' : 'unclassified'`
    for lanes, `'unclassified'` for subagents at `:100`); B7 replaces it with full resolution.
  - **Mapping table** (new `task-kind-mapping.ts`). `taskKindForRole(role: string | null): OutcomeTaskKind | null`,
    case-insensitive exact match, no fuzzy matching:
    - Task kinds and phase kinds from `phase-plan.ts:349-372` (`plan`, `architecture`→plan,
      `implement`, `review`, `document-review`, `visual-review`, `plan-review`→review, `research`,
      `tests`, `docs`, `design`→docs).
    - Subagent slugs from `phase-plan.ts:37-48` plus repository agents: `project-manager`,
      `software-architect`, `team-leader` → plan; `backend-developer`, `frontend-developer`,
      `devops-engineer` → implement; `code-logic-reviewer`, `code-style-reviewer`,
      `visual-reviewer` → review; `researcher-expert` → research; `senior-tester` → tests;
      `technical-content-writer`, `ui-ux-designer` → docs.
    - Anything else, including `general-purpose`, `Explore` and `unknown`, returns null.
    - Exported through the lane-outcomes barrel (Component 9, F7) for cli-agent-runtime.
  - **Lane rows** (`recordLaneCompletion`, `:43-79`) take an extra transient argument
    `{ brief?: string }`. Resolution: `input.taskKind` → explicit; else `taskKindForRole(role)` →
    mapped; else null + unclassified. When a classifier is registered and the brief is non-blank,
    stash `{ runId, executorKind, role, brief: brief.slice(0, 4000) }` in a map bounded to 200
    entries (oldest dropped). Nothing waits for classification; the spawn path makes no request.
  - **Subagent rows**:
    - `recordSubagentStop(payload)`: nullable fields; `role = agentType`; kind via mapping, else
      unclassified. A brief is available only from the second producer.
    - New `recordSubagentEnded(event: SdkAdapterSubagentEndedEvent)`: same row with
      `parentSessionId = event.sessionId`, `workspaceRoot = event.cwd`, `subagentSessionId = null`,
      `telemetryJoin: 'unavailable'`; enqueue `subagent-stop`. When the kind is unresolved and
      `lastAssistantMessage` is non-blank, stash its first 4000 chars as the brief. When the mapped
      kind is `review` and `lastAssistantMessage` is present, call `captureReview` with reviewer
      `subagentRunId(agentId)`.
  - **Insert callback**: rename `onLaneRecordInserted` to `onRecordInserted(row)`. It schedules the
    existing failure classification (lane only) and the new task-kind classification:
    `void classifier.classify(...).then(kind => kind && store.setClassifiedTaskKind(runId, kind)).catch(warn)`,
    mirroring `:85-96`.
  - **Review capture**: `captureReview({ reviewerRunId, text })` → `parseReviewDeliverable(text)`
    (new `review-verdict.parser.ts`).
    - Format, published in the file's doc comment:
      - Exactly one distinct reviewed-run line:
        `^\s*(?:[-*]\s*)?(?:\*\*)?Reviewed-Run(?:\*\*)?\s*:\s*`?([A-Za-z0-9:._|-]{1,200})`?\s*$` (case-insensitive).
      - One or more verdict lines that all agree:
        `^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?(?:\*\*)?Verdict(?:\*\*)?\s*:\s*(?:\*\*)?(APPROVED|REVISE|REJECTED)\b`
        (case-insensitive).
      - Conflicting verdicts, more than one distinct reviewed run, or reviewed run = reviewer are
        ambiguous.
    - Returns `{ reviewedRunId, verdict } | { refusal: 'no-target' | 'no-verdict' | 'ambiguous' | 'self-review' }`.
    - On success: `attachReview(target, verdict, { reportId: deterministicReviewReportId(reviewed, reviewer) })`.
      `attachReview` (`:180-198`) gains an optional reportId. A missing target is held by the
      pipeline (Component 7), for lanes and subagents alike.
    - On refusal: log `'Review capture refused'` with `{ reviewerRunId, refusal }` only.
  - **External-caller row**: exported helper `reportedSubagentStopRow(agentId, nowMs): LaneOutcomeRecord`
    → an unclassified row (`taskKindSource: 'unclassified'`), `verdict 'unverified'`,
    `telemetryJoin 'unavailable'` (Component 11).
- Verified contracts: `lane-outcome-recorder.service.ts:24-199`; `subagentRunId` exported
  (`lane-outcomes/src/index.ts:58`); `SdkAdapterSubagentEndedEvent` exported (`agent-sdk/src/index.ts:285`).
- Dependencies: lane-outcomes → agent-sdk (types only, existing edge) and → shared.
- Failure behaviour: a classifier rejection or null result leaves the row unclassified with one
  warning (`// degradation-audit: reported - classification is optional evidence; the row stays unclassified`).
  Capture refusals change no row. Map overflow drops the oldest entry, which stays unclassified.
- Quality: no text is persisted or logged; the brief lives in memory until classification settles
  or is evicted.
- Verification seam: `lane-outcome-recorder.service.spec.ts`: the four sources (explicit and mapped
  make zero classifier calls; unset model makes zero calls); a caller cannot set `taskKindSource`
  (type-level: the input type has no such key); a classified row becoming eligible; mapping table
  cases; `recordSubagentEnded` row shape. `review-verdict.parser.spec.ts`: every refusal, case
  variants, markdown bullets and bold, conflicting lines.
- Files: MODIFY `libs/backend/lane-outcomes/src/lib/lane-outcome-recorder.service.ts` (B2 minimal,
  B7 full); CREATE (B7) `…/task-kind-mapping.ts`, `…/review-verdict.parser.ts`,
  `…/review-verdict.parser.spec.ts`; MODIFY (B7) `…/lane-outcome-recorder.service.spec.ts`.
  B2 also updates the record fixtures `…/store/store.test-support.ts:4`, `…/agent-signals.spec.ts:4`,
  `…/lane-outcome-reader.service.spec.ts:13`, `…/subagent-join.spec.ts:8` with
  `taskKindSource: null` (legacy-shaped fixtures) or a source where the spec asserts one.

### 7. Write pipeline: one insert path with held-report join, enrichment, durable review holds (lane-outcomes)

- Purpose: make the second stop producer, and every review that arrives early, durable (F1).
- Responsibilities:
  - **Insert path.** `apply` (`outcome-write-pipeline.ts:605-639`) uses
    `store.insertStopWithHeldReports(row, now, reportEffectOf)` for **both** `lane` and
    `subagent-stop` rows, replacing `insertIfAbsent` at `:623`. For both kinds: reject
    `result.invalid` as `invalid-payload` (as `:614-620`), and call `onRecordInserted(row)` when
    `result.inserted` (callback renamed from `onLaneRecordInserted`, `:170,624-626`). For a
    subagent stop that did not insert, call `store.fillMissingSubagentJoin(row.runId, joinFields)`
    (first producer wins, later one enriches).
  - **Admission (`submit`, `:281-332`).** Replace the `!subagent || (review && …)` refusal at
    `:293-298` with:
    - `review` to a missing target, lane or subagent, with no pending insert: held. No
      held-deliverables precondition.
    - `deliverables` to a missing lane target: refused as today (`run … not found`).
    - `deliverables` to a missing subagent target: held as today.
    - `pendingHolds` (`:312-318`) counts every pending report without a pending row, not only
      subagent ones, so the 500 cap covers lane holds.
  - **Apply (`applyReport`, `:654-669`).** On `missing`: a `review` (any target kind) or a subagent
    `deliverables` report is held under `HOLD_LIMIT` (`:663`); a lane `deliverables` report is
    rejected `target-missing`.
  - **Expiry.** Unchanged: a held review whose target never arrives expires after 24 h through
    `expireHolds` (`:502-512`) into the rejected ledger as `held-report-expired`. That is the
    unknown-target diagnostic.
  - Update the header comment (`:1-10`): "Reviews to a missing lane or subagent run, and
    deliverables to a missing subagent run, are held for up to 24 hours, at most 500 at once."
- Verified contracts: as cited; `store/sqlite-lane-outcome.store.ts:178-230` (join is generic on
  `run_id`); `store/in-memory-lane-outcome.store.ts:29-60`.
- Failure behaviour: unchanged retry/rejection semantics. The held review survives restart in
  `lane_outcome_held_reports` (SQLite) and in the KV snapshot; the journal `heldRuns` index covers
  the not-yet-open store (`:288-291`).
- Verification seam:
  - `outcome-write-pipeline.spec.ts`: two stop ops for one agent give one row with enriched nulls;
    a review before a subagent stop with no held deliverables is held, then joined; a lane
    `deliverables` report to a missing lane is still rejected; the hold cap counts lane holds.
  - New `write/outcome-early-review.integration.spec.ts` (real pipeline, in-memory store, and a
    SQLite store over `pipeline.test-support.ts`): for each of APPROVED, REJECTED and REVISE, a
    review (host capture through `deterministicReviewReportId`) submitted before the reviewed lane
    row returns `held`; the later lane completion inserts the row and the row shows
    `finalReview` APPROVED / REJECTED, or `reviseRounds` 1 for REVISE; replaying the same review
    after the insert does not change counts (receipt dedupe); a held review whose lane never
    arrives expires into the rejected ledger with `held-report-expired`; a store reopened before
    the lane insert still joins the held review.
- Files: MODIFY `…/write/outcome-write-pipeline.ts`, `…/write/outcome-write-pipeline.spec.ts`;
  CREATE `…/write/outcome-early-review.integration.spec.ts`.

### 8. Shared decision caller and task-kind classifier (lane-routing)

- Purpose: one opened-caller dispatch for the three fixed-question users (pre-flight, scope check,
  task kind), and the classifier implementation.
- Responsibilities:
  - Extract `openCaller`, `dispatchFor` and `noteLive` (`route-decide.service.ts:291-376`) into
    `decision-model/decision-caller.ts` as a `DecisionCaller` class with dependencies
    `{ config, logger, structured?, seams? }`. `RouteDecideService` delegates with no behaviour
    change.
  - New `task-kind/decision-model-task-kind-classifier.ts` implements `LaneTaskKindClassifier`:
    one `runFixedRequest` (`pipeline/model-refine.ts:143`) with question `task_kind`, criteria
    `criterionLabels(OUTCOME_TASK_KINDS)`, request text `Role: <role|none>\nTask:\n<brief>`;
    acceptance via `validateChoiceAnswer` (threshold 0.5); unset/blocked → null after zero
    requests; any throw is logged and returns null.
  - Token `LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER = Symbol.for('LaneRoutingTaskKindClassifier')`,
    registered with `useFactory` like `FAILURE_CLASSIFIER` (`di/register.ts`, around `:115`).
- Verified contracts: `route-decide.service.ts:86-170,291-376`; `di/tokens.ts:9-40`;
  `preflight-answer.ts:25-59`.
- Dependencies: shared (port), existing internals.
- Failure behaviour: never rejects; timeout `DECISION_REQUEST_TIMEOUT_MS` (`routing-constants.ts:110`).
- Verification seam: `route-decide.preflight.spec.ts` and `route-decide.gate.spec.ts` pass unchanged.
  `decision-model-task-kind-classifier.spec.ts`: unset (0 requests), valid kind, low confidence →
  null, out-of-set → null, timeout → null.
- Files: CREATE `libs/backend/lane-routing/src/lib/decision-model/decision-caller.ts`,
  `…/task-kind/decision-model-task-kind-classifier.ts`, `…/task-kind/decision-model-task-kind-classifier.spec.ts`;
  MODIFY `…/route-decide.service.ts`, `…/di/tokens.ts`, `…/di/register.ts`.

### 9. Outcome DI wiring, barrel and second producer subscription (lane-outcomes)

- Purpose: inject the optional task-kind classifier, subscribe to `subagentEnded` on request, and
  publish the helpers other libs call.
- Responsibilities:
  - `LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER` (new) resolved optionally in the recorder factory,
    like `FAILURE_CLASSIFIER` (`di/register.ts:81`). Wire `pipeline.onRecordInserted` to
    `recorder.onRecordInserted` (`register.ts:66-69`).
  - `startLaneOutcomes(container, logger, options?: { observeSubagentEnded?: boolean })`
    (`di/start.ts:60-119`): when true and `SDK_TOKENS.SDK_ADAPTER_EVENTS` is registered, subscribe
    `onSubagentEnded(e => recorder.recordSubagentEnded(e))` and push the disposer into `unsubs`.
    `startAndRegisterLaneOutcomes` passes the option through.
  - Barrel `libs/backend/lane-outcomes/src/index.ts` (F7) adds: `taskKindForRole`
    (from `./lib/task-kind-mapping`), `reportedSubagentStopRow`, `parseReviewDeliverable`,
    `deterministicReviewReportId`.
- Verified contracts: `di/start.ts:60-119`; `agent-sdk/src/lib/di/tokens.ts:144`;
  `sdk-adapter-events.service.ts:243-247`; barrel `lane-outcomes/src/index.ts:2-67`.
- Failure behaviour: the subscription runs in the existing try/catch (`start.ts:109-114`) and is
  released by the disposer.
- Verification seam: `subagent-stop.integration.spec.ts` (new; real registry and `SdkAdapterEvents`,
  recorder, in-memory store): callback first then `subagentEnded`, and the reverse: one row each
  time; a stop with no transcript gives `telemetryJoin 'unavailable'`; a held deliverables report
  joins; a review-kind subagent with a valid `lastAssistantMessage` and **no** `ptah_outcome_report`
  gives the reviewed lane row `finalReview`; a message without a target changes nothing.
- Files: MODIFY `libs/backend/lane-outcomes/src/lib/di/tokens.ts`, `…/di/register.ts`, `…/di/start.ts`,
  `libs/backend/lane-outcomes/src/index.ts`; CREATE `…/lib/subagent-stop.integration.spec.ts`;
  MODIFY `…/di/start.spec.ts` (Assumption: the spec exists; create it if not).

### 10. Lane terminal coverage and lane review capture (cli-agent-runtime)

- Purpose: Req 1 diagnostics, a correct terminal verdict (stale deliverable, exit-0 API rate limit;
  `decisions.md` row 10), and proof, plus the Req 7 lane event.
- Responsibilities:
  - **Fresh-deliverable rule (r3, N1).** `LaneCompletionNotifier.verdictOf`
    (`lane-completion-notifier.service.ts:667-679`) gains a fourth parameter `rateLimited: boolean`
    and the session-child freshness rule (`:180-185`):
    1. `status !== 'completed' && !hostStopped` → `failed` (unchanged).
    2. `allFresh` = deliverables non-empty and every check has `exists`, `bytes > 0` and
       `writtenAfterSpawn !== false`.
    3. `rateLimited && !allFresh` → `failed`. A fresh, complete deliverable wins over a 429
       wording: the CLI retried and finished.
    4. No deliverables → `unverified`. Else `allFresh` → `delivered`, otherwise `no-deliverable`.

    An absent `writtenAfterSpawn` (unreadable mtime or non-finite `startedAt`) keeps today's
    existence rule, as in the child verdict. `LaneCompletionContext` (`:280-287`) gains
    `readonly rateLimited?: boolean`, documented as "API rate-limit wording seen in this turn's
    bounded output; in memory only". The call at `:596-600` passes `context.rateLimited ?? false`. The rendered line already prints
    `(NOT written by this run)` (`:156-162`), so no text change is needed. `startedMs` is the lane's
    first spawn time, so a continuation turn that leaves a turn-1 file untouched still counts as
    fresh (Assumption, unchanged from today; the check: `buildSignal` passes `Date.parse(info.startedAt)`).

  - **Rate-limit matcher (r3, N1).** New pure `limits/lane-rate-limit-classifier.ts`. It exports
    `matchesApiRateLimit(texts: readonly string[]): boolean`, shaped like `matchesAuthFailure`
    (`lane-auth-classifier.ts:12-16`): no clock, no I/O, no logging. The patterns are conservative.
    A 429 must sit next to an API or rate wording on the same line. A bare "429" or a bare
    "rate limit" never matches:
    - `/\bAPI Error\b[^\n]{0,80}?\b429\b/i` (for example "API Error: Request rejected (429)" or
      "API Error: 429 {…}")
    - `/\b429\b[^\n]{0,80}?\b(?:rate[- ]?limit(?:ed)?|too many requests)\b/i` (for example
      "429 Kimi Code API rate limit")
    - `/\brate[- ]?limit(?:ed)?\b[^\n]{0,80}?\b429\b/i`
    - the fixed ptah-cli marker `PTAH_API_RATE_LIMIT_SEGMENT` = `'API rate limit (HTTP 429)'`, exported
      from the same file.

    It is not quota. It never feeds `classifyLaneLimit`, `failureKind` or `recordLaneLimits`.

  - **Capture at exit (r3, N1).** `TrackedAgent` (`tracked-agent.ts:68-69`) gains
    `rateLimitMatched?: boolean` and `turnSegmentStart?: number`. Both are in memory and never
    persisted. `turnSegmentStart` is set to 0 at spawn (`agent-process-manager.service.ts:1126`) and
    to `accumulatedSegments.length` in `continueConversation` beside `hasExited = false` (`:2206`).
    The flag is computed in `handleExit` inside the `status === 'running'` branch (`:2741-2769`),
    before `outputBuffer.discard` (`:2778`):
    - `code === 0` → `matchesApiRateLimit(errorSegmentsSince(turnSegmentStart))`. That is the
      current turn's `error` segments only, at most `LIMIT_CLASSIFIER_ERROR_SEGMENTS` (8), each cut
      to `LIMIT_CLASSIFIER_SEGMENT_CHARS` (4 KiB) (`:117-120`). Stdout is **not** read on exit 0: a
      lane's final summary may legitimately discuss 429s (this task's own lanes will).
    - `code !== 0` → `matchesApiRateLimit(this.laneFailureTexts(tracked))`, the same bounded texts
      the auth match reads (`:2759-2760`).
    - A match logs `debug('[AgentProcessManager] Lane turn matched an API rate-limit wording',
{ agentId, cli, exitCode })`. The log carries no text.
    - `signalLaneCompletion` (`:2992-3000`) adds `rateLimited: tracked.rateLimitMatched ?? false`.
      Timeout and stop paths never enter that branch, so they keep `false`.
    - If segments hit `MAX_ACCUMULATED_SEGMENTS`, later ones are not stored
      (`agent-output-buffer.service.ts:103`). Detection then fails open: no match, today's
      behaviour.
  - **ptah-cli adapter output (r3, N1).** In `ptah-cli-stream-loop.service.ts` at the success-result
    branch (`:602-625`), when `msg.is_error` and either `msg.api_error_status === 429` or
    `matchesApiRateLimit([msg.result.slice(0, 4096)])`, emit exactly one
    `{ type: 'error', content: PTAH_API_RATE_LIMIT_SEGMENT }`. The provider text is never copied
    into the segment. The exit code stays 0 and `reportTurnSuccess` stays skipped (`:625`). The
    stream loop imports the classifier by relative path, inside the same project.
  - **Failure class (r3, N1).** `LaneFailureClassInput` (`lane-failure-class.ts:7-12`) gains
    **optional** `rateLimited?: boolean`. It is optional because the function is exported from the
    lib barrel (`src/index.ts:3`). The precedence becomes: `delivered`/`unverified` → null; `quota`
    → `usage-limit`; `rateLimited` → `usage-limit`; timeout; auth; crash; completed + `no-deliverable`
    → `bad-output`. The doc comment at `:14` is updated to match.
  - `enqueueLaneCompletionOutcome` (`lane-completion-outcome.ts:12-70`): when the recorder thunk
    returns null, log one `warn('[LaneCompletionNotifier] Outcome recorder unavailable', { runId })`
    per process plus a debug line per run; pass `{ brief: info.task }` as the transient argument.
    It passes no `taskKindSource` (the input type omits it, Component 6). (r3) It gains a
    `rateLimited: boolean` parameter after `authMatched`. The notifier passes
    `context.rateLimited ?? false` (`:353-360`), and the value is forwarded to
    `classifyLaneFailureClass`. `failureKind` stays `info.failureKind ?? null`, so a rate limit
    never pretends to be quota.
  - `LaneCompletionNotifier.signal` (`lane-completion-notifier.service.ts:331-360`), after enqueue:
    when the lane's resolved kind is review (`info.taskKind === 'review'` or
    `taskKindForRole(info.role) === 'review'`, imported from `@ptah-extension/lane-outcomes`) and
    `info.deliverables` is non-empty, read each declared deliverable through the injected
    `IFileSystemProvider` (≤ 64 KiB per file, ≤ 3 files, inside the lane working directory, same
    path-escape rule as `outcome-report.tool.ts:132-142`); parse the concatenation with
    `recorder.captureReview({ reviewerRunId: runId, text })`. Fire-and-forget after the chat
    notification is queued.
- Verified contracts: `lane-completion-outcome.ts:12-70`; `cli-agent-runtime/src/lib/di/register.ts:300-313`;
  `agent-process.types.ts:137,167,177`. (r3) `lane-completion-notifier.service.ts:113-136,156-187,280-287,353-360,596-600,667-679`;
  `limits/lane-failure-class.ts:7-27`; `limits/lane-auth-classifier.ts:1-16`;
  `limits/lane-limit-classifier.ts:52-54,141-156`; `agent-process-manager.service.ts:117-120,1126,2199-2217,2741-2778,2850-2860,2978-3000`;
  `tracked-agent.ts:68-69`; `agent-output-buffer.service.ts:103`;
  `ptah-cli/helpers/ptah-cli-stream-loop.service.ts:599-641`; `sdk.d.ts:5418-5449`.
- Dependencies: cli-agent-runtime → lane-outcomes (existing edge), through the barrel only. The r3
  additions are all inside cli-agent-runtime. The SDK result type is already imported from
  agent-sdk (`ptah-cli-stream-loop.service.ts:16-45`). No new edge.
- Failure behaviour: a read failure logs `warn` with `{ runId, code }` and captures nothing
  (`// degradation-audit: reported - review capture is optional evidence`). A missing recorder logs
  the warning above. (r3) The rate-limit match fails open: no match, or a segment dropped by the
  cap, leaves today's verdict. A false positive needs both a 429 and an API or rate wording in an
  `error` segment of the same turn, and a stale or missing deliverable. A fresh deliverable is
  never downgraded. No output text reaches a log, a row or the journal.
- Verification seam: `lane-terminal-outcomes.integration.spec.ts` (new; notifier, real recorder,
  pipeline, in-memory store, synthetic `AgentProcessInfo`): completed with a fresh deliverable →
  `delivered`; crash → `failed`/crash; `failureKind 'quota'` → `failed`/usage-limit; timeout →
  `failed`/timeout; caller stop → `failed` (`verdictOf`, `lane-completion-notifier.service.ts:658-678`);
  a continuation (new `completedAt`) → second row, same `completedAt` deduped; a null recorder logs
  the warning; a review-kind lane whose deliverable has `Reviewed-Run: <implementer runId>` and
  `Verdict: REVISE` increments `reviseRounds` once and a replay does not; a review lane that
  finishes **before** the implementer lane is held and applies when the implementer row lands
  (end-to-end F1).
  - **(r3, N1) freshness and rate-limit cases**, same spec. A real temp file is written, then its
    mtime is set before or after `info.startedAt`. Each case asserts both the delivered
    `LaneCompletionSignal` (`verdict`, deliverable line) **and** the persisted in-memory store row
    (`verdict`, `failureClass`, `failureKind`):
    1. Pre-existing non-empty deliverable (mtime < `startedAt`), exit 0, `rateLimited: false` →
       signal `no-deliverable` with `(NOT written by this run)`; row `no-deliverable` / `bad-output`
       / `failureKind` null.
    2. The same pre-existing file, exit 0, `rateLimited: true` → signal `failed`; row `failed` /
       `usage-limit` / `failureKind` null.
    3. Fresh non-empty deliverable (mtime ≥ `startedAt`), exit 0, `rateLimited: false` → signal
       `delivered`; row `delivered` / `failureClass` null.
    4. Fresh deliverable, `rateLimited: true` → `delivered` / null (no false downgrade).
    5. A store spy confirms that no row field and no logger call contains the 429 text.
  - `lane-rate-limit-classifier.spec.ts`: each wording matches ("API Error: Request rejected
    (429)", "API Error: 429 {\"type\":\"rate_limit_error\"}", "429 Kimi Code API rate limit",
    "rate limited (429)", the fixed marker). These do not match: a bare "429", a bare "rate limit",
    "HTTP 4290", a 429 and a rate wording on different lines, and `MODEL_CAPACITY_EXHAUSTED`.
  - `lane-failure-class.spec.ts`: `rateLimited` → `usage-limit` for `failed` and `no-deliverable`;
    still null for `delivered`/`unverified`; `quota` keeps precedence; an absent field is unchanged.
  - `agent-process-manager.service.spec.ts`:
    - an exit-0 turn whose current-turn error segment is the marker → the signal context has
      `rateLimited: true` and `failureKind` stays undefined;
    - an exit-0 turn with "API Error: 429" only in stdout → `false`;
    - a continuation turn after a rate-limited turn 1 → `false` (per-turn start index);
    - a failed exit with a 429 rate wording in its tail → `true`.
  - `ptah-cli-stream-loop.service.spec.ts`: a success result with `is_error: true,
api_error_status: 429` emits one `error` segment equal to the marker and turn exit code 0. A
    success result with `is_error: true` and a 429 wording in `result` gives the same. `is_error`
    with status 500 and a non-429 `result` emits no marker. A clean success emits none.
- Files:
  - CREATE (B10a) `libs/backend/cli-agent-runtime/src/lib/cli-agents/limits/lane-rate-limit-classifier.ts`,
    `…/limits/lane-rate-limit-classifier.spec.ts`. MODIFY (B10a) `…/limits/lane-failure-class.ts`,
    `…/limits/lane-failure-class.spec.ts`.
  - MODIFY (B10b) `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-outcome.ts`,
    `…/lane-completion-notifier.service.ts`, `…/lane-completion-notifier.service.spec.ts`. CREATE
    (B10b) `…/lane-terminal-outcomes.integration.spec.ts`.
  - MODIFY (B10c) `libs/backend/cli-agent-runtime/src/lib/cli-agents/tracked-agent.ts`,
    `…/cli-agents/agent-process-manager.service.ts`, `…/cli-agents/agent-process-manager.service.spec.ts`
    (Assumption: the exit-path cases fit there; else the nearest `agent-process-manager.*.spec.ts`
    that drives `handleExit`), `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-stream-loop.service.ts`,
    `…/ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts`.
  - The existing notifier spec fixtures that expect `delivered` from a file whose mtime precedes
    `startedAt` must get a fresh mtime in B10b. Check: grep the spec for `writtenAfterSpawn` and
    `mtime`.

### 11. Outcome report tool: reviewer pairing, external-caller subagent rows, required field flip (vscode-lm-tools, shared)

- Purpose: dedupe model-reported reviews against host capture, record subagents that never produce
  a host stop, and make `taskKindSource` required once every literal has it (F8).
- Responsibilities:
  - Review kind: when `args.reviewerRunId` is present, `reportId = deterministicReviewReportId(runId, reviewerRunId)`;
    otherwise a random UUID as today (`outcome-report.tool.ts:182`).
  - Deliverables kind with an `{agentId}` target, no subagent row, no lane row, and **no
    `getCallerSessionId()`** (external MCP client, `mcp-request-context.ts:21-40`): enqueue
    `{ kind: 'subagent-stop', row: reportedSubagentStopRow(agentId, now) }` through
    `deps.pipeline.enqueue` before `submit`, so `submit` sees a pending insert and returns `applied`
    or `queued` (`outcome-write-pipeline.ts:239-279`).
  - A Ptah-session caller keeps today's hold (its stop arrives through Components 5 and 9).
  - Update the tool description sentence (`:80-83`) to name `reviewerRunId`, and to say a review
    can be reported before the reviewed run finishes.
  - The spec fixture `row()` (`outcome-report.tool.spec.ts:42`) gains `taskKindSource`.
  - Flip `LaneOutcomeRecord.taskKindSource` to required in `lane-outcome.types.ts` (Component 1).
- Verified contracts: `outcome-report.tool.ts:90-207`.
- Failure behaviour: unchanged result union; an enqueue during dispose is ignored (`:215`).
- Verification seam: `outcome-report.tool.spec.ts`: external caller deliverables → `applied` and one
  row; a Ptah caller → `held`; the same `(reviewed, reviewer)` reported twice → one `reviseRounds`
  increment; a review to a missing lane run → `held` (F1); a review without `reviewerRunId` keeps
  today's behaviour. After the flip, typecheck every host.
- Files: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tools/outcome-report.tool.ts`,
  `…/tools/outcome-report.tool.spec.ts`, `libs/shared/src/lib/types/lane-outcome.types.ts`.

### 12. Prior-blended local cells (lane-routing)

- Purpose: Req 8.
- Responsibilities:
  - `routing-constants.ts`: add `export const BLEND_PRIOR_WEIGHT = 10;`; delete
    `MINIMUM_SAMPLE_COUNT` (`:151-152`).
  - `local-derivation.ts`:
    - `cellFrom` (`:247-275`) builds a cell when `deliveryTotal > 0 || reviewTotal > 0`.
    - Prior `p` = score of the seed value cell for the same `(family, model, taskKind)` from
      `buildSeedMatrix(nowMs)` by exact profile match, else `NEUTRAL_SCORE`.
    - `scoreBucket` (`:277-307`) blends each available rate as `score = round((100·s + k·p) / (n + k))`
      through the existing integer helpers: `roundPercent(100·s + k·p, 100·(n + k))` for one rate;
      `roundMean(100·s₁ + k·p, 100·(n₁ + k), 100·s₂ + k·p, 100·(n₂ + k))` for both. Delivery uses
      `s = delivered`, `n = delivered + noDeliverable + failed`. Review uses `s = approved`,
      `n = approved + rejected`.
    - `delivered` never counts toward the review rate (already true in `countSummary`, `:166-203`).
    - Update the header comment (`:22-38`).
  - `matrix.schema.ts:41` sets `sampleCount` to `.min(1)`; `compile-reasons.ts:228-240` minimum 1.
  - Specs replace the `MINIMUM_SAMPLE_COUNT` imports.
- Verified contracts: as cited; `capability-matrix.store.ts:186-190` (user precedence kept).
- Numeric examples (settles N2; `k = 10`):

  | Case              | Prior                | Observations                      | Score                                        |
  | ----------------- | -------------------- | --------------------------------- | -------------------------------------------- |
  | Seeded, falling   | 80 (glm-5 implement) | 1 failed                          | round(800/11) = **73**                       |
  | Seeded, falling   | 80                   | 5 failed                          | round(800/15) = **53**                       |
  | Seeded, falling   | 80                   | 50 failed                         | round(800/60) = **13**                       |
  | Neutral, rising   | 50                   | 1 delivered                       | round(600/11) = 54.55 → **55**               |
  | Neutral, rising   | 50                   | 5 delivered                       | round(1000/15) = **67**                      |
  | Neutral, rising   | 50                   | 100 delivered                     | round(10500/110) = **95**                    |
  | Both rates        | 50                   | delivery 5/5, review 1/1 approved | mean(66.67, 54.55) = 60.61 → **61**          |
  | Exact half        | 50                   | 30 failed                         | 500/40 = 12.5 → **13** (half away from zero) |
  | Zero denominators | any                  | only `unverified` rows            | no cell                                      |

- Failure behaviour: an unsafe integer product leaves the cell underived, as today
  (`local-derivation.ts:309-345`).
- Verification seam: `local-derivation.spec.ts` (one test per table row), a user cell overriding a
  local one in `capability-matrix.store.spec.ts` (unchanged, rerun), `compile-reasons.spec.ts`
  (sample count 1 accepted, 0 refused).
- Files: MODIFY `libs/backend/lane-routing/src/lib/routing-constants.ts`, `…/matrix/local-derivation.ts`,
  `…/matrix/local-derivation.spec.ts`, `…/matrix/matrix.schema.ts`, `…/reasons/compile-reasons.ts`,
  `…/reasons/compile-reasons.spec.ts`.

### 13. Scope check, host routing setting and revision-validated reuse cache (lane-routing)

- Purpose: the typed per-turn decision (Req 4), the single effective-enable rule, and the reusable
  pre-flight that is valid only for an unchanged agreed scope (Req 6, F6).
- Responsibilities:
  - **`ScopeConversation`** (F4), the bounded input, built by the coordinator:
    `{ turnText; previousUserTurn: string | null; lastAssistantReply: string | null; pendingScope: string | null; lastRoutedScope: string | null }`.
    `ScopeCheckService` enforces the caps itself (truncating, never rejecting):

    | Field                | Cap (chars) |
    | -------------------- | ----------- |
    | `turnText`           | 2000        |
    | `previousUserTurn`   | 800         |
    | `lastAssistantReply` | 1500        |
    | `pendingScope`       | 1200        |
    | `lastRoutedScope`    | 1200        |

    Total ≤ 6700 chars plus ≤ 200 chars of section labels, under `REQUEST_TEXT_MAX_CHARS` 8000
    (`decision-payload.ts:5`). At ≤ 4 bytes per char the request text is ≤ 28 KiB, plus four fixed
    questions, under `REQUEST_SIZE_LIMIT_BYTES` 64 KiB (`routing-constants.ts:145`). The existing
    payload builder still enforces both limits.

  - **`ScopeCheckService.assess(conversation): Promise<ScopeAssessment>`**: one `runFixedRequest`
    through `DecisionCaller` with four fixed questions:

    | key               | criteria                                                                                                                                  |
    | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
    | `engineering`     | `yes`: software engineering work on this workspace (code, design, tests, docs, research for a change); `no`: anything else                |
    | `scope_settled`   | `yes`: goal and boundaries are agreed enough to start, counting the user's agreement with the assistant's last proposal; `no`: still open |
    | `relation`        | `new-task`: a different piece of work from the scope under discussion or last routed; `continuation`: the same work                       |
    | `material_change` | `yes`: the agreed scope changed in goal, size or boundaries; `no`: unchanged                                                              |
    - Request text, in this order, each section omitted when its field is null:
      `Scope under discussion:\n<pendingScope>\n\nLast routed scope:\n<lastRoutedScope>\n\nUser earlier:\n<previousUserTurn>\n\nAssistant's last reply:\n<lastAssistantReply>\n\nUser turn:\n<turnText>`.
    - Result: `ScopeAssessment = { kind: 'unavailable' } | { kind: 'answered'; engineering; settled; relation; materialChange }`.
      Each answer is `{ value, confidence } | null`; null = malformed or `confidence < CONFIDENCE_THRESHOLD`
      (`validateChoiceAnswer`). `usage` is returned for logs.

  - **`buildPreflightScopeSummary(conversation): string`** (pure, same file): the pre-flight request
    text for Req 5's "bounded summary of that scope":
    `Agreed scope:\n<pendingScope ≤ 1500>\n\nAssistant's proposal:\n<lastAssistantReply ≤ 1500>\n\nUser's confirmation:\n<turnText ≤ 2000>`
    (sections omitted when null; ≤ 5100 chars, under the route_decide `request` `.max(8000)`,
    `route-decide-args.schema.ts:41`). The first 1200 chars become `routedScope`.
  - **`HostRoutingSetting`** (new `scope/host-routing-setting.ts`): `isEnabled(): boolean` =
    `workspace.getConfiguration('ptah', 'agentOrchestration.hostRouting') !== false && config.getSelection().kind !== 'unset'`.
    A non-boolean stored value reads as the default `true`. Dependencies: `IWorkspaceProvider`,
    `DecisionModelConfig` (same read path as `decision-model.config.ts:188-205`). This is the one
    place the effective rule lives (coordinator gate and cache gate both call it).
  - **`PreflightReuseCache`** (in memory, at most 100 sessions, LRU), revision-validated (F6):
    - Per session key: `{ continuity: 'known' | 'pending' | 'unknown'; currentRevision: number | null; entry?: { revision; modelFingerprint; result: PreflightResult } }`.
    - `beginTurn(key)`: sets `continuity = 'pending'` (called synchronously at admission, before
      the scope answer, so a skill pre-flight during the scope check cannot hit).
    - `confirmRevision(key, revision)`: `continuity = 'known'`, `currentRevision = revision`; drops
      an entry whose revision differs.
    - `markUnknown(key)`: `continuity = 'unknown'`, entry deleted (malformed/unavailable
      continuity).
    - `put(key, { revision, modelFingerprint, result })`: stored only when `revision === currentRevision`.
    - `get(key, modelFingerprint): PreflightResult | null` returns a hit only when
      `setting.isEnabled()`, `continuity === 'known'`, `entry.revision === currentRevision`, and the
      fingerprint matches. When the setting is disabled it calls `clear()` first and returns null.
      A fingerprint mismatch deletes the entry.
    - `invalidate(key)`, `clear()`.
    - `modelFingerprint` = `JSON.stringify(config.getSelection())` (no secret: keys live in secret
      storage, `decision-model.types.ts:140-148`).
  - **Roles export (F7)**: `phase-plan.ts:50` `BUILTIN_ROLES` becomes
    `export const BUILTIN_SUBAGENT_ROLES: ReadonlySet<string>` (same values; internal uses at
    `:239` renamed).
  - Tokens `SCOPE_CHECK_SERVICE`, `PREFLIGHT_REUSE_CACHE`, `HOST_ROUTING_SETTING` in `di/tokens.ts`,
    registered with `useFactory` in `di/register.ts`. Barrel `lane-routing/src/index.ts` exports
    the three classes' types, `ScopeAssessment`, `ScopeConversation`, `buildPreflightScopeSummary`
    and `BUILTIN_SUBAGENT_ROLES`.
- Verified contracts: `preflight-answer.ts:25-59`; `routing-constants.ts:107-145`; `di/tokens.ts`;
  `di/register.ts:86-125`; `phase-plan.ts:37-50,237-239`; barrel `index.ts:10-71`.
- Failure behaviour: `assess` never rejects (unset, blocked, timeout or bad output → `unavailable`
  or null answers). The cache and setting never throw; a config read failure reads as disabled.
- Verification seam:
  - `scope-check.service.spec.ts`: unset (0 requests); all four answered; low confidence → null;
    timeout → unavailable; each field truncated to its cap; a maximal conversation stays
    ≤ 8000 chars and the built payload ≤ 64 KiB; sections omitted when null.
  - `preflight-reuse-cache.spec.ts`: LRU bound; fingerprint mismatch; **disabled** setting → miss
    and the cache is empty afterwards; **pending** continuity (after `beginTurn`) → miss;
    **malformed answer** (`markUnknown`) → miss and entry gone; **scope change**
    (`confirmRevision` with a new revision) → miss for the old entry; same revision confirmed
    again → hit; `put` for a stale revision is ignored.
  - `host-routing-setting.spec.ts`: `false` → off; `true`/missing/non-boolean with a model → on;
    any value with an unset model → off.
- Files: CREATE (B13) `libs/backend/lane-routing/src/lib/scope/scope-check.service.ts`,
  `…/scope/scope-check.service.spec.ts`, `…/scope/preflight-reuse-cache.ts`,
  `…/scope/preflight-reuse-cache.spec.ts`, `…/scope/host-routing-setting.ts`,
  `…/scope/host-routing-setting.spec.ts`; MODIFY (B14) `…/di/tokens.ts`, `…/di/register.ts`,
  `libs/backend/lane-routing/src/index.ts`, `…/pipeline/phase-plan.ts`.

### 14. Pre-flight reuse on `route_decide` (lane-routing, vscode-lm-tools)

- Purpose: Req 6. A later skill pre-flight in the same session with an unchanged, confirmed
  revision makes no second model request.
- Responsibilities:
  - `RouteDecideDependencies` (`route-decide.service.ts:86-113`) gains optional
    `reuse?: PreflightReuseCache`, passed by the factory (`di/register.ts:115-125`).
  - `RouteDecideService.decide(args, source, context?: { sessionKey?: string })` (`:114-126`): for
    `pre-flight` with a `sessionKey` and a `reuse` cache, call `reuse.get(sessionKey, fingerprint)`.
    On a hit, return a copy whose reasons gain `'reused host pre-flight result'` and whose `usage`
    is `{ requests: 0, inputTokens: null, outputTokens: null, costUsd: null }`, validated by
    `PreflightResultSchema`. All validity checks (enabled, continuity, revision, fingerprint) live
    in the cache. gate-0.1 is untouched.
  - `RouteNamespace.decide(args, context?)` (`route-namespace.builder.ts:43-45,101-111`) forwards
    the context; `handleRouteToolCall(args, route, logger, context?)` (`route-tool-handlers.ts:108`)
    forwards it; `routeDecideResponse` (`protocol-dispatcher.ts:2871-2882`) computes
    `sessionKey = deps.getSessionTabId?.(callerSessionId) ?? callerSessionId` from
    `getCallerSessionId()`, as at `:2366-2377` (A2).
  - Export `buildRouteCandidateSource` from the vscode-lm-tools barrel for Component 16.
- Failure behaviour: a miss falls through to the normal pre-flight; the cache never throws.
- Verification seam: `route-decide.preflight.spec.ts`: a confirmed hit makes zero dispatches; a
  fingerprint change, a missing key, a pending or unknown continuity, a disabled setting, or an
  invalidated entry makes one dispatch. `route-tool-handlers` spec: the context is forwarded.
- Files: MODIFY (B14) `libs/backend/lane-routing/src/lib/route-decide.service.ts`,
  `…/route-decide.preflight.spec.ts`; MODIFY (B15)
  `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/route-namespace.builder.ts`,
  `…/mcp-core/route-tool-handlers.ts`, `…/mcp-core/route-tool-handlers.spec.ts` (Assumption: path;
  else the nearest existing spec), `…/mcp-core/protocol-dispatcher.ts`, `libs/backend/vscode-lm-tools/src/index.ts`.

### 15. Next-turn reminder queue and hook drain (agent-sdk)

- Purpose: deliver one reminder into the next main-thread model turn without touching the current
  one.
- Responsibilities:
  - `NextTurnReminderQueue` (new): `put(sessionKey, text)` replaces any pending reminder (stale
    dropped), text capped at 600 chars; `take(sessionId): string | null` reads and deletes;
    subscribes once to `SessionIdResolvedCallbackRegistry` and moves entries from `tabId` to
    `realSessionId`, keeping a bounded alias map of 200 so a later `put(tabId)` lands on the real
    id; `dispose()` releases the subscription.
    (r3, N3) `discard(sessionKey): void` deletes a pending reminder under `sessionKey` **and**
    under its aliased real id (alias map lookup), so a tab key still reaches an entry that was
    rekeyed. It is synchronous, never throws, and a missing entry is a no-op.
  - `UserPromptSubmitHookHandler` (`:60-109`) gets the queue as an optional dependency (A3). On the
    main thread only (after the `:88` gate), `additionalContext` = the pointer and
    `queue.take(resolvedSessionId)`, joined with a blank line, returned only when non-empty.
  - Token `SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE`, a singleton in `di/register.ts` near `:360`.
    The barrel export is in B17.
- Verified contracts: `user-prompt-submit-hook-handler.ts:60-109`; `session-id-resolved-callback-registry.ts:44-65`.
- Failure behaviour: `take` is synchronous and never throws; with no queue the hook behaves as today.
- Quality: O(1) per prompt; bounded maps; one subscription with a release path.
- Verification seam: queue spec (replace drops stale, take deletes, rekey in both orders, alias
  bound; (r3) `discard(tabId)` after a rekey removes the entry so `take(realId)` returns null, and
  `discard` of an absent key is a no-op); hook spec (a subagent prompt never drains; a main prompt drains once; a second prompt gets
  nothing).
- Files: CREATE `libs/backend/agent-sdk/src/lib/helpers/next-turn-reminder.queue.ts`,
  `…/helpers/next-turn-reminder.queue.spec.ts`; MODIFY `…/helpers/user-prompt-submit-hook-handler.ts`,
  `…/helpers/user-prompt-submit-hook-handler.spec.ts`, `…/di/tokens.ts`, `…/di/register.ts`.

### 16. Host routing coordinator (rpc-handlers)

- Purpose: Req 4 and 5 for the Electron main conversation.
- Responsibilities:
  - **Entry.** `HostRoutingCoordinator.admitUserTurn({ tabId, sessionId, prompt })` is synchronous
    and returns `void`; internally `void this.run(...)` with a catch.
  - **Gate (synchronous, before any call).** Skip blank prompts and slash commands. If
    `HostRoutingSetting.isEnabled()` is false: `cache.clear()`, apply **Disable reset** (below) to
    the tab, return. Zero model calls. Otherwise `cache.beginTurn(tabId)`.
  - **Disable reset (r3, N3)**, one private method, used at the admission gate and at every settle
    that finds the setting off. For the tab:
    - `cache.markUnknown(tab)`: entry deleted, continuity `unknown`, so `get` misses until a fresh
      `confirmRevision`;
    - `queue.discard(state.latestSessionKey)`: drops a pending reminder or nudge;
    - `inFlight = null`, `attemptedRevision = null`, `routedRevision = null`, `nudgedRevision = null`.

    `revision`, `pendingScope` and the conversation window are kept. They hold no reusable
    result. Clearing the routed and attempted marks means a re-enabled tab is routed again rather
    than suppressed by a pre-disable attempt. After re-enable, nothing is reused until a new
    admission's `assess` settles and calls `confirmRevision` (rules 2-5). A skill pre-flight in that
    gap misses (continuity `unknown`, then `pending` after `beginTurn`).

  - **Conversation window (F4).** Per tab, in memory only, never logged:
    - `previousUserTurn` = the prior admitted turn text (≤ 800).
    - `lastAssistantReply` (≤ 1500), updated from `SdkAdapterEvents.onTurnEnded(e)`
      (`sdk-adapter-events.service.ts:231-234`): `e.lastAssistantMessage` is stored on the tab whose
      alias maps `e.sessionId`. The alias map (bounded 200) is fed by `admitUserTurn` (continue turns
      carry the real `sessionId`) and by `SessionIdResolvedCallbackRegistry.register`
      (`callback-registry.base.ts:22`, payload `session-id-resolved-callback-registry.ts:44-65`) for
      start turns (A7).
    - Both subscriptions are taken once in the constructor and released in `dispose()`.
  - **State per tab** (bounded LRU, 200 tabs):
    `{ generation; revision (0 = no scope yet); pendingScope; routedRevision; routedScope; nudgedRevision; attemptedRevision; inFlight: { revision; promise } | null; previousUserTurn; lastAssistantReply }`.
    Each admission bumps `generation` and records `latestSessionKey = sessionId ?? tabId`.
  - **Assessment ordering (r3, N2).** At admission, synchronously and in this order:
    1. `const g = ++state.generation`.
    2. Build an immutable `ScopeConversation` snapshot from the window as it stands. Then set
       `previousUserTurn = turnText`, so the window now belongs to the latest turn.
    3. Call `assess(snapshot)`, then `.then((answer) => this.applyAssessment(tab, g, turnText,
snapshot, answer))`.

    `applyAssessment` checks two guards first, before any rule runs:
    - (a) `g !== state.generation` → discard. No change to `revision`, continuity (`confirmRevision`
      or `markUnknown`), `pendingScope`, `nudgedRevision`, `attemptedRevision`, `inFlight`, the
      cache or the queue. `debug` `{ tabId, stage: 'scope', reason: 'superseded' }`, no text.
    - (b) `!setting.isEnabled()` → Disable reset, then stop (N3).

    Only the newest admission's answer can mutate state. The newest snapshot already carries the
    older turn as `previousUserTurn`, so no context is lost. A settle never writes the conversation
    window. Only admission (`previousUserTurn`) and `onTurnEnded` (`lastAssistantReply`) write it,
    so a late answer cannot roll the window back. While a newer answer is still pending, the cache
    stays `pending` (from that admission's `beginTurn`) and nothing is reused. If the newest answer
    is `unavailable`, rule 1 marks the cache unknown and the older answer stays discarded. That is
    the fail-open path: no reminder, no nudge. A tab evicted from the LRU while an assessment is
    pending is a discard: no state is recreated by a settle.

  - **Scope state machine (F2).** One `assess(conversation)` per admitted turn, applied only through
    `applyAssessment` above. Let `E`, `S`, `R`,
    `M` be the engineering, settled, relation and material-change answers (null = malformed or
    below threshold). Rules apply in order:

    | #   | Condition                                       | Revision                                                      | Cache                                              | Next step                                      |
    | --- | ----------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------- |
    | 1   | `unavailable`, or `E` null                      | unchanged                                                     | `markUnknown(tab)`                                 | stop: no reminder, no nudge                    |
    | 2   | `E = no`                                        | unchanged                                                     | `confirmRevision(tab, revision)`                   | stop (non-engineering turn leaves scope as is) |
    | 3   | `E = yes`, `revision = 0`                       | **initialise** to 1 (not a change); `pendingScope = turnText` | `confirmRevision(tab, 1)`                          | act on revision                                |
    | 4   | `E = yes`, `R = new-task` or `M = yes`          | `revision += 1`; `pendingScope = turnText`                    | `confirmRevision(tab, revision)` (drops old entry) | act on revision                                |
    | 5   | `E = yes`, `R = continuation` and `M = no`      | unchanged                                                     | `confirmRevision(tab, revision)`                   | act on revision                                |
    | 6   | `E = yes`, `R` or `M` null (other combinations) | unchanged (stable; never incremented on unknown)              | `markUnknown(tab)`                                 | stop: no reminder, no nudge                    |

    **Act on revision** (the current one, `v`):
    - `v === routedRevision` → nothing (already routed; Req 4 bullet 2).
    - `S = yes` → pre-flight for `v` (below).
    - `S = no` or null, and `nudgedRevision !== v` → queue the nudge to `latestSessionKey`,
      `nudgedRevision = v`.
    - `S = no` or null, and `nudgedRevision === v` → nothing. So an unresolved revision gets at
      most one nudge however many unchanged turns follow.

  - **Pre-flight, one per revision (F3).**
    - If `inFlight?.revision === v`: reuse `inFlight.promise`; no new call.
    - Else if `attemptedRevision === v` (an earlier attempt for `v` failed): no new call (D-15).
    - Else: `attemptedRevision = v`; `inFlight = { revision: v, promise: routeDecide.decide({ stage: 'pre-flight', request: buildPreflightScopeSummary(conversation) }, source) }`.
    - `buildPreflightScopeSummary` receives the snapshot of the generation whose answer was applied
      (always the newest, per Assessment ordering). So the request never carries a superseded
      turn's scope as its pending scope.
    - On settle, the continuation reads the tab state at that moment, in this order:
      - (r3, N3) `!setting.isEnabled()` → discard the result (no `cache.put`, no `queue.put`, no
        `routedRevision`), apply Disable reset, stop.
      - `state.revision !== v` (scope changed meanwhile) → discard.
      - Otherwise, on success: `routedRevision = v`,
        `routedScope = summary.slice(0, 1200)`, `cache.put(tab, { revision: v, modelFingerprint, result })`,
        build the reminder and `queue.put(state.latestSessionKey, text)`; the queue replaces any
        pending nudge. On failure: no reminder. `inFlight = null` in both cases. The reminder is
        therefore delivered once, through the latest generation's session key, never into an
        already dispatched turn.
  - **Candidates**: `buildRouteCandidateSource(api.agent)`, with `PtahAPIBuilder.build()` memoised
    once (precedent `lane-plan-limits-rpc.handlers.ts:72-77`), raced against
    `MODEL_LISTING_BUDGET_MS` (2000). Lanes: installed, not disabled, limit not `at-limit`, ordered
    by `preferredRank` then id, at most 4 labels. Subagents: `roles()` intersected with
    `BUILTIN_SUBAGENT_ROLES` imported from `@ptah-extension/lane-routing` (F7), at most 4. A
    timeout or rejection drops that part of the line.
  - `routing-reminder.format.ts` (pure):
    - Reminder: `Routing: pre-flight taskType=<value|undetermined> (<source>[, <confidence 2dp>]); depth=<value|undetermined> (<source>[, <confidence>]). Available lanes: <a, b>. Available subagents: <x, y>. Executor choice stays with gate-0.1 at plan approval.`
      Absent lists omitted; total ≤ 600 chars.
    - Nudge: `Routing: the engineering scope does not look settled yet. Confirm the goal and boundaries with the user before planning.`
    - Neither text tells the model to call `route_decide` (out of scope, `task-description.md:33`).
  - Registration: `registerHostRoutingServices(container)` registers
    `CHAT_TOKENS.HOST_ROUTING_COORDINATOR` as a singleton, exported from the rpc-handlers barrel;
    only Electron calls it (Component 18).
  - `ChatSessionService` injects `@inject(CHAT_TOKENS.HOST_ROUTING_COORDINATOR, { isOptional: true })`
    (pattern `:316-321`) and calls `admitUserTurn` in `startSession` after `launchSdkSession`
    resolves (`:697`, `sessionId: null`) and in `continueSession` right after
    `sendMessageToSession` returns (`:1189`, real `sessionId`). Ptah-CLI and slash-command branches
    excluded. Neither call is awaited.
- Verified contracts: `chat-session.service.ts:592-714,1057-1195`; `chat/tokens.ts:10-30`;
  `route-decide-result.schema.ts:218-227`; `sdk-adapter-events.service.ts:42-50,231-234`;
  `session-id-resolved-callback-registry.ts:44-65`; `agent-sdk/src/lib/di/tokens.ts:144,195`.
- Dependencies: rpc-handlers → lane-routing, agent-sdk, vscode-lm-tools, platform-core (existing
  edges).
- Failure behaviour: every failure fails open for chat (scope timeout, pre-flight throw, listing
  timeout, missing cache, queue or event bus). No reminder for a failed pre-flight; a nudge is not a
  recommendation. A pre-flight whose `taskType` and `depth` both came from `skill-table` with a
  non-null `fallbackCause` queues no reminder. One `warn` per failure with `{ tabId, stage, code }`
  (`// degradation-audit: reported - host routing is advisory; chat continues`).
- Quality: zero awaits on the reply path; at most one scope request per admitted turn; at most one
  pre-flight attempt per revision; turn, scope and assistant text live only in memory and are never
  logged; two subscriptions with release paths; all maps bounded. (r3) Only the newest
  admission's scope answer mutates state. No reminder is queued while the effective setting is off,
  checked at admission and at each settle.
- Verification seam: `host-routing.coordinator.spec.ts`, driving the real coordinator with fake
  `ScopeCheckService`, `RouteDecideService`, a real `PreflightReuseCache`, a real
  `NextTurnReminderQueue` and a real `SdkAdapterEvents`:
  - Setting off, or model unset: zero `assess` and zero `decide` calls; cache cleared.
  - **No repeated nudge (F2)**: turn 1 `E=yes, S=no` → one nudge (revision 1); turns 2 and 3
    `E=yes, R=continuation, M=no, S=no` → no further nudge, revision stays 1; turn 4 with `R` null
    → no nudge, revision stays 1, cache `unknown`.
  - Settled new task: one pre-flight, one reminder, cache confirmed hit afterwards.
  - Continuation with no change on a routed revision: nothing.
  - Material change: revision + 1, old cache entry dropped, a new pre-flight.
  - **Deferred pre-flight (F3)**: turn 1 settled starts `decide` returning a deferred promise;
    turn 2 (unchanged, settled) arrives before it resolves → `decide` called once in total;
    resolving it posts exactly one reminder to turn 2's session key.
  - Deferred pre-flight, then a material change before it resolves: the first result is discarded,
    a second `decide` runs for the new revision, only its reminder is posted.
  - Pre-flight failure: no reminder; another unchanged settled turn makes no second call.
  - Unknown continuity (`R` null) after a routed revision: cache `get` misses (F6).
  - **(r3, N2) Reverse-order scope answers** (deferred `assess`). Turn 1 "refactor the uploader"
    and turn 2 "add retries to the downloader, 3 attempts" are admitted back to back, each with its
    own deferred promise.
    1. Resolve turn 2's answer first: `E=yes, S=yes`, revision 0 → 1, one `decide`. Its `request`
       has turn 2's text as pending scope.
    2. Then resolve turn 1's answer with `E=yes, R=new-task, M=yes, S=yes` (the stale `new-task`).
    3. Assert: revision stays 1; `decide` was called once in total; after the pre-flight settles,
       the cache entry has revision 1 and `get` hits; exactly one reminder is queued, to turn 2's
       session key; `pendingScope` is turn 2's text; `previousUserTurn` is still turn 2's text.
    - Variant: the stale turn-1 answer is `E=yes, S=no` → no nudge is queued.
    - Variant, in order but overlapping: turn 1 resolves first while turn 2 is pending → it is
      discarded. Cache `get` misses (continuity `pending`), with zero `decide` and no nudge. Then
      turn 2 resolves and applies normally.
  - **(r3, N3) Disable while pre-flight is in flight.** Turn 1 settled → `decide` returns a deferred
    promise. A nudge is pre-queued for the same key from an earlier unsettled turn, so its discard
    can be seen. The fake setting is flipped to off, then the deferred promise resolves.
    - Assert: `queue.take(sessionKey)` is null (no reminder, the nudge discarded); `cache.get` misses
      and still misses after the setting returns to on; `decide` was called once.
    - Then, with the setting on, an unchanged settled turn 2 is admitted with a deferred `assess`.
      A `cache.get` before that answer resolves misses. After it resolves, a **new** `decide` runs
      (the attempt mark was cleared) and exactly one reminder is queued.
    - Same flip during a pending **scope** answer: the answer is discarded with zero `decide` and no
      nudge.
  - `routing-reminder.format.spec.ts`: format, omissions, 600-char cap.
  - **Multi-turn acceptance (F4)** `host-routing.multi-turn.spec.ts`: turn 1 "add retries to the
    uploader" → `S=no` → nudge; an `onTurnEnded` event for that session carries the assistant's
    clarification ("Retry only network errors, 3 attempts with backoff?"); turn 2 "yes, use that
    approach" → the `assess` input contains the pending scope, the assistant reply and the new
    turn; with `R=continuation, M=no, S=yes` exactly one pre-flight runs, its `request` contains
    the pending scope and the assistant proposal and is ≤ 8000 chars; one reminder is queued and no
    second nudge.
  - `chat-session.service` spec: `admitUserTurn` called on start and continue, not on slash or
    ptah-cli turns, and dispatch does not wait on a never-resolving coordinator.
- Files: CREATE (B18) `libs/backend/rpc-handlers/src/lib/chat/host-routing/host-routing.coordinator.ts`,
  `…/host-routing.coordinator.spec.ts`, `…/host-routing.multi-turn.spec.ts`,
  `…/routing-reminder.format.ts`, `…/routing-reminder.format.spec.ts`; MODIFY (B18)
  `libs/backend/rpc-handlers/src/lib/chat/tokens.ts`; CREATE (B19) `…/host-routing/register-host-routing.ts`;
  MODIFY (B19) `…/chat/session/chat-session.service.ts`, its spec (`chat-session.service.spec.ts`;
  Assumption: path, else the nearest existing chat-session spec), `libs/backend/rpc-handlers/src/index.ts`.

### 17. Host routing setting storage (platform-core, agent-sdk)

- Purpose: storage and default for the toggle (Req 4). The UI is Component 19 (D-6 overturned).
- Responsibilities:
  - Add `'agentOrchestration.hostRouting'` to `FILE_BASED_SETTINGS_KEYS` (`file-settings-keys.ts:98-140`)
    and `'agentOrchestration.hostRouting': true` to `FILE_BASED_SETTINGS_DEFAULTS` (`:323+`). It is
    not added to `ADVANCED_SETTINGS` (D-6).
  - Add it to the export/import allowlist (`agent-sdk/src/lib/types/settings-export.types.ts`,
    around `:90`).
  - The stored default `true` is the "ON with a configured model" half; `HostRoutingSetting`
    (Component 13) makes it effectively OFF without a model (Req 4 bullet 4).
  - `settings:set` accepts it through `isFileBasedSettingKey` (`settings-rpc.handlers.ts:153-181`);
    it is not in the refused list (`:69-78`).
  - Export `NextTurnReminderQueue` from `libs/backend/agent-sdk/src/index.ts` (Component 15; kept
    here so the agent-sdk barrel has one owner batch).
- Failure behaviour: a non-boolean value reads as the default `true`, with no throw.
- Verification seam: `file-settings-keys.spec.ts` (the key is file-based and its default is `true`;
  Assumption: the spec enumerates keys, update its list if so); coordinator gate cases.
- Files: MODIFY `libs/backend/platform-core/src/file-settings-keys.ts`,
  `libs/backend/platform-core/src/file-settings-keys.spec.ts`,
  `libs/backend/agent-sdk/src/lib/types/settings-export.types.ts`, `libs/backend/agent-sdk/src/index.ts`.

### 18. Electron composition root and DI guards (apps/ptah-electron)

- Purpose: wire everything in Electron only.
- Responsibilities:
  - `phase-2-libraries.ts`: after `:295-297`, register `LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER`
    with `useToken: LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER`; change `:406` to
    `startAndRegisterLaneOutcomes(container, logger, { observeSubagentEnded: true })`.
  - `phase-4-handlers.ts`: call `registerHostRoutingServices(container)` after
    `registerChatServices` (`:91`).
  - `expected-resolvable.ts`: add `CHAT_TOKENS.HOST_ROUTING_COORDINATOR`,
    `LANE_ROUTING_TOKENS.SCOPE_CHECK_SERVICE`, `LANE_ROUTING_TOKENS.PREFLIGHT_REUSE_CACHE`,
    `LANE_ROUTING_TOKENS.HOST_ROUTING_SETTING`, `LANE_ROUTING_TOKENS.TASK_KIND_CLASSIFIER`,
    `LANE_OUTCOME_TOKENS.TASK_KIND_CLASSIFIER` and `SDK_TOKENS.SDK_NEXT_TURN_REMINDER_QUEUE`.
  - `rpc-surface.spec.ts` and `surface-composition.spec.ts` need no change (no RPC method or
    surface added); run them to confirm.
  - VS Code and CLI: the lane-routing and agent-sdk tokens are registered by the shared register
    functions in all hosts. Add them to `apps/ptah-extension-vscode/src/di/expected-resolvable.ts`
    and `apps/ptah-cli/src/di/expected-resolvable.ts` only if those guards enumerate every
    lib-owned token (check by reading each file). Those hosts get no classifier alias, no
    `observeSubagentEnded` and no coordinator, so their behaviour is unchanged.
- Failure behaviour: none new; the smoke spec resolves every token.
- Verification seam: `npm run verify -- -p ptah-electron` (smoke, rpc-surface, surface-composition).
- Files: MODIFY `apps/ptah-electron/src/di/phase-2-libraries.ts`, `apps/ptah-electron/src/di/phase-4-handlers.ts`,
  `apps/ptah-electron/src/di/expected-resolvable.ts`; possibly MODIFY the VS Code/CLI
  `expected-resolvable.ts`.

### 19. Host routing settings toggle (frontend chat, Electron only) — new in r2 (F5)

- Purpose: the user-facing Electron setting named in Req 4. **UI change, no new surface**: one row
  inside the existing Context Management tab.
- Responsibilities:
  - New `HostRoutingSettingComponent`, selector `ptah-host-routing-setting`, in
    `libs/frontend/chat/src/lib/settings/ptah-ai/host-routing-setting.component.ts`. Standalone,
    `ChangeDetectionStrategy.OnPush`, state in signals, `computed` for derived state. It is
    self-contained like `CopilotAutoApproveToggleComponent` (`copilot-auto-approve-toggle.component.ts:31-126`),
    so it needs no `input()`/`output()`; if a parent ever passes data, it uses `input()`/`output()`,
    never decorators.
  - Data access through `ClaudeRpcService` only (`inject(ClaudeRpcService)`, as
    `decision-model-row.component.ts:440`):
    - Read, in parallel on init: `call('settings:get', { key: 'agentOrchestration.hostRouting' })`
      (`rpc.types.ts:1769-1772`) and `call('agent:getConfig', undefined, { timeout })` →
      `decisionModel.selection.kind` (`rpc-agents.types.ts:167-180,312`), parsed with the existing
      `parseDecisionModelStatus` (`decision-model-row.view.ts:348`).
    - Write: `call('settings:set', { key: 'agentOrchestration.hostRouting', value: next })`
      (`rpc.types.ts:1773-1776`) through `SettingsSaveFeedbackService.saveGeneric`
      (`settings-save-feedback.service.ts:44-51,157`) with an Undo that writes the previous value,
      then re-read `settings:get`.
  - Signals: `stored: boolean | null` (undefined reads as `true`, A6), `modelConfigured: boolean | null`,
    `load: 'loading' | 'ready' | 'error'`, `saving: boolean`;
    `effective = computed(() => modelConfigured() === true && stored() !== false)`.
  - Rendering (DaisyUI `toggle toggle-xs`, the copilot row's focus ring and spacing):
    - Label "Routing suggestions"; help "Before planning, Ptah checks whether the engineering task
      is agreed and suggests a task type, depth and available executors. Uses one decision-model
      call per message." (`data-testid="host-routing-setting"`).
    - Model configured: checkbox `[checked]="effective()"`, enabled.
    - No decision model: checkbox unchecked and disabled, note "Off: set a decision model in
      Providers to use this." (`data-testid="host-routing-needs-model"`). The stored value is not
      changed.
    - Read failed: no value shown, "The setting could not be read." and a "Retry" button
      (`data-testid="host-routing-retry"`); no write is taken until a read succeeds.
    - Busy while `saving()` or `feedback.saving()` (`SettingsBusyDisabledDirective`, as the copilot
      row).
  - Mounting: `orchestration-settings.component.ts` imports the component and renders
    `@if (isElectron) { <ptah-host-routing-setting /> }` directly after `<ptah-lane-guards-settings />`
    (`:60-61`), with `isElectron = inject(VSCodeService).isElectron === true` (precedent
    `main-agent-reassign-popover.component.ts:310`). VS Code gets no row because it has no
    coordinator.
- Verified contracts: as cited above; `orchestration-settings.component.ts:25-34,60-73`.
- Dependencies: `@ptah-extension/core` (`ClaudeRpcService`, `VSCodeService`), `@ptah-extension/shared`
  types; both existing imports of `libs/frontend/chat` (`scope:webview`).
- Failure behaviour: a failed or timed-out read shows the error row with Retry; a failed write is
  reported by the page toast and the re-read value is shown; the component never shows a value it
  did not read back.
- Quality (accessibility, measurable): the checkbox has an `aria-label` equal to the visible label;
  the disabled state is announced through the note text linked by `aria-describedby`; focus ring
  visible on keyboard focus; contrast of the help and note text meets WCAG AA in dark and light
  themes (visual-reviewer checks).
- Verification seam:
  - `host-routing-setting.component.spec.ts` (fake `ClaudeRpcService`): model set + stored true →
    checked, enabled; model set + stored false → unchecked; model unset → unchecked, disabled, note
    shown, no `settings:set` on click; toggling writes `settings:set` with the negated value and
    re-reads; a failed read shows Retry and Retry re-reads; a failed write keeps the previous value.
  - `orchestration-settings.component.spec.ts`: the row renders when `isElectron` is true and not
    when false.
  - Visual review (visual-reviewer, Electron only): before/after screenshots of the Context
    Management tab, dark and light themes, for model set and model unset.
- Files: CREATE `libs/frontend/chat/src/lib/settings/ptah-ai/host-routing-setting.component.ts`,
  `…/ptah-ai/host-routing-setting.component.spec.ts`; MODIFY `…/ptah-ai/orchestration-settings.component.ts`,
  `…/ptah-ai/orchestration-settings.component.spec.ts`.

## Integration architecture

- **Data flow, learning integrity:**
  1. Lane exit → (r3) `handleExit` sets `TrackedAgent.rateLimitMatched` from bounded current-turn
     error segments (exit 0) or `laneFailureTexts` (failed). The ptah-cli stream loop has already
     turned an `is_error` 429 result into the fixed marker segment. → `signalLaneCompletion` passes
     `rateLimited` → `LaneCompletionNotifier.signal` → `verdictOf` (freshness rule, rate-limit
     downgrade) → `enqueueLaneCompletionOutcome` (`failureClass` from `classifyLaneFailureClass`
     with `rateLimited`; kind and source resolved in the recorder; transient brief) → pipeline
     journal → `insertStopWithHeldReports` (joins any held review for that run) →
     `onRecordInserted` → task-kind classifier (async) → `setClassifiedTaskKind`.
  2. Review lane or review subagent → deliverable or last message → `captureReview` →
     `attachReview(deterministic reportId)` → pipeline `submit`: applied if the target row exists,
     else **held** (lane or subagent) → joined on the target's insert, or expired to the rejected
     ledger after 24 h.
  3. SubagentStop → (a) callback registry, now ungated, and (b) `subagentEnded` bus (Electron).
     Both reach the recorder → one row per `subagent:<agentId>`; the second producer enriches.
  4. External client report → `reportedSubagentStopRow` → row → report applied.
- **Data flow, routing:**
  1. `chat:start`/`chat:continue` → `ChatSessionService` dispatches the SDK turn → `admitUserTurn`
     (not awaited) → gate (`HostRoutingSetting`) → `cache.beginTurn` → scope check on the bounded
     conversation (≤ 3000 ms) → state machine → optional single pre-flight per revision
     (≤ `OVERALL_CALL_BUDGET_MS`) → `cache.confirmRevision`/`put` and `NextTurnReminderQueue.put`.
  2. The SDK Stop hook → `onTurnEnded` → coordinator stores the last assistant reply for the tab.
  3. The next SDK user message → `UserPromptSubmit` hook → `take` → `additionalContext`.
  4. The skill calls `ptah_route_decide` pre-flight → dispatcher session key → `cache.get`
     (enabled, continuity known, revision current, fingerprint equal) → hit, no request; else a
     normal pre-flight. gate-0.1 stays skill-driven.
  5. Settings tab toggle → `settings:set agentOrchestration.hostRouting` → read live by
     `HostRoutingSetting` on the next admission, on the next cache `get`, and (r3) when any
     in-flight scope answer or pre-flight settles. When the setting is off, the result is discarded
     and the tab is reset (Component 16 Disable reset).
- **Matrix:** outcome rows → reader → `deriveLocalMatrix` (blended) → user > local > seed layers.
- **State or persistence:**
  - Persistent: `task_kind_source` (SQLite) and KV JSON; held reviews in the existing
    `lane_outcome_held_reports` table / KV snapshot; the `agentOrchestration.hostRouting` file
    setting.
  - In memory, owned by singletons and bounded: classification briefs 200 (recorder); coordinator
    tab state 200 and session alias map 200; pre-flight cache 100; reminder queue and aliases 200.
    (r3) `TrackedAgent.rateLimitMatched` and `turnSegmentStart` are two scalars per tracked lane.
    They live as long as the existing `TrackedAgent` record and are never persisted.
- **External boundaries:**
  - Decision-model calls use the existing payload builder (64 KiB cap, request text ≤ 8000 chars)
    and timeouts; the scope conversation and pre-flight summary are capped before they reach it.
  - Deliverable reads are confined to the lane working directory, ≤ 64 KiB per file, ≤ 3 files.
  - The parser accepts only the strict line grammar.
  - Tool args are validated by the zod schema at the boundary (`outcome-report.tool.ts:94`).
  - `settings:set` validates the key through `isFileBasedSettingKey`; the toggle sends a boolean.
- **Failure and rollback:**
  - All new model calls fail open and leave no partial state. A failed pre-flight leaves its
    revision unrouted and is not retried for that revision; a new revision gets a fresh attempt.
  - Migration failure: the runner rolls back; rows written by the new code into an older DB fail
    the INSERT and follow the existing journal retry.
  - A held review whose target never arrives expires to the rejected ledger.
- **Observability:** warnings carry ids and codes only: `Outcome recorder unavailable`; `Review
capture refused` (with refusal); `Outcome classification failed`; `Host routing step failed`
  (stage); `Outcome hold expired` and the rejected ledger (`OUTCOME_REJECTED_KEY`) for reviews whose
  target never arrived. (r3) `Lane turn matched an API rate-limit wording` (debug, `{ agentId, cli,
exitCode }`), and the coordinator's `superseded` debug line (`{ tabId, stage }`). Neither carries
  text. The Req 3 live check: after B9, a Ptah-session subagent's deliverables
  report returns `applied`.

## Architecture-level quality requirements

- **Functional:** each Req 1-8 acceptance case maps to a named spec:
  - Req 1 → Component 10 integration, including the r3 stale-file, exit-0 429 and fresh-file
    cases (signal and row), plus the classifier, failure-class, process-manager and ptah-cli
    stream-loop specs.
  - Req 2 → Components 6, 8.
  - Req 3 → Components 5, 9, 11.
  - Req 4 → Components 13 (setting), 16 (gate), 19 (UI).
  - Req 5 → Component 16 (state machine, deferred pre-flight, multi-turn acceptance, r3
    reverse-order scope answers).
  - Req 4 disable transition → Component 16 (r3 toggle-off during an in-flight pre-flight or scope
    answer).
  - Req 6 → Components 13, 14 (revision-validated cache).
  - Req 7 → Components 6, 7 (early-review integration), 9, 10, 11.
  - Req 8 → Component 12 table.
- **Performance:** no await is added to `startSession`/`continueSession` reply dispatch; the hook
  drain is synchronous; the scope request ≤ 3000 ms; pre-flight bounded by `OVERALL_CALL_BUDGET_MS`;
  at most one scope request per admitted turn and one pre-flight attempt per revision.
- **Security/privacy:**
  - No request, prompt, brief, scope, assistant, deliverable or CLI output text in rows, journal,
    receipts or logs. The ptah-cli rate-limit marker is a fixed string, never provider text.
  - The model fingerprint carries no secret.
  - Deliverable paths are confined to the workspace.
- **Maintainability:**
  - Nx graph unchanged: no new lib-to-lib edges.
  - No `vscode-core` import is added to host-neutral libs.
  - Cross-lib calls go through barrels only (F7).
  - Deliberate swallows carry `degradation-audit: reported` markers; baselines unchanged.
  - Angular: standalone, OnPush, signals, `ClaudeRpcService` only; no new message listener.
- **Testability:** each component has a jest spec beside it. The integration specs for Req 1, 3 and
  7 use real recorder, pipeline and store objects with synthetic events. The coordinator specs drive
  the real state machine.

## Decisions

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Options                                                                                                                                                                                                                                                                                                                                                                                     | Evidence                                                                                                                                                                                                 | Reversible |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| D-1  | Reminder delivered as `UserPromptSubmit` `additionalContext` from an agent-sdk queue                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | prompt prefix in `continueSession`; `MainThreadNoticeQueue`; UserPromptSubmit                                                                                                                                                                                                                                                                                                               | `user-prompt-submit-hook-handler.ts:95-103`; the notice queue drains into tool results                                                                                                                   | yes        |
| D-2  | Admission in `ChatSessionService` after dispatch, not awaited; coordinator Electron-only by registration                                                                                                                                                                                                                                                                                                                                                                                                                                                 | UserPromptSubmit fan-out (cannot tell human turns from envelopes); chat service                                                                                                                                                                                                                                                                                                             | `chat-session.service.ts:697,1189`                                                                                                                                                                       | yes        |
| D-3  | (N1) Task-kind classification is independent of `agentOrchestration.hostRouting`; gated only by a configured decision model and the Electron-only classifier alias                                                                                                                                                                                                                                                                                                                                                                                       | tie to setting; independent                                                                                                                                                                                                                                                                                                                                                                 | Learning integrity, not routing; the Cost NFR names only the model as its gate (`task-description.md:125`)                                                                                               | yes        |
| D-4  | Close both causes of the live `held` result: ungate the in-host producers, and create the row from the report for external MCP callers                                                                                                                                                                                                                                                                                                                                                                                                                   | wait for a stop that never comes; ungate only; both                                                                                                                                                                                                                                                                                                                                         | `outcome-write-pipeline.ts:239-332`; `mcp-request-context.ts:21-40`                                                                                                                                      | yes        |
| D-5  | Review dedupe through deterministic `reportId = review:<reviewed>\|<reviewer>` on the existing receipts table                                                                                                                                                                                                                                                                                                                                                                                                                                            | new table; deterministic id                                                                                                                                                                                                                                                                                                                                                                 | `0054_lane_outcome_records.ts:11-14`                                                                                                                                                                     | yes        |
| D-6  | **Overturned in r2 (F5, `decisions.md` row 8).** The disable control is a visible Electron-only toggle (`HostRoutingSettingComponent`) in the existing Context Management tab, backed by file setting `agentOrchestration.hostRouting` (stored default `true`; effective only with a configured model). Dedicated component, not an `ADVANCED_SETTINGS` row. UI change, no new surface: visual-reviewer before/after, dark + light                                                                                                                       | file key only (r1); `ADVANCED_SETTINGS` boolean row; dedicated toggle                                                                                                                                                                                                                                                                                                                       | `task-description.md:81`; static default `advanced-settings.types.ts:65-68`; renderer `advanced-settings-group.component.ts:350-352`; toggle precedent `copilot-auto-approve-toggle.component.ts:31-126` | yes        |
| D-7  | Scope state, reuse cache and reminder state keyed by tab id (MCP caller key normalised with `getSessionTabId`); the queue rekeys to the SDK UUID                                                                                                                                                                                                                                                                                                                                                                                                         | real session id everywhere; tab id                                                                                                                                                                                                                                                                                                                                                          | `protocol-dispatcher.ts:2366-2377`; `session-id-resolved-callback-registry.ts:44-65`                                                                                                                     | yes        |
| D-8  | Available-candidate source is `buildRouteCandidateSource(ptah.agent)`, exported; subagent roles filtered by the exported `BUILTIN_SUBAGENT_ROLES`                                                                                                                                                                                                                                                                                                                                                                                                        | rebuild detection in rpc-handlers; reuse                                                                                                                                                                                                                                                                                                                                                    | `route-namespace.builder.ts:79-99`; `phase-plan.ts:50`                                                                                                                                                   | yes        |
| D-9  | (N2) Blend examples fixed as tests; prior = exact seed cell, else 50; `MINIMUM_SAMPLE_COUNT` deleted; schema and reasons minimum = 1                                                                                                                                                                                                                                                                                                                                                                                                                     | keep the constant at 1; delete it                                                                                                                                                                                                                                                                                                                                                           | `matrix.schema.ts:41`; `compile-reasons.ts:228-240`                                                                                                                                                      | yes        |
| D-10 | Review-deliverable contract = `Reviewed-Run: <runId>` plus `Verdict: APPROVED\|REVISE\|REJECTED` lines, published in `review-verdict.parser.ts`                                                                                                                                                                                                                                                                                                                                                                                                          | free-form inference; spawn arg; deliverable lines                                                                                                                                                                                                                                                                                                                                           | Req 7; out-of-scope prompt changes (`task-description.md:33`)                                                                                                                                            | yes        |
| D-11 | Subagent second producer subscribed only in Electron (`observeSubagentEnded`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | all hosts; Electron only                                                                                                                                                                                                                                                                                                                                                                    | Electron first (`task-description.md:28`)                                                                                                                                                                | yes        |
| D-12 | Migration number 0064 (latest 0063); re-check at implementation (A4)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | —                                                                                                                                                                                                                                                                                                                                                                                           | `migrations/index.ts:448-452`                                                                                                                                                                            | yes        |
| D-13 | (F1) Early reviews are held for missing lane and subagent targets; lane rows go through `insertStopWithHeldReports` so the hold joins on insert. The method name is kept (its body is already run-kind-agnostic; a rename touches seven specs for no behaviour). `insertIfAbsent` stays on the interface for the store specs that exercise it. Lane `deliverables` to a missing lane stays rejected                                                                                                                                                      | reject lane reviews (r1); hold reviews for both; rename method                                                                                                                                                                                                                                                                                                                              | `task-description.md:105-109`; `sqlite-lane-outcome.store.ts:178-230`; review Decisions row 1                                                                                                            | yes        |
| D-14 | (F2) First-scope initialisation (0 → 1) is not a revision change; a revision increments only on a confident `new-task` or material change; unknown continuity keeps the revision and marks the cache unknown; nudge at most once per revision                                                                                                                                                                                                                                                                                                            | increment on absent routed scope (r1); explicit state machine                                                                                                                                                                                                                                                                                                                               | `task-description.md:87-90`                                                                                                                                                                              | yes        |
| D-15 | (F3) One pre-flight attempt per revision, shared across unchanged turns while in flight; a failed attempt is not retried within the same revision                                                                                                                                                                                                                                                                                                                                                                                                        | retry every settled turn (r1); one attempt                                                                                                                                                                                                                                                                                                                                                  | Cost NFR "at most one new pre-flight per unchanged scope revision" (`task-description.md:124-125`)                                                                                                       | yes        |
| D-16 | (F4) The last assistant reply comes from `SdkAdapterEvents.onTurnEnded` (Stop hook `last_assistant_message`), not from transcript reads; the conversation window is one previous user turn plus that reply plus the pending and routed scope, each capped                                                                                                                                                                                                                                                                                                | transcript JSONL read per turn; event-fed window                                                                                                                                                                                                                                                                                                                                            | `sdk-adapter-events.service.ts:42-50,231-234`; `stop-hook-handler.ts:105-113`; limits `decision-payload.ts:5`, `routing-constants.ts:145`, `route-decide-args.schema.ts:41`                              | yes        |
| D-17 | (F6) Reuse validity lives in `PreflightReuseCache.get`: enabled setting, known continuity, current revision, fingerprint. `beginTurn` blocks hits while a scope answer is pending                                                                                                                                                                                                                                                                                                                                                                        | check only session and fingerprint (r1); revision-validated get                                                                                                                                                                                                                                                                                                                             | `task-description.md:98-99`; review Decisions                                                                                                                                                            | yes        |
| D-18 | (F8) `taskKindSource` is omitted from `LaneCompletionOutcomeInput` and set by the recorder; the shared field is introduced optional (B1) and made required (B11) once every literal carries it                                                                                                                                                                                                                                                                                                                                                           | required at once (breaks B1 checks); optional forever; staged                                                                                                                                                                                                                                                                                                                               | `lane-outcome-recorder.service.ts:24-29`; literal sites listed in Codebase evidence                                                                                                                      | yes        |
| D-19 | (F7) `taskKindForRole` stays owned by lane-outcomes and is exported from its barrel; `BUILTIN_SUBAGENT_ROLES` is exported from lane-routing                                                                                                                                                                                                                                                                                                                                                                                                              | move mapping into lane-routing (adds a lane-outcomes → lane-routing edge); barrel exports                                                                                                                                                                                                                                                                                                   | `lane-outcomes/src/index.ts:2-67`; `lane-routing/src/index.ts:10-71`; `phase-plan.ts:50`                                                                                                                 | yes        |
| D-20 | (r3, N1; `decisions.md` row 10) The lane verdict requires `writtenAfterSpawn !== false` (the child rule). A stale file reads as `no-deliverable`/`bad-output`. An absent flag keeps the existence rule                                                                                                                                                                                                                                                                                                                                                   | keep the existence-only lane rule; a separate lane-only freshness rule; adopt the child rule                                                                                                                                                                                                                                                                                                | `lane-completion-notifier.service.ts:174-187` vs `:667-679`; row 10 live run 80ddc78e                                                                                                                    | yes        |
| D-21 | (r3, N1) An API 429 is detected by a pure, conservative matcher (429 plus an API or rate wording on one line), sibling of `matchesAuthFailure`. On exit 0 it reads only the current turn's `error` segments, never stdout. The ptah-cli loop maps `is_error` + `api_error_status === 429` (or a 429 wording in `result`) to a fixed marker segment. The match sets verdict `failed` (unless every deliverable is fresh) and `failureClass` `usage-limit`. It never sets `failureKind 'quota'` or writes the limit ledger. In-memory only, reset per turn | extend `classifyLaneLimit` to rate limits (it deliberately refuses plain 429s, `lane-limit-classifier.ts:141-156`, and would write quota ledger evidence); exit code 1 on `is_error` in the stream loop (would flip status and give `crash` without the class); read the stdout tail on exit 0 (false positives from summaries that discuss 429s); separate matcher + structured SDK status | `lane-auth-classifier.ts:1-16`; `lane-failure-class.ts:14-27`; `agent-process-manager.service.ts:2741-2769`; `ptah-cli-stream-loop.service.ts:599-641`; `sdk.d.ts:5445-5449`                             | yes        |
| D-22 | (r3, N2) Each scope assessment carries its admission generation. Only the newest admission's answer is applied; an older one is discarded before any state change. The window is written only at admission and by `onTurnEnded`                                                                                                                                                                                                                                                                                                                          | apply in arrival order (r2); apply if newer than the last applied (still lets a stale answer start pre-flight while the newest is pending); newest-only                                                                                                                                                                                                                                     | Re-review N2; the newest snapshot already contains the older turn as `previousUserTurn`                                                                                                                  | yes        |
| D-23 | (r3, N3) Effective enablement is re-checked when a scope answer or a pre-flight settles. Off → discard the result and apply Disable reset (`markUnknown`, `queue.discard`, clear routed/attempted/nudged/inFlight). Reuse after re-enable needs a fresh `confirmRevision`. `NextTurnReminderQueue.discard` is added, alias-aware                                                                                                                                                                                                                         | check only at admission and `get` (r2); abort the in-flight request (adds a cancellation contract to `RouteDecideService.decide` for one caller, and a late result must still be discarded); settle-time check + reset                                                                                                                                                                      | Re-review N3; `HostRoutingSetting` is the single rule (Component 13)                                                                                                                                     | yes        |

## Clarifications Needed

None. No user-reserved decision is open. The per-turn model call default (ON with a configured model)
was settled at Gate 1 (`decisions.md` row 7); the visible setting was settled at Gate 2 (row 8).

## Team-leader handoff

- **Recommended executors.** CLI lanes take bounded batches with a known file list. A
  backend-developer subagent takes B7, B8, B10c, B18 and B19 (cross-component state, durability,
  exit-path ordering and concurrency rules). A frontend-developer subagent takes B20 (Angular rules and the save/read-back
  pattern); a visual-reviewer then captures Electron before/after screenshots, dark and light,
  model set and unset. Every lane prompt must repeat the `CLAUDE.md` rules: scoped
  `npm run verify -- -p <project>` only, no build/serve/e2e, Electron first, keep every host
  compiling, no git.
- **Complexity:** HIGH. 19 components across 10 projects, two staged shared contracts that every
  host compiles, and a concurrent state machine.
- **Dependencies and ordering** (component level; learning integrity first). The table is a
  proposal the team-leader may re-derive. Each batch has at most 6 files and at most 2 libs, and
  compiles on its own. Batches that share a file are sequenced (column "Depends on").

| Batch | Components                                            | Libs                                    | Files                                                                                                                                                                                                                                         | Depends on          | Executor                      | Why                                                                                                                                                                                                                                        |
| ----- | ----------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1    | 1 (optional field, port), 2                           | shared, persistence-sqlite              | `shared/.../lane-outcome.types.ts`; `0064_…ts`; `0064_…spec.ts`; `migrations/index.ts`                                                                                                                                                        | —                   | CLI lane                      | exact contracts; optional field keeps every host compiling                                                                                                                                                                                 |
| B2    | 3 (schema), 6 (input Omit, interim source) + fixtures | lane-outcomes                           | `lane-outcome.schema.ts`; `lane-outcome-recorder.service.ts`; `store/store.test-support.ts`; `agent-signals.spec.ts`; `lane-outcome-reader.service.spec.ts`; `subagent-join.spec.ts`                                                          | B1                  | CLI lane                      | mechanical: one field on every literal, named in full                                                                                                                                                                                      |
| B3    | 3 (effect, report id), 4 (stores)                     | lane-outcomes                           | `store/lane-outcome.store.ts`; `store/sqlite-lane-outcome.store.ts`; `store/in-memory-lane-outcome.store.ts`; `store/key-value-lane-outcome.store.ts`; `write/pipeline.test-support.ts`; `write/report-effect.ts`                             | B2                  | CLI lane                      | SQL given; interface and every implementer in one batch                                                                                                                                                                                    |
| B4    | 3, 4 (specs)                                          | lane-outcomes                           | `lane-outcome.schema.spec.ts`; `write/report-effect.spec.ts`; `store/sqlite-lane-outcome.store.spec.ts`; `store/in-memory-lane-outcome.store.spec.ts`; `store/key-value-lane-outcome.store.spec.ts`                                           | B3                  | CLI lane                      | bounded test cases listed                                                                                                                                                                                                                  |
| B5    | 5                                                     | agent-sdk, skill-synthesis              | `subagent-stop-callback-registry.ts`; `subagent-hook-handler.ts`; `subagent-hook-handler.spec.ts`; `skill-trigger.service.ts`; `skill-trigger.service.spec.ts`                                                                                | —                   | CLI lane                      | bounded                                                                                                                                                                                                                                    |
| B6    | 8                                                     | lane-routing                            | `decision-model/decision-caller.ts`; `route-decide.service.ts`; `task-kind/decision-model-task-kind-classifier.ts`; its spec; `di/tokens.ts`; `di/register.ts`                                                                                | B1                  | CLI lane                      | refactor with an existing spec net                                                                                                                                                                                                         |
| B7    | 6 (full)                                              | lane-outcomes                           | `lane-outcome-recorder.service.ts`; `task-kind-mapping.ts`; `review-verdict.parser.ts`; `review-verdict.parser.spec.ts`; `lane-outcome-recorder.service.spec.ts`                                                                              | B4, B5              | subagent (backend-developer)  | cross-lib payloads, privacy rules                                                                                                                                                                                                          |
| B8    | 7                                                     | lane-outcomes                           | `write/outcome-write-pipeline.ts`; `write/outcome-write-pipeline.spec.ts`; `write/outcome-early-review.integration.spec.ts`                                                                                                                   | B7                  | subagent (backend-developer)  | durability and admission semantics (F1)                                                                                                                                                                                                    |
| B9    | 9 (incl. barrel)                                      | lane-outcomes                           | `di/tokens.ts`; `di/register.ts`; `di/start.ts`; `lane-outcomes/src/index.ts`; `subagent-stop.integration.spec.ts`; `di/start.spec.ts`                                                                                                        | B8                  | CLI lane                      | bounded wiring; owns the lane-outcomes barrel (F7)                                                                                                                                                                                         |
| B10a  | 10 (r3 matcher, failure class)                        | cli-agent-runtime                       | `cli-agents/limits/lane-rate-limit-classifier.ts` (CREATE); `cli-agents/limits/lane-rate-limit-classifier.spec.ts` (CREATE); `cli-agents/limits/lane-failure-class.ts`; `cli-agents/limits/lane-failure-class.spec.ts`                        | —                   | CLI lane                      | pure, patterns and precedence given; optional field keeps the barrel export compatible                                                                                                                                                     |
| B10b  | 10 (verdict, outcome, review capture, integration)    | cli-agent-runtime                       | `cli-agents/lane-completion-outcome.ts`; `cli-agents/lane-completion-notifier.service.ts`; `cli-agents/lane-completion-notifier.service.spec.ts`; `cli-agents/lane-terminal-outcomes.integration.spec.ts` (CREATE)                            | B9, B10a            | CLI lane                      | uses `taskKindForRole` through the B9 barrel; adds the optional `LaneCompletionContext.rateLimited` (default `false`), so it compiles before any producer sets it; integration cases drive it through a synthetic context                  |
| B10c  | 10 (r3 capture)                                       | cli-agent-runtime                       | `cli-agents/tracked-agent.ts`; `cli-agents/agent-process-manager.service.ts`; `cli-agents/agent-process-manager.service.spec.ts`; `ptah-cli/helpers/ptah-cli-stream-loop.service.ts`; `ptah-cli/helpers/ptah-cli-stream-loop.service.spec.ts` | B10a, B10b          | subagent (backend-developer)  | exit-path ordering before `outputBuffer.discard`, per-turn index, hot stream loop; passes the context field B10b added (an object literal with an undeclared field would not compile, hence the order)                                     |
| B11   | 11 (+ required flip of 1)                             | vscode-lm-tools, shared                 | `tools/outcome-report.tool.ts`; `tools/outcome-report.tool.spec.ts`; `shared/.../lane-outcome.types.ts`                                                                                                                                       | B9, B10b            | CLI lane                      | last literal fixed in the same batch as the flip (F8); B10c is not a prerequisite (no shared file)                                                                                                                                         |
| B12   | 12                                                    | lane-routing                            | `routing-constants.ts`; `matrix/local-derivation.ts`; `matrix/local-derivation.spec.ts`; `matrix/matrix.schema.ts`; `reasons/compile-reasons.ts`; `reasons/compile-reasons.spec.ts`                                                           | B6 (same lib)       | CLI lane                      | pure, test table given                                                                                                                                                                                                                     |
| B13   | 13 (classes)                                          | lane-routing                            | `scope/scope-check.service.ts`; its spec; `scope/preflight-reuse-cache.ts`; its spec; `scope/host-routing-setting.ts`; its spec                                                                                                               | B12                 | CLI lane                      | bounded; caps and cache rules given                                                                                                                                                                                                        |
| B14   | 13 (DI, barrel, roles), 14 (lane-routing)             | lane-routing                            | `di/tokens.ts`; `di/register.ts`; `lane-routing/src/index.ts`; `pipeline/phase-plan.ts`; `route-decide.service.ts`; `route-decide.preflight.spec.ts`                                                                                          | B13                 | CLI lane                      | owns the lane-routing barrel (F7)                                                                                                                                                                                                          |
| B15   | 14 (lm-tools)                                         | vscode-lm-tools                         | `route-namespace.builder.ts`; `route-tool-handlers.ts`; `route-tool-handlers.spec.ts`; `protocol-dispatcher.ts`; `vscode-lm-tools/src/index.ts`                                                                                               | B14, B11 (same lib) | CLI lane                      | bounded                                                                                                                                                                                                                                    |
| B16   | 15                                                    | agent-sdk                               | `next-turn-reminder.queue.ts`; its spec; `user-prompt-submit-hook-handler.ts`; its spec; `di/tokens.ts`; `di/register.ts`                                                                                                                     | B5 (same lib)       | CLI lane                      | bounded; (r3) includes the alias-aware `discard` used by B18                                                                                                                                                                               |
| B17   | 17 (+ queue export)                                   | platform-core, agent-sdk                | `file-settings-keys.ts`; `file-settings-keys.spec.ts`; `settings-export.types.ts`; `agent-sdk/src/index.ts`                                                                                                                                   | B16                 | CLI lane                      | small; owns the agent-sdk barrel                                                                                                                                                                                                           |
| B18   | 16 (core)                                             | rpc-handlers                            | `host-routing.coordinator.ts`; `host-routing.coordinator.spec.ts`; `host-routing.multi-turn.spec.ts`; `routing-reminder.format.ts`; `routing-reminder.format.spec.ts`; `chat/tokens.ts`                                                       | B14, B15, B17       | subagent (backend-developer)  | state machine and concurrency (F2-F4); (r3) generation-guarded `applyAssessment`, settle-time enablement check and Disable reset, with the reverse-order and toggle-off deferred specs in `host-routing.coordinator.spec.ts` (no new file) |
| B19   | 16 (wiring)                                           | rpc-handlers                            | `register-host-routing.ts`; `chat-session.service.ts`; its spec; `rpc-handlers/src/index.ts`                                                                                                                                                  | B18                 | subagent (backend-developer)  | sensitive hot path                                                                                                                                                                                                                         |
| B20   | 19                                                    | chat (frontend)                         | `host-routing-setting.component.ts`; its spec; `orchestration-settings.component.ts`; `orchestration-settings.component.spec.ts`                                                                                                              | B17                 | subagent (frontend-developer) | Angular rules, save/read-back pattern; then visual-reviewer screenshots                                                                                                                                                                    |
| B21   | 18                                                    | ptah-electron (+ host guards if needed) | `phase-2-libraries.ts`; `phase-4-handlers.ts`; `expected-resolvable.ts` (+ VS Code/CLI `expected-resolvable.ts` only if required)                                                                                                             | all backend batches | CLI lane                      | bounded                                                                                                                                                                                                                                    |

- **Parallel-safe work** (file-disjoint): B1, B5 and B10a start together (B10a touches only
  `cli-agents/limits/`). B10b waits for B9 and B10a; B10c waits for B10b. After B1: B2→B3→B4 (lane-outcomes
  chain) beside B6→B12→B13→B14 (lane-routing chain) and B16→B17 (agent-sdk/platform-core). B20 can
  run as soon as B17 lands, beside B18/B19. Batches that share a lib are sequenced because they share
  `di/tokens.ts`, `di/register.ts`, barrels or `lane-outcome.types.ts`.
- **Files affected:**
  - CREATE:
    - `persistence-sqlite/.../0064_lane_outcome_task_kind_source{,.spec}.ts`
    - `lane-outcomes/.../{task-kind-mapping,review-verdict.parser,review-verdict.parser.spec,subagent-stop.integration.spec,write/outcome-early-review.integration.spec}.ts`
    - `lane-routing/.../{decision-model/decision-caller,task-kind/decision-model-task-kind-classifier{,.spec},scope/scope-check.service{,.spec},scope/preflight-reuse-cache{,.spec},scope/host-routing-setting{,.spec}}.ts`
    - `agent-sdk/.../helpers/next-turn-reminder.queue{,.spec}.ts`
    - `cli-agent-runtime/.../{lane-terminal-outcomes.integration.spec,limits/lane-rate-limit-classifier{,.spec}}.ts`
    - `rpc-handlers/.../chat/host-routing/{host-routing.coordinator{,.spec},host-routing.multi-turn.spec,routing-reminder.format{,.spec},register-host-routing}.ts`
    - `frontend/chat/.../settings/ptah-ai/host-routing-setting.component{,.spec}.ts`
  - MODIFY: every other file named in the batch table.
  - REWRITE: none.
- **Verification points** (each batch must pass on its own):
  - Per batch: `npm run verify -- -p <projects touched>`.
  - After B1 and after B11 (the two shared-contract steps), also
    `npm run verify -- -t typecheck -p ptah-electron,ptah-extension-vscode,ptah-cli`. B1 compiles
    because the field is optional; B11 compiles because B2, B7 and B11 put the field on every
    literal listed in Codebase evidence. Before B11, re-grep for `LaneOutcomeRecord = {`,
    `: LaneOutcomeRecord`, `LaneOutcomeRow = {` and `telemetryJoin:` to confirm no new literal
    appeared.
  - After B2: `npm run verify -- -p lane-outcomes,cli-agent-runtime,vscode-lm-tools` (the Omit
    keeps `lane-completion-outcome.ts` compiling with no edit).
  - After B5 and B17: typecheck the three hosts (agent-sdk and platform-core are shared).
  - After B10a, B10b and B10c: `npm run verify -- -p cli-agent-runtime`. After B10a, also
    `npm run verify -- -t typecheck -p vscode-lm-tools,ptah-electron`, because
    `classifyLaneFailureClass` is a barrel export and its new field must stay optional. Before
    B10b, grep `lane-completion-notifier.service.spec.ts` for deliverable fixtures whose mtime
    precedes `startedAt`. Before B10c, confirm that `continueConversation` is the only turn-restart
    path that must reset `turnSegmentStart`: grep `hasExited = false`, verified single site
    `agent-process-manager.service.ts:2206`.
  - After B20: `npm run verify -- -p chat`, then the visual review.
  - After B21: `npm run verify -- -p ptah-electron`.
  - `tools/degradation-audit` passes with an unchanged baseline (its project target, scoped).
  - Re-check A2-A7 and the migration number before their batches.
  - Live check in Electron after B21 (r3 additions): a lane that hits an API 429, exits 0 and leaves
    a pre-existing deliverable is signalled `failed` and its row reads `usage-limit`. A lane whose
    deliverable predates its spawn reads `no-deliverable`. Toggling host routing off mid-turn
    leaves no reminder in the next turn.
  - Live check in Electron after B21: a Ptah-session subagent stop writes a row and a later
    deliverables report returns `applied`; a review lane finishing before its implementer lane
    still lands its verdict; the routing reminder appears in the next turn's context after a
    settled engineering request; a vague request gets one nudge and no repeat; turning the toggle
    off gives zero decision-model requests (decision usage logs).

## Gate 2 carry-forward (user-approved 2026-10-30)

Gate 2 was approved by the user on r3 with one binding addition to **Component 16 / B18**
(source: `implementation-plan-rereview.md` § Re-review r3, Moderate finding):

- Increment a per-tab cancellation epoch on Disable reset. Capture it when each assessment and
  pre-flight starts, and discard a result whose epoch changed before any state, cache or queue
  mutation.
- Guard `inFlight` cleanup by promise identity.
- Deferred tests: off → on before an old assessment settles, and off → on before an old pre-flight
  settles (including a new same-revision pre-flight). Assert there is no old reminder or cache
  entry and that only the new request stays active.
