# Batch 1 report: Shared RPC contract

## Task 1.1: Carry-over params and result types

- Status: COMPLETE
- Evidence: Added `ChatCarryOverCheckParams`, `ChatCarryOverCheckResult`, `ChatCarryOverParams`, `ChatCarryOverFailureReason` and `ChatCarryOverResult`. The result types use the required discriminated unions. No transcript field or error-code extension was added.

## Task 1.2: Registry entries

- Status: COMPLETE
- Evidence: Added both method types to the chat type imports, `RpcMethodRegistry` and `RPC_METHOD_ENTRIES`, directly after `chat:continue`. Existing entries were not reordered. The replay sanitizer allow-list was not changed.

## Changed files

- `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
- `/home/amun/ptah-extension/.claude-worktrees/feat-provider-switch-carryover-9f3f79992765/libs/shared/src/lib/types/rpc.types.ts`

## Verification

Command: `npm run verify -- -p @ptah-extension/shared 2>&1 | tail -40`

Result: PENDING

## Decisions

None.
