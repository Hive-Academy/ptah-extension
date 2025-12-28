# Task Context - TASK_2025_037

## User Intent

Fix critical logic failures discovered in TASK_2025_034 (Permission UI Embedding) by the code-logic-reviewer. The permission embedding feature has fundamental issues that prevent it from working correctly in production.

## Problem Summary

The code-logic-reviewer identified 3 critical issues in TASK_2025_034:

### Critical Issue #1: ID Mismatch Logic

- `permissionRequestsByToolId` indexes by `toolUseId` (from MCP server)
- `getPermissionForTool()` looks up by `toolCallId` (from JsonlProcessor)
- These are set from **different code paths** with no guarantee they match
- If they don't match → permission card never displays

### Critical Issue #2: Race Condition

- Permission may arrive BEFORE tool node exists in execution tree
- Current lookup is one-time at render, not reactive
- If permission arrives early, it won't be found when tool renders

### Critical Issue #3: No Fallback Display

- Batch 4 of TASK_2025_034 removed the fixed permission cards
- No fallback exists for unmatched permissions
- Combined with #1 and #2, permissions become **invisible**

## Technical Context

- Branch: ak/fix-chat-streaming (continuing from TASK_2025_034 work)
- Created: 2025-12-01
- Type: BUGFIX
- Complexity: Medium (3-4 hours)
- Parent Task: TASK_2025_034

## Root Cause Analysis

From TASK_2025_034's context.md:

> Both are set from different code paths:
>
> - toolCallId: Set in JsonlMessageProcessor when tool starts
> - toolUseId: Set by MCP server in permission:request message

The implementation assumed these IDs would match without verification.

## Execution Strategy

BUGFIX workflow (streamlined):

1. Team-leader decomposes with plan validation
2. Developer implements fixes
3. Reviewers verify fixes address all issues
4. QA testing

## Success Criteria

1. Permission cards display inside tool cards that request them
2. Fallback display exists for any unmatched permissions
3. Race condition handled via reactive lookup
4. Debug logging helps troubleshoot ID correlation issues
5. All 3 critical issues from code-logic-review resolved

## Files to Modify

1. `libs/frontend/chat/src/lib/services/chat.store.ts` - Fix ID correlation, add fallback computed
2. `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` - Restore fallback display
3. `libs/frontend/chat/src/lib/components/organisms/execution-node.component.ts` - Reactive lookup

## Reference Documents

- TASK_2025_034/code-logic-review.md - Full analysis of issues
- TASK_2025_034/implementation-plan.md - Original design (has flaws)
- TASK_2025_034/context.md - Original requirements
