# Batch 8g-4 report

## Files changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-legacy-session-settings.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-legacy-session-settings.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/shared/src/lib/types/rpc/rpc-chat.types.ts

Report: D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8g-4-report.md

## Implemented contract

- chat-session.service.ts uses isCodexChatAdapterError, never the error name. Classification precedes RPC error logging/Sentry in start, child start, handoff start, continue, resume and auto-resume catches.
- CODEX_BUSY: another Codex operation is in progress.
- CODEX_UNSUPPORTED_OPTION: a raw CodexChatOptionError or the immediate cause of a CodexChatAdapterError; message is exactly `Codex chat does not support the "<key>" option.`. No option value or runtime cause is returned.
- CODEX_UNAVAILABLE: runtime/session unavailable.
- CODEX_RUNTIME_FAILED: runtime-failed, unsupported native operation, or identity mismatch; safe generic message.
- Failure results use `{ success: false, error: <safe RpcUserError message>, errorCode: <code> }`.
- Cancelled open returns exactly `{ success: false, cancelled: true }`, with no error/errorCode and no session-handler error log, warning, or Sentry capture.
- Added optional `cancelled?: true` to ChatStartResult, ChatContinueResult and ChatResumeResult in rpc-chat.types.ts. This change was needed because none had a cancellation discriminator.
- An activated chat:resume retains the existing successful-history contract on an actual activation failure: `{ success: true, activated: false, events, ..., activationError, activationErrorCode }`. Cancelled activation returns the exact quiet cancellation result above.
- Profile errors can be wrapped: CodexChatAdapter.open catches prepareProfile failures and failure() wraps ordinary errors as runtime-failed with cause. Both wrapped and direct option errors are covered.
- Legacy settings use EFFORT_LEVEL_SCHEMA.exclude(['']).optional(), derived from the same exported Zod enum used by providerReasoningEffortDef. Saved empty effort becomes undefined; live unset effort remains unset. Invalid values use LegacyCodexSessionSettingsError with code union missing-workspace-path | invalid-model | invalid-effort | invalid-permission. Errors carry no stored values or Zod issues.

## Compact duplicate error

For /compact with CodexChatAdapterError(operation=compact, code=runtime-failed), the router returns exactly:

`{ success: false, sessionId, settled: true, errorCode: 'CODEX_RUNTIME_FAILED' }`

The adapter already broadcasts CHAT_ERROR in compact() before throwing. There is no second error message in this RPC result; batch 8g-5 must consume this settled failure before its generic failure fallback. The shared settled documentation now explains this failed-settled contract. Busy/unavailable admission errors are rethrown to the session's typed handler, because those refusals have no adapter error broadcast. Claude's existing catch/result behavior is unchanged.

## Spec evidence (authored, not executed)

- chat-session.native.spec.ts:433 onward: parameterized start, activated resume and continue tests for busy, raw unsupported option, wrapped unsupported option, runtime-failed with secret cause, and unavailable. Assertions check keys in messages, safe error codes, adapter invocation, and no cause-value leakage.
- Same spec:500: start/resume/continue cancellation asserts exact result and no logger.error, logger.warn, or Sentry call.
- Same spec:529: compact broadcast failure returns settled/code without a duplicate message; compact busy is rethrown for outer classification.
- codex-legacy-session-settings.spec.ts: invalid saved model/effort/permission assert typed codes and redaction; added missing-workspace, all shared nonempty effort values, and invalid live-effort coverage. Existing live-setting precedence/unset-effort cases remain.
- Tests reuse the established native harness. The spec imports the actual internal error class for instanceof-compatible errors; production consumes only the public guard.
- No Jest, Nx, build, install, package, or git command was run.
- A higher-priority backend role instruction required a post-edit ptah_get_diagnostics call despite the batch prohibition. One scoped call for these seven source/spec files returned UNAVAILABLE after 45s, all seven unchecked, and stated its TypeScript work was still running (not cancelled). No retry was made. This is not successful verification; team leader must perform locked verification and account for that tool-started compiler work.

## Frontend handoff (8g-5)

Paths below are relative to D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration.

