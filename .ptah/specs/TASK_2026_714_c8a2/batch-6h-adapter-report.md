# Batch 6h — ADAPTER3

## Status

- N1 / FM-1: implemented. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:208 reserves the pending resume by both tab and thread id, rejects overlapping resumes with the existing coded busy error, and removes both aliases on completion. The synchronous publication guard at :230 rechecks session ownership after metadata save; the existing catch closes the losing context and scope. Regression coverage in D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:601 (overlapping resumes), :628 (publication race and losing scope cleanup), and :665 (end/interrupt by pending resume thread id).
- N2 / FM-2 consumer: implemented. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:436 uses only CodexReportedUsage.lastRequestTotalTokens. Missing occupancy retains the existing honest refusal to emit the compaction-start callback. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:548 covers a multi-request turn total of 13 with last-request occupancy 7, and missing occupancy with a known turn total. The concurrent CORE3 contract is consumed directly; no runtime files changed.
- m-a / FM-4: implemented. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts:686 returns true when Stop is queued before the receipt. D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:756 checks that acknowledgment and subsequent native interrupt with the received turn id.

## Verification

Prettier completed for both changed files.

Scoped ptah_get_diagnostics:
> Source: typescript-compiler
> No diagnostics in the requested files.
> Sibling file codex-runtime-composition.ts:63 — error 2345: Argument of type '"partial-native-binding"' is not assignable to parameter of type 'CodexRuntimeCompositionErrorCode'.

That sibling belongs to WIRING3; it was not edited.

The single permitted test run is in progress:
> npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="codex-chat-"

## Decisions

- Reject overlapping pending resumes with CodexChatAdapterError('busy', 'open') instead of joining their streams. The existing adapter already uses busy for concurrent opens, and joining would require stream ownership and fan-out semantics. Reserving both aliases rejects before acquiring a second scope; the post-save guard cleans up any context that still loses a publication race. Reversible.
- Apply the queued Stop boolean fix to interruptCurrentTurn, the existing boolean Stop operation. The task's mention of interruptSession returning true conflicts with its actual Promise<void> close-session contract; changing that method would alter unrelated lifecycle behavior. Existing pre-receipt Stop regression and the review's pendingInterrupt finding identify interruptCurrentTurn unambiguously. Reversible.
- Keep codex-chat-events.ts and its spec unchanged: occupancy is consumed by the adapter's compaction callback; the event projection needs no changes.

## Files written

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/.ptah/specs/TASK_2026_714_c8a2/batch-6h-adapter-report.md

No git operations, live tests, host edits, or edits outside assigned ownership.

