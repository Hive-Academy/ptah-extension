# Batch 6g ADAPTER2 report

Implemented the assigned adapter changes in the six owned files. Scoped TypeScript diagnostics are clean. The one permitted test command was still running at its single completion check; no test pass is claimed. SN1 now satisfies the orchestrator's clarified cancellation contract, including cancellation during metadata save.

## Finding status and evidence

Paths below are relative to libs/backend/agent-sdk/src/lib/codex-app-server/ unless stated otherwise.

- **SN1 / decision 12: implemented, including the clarified save-in-flight behavior.** codex-chat-adapter.ts:626 exposes owns for resolved sessions and pending tab IDs. isSessionActive reports uncancelled opens; interruptSession at :691 cancels a pending open rather than looking up a nonexistent session. Open uses the tab ID when supplied (:205), checks cancellation before metadata save and after it (:218-227), and closes the context/disposes scope on failure. Regression codex-chat-adapter.spec.ts:592 exercises both endSession and interruptSession while runtime.open is pending and proves zero metadata saves, session publications and turn starts, plus context/scope cleanup. Ownership remains until the pending operation settles so routing never falls through to legacy during cleanup.
- **SN1 cancellation during save: accepted and covered.** The orchestrator explicitly permits an already-started metadata.save to finish and retain the real resumable session row. The existing post-save cancellation check (adapter :227) rejects the open before publication/first turn, then closes the context, disposes the scope and removes pending ownership. The new parameterized regression named "cancel during save" covers endSession and interruptSession: it blocks save, cancels, allows save to complete, and verifies completion, no publication/turn, context/scope cleanup, and inactive/unowned tab and thread IDs. No runtime change or rollback is needed.
- **Decision 13: implemented.** listSessionModels (:410) uses model.model as picker value and keys deduplication by execution slug, preferring an isDefault entry. Distinct catalog aliases cannot produce duplicate picker values. Spec :627 uses three different catalog IDs for the same slug, verifies default display selection, the profile passed to runtime.open, and the slug passed to updateNextTurn. The profile port already owns construction of the execution profile; arbitrary string catalog IDs are not guessed or converted. CORE2 explicitly assigns model as the execution slug.
- **Decision 14 / M2: implemented.** canSendFollowUp (:632) reflects live ownership, busy, blocked and closing state. False for pending opens and active turns; false after failed interrupt while the turn remains active; true after terminal cleanup. Specs :447, :592, :652 and :671. LegacySessionControls implements interrupt via lifecycle and has no queued native-turn facility; SessionRuntimeRouter:56 returns true for legacy and delegates native policy. Native sends start a new turn, so busy must be false rather than falsely promising SDK-style queuing.
- **Decision 19 / M7 and style M7: implemented.** One tokenUsage helper at codex-chat-events.ts:8 maps max(0, input-cached), output unchanged, cacheRead and cacheCreation. Both stream usage projections (:205, :245) and result stats (adapter :498) call it. Whole-turn snapshots replace the previous snapshot; they are never summed. Specs events.spec.ts:241 and adapter.spec.ts:417 cover repeated snapshots, nonzero cached/cache-write counts, reasoning already included in output, and a negative-difference clamp. No usage update still produces no token stats.
- **Live stats: retained explicit refusal, with corrected reason.** adapter :752; regression spec :707. Field analysis below.
- **m2 double cancellation: implemented.** sink :209 settles cancel and dismisses, without presenting cancelPrompt. Router owns that notification/reason. Other abort/dispose settlement paths still present their reasons. Regression sink.spec.ts:240 proves one dismissal, no sink cancel presentation, and no duplicate disposal release.
- **m3 consumer return: implemented.** adapter :552-610 retains busy while a detached reader interrupts the turn and drains its existing iterator to a correlated terminal. Follow-ups fail with coded busy in that interval. On iterator/interrupt failure or missing terminal, it closes the context before releasing busy. Abort listeners and event iterators are released on both normal and detached paths. Regression :671.
- **m4 early Stop: implemented.** adapter :676 records pendingInterrupt while startTurn has no receipt; :504 applies it when the receipt arrives. It returns false until actual server acceptance is known, and canSendFollowUp stays false. Regression :652.
- **Style M2: implemented.** Adapter and approval-sink logger errors now carry class prefix and runtime-failed code, without raw provider errors/secrets.
- **Style M10: implemented.** adapter :1/:119 declares implements NativeChatAdapter using import type. The contract remains owned by routing; the erased type-only import creates no runtime dependency/cycle. IAgentAdapter remains used for inherited method signatures.
- **Spec logger helper: preserved.** Existing no-cast mockLogger pattern remains.
- **m1 frontend accumulator replay: deferred.** Actual StreamingAccumulatorCore is in libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:208. Replaying through it requires the forbidden frontend import. Existing backend-only event-order/identity test (events.spec.ts:199) remains; reproducing the accumulator in a mock would not verify frontend replay.

