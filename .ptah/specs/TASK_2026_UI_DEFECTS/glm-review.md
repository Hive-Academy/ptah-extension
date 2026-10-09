# Independent review — glm (TASK_2026_UI_DEFECTS, uncommitted work on main)

READ-ONLY review of the uncommitted diff. Findings below; "Areas checked and
found sound" at the end. Updated incrementally.

**Verdict (interim): in progress**

---

## Area 1 — message-router outside-zone dispatch (perf-batch1)

Status: analysed. Handler paths traced (see below). Draft findings:

- Router logic (`message-router.service.ts`): FIFO order, BATCH in-place
  expansion, per-message error isolation and the synchronous `rpc:response`
  flush are all preserved. Mixed drain = one `NgZone.run`; all-stream drain =
  zero entries. `requiresZone` is conservative (unknown types, malformed
  BATCH envelopes, non-stream BATCH members all stay in Zone). Sound.
- `chat:chunk` path: `chat-message-handler.service.ts:458` →
  `turnStateApplier.apply` / `streamRouter.routeStreamEvent(ForSurface)` /
  `chatStore.processStreamEvent`. All terminal writes are signal writes
  (`TabManagerService.setStreamingState`, `applyTurnState`, liveness signals,
  store signals). `BatchedUpdateService` RAF callback only calls
  `tabManager.setStreamingState` (signal) — Angular's reactive view scheduler
  picks it up without Zone. Sound.
- `agent:summary-chunk` path: `chat-lifecycle.service.ts:147` — accumulator
  map writes + `setStreamingState` signal write only. Sound.

Findings (draft, will finalise):

- **Low** — `compaction-lifecycle.service.ts:168` recovery timer and
  `advisoryCorrelator.scheduleStaleRetry` (line 694, async callback) can now
  be armed from a `chat:chunk` dispatched outside NgZone. The `setTimeout`
  task is then registered in the root zone, so its callback also runs outside
  Angular. Current callback bodies appear signal/RPC-only, so no defect today;
  flag as a latent risk of the allowlist contract.

## Area 2 — session budget reload fix

Checked: `session-budget.types.ts:303`/`:324` (new `errorCode`), backend
`noState()` (`session-budget.service.ts:920-925`), `budgetPatch`
(`tab-manager.service.ts:148-155`), `clearSessionBudget`
(`tab-manager.service.ts:2276-2280`), and `runAction`'s
`NO_SESSION_BUDGET_STATE` branch (`session-budget-actions.service.ts:292-300`).

Sound parts:

- `clearSessionBudget` guards on `tab.claudeSessionId === sessionId`, so a
  tab switch mid-flight cannot clear another session's budget.
- `noState()` result carries no `state`, so the earlier
  `if (data?.state) actionState.set(...)` cannot run before the quiet
  dismissal.
- Backend `observe` returns a defined `disabledState` when the budget is
  disabled, and the stale-revision path composes the existing figure — both
  keep `budget` present on the stats event, so a live budget card is not
  cleared by those paths.

Findings:

