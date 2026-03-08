# TASK_2025_136: AskUserQuestion Tool Fix - Implementation Summary

## Changes Made

### 1. Frontend Message Handler (vscode.service.ts)

**File**: `libs/frontend/core/src/lib/services/vscode.service.ts`

Added handler for `MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST`:

- Routes incoming question requests to `ChatStore.handleQuestionRequest()`
- Follows existing pattern used by `PERMISSION_REQUEST` handler

### 2. Backend Message Handler (webview-message-handler.service.ts)

**File**: `libs/backend/vscode-core/src/services/webview-message-handler.service.ts`

Added case and handler method for `MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE`:

- Routes user answers back to `SdkPermissionHandler.handleQuestionResponse()`
- Follows existing pattern used by `SDK_PERMISSION_RESPONSE` handler

### 3. ChatStore Bridge Methods (chat.store.ts)

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

Added:

- `handleQuestionRequest(request)` - delegates to PermissionHandlerService
- `handleQuestionResponse(response)` - delegates to PermissionHandlerService
- `questionRequests` signal - exposes PermissionHandlerService.questionRequests

### 4. Chat View UI (chat-view.component.ts/html)

**Files**:

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

Added:

- Import for `QuestionCardComponent`
- Added to imports array
- Template renders question cards when `questionRequests()` has items

## Message Flow (After Fix)

```
[BACKEND]                                      [FRONTEND]
    |                                               |
    | 1. SDK calls canUseTool("AskUserQuestion")   |
    |    - Creates Promise in pendingQuestionRequests |
    |                                               |
    | 2. ASK_USER_QUESTION_REQUEST --------------> |
    |    (via webviewManager.sendMessage)          |
    |                                               |
    |                              3. VSCodeService receives message
    |                                 Routes to ChatStore.handleQuestionRequest()
    |                                               |
    |                              4. PermissionHandlerService adds to
    |                                 _questionRequests signal
    |                                               |
    |                              5. QuestionCardComponent renders
    |                                 User sees questions and options
    |                                               |
    |                              6. User selects answers, clicks Submit
    |                                 QuestionCardComponent emits answered event
    |                                               |
    |                              7. ChatStore.handleQuestionResponse()
    |                                 PermissionHandlerService sends
    |                                 ASK_USER_QUESTION_RESPONSE
    |                                               |
    | <------- ASK_USER_QUESTION_RESPONSE -------- |
    |                                               |
    | 8. WebviewMessageHandlerService.handleAskUserQuestionResponse()
    |    Calls SdkPermissionHandler.handleQuestionResponse()
    |    Resolves pendingQuestionRequests Promise
    |                                               |
    | 9. canUseTool returns { behavior: 'allow', updatedInput: { answers } }
    |    SDK continues execution with user's answers
```

## Files Modified

| File                                                                       | Changes                                       |
| -------------------------------------------------------------------------- | --------------------------------------------- |
| `libs/frontend/core/src/lib/services/vscode.service.ts`                    | +15 lines (ASK_USER_QUESTION_REQUEST handler) |
| `libs/backend/vscode-core/src/services/webview-message-handler.service.ts` | +40 lines (case + handler method)             |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                        | +12 lines (signal + 2 bridge methods)         |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`   | +2 lines (import + imports array)             |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` | +8 lines (question card rendering)            |

## Verification

All typechecks pass:

- `nx run vscode-core:typecheck` ✓
- `nx run core:typecheck` ✓
- `nx run chat:typecheck` ✓

## Testing Checklist

1. [ ] Send a prompt that triggers `AskUserQuestion` (e.g., "Help me choose a framework")
2. [ ] Verify question UI appears in webview
3. [ ] Select an answer and click Submit
4. [ ] Verify backend receives response and resolves Promise
5. [ ] Verify agent continues with the selected answer
6. [ ] Test multi-select questions
7. [ ] Test timeout behavior (wait 5+ minutes without answering)

## Related Documentation

- Research findings: `task-tracking/TASK_2025_136/research-findings.md`
- SDK AskUserQuestion docs: https://platform.claude.com/docs/en/agent-sdk/user-input

## Date Completed

2026-02-03