## Live-stats decision: required fields checked individually

Contract: libs/shared/src/lib/types/rpc/rpc-session.types.ts:359-460.

| Field | Evidence / availability |
| --- | --- |
| sessionId | Exact native thread identity is available. |
| model | Contract permits null. Usage snapshots lack per-model attribution and do not establish the primary lifetime model by highest cost/tokens. A current selected model would not prove this field. |
| totalCost | Contract permits null for unknown pricing. No lifetime cost coverage exists for resumed history; zero must not be invented. |
| tokens.input | Exact disjoint input is available per reported turn. Resumed lifetime prefix totals are not supplied to this adapter. |
| tokens.output | Exact per reported turn, including reasoning; lifetime prefix unavailable. |
| tokens.cacheRead | Available per reported turn; lifetime prefix unavailable. |
| tokens.cacheCreation | NOW available from cacheWriteInputTokens (core defaults omitted wire field to zero); no longer itself a reason for refusal. Lifetime prefix remains unavailable. |
| messageCount | Required count of assistant messages. No prior assistant-message count/history is supplied on resume. Turn count is not proven to equal assistant-message count, and counting only locally observed messages omits resumed history. No estimate/counter added. |
| status | Cannot honestly publish ok for a complete lifetime entry without the required exact fields. error/empty does not make fabricated numeric fields valid. |

Optional knownCost, tokenCount, agentSessionCount, cliAgents, modelUsageList, coverage, untimestampedCount, pricingCoverage, scope, revision, cache, provisional, durationMs and contextSnapshot can be omitted. Partial coverage/provisional does not supply an exact required messageCount. A local revision or elapsed duration cannot repair missing history. Retain unsupported/liveStats until a history-aware contract supplies exact counts and totals. Result-level stats remain available.

## Verification

Formatted all six owned files with node_modules/.bin/prettier --write.

Final ptah_get_diagnostics scoped to all six files:

> Source: typescript-compiler
> Errors: 0 | Warnings: 0 â€” No issues found.
> Coverage: clean
> Shown 0 of 0 (0 in requested files, 0 in sibling files omitted)

Earlier diagnostics caught a mock return-type mismatch and unsupported Promise.withResolvers lib typing; both corrected before the final clean diagnostic.

Started exactly once:

> npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="codex-chat-"

Output is filtered to the last 60 lines. Native exec session 40367 was still running at the single allowed completion check:

> session_id: 40367
> output: ""
> exit_code: not returned

No retry, second completion check, workspace run, install, build, live model call or git command. Team leader owns authoritative verification. A running/queued test is not a pass.

## Decisions