- **Medium — F5 degradation contract broken by `budgetPatch` clear.**
  `session-budget.service.ts:315-327`: when `observe` throws (documented F5
  path: "an observe failure must never break the result-stats broadcast; the
  consumer keeps its last state"), `accept` returns `undefined` and
  `sdk-agent-adapter.ts:1690` publishes the stats event WITHOUT a budget.
  The new `budgetPatch` (`tab-manager.service.ts:152-154`) then clears the
  tab's `sessionBudget`, so a transient backend fault now REMOVES a valid
  live budget card instead of keeping the last state. Failure scenario: one
  result-stats broadcast with a throwing config read; the banner disappears
  while the backend budget is alive; it returns only on the next successful
  figure. Fix suggestion: make the backend publish an explicit "budget exists
  but unavailable" marker (or `budget: null` with a reason) so the frontend
  can distinguish "no budget state" from "degraded"; clear only the former.

**Area verdict: approve with fixes** (single medium finding above).

## Area 3 — effort plumbing (Grok, Antigravity, Ptah CLI)

Checked at code level:

- `lane-spawn-policy.ts:199-233` — `mapEffortToAgy`: `minimal`→`low`;
  `low|medium|high|xhigh|max` pass through raw; anything else dropped.
  `mapEffortToCli` (codex/copilot/grok): `minimal`→`low`, `max`→`xhigh`.
  `effortMapperFor` routes antigravity→agy scale, grok→cli scale. Correct.
- `antigravity-cli.adapter.ts:99` — `AGY_EFFORTS` extended with `xhigh`,
  `max`, matching the reported `agy 1.3.0 --help`. Adapter allowlist and the
  policy allowlist agree.
- `agent-spawn-environment.service.ts:112` — `EFFORT_CONFIG_KEYS` now maps
  grok→`grokReasoningEffort`, antigravity→`antigravityReasoningEffort`.
- `agent-rpc.handlers.ts:104-108`/`:410`/`:608` — both new config fields
  validated against `CLI_REASONING_EFFORT_VALUES` (no `minimal`/`max`, so
  the mapping functions handle the full scale) and persisted via
  `setAgentCfg` only when defined. Getter defaults to `''` (CLI default).
- Grok consumption (`grok-acp-profile.ts:140-144`, pre-existing from PR #665):
  `reasoning_effort` session config, non-binding, only when non-empty. Sound.
- Ptah CLI: `rpc-agents.types.ts:344-352` zod enum `low|medium|high|xhigh|max`
  matches the SDK's `effort` option; `ptah-cli-rpc.handlers.ts:191-193`
  parses input with `PtahCliReasoningEffortInputSchema` inside the handler's
  try/catch (a bad value becomes `{success:false}`, not a crash);
  `ptah-cli-registry.ts:804` maps `''`→`undefined` (SDK default) — correct;
  `:269` echoes the stored value in list output.

**No findings. Area verdict: approve.**

## Area 4 — analytics window classification

Checked `classifyWindow` (`window-state.ts:195-231`) and the full guard order.

- The new provider-api exception is sound: a `resetsAt` in the future at
  `now` proves no reset passed since the observation (the observation
  described the then-current window, and its next reset has not happened
  yet). The earlier `resetPassage` rule (checked before age) still catches an
  observed-then-passed reset, and the `aged` rule still bounds the trust to
  `freshnessMs`. `resetsAt <= now` falls back to `not-confirmed` —
  conservative. No false "confirmed" path found: `used` unknown,
  `estimated` and `stale` all classify earlier.
- Codex version pin removal (`codex-account-usage.service.ts:221-235`):
  `assertVersion` now only requires non-empty output; a method/schema
  mismatch degrades to `cli-version-unsupported` (kind `method`) or, for a
  zod response mismatch, `service-unavailable` via the catch-all in
  `performRead` (`:144-160`) — cached-stale fallback keeps prior data. Safe,
  no crash path.

**Low note:** with the pin removed, a protocol-breaking future codex CLI now
classifies as `service-unavailable` rather than `cli-version-unsupported`.
User-visible wording only; behaviour is still a safe degraded state.

**Area verdict: approve.**

## Area 5 — tests surface (transformer, turn-tests utils, recap row)

Checked:

- `system-message.transformer.ts:596-645`: the local_bash branch is guarded —
  `skip_transcript` still returns `[]`, and the new tool_result is emitted only
  when `parentToolUseId` resolved (`msg.tool_use_id` or a recorded task
  parent), otherwise the existing early return drops it. The turn-state
  background-task removal in `transformTaskNotification` still runs for every
  task kind. `isError: status !== 'completed'` and the
  `getMessageId('') ?? task_<id>` fallback mirror the agent_completed path.
  The `{ summary, outputFile }` output shape is what the new
  `outputText()` in `turn-tests.utils.ts` parses. Sound.
- `turn-tests.utils.ts`: `running` outcome for in-flight background commands
  is gated on node status; `outputOutcome` checks failure patterns before
  success patterns; `projectRuns` lets a later `failed` match overwrite an
  earlier `passed` for the same project (correct precedence). `failures`
  capped at 5.
- `turn-tests-row.component.ts` redefines its local `TurnTestRow` with
  `project`/`label`/`failures` and maps `failures: run.failures ?? []`, so the
  `TurnTestRow.project` TS2339 the budget lane saw mid-flight is resolved by
  this later change (cannot re-run typecheck per review constraints; code is
  consistent).

Findings:

- **Low — duplicated DOM id across recap rows.**
  `turn-tests-row.component.ts:130` `bodyId = 'turn-tests-body'` is a constant.
  Two recaps on screen (e.g. two finalized turns in a transcript) produce
  duplicate `id` values; `aria-controls` on each header points at both.
  Fix: derive a unique id per instance (`Math.random`/instance counter).
- **Low — output parse can override a node error status.**
  `turn-tests.utils.ts:80-83`: `outputOutcome(output)` is applied before
  `outcomeFor`, so a command whose tool node ended `error` but whose output
  contains "Tests: N passed" (tests passed, later step in the same command
  failed) reports `passed`. Arguably accurate for the test rows; note only.

**Area verdict: approve** (no behavioural defect; the two low notes are
polish/a11y).

## Area 6 — lane guards, stop reason, agents panel usage stats

(pending)
