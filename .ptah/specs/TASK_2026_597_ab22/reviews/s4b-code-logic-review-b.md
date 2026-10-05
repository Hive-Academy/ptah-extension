# Code Logic Review — `TASK_2026_597_ab22` (S4-b part B, base `ccd8a8a9c`)

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 6              |
| Minor issues        | 7              |
| Failure modes found | 9              |

Score rationale: the settings write path, the guard release paths, the blocked-model refusal, the rotation advisor state machine and the subagent figure plumbing all hold up. What keeps this at 5 rather than 7 are two lane-guard defects on likely paths. First, the guard's "gentle" steer goes through the general message router. On most CLIs the router either queues it as a turn that starts after the lane has finished, or interrupts the turn and throws away its partial work. Second, the stop reason the guard stamps on the record is read by nothing that reports to the orchestrator. Neither is a data-corruption issue, which keeps the score above 3-4.

Diagnostics: `ptah_get_diagnostics` on `agent-process-manager.service.ts` and `session-budget-banner.component.ts` reports no errors in those files. The 241 sibling errors are in pre-existing frontend specs that are outside this scope.

## Five logic questions

### 1. How does this fail silently?

- When the guard stops a lane, the orchestrator is told the lane was "stopped on request". `stopLaneForBudget` sets `stopReason` (`agent-process-manager.service.ts:939`). `agent-wait.tool.ts:230-244` (`stopReasonOf`) only switches on `status`, so `'stopped'` comes out as "stopped on request". The JSDoc at `agent-process.types.ts:165-172` says "Status, the agent card and the completion signal read it". A repo-wide search finds no reader of `AgentProcessInfo.stopReason` outside the manager.
- If the stored steer/stop pair is invalid (hand-edited `stop <= steer`), the runtime quietly uses 40/60 (`agent-spawn-environment.service.ts:200-220`, no log line). `agent:getConfig` reads each field on its own (`agent-rpc.handlers.ts:1209`), so the settings UI keeps showing the invalid pair as if it were in force.
- On a Codex, Copilot or Antigravity lane the guard steer is queued, not delivered. `steerLane` logs "Lane budget steer sent" with `mode: 'queue-next-turn'` (`agent-process-manager.service.ts:889-905`). The log reads as success, but the lane never sees the steer during the turn that is running away.

### 2. What user action produces unexpected behaviour?

- The orchestrator or user sends a follow-up task to a lane that can continue. The guard is kept across turns (`handleExit`, `:2113-2118`) and is never reset in `continueConversation` (`:1641-1657`). The second task starts with the first task's tool-call and repeat counts already used up. The steer is one-shot (`lane-budget-guard.ts:79`), so it never fires again. The second task can be stopped after a handful of calls with no warning.
- "Keep this session" on the rotation banner, then a switch to a tab with no budget state (for example the new tab "Rotate" creates), then a switch back: the rotation banner is back. `keptKeys` lives in the banner component (`session-budget-banner.component.ts:196`), and the banner sits inside `@if (resolvedSessionBudget(); as budget)` (`chat-view.component.html:136`), so it is destroyed and rebuilt. A webview reload also loses it. batch-31-report says "switching tabs does not lose another session's dismissal". That is only true while every visited tab has budget state.

### 3. What input data produces a wrong answer?

- Codex `file_change` tool calls have the key `toolName + {file_path}` and nothing else (`codex-cli.adapter.ts:1044-1046`). Twenty separate edits to one file, counted across turns because of item 2 above, trip `repeat-call` and stop a lane that is working normally.
- OpenCode reports shell calls as `type: 'command'` segments, not `tool-call` (`opencode-cli.adapter.ts:833-848`). The guard only counts `tool-call` (`lane-budget-guard.ts:66`), so an OpenCode lane looping on bash is never limited by either threshold.
- `rotation` may reuse an old handoff. `previewHandoff` returns `entry.handoffCopy` when one exists (`session-budget.service.ts:700-703`). That copy can come from an earlier handoff stage, written before the user extended the session. The rotation seed placed in the new tab then leaves out everything since.