- Use the existing opening cancellation token and session map, with tab-first pending keys; do not add a routing dependency at runtime. Options: new owner service vs extend existing state. Existing map and decision 12 select extension. Reversible.
- Deduplicate picker values by execution slug, prefer default entry, preserve catalog order for other values. Options: expose duplicate values or choose one entry. Decision 13 and CORE2 model contract select one. Reversible.
- Native canSendFollowUp denies busy state because sendMessageToSession starts a turn without queuing; legacy's unconditional query does not prove equivalent native capabilities. Reversible.
- Drain the existing event iterator after consumer return rather than clearing busy immediately or adding a second subscription/poll. It preserves terminal correlation and keeps no per-item timers. A failed drain closes the context. Reversible.
- Keep live-stats refusal because exact required resumed messageCount and lifetime totals are unavailable, despite newly available cacheCreation. Options: invent local counters vs explicit refusal. The task forbids estimates. Reversible when a real history contract exists.
- Follow the orchestrator's explicit SN1 decision: finish an already-started metadata save and retain the resumable row, then cancel before publication/turn and release context/scope/ownership. Options were rollback/cancellable persistence versus retaining the real saved row. The latter is approved and matches the existing post-save cancellation check; no new transaction contract is required. Reversible. The regression covers both cancellation entry points.
- Type-only NativeChatAdapter import is the smallest enforceable contract without moving ROUTING2-owned declarations or adding a runtime import. Reversible.
- Defer actual frontend replay to a frontend-capable lane. A copied fake accumulator would test invented behavior, not the real consumer.

## Absolute paths changed

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-events.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-approval-sink.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6g-adapter-report.md


## SN1 follow-up verification

Added the parameterized cancel-during-save regression to codex-chat-adapter.spec.ts and updated this report. Runtime source already enforces the clarified behavior. Live-stats refusal and field-by-field reasoning remain unchanged. The earlier one-run test budget is exhausted; no second test command was started. New spec execution remains for the coordinator's authoritative verification. Scoped diagnostics are recorded below after formatting.

Regression location: codex-chat-adapter.spec.ts:715.

Final follow-up ptah_get_diagnostics (changed spec):

> Source: typescript-compiler
> Errors: 0 | Warnings: 0 ? No issues found.
> Coverage: clean
> Shown 0 of 0 (0 in requested files, 0 in sibling files omitted)

Files written in this follow-up:

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6g-adapter-report.md

## Fix after team-leader verify

- Missing terminal (production): codex-chat-adapter.ts:467,511,549 now distinguishes an exhausted runtime iterator from consumer return(). Exhaustion releases busy synchronously in cleanup and keeps the session available for retry; consumer return while the server may still emit retains the drain and busy latch. Existing missing-terminal and consumer-return specs remain intact.
- Approval cancellation: inspection found the production sink already preserves internal abort/dispose presentation (codex-chat-approval-sink.ts:102-120), while router cancel deliberately settles without presenting. The failing adapter fixture supplied an unrelated router callback. codex-chat-adapter.spec.ts:121 now shares the presentation cancellation callback with the router; the original expectation is retained and :361 additionally asserts exactly one notification. No production sink change was warranted: emitting from router cancel would reintroduce the prohibited duplicate. Existing sink internal-abort/dispose and router-cancel specs remain intact.
- Lint: codex-chat-adapter.ts:474-475 stores the event iterable before accessing Symbol.asyncIterator, removing the ambiguous newline without disabling lint.
- Routing fixture: register.codex-runtime.spec.ts:133-135 supplies typed owns (false, so persisted identity decides), canSendFollowUp and listSessionModels implementations. Native rejection and absence of legacy retry remain the assertions.

Formatted the three changed TypeScript files with worktree Prettier.

Diagnostics requested for all three files; initial result and one cache retrieval both reported:

> Source: typescript-compiler — Unavailable
> Coverage: qualified — 3 files unchecked
> TypeScript check still running after 45s. It was not cancelled.

Exactly one verification run:

> npm run verify -- -t test,lint -p @ptah-extension/agent-sdk
> Initial foreground wait: 30 seconds; session_id: 34917; output: empty
> One completion check: 60 seconds; session_id: 34917; output: empty; exit_code: not returned

Verification is still running/queued; no pass is claimed. Output is filtered to its final 65 lines; the command also captures its output in the followup log below for the coordinator. No second test/lint run or further completion polling was performed. Known unrelated lint noise was not edited.

Absolute paths written in this follow-up:

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/register.codex-runtime.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6g-adapter-report.md
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6g-adapter-followup-verify.log (verification output artifact)

Decision: correct the approval fixture wiring rather than add a second production notification; this follows the router's explicit single-presentation ownership contract. Live-stats refusal and prior field-by-field reasoning remain unchanged.
