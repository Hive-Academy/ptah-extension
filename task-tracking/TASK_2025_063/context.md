# Task Context - TASK_2025_063

> **SUPERSEDED BY TASK_2025_097**
>
> This task has been superseded. The implementation approach described below was **INCORRECT**.
>
> **Why This Task Was Superseded:**
>
> - **INCORRECT Approach (this task)**: Auto-approve AskUserQuestion in `canUseTool`, then use a separate `SdkQuestionHandler` class to handle questions
> - **CORRECT Approach (TASK_2025_097)**: AskUserQuestion enters the `canUseTool` callback like any dangerous tool, prompts the user for answers, and returns answers in `updatedInput.answers` per SDK documentation
>
> **Key Differences:**
>
> 1. AskUserQuestion is NOT auto-approved - it requires user interaction via the `canUseTool` callback
> 2. There is no separate `SdkQuestionHandler` class - all handling is unified in `SdkPermissionHandler`
> 3. The response format uses `updatedInput.answers` to pass answers back to the SDK
>
> **See TASK_2025_097** for the correct implementation of:
>
> - Permission system UX improvements (race condition fix, collapsed badge UI)
> - AskUserQuestion tool handling via unified `canUseTool` callback
> - Timing diagnostics for permission flow
>
> ---

## User Intent

Properly implement SDK permission and user interaction system systematically, including:

1. Remove the 30-second permission timeout (should block until user responds, like native CLI)
2. Add custom input option to permission prompts (allow users to modify commands)
3. Implement AskUserQuestion tool handling (currently not handled at all)
4. Add user message injection capability for mid-stream responses

## Conversation Summary

### Research Findings

**Permission System:**

- Native Claude CLI blocks execution and waits indefinitely for user input - no timeout
- Our current implementation has 30-second timeout with auto-deny - this is incorrect
- SDK's `canUseTool` callback is designed to be asynchronous but blocking
- Users should be able to type custom responses or modify tool inputs

**AskUserQuestion Tool:**

- Added in Claude Code v2.0.21
- Purpose: Ask users clarifying questions to resolve ambiguity
- Does NOT require permission (communication tool, not dangerous action)
- Schema: `{ question: string }` → `{ answer: string }`
- Currently NOT handled at all - would show as generic tool, never collect user input

**Streaming User Input:**

- SDK supports injecting user messages via async generator during streaming
- Needed for: answering questions, providing context, course-correction

### Bugs Fixed During Investigation

1. Event name mismatch: Backend sent `'claude:permissionRequest'`, frontend expected `'permission:request'`
2. Field name mismatch: Backend used `requestId`, shared type expected `id`
3. Missing fields: Backend didn't send `description` and `timeoutAt` required by UI
4. Missing response handler: No backend handler for `'chat:permission-response'`
5. Event emitter not connected: `SdkPermissionHandler.setEventEmitter()` was never called

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-10
- Type: FEATURE
- Complexity: Complex (multiple modules, new UI patterns, streaming integration)

## Execution Strategy

FEATURE strategy with research already complete. Key phases:

1. Requirements (PM) - Define scope and acceptance criteria
2. Architecture (Architect) - Design permission/question handling patterns
3. Implementation (Team Leader + Developers) - Batch-based development
4. QA (Tester + Reviewers) - Validate behavior matches native CLI

## Related Files

### Backend (Permission Handler)

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` - Main permission logic
- `libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts` - Event emitter wiring
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` - Response routing

### Frontend (UI Components)

- `libs/frontend/chat/src/lib/components/molecules/permission-request-card.component.ts`
- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

### Shared Types

- `libs/shared/src/lib/types/permission.types.ts`
- `libs/shared/src/lib/types/execution-node.types.ts`

## Key Design Decisions Needed

1. Should permission prompts block the entire UI or allow scrolling/reading?
2. How to handle AskUserQuestion with multiple choice options vs free-form text?
3. Should "Always Allow" rules persist across sessions or be session-only?
4. How to visually distinguish AskUserQuestion from permission requests?
