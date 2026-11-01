# Summary

Implemented native Codex turn-state emission, user-abort classification, and turn-scoped approval cleanup within the assigned files. Added focused Jest coverage using a real SessionTurnStateRegistry. Verification is deferred to the coordinator, as instructed. One out-of-scope Electron spec constructor must be updated before verification can pass.

## Task 1: shared registry dependency

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:160`: added the required second constructor parameter with the four-method registry Pick; forwards it to the stream at line 518.
- `libs/backend/agent-sdk/src/lib/di/register.ts:1090`: factory resolves SDK_SESSION_TURN_STATE_REGISTRY and passes the existing shared instance. Host ports remain unchanged.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:174`: supplies a real registry.
- Constructor search across libs/apps found one additional call outside ownership: `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:470`. Coordinator must add the second argument and its import there. Left untouched.

## Task 2: ordered lifecycle events

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:77`: one guarded settlement function maps result callback status to completed, aborted_streaming, or recordFailure plus settleTurn.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:169`: root message_start is preceded by a non-null generating state; message_complete is followed by exactly one settlement event. Status comes from callbacks.result, not stopReason.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:233`: expected terminal-only projection now includes both turn_state events.

## Task 3: detached consumers

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:227`: drain uses the same result-based settlement function without yielding, and forceIdle(aborted_streaming) when no terminal is consumed.
- Stream finally also settles an already observed terminal if the consumer returns between message_complete and its following settlement event. The settlement guard prevents duplicate revisions.

## Task 4: user aborts

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:182`: session aborts normalize both iterator completion and rejection to CodexChatAdapterError(cancelled, turn), bypassing runtime failure logging. An unexpected end without abort remains runtime-failed.
- No settlement event is emitted on this thrown path. Read `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`: its catch recognizes cancelled, skips Sentry/CHAT_ERROR, and pushes forceIdle(aborted_streaming). Broadcaster unchanged.

## Task 5: pending approvals

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts:227`: endTurn matches both thread and turn, settling every matching request with cancel and turn-ended through the existing cancelPrompt/dismiss path. dispose behavior unchanged.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:188`: cleanup ends pending turn approvals before release; detached cleanup does so again idempotently before releasing the busy latch.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:593`: close ends the active turn's approvals before abort/dispose, so the generic dispose decline cannot win that race.

## Task 6: regression specs

- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:204`: exact completed event sequence with a text delta, generating/idle phases, completed terminal reason, and increasing revisions.
- Line 241: interrupted and failed terminal mapping; line 268: second turn rearms generating above the previous revision.
- Line 302: Stop during approval for both normal iterator end and rejection; error class/code/cancel message, approval cancellation/dismissal, and no runtime error log.
- Line 358: unexpected iterator end remains runtime-failed and cleans approvals.
- Line 392: detached completed/interrupted/failed/missing terminals leave the registry settled.
- Line 430: all terminal statuses clean pending approvals; line 465: consumer return immediately after message_complete still settles.
- `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts:69`: endTurn settles multiple matching approvals exactly once and preserves other turns and threads.

## Decisions

- Decision: settle an observed terminal in finally when a consumer detaches between yields. Options: rely only on the yield loop, or guard a shared settlement function also used by cleanup. Evidence: async-generator return skips code after the suspended yield; the registry must not stay generating. Reversible: yes, local stream implementation.
- Decision: endTurn before abort/dispose in adapter.close. Options: allow dispose to decline the pending request first, or cancel the active turn explicitly. Evidence: close aborts and disposes synchronously before the iterator resumes; stream-finally alone cannot preserve cancel/turn-ended. Reversible: yes; dispose itself is unchanged.
- Decision: reuse the existing adapter fixture pattern locally in the new spec. Options: copy the scoped fake setup, import an executable spec, or add an out-of-scope helper file. Evidence: the output scope permits only the named new spec; importing the existing spec would also register its tests. Reversible: yes, extract a shared fixture if later authorized.

## Risks handled

- Uses the shared registry singleton and its revision/dedupe behavior; no separate host lifecycle state.
- Failure details remain the sanitized unknown classification; no raw runtime payload enters turn state.
- Detached cleanup settles the registry even when the server never supplies a terminal.
- Approval cancellation uses the existing ownership-release and presentation-dismissal path and is idempotent.
- Genuine stream failures remain distinct from explicit session aborts.
- Production host ports and the projection module are unchanged.

## Not done

- No verification commands or diagnostics were run. Tests are written but unexecuted; no passing-test claim is made. Only the new spec was formatted with Prettier's write API.
- Out-of-scope constructor fix needed: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:470`. Supply the new registry argument. Until this is updated, that spec has a constructor arity mismatch.
- No git operations, task-state edits, projection edits, runtime edits, or RPC-handler edits.

## Files written

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/register.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8k-1-report.md

## Continuation

- Updated `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:32` to import SessionTurnStateRegistry from the agent-sdk public export (`libs/backend/agent-sdk/src/index.ts:196`). The constructor at `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:471` now receives a real `new SessionTurnStateRegistry()` as its second argument.
- Decision: use the exported registry rather than a typed substitute; the public export is available. This local spec change is reversible and resolves the constructor arity mismatch reported above.
- Files written in this continuation: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts` and `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8k-1-report.md`.
- No verification, diagnostics, or git operations were run. Verification remains with the coordinator; no other work remains in this continuation.

## Fix round

- Approval isolation root cause: the spec spread entire approval requests into replies, adding `kind`, `normalizedHome`, `workspaceId`, `providerId`, `message`, and `details`. The strict reply schema rejects these extra fields before pending-request lookup. Updated `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts:93` to override only the differing correlation fields on the valid reply fixture. Both successful-response assertions and all isolation/exactly-once assertions remain intact. Production `endTurn` correctly requires matching thread and turn; no implementation change was needed.
- Electron binding root cause: `bindingFixture` calls `registerCodexChatServices` directly and omitted the registry dependency now resolved by the adapter factory. Updated `apps/ptah-electron/src/di/codex-runtime-composition.spec.ts:390` to register a real `new SessionTurnStateRegistry()` under `SDK_SESSION_TURN_STATE_REGISTRY` before Codex service registration, using the existing import.
- Production registration confirmed by source inspection: `activation/bootstrap.ts:416` calls `ElectronDIContainer.setup` before Codex binding at line 593; `di/container.ts:43` runs phase 2; `di/phase-2-libraries.ts:218` calls `registerSdkServices`; `libs/backend/agent-sdk/src/lib/di/register.ts:763` registers the registry singleton and line 770 resolves it. The Codex adapter factory registered earlier is lazy and resolves the shared registry at line 1099.
- Decision: correct the invalid reply fixtures and supply the missing real registry in the test container. Alternatives were changing production approval filtering or dependency registration; source evidence shows neither is defective for these failures. Both fixture changes are reversible.
- Risks handled: strict reply validation, turn/thread isolation, original assertions, shared registry wiring, and existing unrelated changes are preserved.
- Files written: `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts`; `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/apps/ptah-electron/src/di/codex-runtime-composition.spec.ts`; `D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-8k-1-report.md`.
- Not done: no verification commands, diagnostics, or git operations were run, as instructed. Coordinator verification remains outstanding; no passing-test claim is made.
