# Code Logic Review — `TASK_2026_632_a6b1`

Scope: `git diff` of the worktree plus new `subagent-stop-notices.ts`, read in full for the monitor `stop()`/`rekey()`/`release()` paths, `system-message.transformer.ts` task-notification code, `sdk-message-transformer.ts` constructor, `di/register.ts` wiring. No Jest, nx or build was run (per instruction); findings come from reads, grep and `git diff`.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 1              |
| Serious issues      | 2              |
| Moderate issues     | 5              |
| Failure modes found | 6              |

The core mechanism is sound: the notice is recorded before `stopSubagent`, the key is the SDK task id, and the transformer swaps only `stopped` summaries with a recorded id. A real user stop keeps the SDK text. Three things stop an approval. The change breaks the compile of an existing spec. The child-session acceptance item is "proven" by a test that does not cover the child path. The one test that wires the store through DI cannot run here.

## Five logic questions

### 1. How does this fail silently?

- `SdkMessageTransformer` takes the store as `isOptional: true` (`sdk-message-transformer.ts:134-135`). If the token is ever unbound, `helpers.stopNotices` is `undefined` and `system-message.transformer.ts:667` falls back to the SDK "stopped by user" text with no log. Today the only production binding site is `di/register.ts:242-246`, so this does not fire now. A later host or container that builds the transformer without `registerSdkServices` would regress with no signal, and no test would catch it.
- A stop that was rejected and never reached the SDK still leaves its notice in the store (`subagent-budget-monitor.ts:963-973`, kept on exhaustion by design, spec `subagent-budget-monitor.spec.ts` +770). If the user then stops that same task by hand, the event reads "Ptah stopped … The user did not stop it". That is the reverse of the original bug.

### 2. What user action produces unexpected behaviour?

- User presses stop on a subagent at the same moment the monitor is in flight. The monitor recorded the notice first, so the single `stopped` notification carries the Ptah text even if the user's stop landed first. Narrow, and it cannot be told apart from the SDK's side. Moderate.
- The user sees the notice in `agent_completed` only. `background_agent_stopped` carries no summary (`system-message.transformer.ts:547-556`), which is fine. A history replay after restart shows the SDK text again (D4, accepted).

### 3. What input data produces a wrong answer?

- `SubagentStopNotices.record` overwrites by task id (`subagent-stop-notices.ts:9`). A second `stop()` for the same task, for example a retry after the first stop failed, recomputes the text from the current `state.contextTokens`. The figures shown are from the last attempt, not the one that tripped the limit. Cosmetic.
- `stopNotice` is built with `state.contextTokens` / `state.weightedUsed` from the original `state` (`:966-972`), while a rekey merge may have replaced it with `preparedState`/`liveState`. Figures could come from the discarded record. Minor.

### 4. What happens when a dependency fails?

- `stopSubagent` rejecting: handled by `onStopFailed`; the notice stays (see above). Trade-off is explained in the failure modes.
- `prepareHandoff` returning nothing, or release during preparation: `stop()` returns at `:942-956` before `record()`, so no notice is leaked. Correct.
- Release while the stop awaits (`:989-993`): `release()` forgets the notice, then the SDK notification arrives later and the transformer finds no notice, so it shows "stopped by user". The session is over at that point, and the only remaining reader is a stream that is being torn down. Low risk, but it is a hole in the "never" wording of the goal.

### 5. What is missing that the requirements never mentioned?

- No consume or TTL path. The notice is looked up with `noticeFor` and never deleted on use. It lives until `release(sessionId)`. A long-lived session that stops many subagents holds one small entry per stop. Bounded by stops, not a real leak.
- No test connects the three pieces (monitor writes, store, transformer reads) through the real `SdkMessageTransformer.transform` path.

## Failure modes

### Spec compile break from the new required constructor parameters