### 4. What happens when a dependency fails?

- The steer cannot be delivered (`unsupported`, or `sendToAgent` throws). This is logged and the stop threshold still applies (`:906-915`). That is correct.
- `interrupt()` succeeds but the re-submit fails (Cursor). The router itself reports that the interrupted turn's partial work is gone (`agent-message-router.service.ts:190-200`). Because the guard triggered the interrupt, a runaway Cursor lane at 40 calls loses its turn and does not get the steer.
- The context-usage port is not registered. The advisor turns itself off and logs one line (`session-rotation-advisor.ts:52-58`). That is correct.
- The budget monitor or compaction config is missing in the injector. The advice is `undefined` and the prompt is unchanged (`chat-subagent-context-injector.service.ts:267-275`). That is correct.

### 5. What is missing that the requirements never mentioned?

- The guard counts per lane lifetime, not per task. Nothing defines a "task boundary" for a lane that can continue.
- Nothing reports `stopReason` to the orchestrator (`ptah_agent_wait`) or to the agent card.
- There is no way to turn off the rotation advisory: `readBudget` refuses 0 (`compaction-config-provider.ts`, `raw > 0`).
- The blocked-model check does not cover `spawnFromSdkHandle` (Ptah CLI agents, `agent-process-manager.service.ts:624-704`) or a lane that runs on the CLI's own default model (`resolvedModel` undefined).

## Failure modes

### Guard steer becomes a post-completion turn or a destructive interrupt

- Trigger: a lane reaches `steerAt` on a CLI without `handle.steer`. Only Pi has one (`pi-cli.adapter.ts:514`).
- Symptom: Codex, Copilot and Antigravity: the steer is queued (`agent-message-router.service.ts:212-236`). It is delivered as a new turn after the lane finishes its deliverable (`flushPending`, `:271-316`), so the lane runs an extra turn told to "Stop exploring, finish the deliverable now". That produces a second completion signal and last-output text that replaces the real report. Cursor: `supportsInterrupt` is true (`cursor-cli.adapter.ts:510`), so the router aborts the turn and discards its partial work (`:170-208`). The aborted turn's `handleExit` also sends a lane-completion signal for a lane that is in fact being resumed.
- Evidence: `agent-process-manager.service.ts:889-905` calls the general `sendToAgent`; router `select` `:132-160`.
- Current handling: every mode except `unsupported` is logged as "steer sent".
- Recommendation: deliver the guard steer only through `handle.steer` while the turn is running. If the handle has no `steer`, log "not delivered" and rely on `stopAt`. Never park the steer, and never use interrupt-resume for it.

### Budget stop reported as a user stop

- Trigger: the guard stops a lane.
- Symptom: `ptah_agent_wait` says "stopped on request" (`agent-wait.tool.ts:242-243`). The orchestrator cannot tell a runaway lane from one it cancelled itself, so it may accept partial output as the result.
- Evidence: `agent-process-manager.service.ts:939`, `agent-process.types.ts:165-172`. No other reader exists.
- Current handling: the field is stamped and logged only.
- Recommendation: add a `stopReason` branch to `stopReasonOf`, and to the completion-signal text if that formats status, or correct the JSDoc and record the reader as deferred work.

### Cumulative guard across caller-initiated turns

- Trigger: `ptah_agent_message` sends a follow-up task to a lane that has completed and can continue.
- Symptom: the lane is stopped early in the follow-up task, without a steer.
- Evidence: `handleExit` `:2113-2118` keeps the guard; `continueConversation` `:1641-1657` does not reset it; `steered` is one-shot (`lane-budget-guard.ts:79-82`).
- Current handling: by design (35c), so that a steered lane's queued or resumed turn is still counted.
- Recommendation: reset the guard when a turn starts from a caller message. Keep the counts only when the guard's own steer started the turn, which becomes moot once the fix for the first failure mode stops parking steers.

### Coarse repeat key on Codex file changes

