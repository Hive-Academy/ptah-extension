# Batch A5 Test Report - TASK_2026_610

## Scope

- User request: prove host turn data never reaches the model, so host-built recap data costs zero model tokens.
- Criteria extracted from Req 1.5 and 5.12: preserve stored `ExecutionNode.content` byte-for-byte; omit host values from serialized `ChatContinueParams`; omit them from the SDK provider prompt and `systemPrompt.append`.
- Sentinels: `zz_sentinel_610.ts`, `0.610610`, `610610`, and `A5_SENTINEL_TEST_LABEL`.

## Suites

### MessageSenderService host-data boundary — unit

- Requirement: a follow-up `chat:continue` only transports the user follow-up, never a prior turn's host recap data.
- Assertions: [message-sender.host-data.spec.ts:45](D:/projects/ptah-extension/.claude-worktrees/task-610-a2ui-coding-chat/libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts:45) seeds `TurnChangeSet`, message usage, and Bash test data; [message-sender.host-data.spec.ts:52](D:/projects/ptah-extension/.claude-worktrees/task-610-a2ui-coding-chat/libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts:52) derives the test row while keeping `ExecutionNode.content` unchanged; [message-sender.host-data.spec.ts:77](D:/projects/ptah-extension/.claude-worktrees/task-610-a2ui-coding-chat/libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts:77) serializes the real `chat:continue` RPC params and rejects every sentinel.
- File: `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\frontend\chat\src\lib\services\message-sender.host-data.spec.ts`

### SdkQueryOptionsBuilder host-data boundary — unit

- Requirement: Electron's `ptahUiFence` hint remains static and host recap data never reaches either provider-bound surface.
- Assertions: [sdk-query-options-builder.host-data.spec.ts:23](D:/projects/ptah-extension/.claude-worktrees/task-610-a2ui-coding-chat/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts:23) seeds host-only values; [sdk-query-options-builder.host-data.spec.ts:32](D:/projects/ptah-extension/.claude-worktrees/task-610-a2ui-coding-chat/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts:32) reads the returned prompt and `systemPrompt.append`; [sdk-query-options-builder.host-data.spec.ts:38](D:/projects/ptah-extension/.claude-worktrees/task-610-a2ui-coding-chat/libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts:38) rejects every sentinel and requires the `ptah-ui` hint.
- File: `D:\projects\ptah-extension\.claude-worktrees\task-610-a2ui-coding-chat\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.host-data.spec.ts`

## Execution

- Command run: `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/message-sender.host-data.spec.ts`
- Result: 1 passed, 0 failed, 0 skipped (observed).
- Command run: `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.host-data.spec.ts`
- Result: no final Jest counts captured. The first run failed at TypeScript compilation (0 tests) for `Array.fromAsync` and the `systemPrompt` union; both were corrected. The final run emitted only the Jest ES-module config warning and no completion output.
- Negative control: temporarily injected `zz_sentinel_610.ts` into serialized frontend params. Its execution capture was blank, so no failing count was observed; the injection was removed. The assertion is present but this requested failure proof is not executed evidence.

## Verdict

- Proven: stored assistant content is unchanged after host test-row derivation; the observed frontend `chat:continue` serialization excludes all sentinels.
- Not proven: SDK query prompt/system-prompt boundary and negative-control failure count, because their executions did not provide a completed Jest result.
- Risk: rerun the agent-sdk command in an environment that returns its Jest completion output before treating that boundary as verified.

## Orchestrator fix (2026-10-04)

- The lane never observed the backend spec complete. Run by the orchestrator, it failed: `build()` threw
  `SdkError: Cannot build the Ptah MCP server URL without a session routing id` (`sdk-query-options-builder.ts:1826`)
  because the session config had no `tabId`. Added `tabId: 'a5-host-data-tab'`.
- The spec was also vacuous: a `hostTurn` object held the sentinels but was never passed to the builder. The builder
  has no host-data input by construction (user stream + session config only), so the dead object was removed and a
  comment states the real scope: with the ptah-ui hint enabled, prompt and `systemPrompt.append` carry no host values.
  The meaningful host-data boundary is the frontend spec, which seeds the sentinels into `ChangeSetStore` and the
  transcript and asserts the serialized `ChatContinueParams`.
- Re-run: `sdk-query-options-builder.host-data.spec.ts` 1 suite, 1 test passed (observed).