- Trigger: `budgetStopCallbacks` changed from optional to required and `stopNotices` added (`subagent-budget-monitor.ts:404-405`).
- Symptom: `session-query-executor.service.spec.ts:1023, 1569, 1730` build the monitor with 7 arguments. The lane report records exactly this as `TS2554, 7 arguments supplied where 9 are expected` and calls it "unchanged" and pre-existing. It is not pre-existing: the file has no diff, and the arity changed in this diff. The lane's own full run also showed 5 failed suites.
- Evidence: `git diff` shows `session-query-executor.service.spec.ts` untouched; `subagent-budget-monitor.ts:404-405`.
- Current handling: none. The lane report blames a missing `marked` module for the failures and the unfiltered cause was not captured.
- Recommendation: update the three construction sites, or restore `budgetStopCallbacks?` as optional and make only `stopNotices` required. The `?.` at `:1018` suggests the optional form was intentional.

### Notice survives a stop that never happened, then mislabels a real user stop

- Trigger: `stopSubagent` rejects on all `MAX_STOP_ATTEMPTS`, subagent keeps running, user later stops it.
- Symptom: `agent_completed.summary` says Ptah stopped it and the user did not.
- Evidence: `subagent-budget-monitor.ts:963-982`; spec +770 asserts the notice is kept.
- Current handling: kept on purpose because the SDK may have stopped it despite the rejection.
- Recommendation: keep it, but also delete the notice in the exhausted-retries branch of `onStopFailed` only when the registry still shows the subagent running; or accept and record in decisions.md as a known trade-off. A real defect either way is small, since rejection after a real stop is the more likely case.

### Child-session acceptance item is asserted by an unrelated test

- Trigger: acceptance says the completion summary of a child session must not claim a user stop.
- Evidence: the added assertion is in `session-history-reader.service.spec.ts` for `readHistoryForCuration`. That path feeds memory curation, and the existing code already filtered `<task-notification>` content. It is not `ptah_session_read`, and it proves nothing about what the child model sees.
- The incident was the child **model** reading the SDK text live. That text is injected by the SDK and the host cannot rewrite it (D3). The defence for a child is the handoff message pushed to its session (D1), which is existing code and not part of this diff. The diff therefore adds no child-specific protection, and the lane's "Child-session finding" is an argument, not a test.
- Recommendation: either add a monitor-level test that the handoff message is pushed to the child's parent session id and says the user did not stop it, or state in decisions.md that child coverage rests on D1 plus the `agent_completed` rewrite. Remove the misleading history-reader assertion or label it as a regression guard only. The same diff also carries prettier reformat hunks in that spec (lines ~165-250) that hide the real change.

### Cross-session collision and rekey leak

- Trigger: rekey A→B, then release.
- `record()` stores the session id current at the time (`live.sessionId`, `:964`). `release(B)` computes `stale` as every alias whose chain includes B and calls `forgetSession` for each plus B (`:648-663`). So a notice recorded under A or B is forgotten when the live id is released. No leak on the normal path.
- Leak case: `release()` called with an old alias id. `release` only deletes `this.sessions` under the id it is given (pre-existing behaviour), and notices recorded under the new id are not reached. Callers pass the current id in the code I read, so I rate this Minor.
- Collision: the map is keyed by task id alone. SDK task ids are unique per process, so a cross-session collision is not realistic. The `sessionId` field exists only for cleanup. The transformer lookup does not need the session. Correct as built.

### Optional injection hides a missing binding

- Trigger: any construction path that omits the token.
- Evidence: `sdk-message-transformer.ts:134-135`, `transformer-helpers.ts` (`stopNotices?`), `system-message.transformer.ts:667` (`?.`).
- Direct `new SdkMessageTransformer(...)` sites: `sdk-message-transformer.spec.ts` (6 sites), `replay.spec.ts:72`, `artifact-parity.spec.ts:57`, `auth-providers/.../codex-stream-parity.spec.ts:52`, plus `sdk-message-transformer.ts:155` (a private copy that does pass the store). All are test sites; none is a production path. Production resolves the singleton registered at `register.ts:242-246`, and `register.ts:558` gives the monitor the same instance. CLI and Electron call the same `registerSdkServices` (their smoke specs already import it), so the binding exists on all hosts.
- Recommendation: make the parameter required and pass `new SubagentStopNotices()` in the 8 spec sites, or keep it optional and add one production-path test (resolve `SDK_MESSAGE_TRANSFORMER` and the monitor from one container and assert they share the store). The smoke test at `register.compaction-boundary-registry.smoke.spec.ts:195-206` asserts only that the store is a singleton and the transformer resolves; it never shows the transformer holds that instance.