- Trigger: 20 Edit/Write calls on one path during the lane's lifetime.
- Symptom: `repeat-call` stops a lane that is working normally.
- Evidence: `codex-cli.adapter.ts:1044-1046`, `lane-budget-guard.ts:96-104`.
- Recommendation: leave patch/file-change tool calls out of the repeat map, or add the change content or diff hash to the key.

### OpenCode shell loops are not counted

- Trigger: an OpenCode lane loops on `bash`.
- Symptom: neither steer nor stop ever fires.
- Evidence: `opencode-cli.adapter.ts:833-848` emits `command` only. The guard only counts `tool-call` (`lane-budget-guard.ts:66`).
- Recommendation: also count `command` segments that carry a `toolCallId` in the adapter's set, while still counting each call once on CLIs that emit both (Codex emits `tool-call` on start and `command` on completion).

### Silent pair fallback that differs from the displayed config

- Trigger: hand-edited `laneToolCallStopAt <= laneToolCallSteerAt` (for example steer 70, stop at the default 60).
- Symptom: the UI shows 70/60, the runtime uses 40/60, and nothing is logged.
- Evidence: `agent-spawn-environment.service.ts:214-220`; `agent-rpc.handlers.ts:1209-1213`.
- Recommendation: log one warning at resolve time, and make `getLaneGuard` apply the same pair rule so the read path matches the runtime.

### Rotation "Keep" lost when the banner unmounts

- Evidence: `session-budget-banner.component.ts:196,201-212,275-284`; `chat-view.component.html:136`.
- Recommendation: hold the kept keys in a service-level store keyed by session (or persist them through the existing `dismiss` action) rather than in the component.

### Rotation seed from an old handoff copy

- Evidence: `session-budget.service.ts:700-703`; `chat-view.component.ts:1180-1201` calls `preview-handoff`.
- Recommendation: build a fresh handoff for rotation, or rebuild when `handoffCopy` is older than the latest snapshot.

### Steer and stop writes are not atomic

- Evidence: `agent-rpc.handlers.ts:519-524` writes steer, then stop, as separate `setAgentCfg` calls. A spawn between the two writes can read a mixed pair, which then falls back to 40/60 for that one lane. Low probability.

## Blocking issues

None.

## Serious issues

### S1 — Guard steer routed through the general message router

- File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:889-905` (with `agent-message-router.service.ts:132-236`)
- Scenario: any lane on Codex, Copilot, Antigravity or Cursor that reaches 40 tool calls.
- Impact: Codex, Copilot and Antigravity run an extra post-completion turn that can overwrite the lane's final report and sends two completion signals. Cursor aborts the running turn, discards its partial work and sends a false completion signal. Only Pi gets a real mid-turn steer.
- Fix: call `tracked.sdkHandle.steer` directly when `status === 'running'`. Otherwise log "steer not delivered" and leave it to `stopAt`. Do not use `sendToAgent` for the guard.

### S2 — `stopReason` is stamped but never reported

- File: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/agent-wait.tool.ts:230-244`; `libs/shared/src/lib/types/agent-process.types.ts:165-172`
- Scenario: the guard stops a lane.
- Impact: the orchestrator is told "stopped on request" and cannot tell a budget stop from its own cancel, which is the R9.4 visibility requirement. The JSDoc claims readers that do not exist.
- Fix: read `info.stopReason` in `stopReasonOf` (for example "stopped by the host: tool-call budget reached" or "...: identical call repeated N times"). Do the same in the completion-signal formatter if it renders status, or explicitly defer the readers and correct the JSDoc.

## Moderate and minor issues

Moderate (each can break a lane config or drop handoff content):

