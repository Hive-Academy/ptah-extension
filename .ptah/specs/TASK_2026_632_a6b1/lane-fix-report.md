# Fix report — TASK_2026_632_a6b1

## Review items

1. **Monitor constructor sites:** Updated all three `SubagentBudgetMonitor` constructions in `helpers/session-lifecycle/session-query-executor.service.spec.ts` to pass `SubagentBudgetStopCallbackRegistry(makeLogger())` and `new SubagentStopNotices()`. The registry matches the monitor-spec harness pattern. The changed suite passed.
2. **Required transformer dependency:** `SdkMessageTransformer` now requires the DI token and a nonoptional `SubagentStopNotices` constructor argument. `TransformerHelpers.stopNotices` is required, and `buildAgentCompleted` calls `noticeFor` without optional chaining. Updated every direct constructor found by `rg -n 'new SdkMessageTransformer\(' libs apps`: the main, replay and artifact-parity agent-sdk specs, and the auth-providers Codex parity spec. Exported the class through the agent-sdk public index for the cross-library spec. Updated the direct system-message spec's optional call.
3. **Rekey-safe notice figures:** `SubagentBudgetMonitor.stop()` builds context and weighted-token figures from `preparedState`, the state selected after handoff preparation and a possible rekey merge.
4. **History-reader spec restored:** Wrote `git show HEAD:libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` bytes back to that path. `git diff --numstat -- libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` produced no output; there is no diff for that file.
5. **Parent handoff and rekey coverage:** Extended the existing test named `foreground subagent whose tool result arrives with the notice still pending: withdraws it and streams it as a user turn, once` to assert the actual `pushParentMessage` text says `The user did not stop it` and does not contain `stopped by user`. Added a test that records notices under both old and new session IDs, rekeys old to new, then verifies `release(new)` forgets both.
6. **Real transform coverage:** Added two cases in `sdk-message-transformer.spec.ts` that feed `task_started` and `task_notification` through `SdkMessageTransformer.transform`. A recorded stopped task emits `agent_completed` with the Ptah notice; an unrecorded stopped task retains `Agent "Explore" was stopped by user`.

## Files touched in this round

- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.ts`
- `libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.spec.ts`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.spec.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.replay.spec.ts`
- `libs/backend/agent-sdk/src/lib/message-transform/transformer-helpers.ts`
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.ts`
- `libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.spec.ts`
- `libs/backend/agent-sdk/src/lib/message-transform/artifact-parity.spec.ts`
- `libs/backend/agent-sdk/src/index.ts`
- `libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts`
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` (restored exactly; final diff empty)

## Checks and exact results

- `npx prettier --write libs/backend/agent-sdk/src/lib/sdk-message-transformer.spec.ts libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.spec.ts` — exit 0; first file formatted, second unchanged.
- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.spec.ts libs/backend/agent-sdk/src/lib/helpers/compaction/subagent-budget-monitor.spec.ts libs/backend/agent-sdk/src/lib/sdk-message-transformer.spec.ts libs/backend/agent-sdk/src/lib/sdk-message-transformer.replay.spec.ts libs/backend/agent-sdk/src/lib/message-transform/artifact-parity.spec.ts libs/backend/agent-sdk/src/lib/message-transform/system-message.transformer.spec.ts libs/backend/agent-sdk/src/lib/di/register.compaction-boundary-registry.smoke.spec.ts --coverage=false --maxWorkers=2` — exit 1; **6 suites passed, 1 failed; 234 tests passed**. The sole failed suite was the DI smoke spec, which could not load the worktree-mapped `node_modules/marked/lib/marked.umd.js`; it ran no tests.
- `npx jest -c libs/backend/auth-providers/jest.config.ts libs/backend/auth-providers/src/lib/providers/codex/codex-stream-parity.spec.ts --coverage=false --maxWorkers=2` — exit 1; **1 suite failed to load, 0 tests run**, for the same missing `marked.umd.js` mapping.
- `npx nx typecheck agent-sdk --parallel=1` — exit 0; `@ptah-extension/agent-sdk:typecheck` passed.
- `npx nx typecheck auth-providers --parallel=1` — exit 0; `@ptah-extension/auth-providers:typecheck` passed.
- `ptah_get_diagnostics` on the changed agent-sdk and auth-providers specs — 0 errors, 0 warnings, clean coverage. The first diagnostics request timed out while the compiler was still running; the completed cached request returned the clean result.
- `git diff --numstat -- libs/backend/agent-sdk/src/lib/session-history-reader.service.spec.ts` — empty output, confirming the requested restoration.

## Decisions

- Exported `SubagentStopNotices` from the agent-sdk public index because the auth-providers direct-construction spec must supply the now-required class without importing a private path. This is an additive public export and can be removed if that construction is later replaced by DI.

## Remaining limitation

The DI smoke and auth-providers Jest suites are blocked by the worktree's missing `marked` file referenced by their Jest mapper. No full Nx test target was run in this fix round.