### SDK status value

- `SDKTaskNotificationMessage.status` is `'completed' | 'failed' | 'stopped'` (`libs/shared/src/lib/types/execution/stream-background.ts:195`; documented at `system-message.transformer.ts:507-511`). A stop produces `stopped`. `killed` appears only in the model-facing XML text and in frontend UI status enums (`stream-background.ts:164`, `agent-status.ts:57`), not on this message. The gate `msg.status === 'stopped'` is correct. The lookup is also correct when the SDK reorders its notification before `stopSubagent` resolves, because `record()` runs at `:963` before the await at `:975`.

## Blocking issues

### B1. Three existing specs no longer compile

- File: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts:1023,1569,1730` against `subagent-budget-monitor.ts:404-405`
- Scenario: any run of the agent-sdk test target, including CI.
- Impact: the suite fails, so the "all green" claim for the project does not hold, and the lane report misattributes it. The failure would block the pre-push or CI gate.
- Fix: pass `new SubagentBudgetStopCallbackRegistry(...)` and `new SubagentStopNotices()` at the three sites, or revert `budgetStopCallbacks` to optional and give `stopNotices` a default-free required slot at the end. Re-run `npx nx test agent-sdk --parallel=1` with output filtered for `TS2554` and report the real failure list, not just the `marked` cause.

## Serious issues

### S1. Child-session criterion is not proven

See failure mode "Child-session acceptance item". File: `session-history-reader.service.spec.ts:1553-1566`. Fix: add a monitor test that pushes the handoff text to the parent session id of a child and contains "did not stop", and drop or relabel the history-reader assertion. Move the prettier noise out of this diff.

### S2. The wiring test cannot run, and no test joins writer and reader

File: `di/register.compaction-boundary-registry.smoke.spec.ts:195-206`. Lane reports the suite fails to load (`marked.umd.js` absent from the worktree `node_modules`). So the only DI evidence is unrun. Fix: run it from an environment with the dependency (or the main checkout's `node_modules`), and extend it to assert `transformer.helpers.stopNotices` is the resolved singleton, or add a `SdkMessageTransformer`-level spec that records a notice and feeds a `task_notification` of status `stopped`.

## Moderate and minor issues

- `subagent-budget-monitor.ts:963-973`: the notice is built from `state`, not from `preparedState`/`liveState`; after a rekey merge the figures may come from the replaced record. Use `preparedState`.
- `subagent-budget-monitor.ts:963`: notice persists for the whole session (never consumed). Optional: delete on the first matching `agent_completed`, or leave.
- Optional constructor parameter (see failure mode) is Moderate.
- `system-message.transformer.spec.ts` new test uses `'sess'` for `record()` while the transformer never passes a session, so the key shape the test uses (task id only) is correct but the first argument is untested. Fine.
- `subagent-budget-monitor.spec.ts`: no test for rekey then release forgetting the notice, no test for release before a late `stopped` notification. Add both; they are the two edge cases the design depends on.
- `stopNotice` (`subagent-handoff-message.ts`) lives in the handoff-message module with the other model-facing text; its text is not asserted for the `teammateName` absent case, only the present one.

## Data flow

1. Monitor `observe` sees budget reached; `stop()` finds task id (`:900-914`) - OK.
2. `prepareHandoff` (await) - OK; early returns precede the record.
3. `liveSession` check (`:948`), then `stopNotices.record(live.sessionId, taskId, text)` (`:963`) - OK, synchronous with the check, before any await that could let the SDK answer.
4. `dispatcher.stopSubagent` awaited (`:975`) - OK.
5. SDK emits `task_notification` status `stopped`; `buildAgentCompleted` reads `noticeFor(msg.task_id)` (`:665-668`) - OK for both orderings. Gap: if `release()` ran first, falls back to SDK text.
6. `agent_completed.summary` goes to UI and transcript - OK. `takeBackgroundTerminalEvent` carries no summary for `stopped` - OK.
7. `release(sessionId)` forgets notices for the id and its aliases (`:663`) - OK on the normal path.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Monitor stop summary carries the Ptah notice, no "stopped by user" | COMPLETE | `agent_completed` only; replay is out of scope (D4). |
| Handoff and weighted-budget reasons each have their own text | COMPLETE | Tested for both. |
| Real user stop keeps SDK summary | COMPLETE | Transformer test covers an unrecorded task id. |
| Child sessions do not see a user-stop claim | PARTIAL | No child-specific code or test; rests on the existing handoff message. |
| Notice recorded before stop on every path | COMPLETE | Single call site covers handoff, safety and retries; retries rerecord. |
| Existing tests still pass | MISSING | `session-query-executor.service.spec.ts` no longer compiles (B1). |

Implicit requirements not addressed: forgetting on rekey-then-release is untested; a late notification after release shows the SDK text.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| SDK notification before stop promise resolves | YES | record precedes await | none |
| Stop rejects, retries exhausted | PARTIAL | notice kept | later user stop mislabelled |
| Rekey then release | YES | alias chain forgotten | untested |
| Release during in-flight stop | PARTIAL | notice forgotten | late notice shows SDK text |
| Two sessions, same task id | YES | task-id key, ids unique | none realistic |
| Store not bound | NO | silent fallback | optional injection |
| User stop of unrecorded task | YES | falls back to SDK text | none |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM-HIGH. The core logic is correct by reading; the compile break and test-run gaps are from the lane's own report and the unchanged spec, not from a run on my side.
- Top risk: the agent-sdk test target no longer compiles because of the new required constructor parameters, and the lane misreports it as pre-existing.
- What a robust implementation would add: fix the three spec construction sites; make the transformer parameter required (or add a shared-singleton test); add monitor tests for rekey-then-release and release-before-notification; replace the history-reader assertion with a child-targeted monitor test; build the notice from `preparedState`; decide and record the policy for a notice left by a stop that never reached the SDK.

## Re-review

Verdict: APPROVED (read-only; no Jest, nx or build run; static diff reading only).

1. B1 fixed: `session-query-executor.service.spec.ts` passes `SubagentBudgetStopCallbackRegistry(makeLogger())` and `new SubagentStopNotices()` at all three monitor sites (diff hunks at about lines 1037, 1584, 1748). The monitor constructor now has both parameters required (`subagent-budget-monitor.ts:404-405`).
2. Transformer dependency required: `sdk-message-transformer.ts:134` injects `SDK_SUBAGENT_STOP_NOTICES` non-optionally; `TransformerHelpers.stopNotices` is required; `system-message.transformer.ts:665-668` has no optional chaining. Every `new SdkMessageTransformer(` site passes a notices instance: artifact-parity, replay, codex-stream-parity, the main spec (all sites, including the self-copy at `sdk-message-transformer.ts:155-164`). The e2e spec in `apps/` only mentions the name, with no construction. The DI registration and token exist (`register.ts:243,558`, `tokens.ts:85`). No silent fallback remains except the intended `?? msg.summary` for unrecorded stops.
3. Figures: `subagent-budget-monitor.ts:949,968-969` use `preparedState`. OK.
4. `session-history-reader.service.spec.ts` has no diff (absent from `git status`).
5. Monitor spec: the handoff-text test asserts `The user did not stop it` and the absence of `stopped by user` (`subagent-budget-monitor.spec.ts:1320-1321`). The rekey-then-release test is at `:1014-1024`; it records under both ids, rekeys, releases and asserts both are forgotten. Meaningful.
6. `sdk-message-transformer.spec.ts`: new `it.each` runs `task_started` then `task_notification` through `transform()` for the recorded and unrecorded cases. Meaningful.
7. Public export: `index.ts:151` is additive and follows the adjacent `CompactionBoundaryGenerationRegistry` precedent, which exists for the same cross-library spec construction. It is necessary for the auth-providers spec. OK.

Remaining (Minor, no action needed to approve):
- `sdk-message-transformer.spec.ts` (new block) records a hand-written notice with `notices.record(...)` instead of the monitor's `stopNotice()` output. This joins the reader through `transform()` but not the real writer. The monitor spec covers the writer side separately.
- Not independently verified: the DI smoke spec and the codex parity spec fail to load in this worktree because `marked.umd.js` is missing (lane-fix-report). This is an environment problem, but those two suites have no passing run.