- M1 — Guard counts accumulate across caller turns; no steer in later tasks. `agent-process-manager.service.ts:2113-2118`, `:1641-1657`; `lane-budget-guard.ts:79-82` (known item 1: 35c's reasoning holds only for guard-originated turns).
- M2 — Codex file-change repeat key uses only the path. `codex-cli.adapter.ts:1044-1046`.
- M3 — OpenCode `bash` is not counted. `opencode-cli.adapter.ts:833-848`.
- M4 — Silent pair fallback; `agent:getConfig` shows values the runtime does not use. `agent-spawn-environment.service.ts:214-220`, `agent-rpc.handlers.ts:1209` (known item 2: resetting both values is acceptable, but it must be visible).
- M5 — "Keep this session" is lost on remount or reload. `session-budget-banner.component.ts:196`, `chat-view.component.html:136`.
- M6 — Rotation can reuse an old `handoffCopy`. `session-budget.service.ts:700-703`.

Minor (recorded):

- m1 — Known item 4: `LaneModelBlockedError` is not exported (`cli-agents/index.ts`). Both callers (`agent-namespace.builder.ts:375`, `agent-rpc.handlers.ts:1033`) pass the error message through, and `name` is set (`agent-process-manager.service.ts:205-212`), so a caller can recognise it by `name`. None branches on it today. Export it when a caller needs `instanceof`.
- m2 — The blocked-model check does not cover `spawnFromSdkHandle` (`:624-704`) or a model left undefined to the CLI's own default (`findBlockedLaneModel(undefined)` returns undefined).
- m3 — `hasAdvice` is true whenever the monitor is registered (`chat-subagent-context-injector.service.ts:191,219`), so the "advice: fresh" instruction is added even when no agent is marked fresh. This is prompt noise only.
- m4 — Known item 5: rotation takes priority over `tighten` and hides OK/Restore (`session-budget-banner.component.ts:219-228`). Acceptable, because Keep brings them back. M5 makes that less reliable.
- m5 — Known item 6 (visual S1 focus ring on `btn-primary` in the light theme) is a shared DaisyUI token issue. It is not a logic defect from this batch; route it to visual/theme follow-up.
- m6 — Steer and stop writes are not atomic (`agent-rpc.handlers.ts:519-524`).
- m7 — The backend `contextTokens` uses `?? 0` for missing cache fields (`assistant-message.transformer.ts:376-385`) and now wins over the frontend fallback (`agent-monitor.store.ts:212-216`). Where a provider reports no cache figures, the monitor shows `input` instead of "unknown". The figure is correctly limited to messages with a `parent_tool_use_id`.

Known item 3 (`-0` rejected for lane-guard keys) is correct: `-0` is below every lane-guard minimum (`agent-rpc.handlers.ts` `isLaneGuardValue`, min 1/2/2), so rejecting it with the field name is the only consistent outcome. Codex keys normalise `-0` to `0` (`withoutNegativeZero`). No finding.

## Data flow

Lane guard:

1. `doSpawnSdk` resolves the model, then the blocked check (`:492-502`). OK: it throws before `runSdk`, and the spawn slot is released by `finally` (`:280-283`).
2. `trackSdkHandle` creates one guard per segment-streaming handle (`:781`). OK.
3. `onSegment`, then `applyLaneGuard` (`:793`). The guard only observes when `status === 'running'`. OK.
4. `steer`, then `sendToAgent`. Gap S1.
5. `stop`: stamp `stopReason`, discard pending, then `stop()`. OK, it is synchronous up to the kill. Gap S2 downstream.
6. Release: `stop` (`:1736`), `handleTimeout` (`:1976`, PR #642), `releaseSubprocess` (`:2068`), `handleExit` for lanes that cannot continue (`:2116`), `dispose` (`clear`). OK: idempotent, and no leak path found (lanes that can continue always get an idle release).

Settings write:

1. `agent:setConfig`: per-field type and minimum check, then pair check against the stored sibling (`invalidLaneGuard`, `:437`).
2. All validators run before any write. OK.
3. Sequential writes (`:519-524`). m6.

Rotation:

1. Stats snapshot, then `SessionBudgetService.observe`, then `evaluateRotation` on both the enabled and disabled paths. OK.
2. Advisor: port `getLast`, else the snapshot context; raise once per crossing; clear and re-arm below the threshold. OK.
3. `composeState`/`disabledState`, then `rotation` field. OK.
4. Banner: rotation unless handoff/limit or kept. M5.
5. Rotate: `preview-handoff`, new tab, `requestComposerPrefill`. OK: the seed is prefilled, not sent. M6 on the content.
6. Session end: `release` also releases the advisor. OK.

Subagent figure:

1. Transformer adds `contextTokens` only when `parent_tool_use_id` is set. OK.
2. Store reads it with `isTokenCount`, and the backend value wins. OK (m7).
3. Injector advice from the monitor snapshot. The reason precedence matches `adviseSubagentResume`. OK.

## Requirements fulfilment

| Requirement                                           | Status   | Gap                                       |
| ----------------------------------------------------- | -------- | ----------------------------------------- |
| Lane-guard keys and compaction keys, file-based       | COMPLETE | —                                         |
| Validate before write; partial steer/stop vs stored   | COMPLETE | m6 (non-atomic)                           |
| Hand-edited invalid values fall back                  | PARTIAL  | M4: silent, and the read path differs     |
| Guard per lane; released on every end path            | COMPLETE | —                                         |
| One steer at `steerAt`                                | PARTIAL  | S1: queued or interrupt on most CLIs      |
| Stop at `stopAt` / `repeatAt` with visible reason     | PARTIAL  | S2, M2, M3                                |
| Blocked model refused before `runSdk`                 | PARTIAL  | m2: Ptah CLI path and CLI default         |
| Rotation advisory: once per crossing, re-arms         | COMPLETE | —                                         |
| Rotation published with the budget disabled           | COMPLETE | —                                         |
| Seed prefilled, not sent                              | COMPLETE | M6: content may be old                    |
| Dismissal (Keep) correct                              | PARTIAL  | M5                                        |
| `contextTokens` on subagent messages only             | COMPLETE | m7                                        |
| Resume-or-fresh advice in the injector                | COMPLETE | m3                                        |

Implicit requirements not addressed: guard semantics for multi-task lanes (M1), a way to turn off rotation, and `stopReason` visible on the agent card.

## Edge cases

| Case                                       | Handled | How                                    | Concern                    |
| ------------------------------------------ | ------- | -------------------------------------- | -------------------------- |
| Stop and timeout race                      | YES     | Status gate plus idempotent release    | —                          |
| Guard stop while a steer is queued         | YES     | `discardPending` before `stop`         | —                          |
| Lane ends while the steer awaits interrupt | YES     | Status gate in `applyLaneGuard`        | S1 side effects remain     |
| Hand-edited non-integer/negative guard     | YES     | Falls back                             | M4 is silent               |
| `-0` / above `MAX_SAFE_INTEGER` on write   | YES     | Rejected with the field name           | —                          |
| Budget disabled with rotation              | YES     | `disabledState` carries `rotation`     | —                          |
| Context drops after compaction             | YES     | Advisor clears and re-arms             | One turn late (R-W4, accepted) |
| Keep, then tab switch to a tab with no budget | NO   | Component state                        | M5                         |
| Provider without cache figures             | PARTIAL | `?? 0`                                 | m7                         |
| Restored or released lane                  | YES     | No guard is created; release clears it | —                          |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH. The steer routing and the missing `stopReason` reader are confirmed in code. Draft and prefill ordering on the main panel after `createTab` was not traced and remains uncertain.
- Top risk: the guard's automatic steer interrupts Cursor lanes and adds unwanted post-completion turns to Codex, Copilot and Antigravity lanes. Every long lane on those CLIs will hit it.
- What a robust implementation would add:
  - Steer only through `handle.steer`.
  - `stopReason` shown in `ptah_agent_wait` and the completion signal.
  - A guard reset on caller-initiated turns.
  - File-change calls left out of the repeat key.
  - OpenCode `command` segments counted.
  - A warning log and a matching read path for the pair fallback.
  - Kept keys held in a session-scoped store.
  - A fresh handoff for rotation.