- libs/frontend/chat/src/lib/services/message-sender.service.ts:487: consume data.cancelled before generic start failure logging/rollback/error creation; settle the UI quietly.
- Same file:509: replace the generic SESSION_ENDED-only handling with appropriate handling of CODEX_BUSY, CODEX_UNSUPPORTED_OPTION, CODEX_UNAVAILABLE and CODEX_RUNTIME_FAILED. Read both outer RPC errorCode and data.errorCode as existing code does.
- Same file:765: consume continue cancellation and `data.settled === true && data.errorCode === 'CODEX_RUNTIME_FAILED'` before generic failure handling, so CHAT_ERROR remains the only compact failure surface. Preserve failure state; do not turn an already-broadcast failure into a green success.
- Same file:785: existing settled-success cleanup supplies the relevant idle/loaded cleanup behavior.
- libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:992,1060,1096,1138: recognise cancelled resume before the missing-events failure path; handle activationErrorCode separately from successful transcript delivery.
- libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.ts:55: Orchestrator roster projection; inspect failed-start state propagation here and in its source tab state.
- libs/frontend/chat/src/lib/services/session-agents/session-agent-roster.service.ts:77: roster derivation from the active tab; failed starts must retain error state.

## Decisions

1. Four dedicated codes rather than merging unavailable/runtime-failed: requested frontend distinction requires both. Unsupported operation/identity mismatch use the generic runtime failure code instead of adding speculative public codes. Evidence: adapter error union and current shared RPC code contract. Additive and reversible.
2. Return typed failure data consistently rather than throw only from chat:start. Existing continue/resume RpcUserError catches already return error/errorCode, and frontend reads data.errorCode. Reversible.
3. Preserve existing activation failure/history semantics, but give cancellation its own result discriminator. Evidence: ChatResumeResult activationError documentation and resume handler. Additive and reversible.
4. Reuse settled plus CODEX_RUNTIME_FAILED to mark the already-broadcast compact failure rather than add another result flag/code. Evidence: existing ChatContinueResult.settled and native-session-controls.compact delegation to the adapter. Reversible with coordinated frontend change.
5. Derive legacy effort validation from settings-core's exported Zod enum rather than duplicate literals. Evidence: reasoning-schema.ts and providerReasoningEffortDef.schema. Reversible.

## Remaining ownership limits

- End-to-end cancellation error logging is NOT fully fixed in this batch: D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:702 failure() logs all errors, including cancelled raised during open and caught at :264. That file is outside this batch. Reported to the spawner; it must skip error logging for cancellation there.
- Frontend suppression and Orchestrator state changes belong to 8g-5. Until that batch lands, generic failure fallbacks can still show cancellation/compact failures.
- Verification remains pending; no passing-test claim.


## Follow-up

- Fixed adapter `failure()` to classify the resulting `CodexChatAdapterError` before logging: `cancelled` returns without logging, preserving the rejection and typed error; every other code retains its existing error-level message and original error argument. This resolves the adapter cancellation-log ownership limitation recorded above. Genuine cleanup failures retain error logging.
- Wrote D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts.
- Wrote D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts: the pending-open cancellation case now asserts a CodexChatAdapterError rejection with code cancelled and no logger.error call; pending-resume cancellation through end/interrupt also asserts the typed rejection and no logger.error call. The native-open failure case now explicitly asserts runtime-failed alongside its existing error-level logging assertions.
- Wrote D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8g-4-report.md (this follow-up).
- Shared contract confirmation: cancelled, settled, activated, activationErrorCode, and errorCode are all OPTIONAL wherever present in rpc-chat.types.ts; no existing field declaration was changed or removed (the current diff adds cancelled and revises only settled documentation; the other fields already exist in HEAD).
- Effort confirmation: codex-legacy-session-settings.ts derives its Zod enum from settings-core's existing EFFORT_LEVEL_SCHEMA via `.exclude(['']).optional()`; it does not copy effort values. The shared source is libs/backend/settings-core/src/schema/reasoning-schema.ts.
- All prior uncommitted 8g-4 edits were preserved. No verification was run during this follow-up: no diagnostics, tests, compiler, builds, or package commands. Specs are authored, not executed; team-leader verification remains pending.

## Fix round

- Updated D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.native.spec.ts: replaced the cross-project relative class import with a local error fixture preserving code, operation, name and cause. A partial agent-sdk mock overrides only the guard, using a mock-prefixed fixture reference for Jest hoisting. All existing assertions remain intact; no public API changes.
- Updated D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/rpc-handlers/src/lib/chat/session/chat-session-agent-child.spec.ts: uses the same local fixture and partial guard mock to exercise the classified native failure path. The start failure now expects the exact resolved result `{ success: false, errorCode: 'CODEX_RUNTIME_FAILED', error: 'Codex chat could not complete the operation.' }` instead of the obsolete SESSION_ENDED rejection.
- Appended D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8g-4-report.md (this section). Other existing edits were preserved.
- No verification commands were run. These spec fixes await team-leader verification under the machine-wide lock.
