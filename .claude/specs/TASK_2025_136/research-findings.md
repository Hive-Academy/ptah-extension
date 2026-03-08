# Research Findings: AskUserQuestion Tool Broken in VS Code Extension

**Task ID**: TASK_2025_136
**Date**: 2026-02-03
**Researcher**: Claude Code (Researcher Expert Agent)
**Confidence Level**: 95% (verified through code analysis and documentation)

---

## Executive Summary

The AskUserQuestion tool is broken because **both message routing paths are missing**:

1. **Frontend does not handle `ASK_USER_QUESTION_REQUEST`** - the webview never receives the question
2. **Backend does not handle `ASK_USER_QUESTION_RESPONSE`** - even if user could answer, backend would never process it

The Promise in `SdkPermissionHandler.awaitQuestionResponse()` never resolves because no code path routes the frontend response back to resolve it.

---

## How AskUserQuestion SHOULD Work (Per SDK Documentation)

Based on official Claude Agent SDK documentation:

### 1. SDK Behavior

When Claude needs clarifying information, it calls the `AskUserQuestion` tool via the `canUseTool` callback:

```typescript
// SDK invokes canUseTool with toolName = "AskUserQuestion"
canUseTool: async (toolName, input) => {
  if (toolName === 'AskUserQuestion') {
    // Display questions to user, collect answers
    // Return updated input with answers populated
    return {
      behavior: 'allow',
      updatedInput: {
        questions: input.questions, // Original questions
        answers: {
          // User-selected answers
          'What framework do you prefer?': 'React',
          'Should I use TypeScript?': 'Yes',
        },
      },
    };
  }
};
```

### 2. Expected Input Format

```typescript
interface AskUserQuestionInput {
  questions: Array<{
    question: string; // "What framework do you prefer?"
    header: string; // "Framework" (max 12 chars)
    options: Array<{
      label: string; // "React"
      description: string; // "Modern component library"
    }>;
    multiSelect: boolean; // Can select multiple options?
  }>;
  answers?: Record<string, string>; // Populated by user
}
```

### 3. Expected Response Format

```typescript
return {
  behavior: 'allow',
  updatedInput: {
    questions: input.questions,
    answers: {
      [question.question]: selectedOption.label,
    },
  },
};
```

### 4. Key Requirements (From SDK Docs)

- Callback must return within **60 seconds** or Claude retries with different approach
- Must include original `questions` array in response
- Answers keyed by question text, values are option labels
- For multi-select: join labels with ", "

**Sources**:

- [Handle approvals and user input - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/user-input)
- [Agent SDK TypeScript Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [GitHub Issue #4775 - canUseTool callback hanging](https://github.com/anthropics/claude-code/issues/4775)

---

## How Our Implementation CURRENTLY Works

### Backend Flow (Working Correctly)

**File**: `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`

1. **SDK invokes `canUseTool` callback** with `toolName = "AskUserQuestion"` (line 334)
2. **Handler validates input** using `isAskUserQuestionToolInput()` type guard (line 627)
3. **Creates request with unique ID** (line 637)
4. **Sends to webview** via `webviewManager.sendMessage()` with type `MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST` (lines 658-675)
5. **Awaits response** via `awaitQuestionResponse()` Promise (line 678)
6. **If response received**: Returns `{ behavior: 'allow', updatedInput: { ...input, answers } }` (lines 699-706)
7. **If timeout**: Returns `{ behavior: 'deny', message: 'Question request timed out' }` (lines 683-691)

**Evidence from Log**:

```
[SdkPermissionHandler] canUseTool invoked: AskUserQuestion
[SdkPermissionHandler] Handling AskUserQuestion tool request
[SdkPermissionHandler] Sending AskUserQuestion request: {requestId: "perm_1770131243844_54ss5ct", questionCount: 1, toolUseId: "AskUserQuestion_0"}
[SdkPermissionHandler] AskUserQuestion request sent to webview: {requestId: "perm_1770131243844_54ss5ct"}
```

Backend correctly sends the request. No further logs appear because **no response ever comes back**.

### Frontend Flow (BROKEN - Missing Handler)

**File**: `libs/frontend/core/src/lib/services/vscode.service.ts`

The `setupMessageListener()` handles many message types:

- `MESSAGE_TYPES.RPC_RESPONSE` -> Routes to `ClaudeRpcService.handleResponse()` (line 243)
- `MESSAGE_TYPES.CHAT_CHUNK` -> Routes to `ChatStore.processStreamEvent()` (line 258)
- `MESSAGE_TYPES.PERMISSION_REQUEST` -> Routes to `ChatStore.handlePermissionRequest()` (line 325)

**CRITICAL GAP**: No handler exists for `MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST`:

```typescript
// This case DOES NOT EXIST in vscode.service.ts:
if (message.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST) {
  // MISSING - Would route to PermissionHandlerService.handleQuestionRequest()
}
```

**File**: `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`

The `handleQuestionRequest()` method exists (line 299) and is fully implemented, but **it is never called** because VSCodeService doesn't route the message to it.

### Response Flow (BROKEN - Missing Handler)

**File**: `libs/backend/vscode-core/src/services/webview-message-handler.service.ts`

The `handleMessage()` method handles:

- `MESSAGE_TYPES.SDK_PERMISSION_RESPONSE` -> Calls `SdkPermissionHandler.handleResponse()` (line 204)
- `MESSAGE_TYPES.MCP_PERMISSION_RESPONSE` -> Calls `PermissionPromptService.resolveRequest()` (line 200)

**CRITICAL GAP**: No handler exists for `MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE`:

```typescript
// This case DOES NOT EXIST in webview-message-handler.service.ts:
case MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE:
  // MISSING - Would call SdkPermissionHandler.handleQuestionResponse()
  break;
```

The `handleQuestionResponse()` method exists in `SdkPermissionHandler` (line 737) but **it is never called** because the backend message handler doesn't route the response to it.

---

## The Exact Gap/Bug Causing the Freeze

### Root Cause Analysis

```
[BACKEND]                              [WEBVIEW]
    |                                      |
    | 1. canUseTool("AskUserQuestion")     |
    |    - Creates Promise                 |
    |    - pendingQuestionRequests.set()   |
    |                                      |
    | 2. ASK_USER_QUESTION_REQUEST ------->|
    |    (sent via webviewManager)         |
    |                                      |
    |                                      | 3. Message arrives at VSCodeService
    |                                      |    setupMessageListener()
    |                                      |
    |                                      |    NO HANDLER FOR THIS MESSAGE TYPE!
    |                                      |    Message is DROPPED!
    |                                      |
    |    [Promise waiting forever...]      |    [No UI rendered]
    |                                      |
    | 4. After 5 minutes: timeout          |
    |    Returns { behavior: 'deny' }      |
```

### Two Missing Pieces

| Component                   | Location                                                                   | What's Missing                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend Message Router** | `libs/frontend/core/src/lib/services/vscode.service.ts`                    | Case for `MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST` that calls `ChatStore.handleQuestionRequest()` or `PermissionHandlerService.handleQuestionRequest()` |
| **Backend Message Router**  | `libs/backend/vscode-core/src/services/webview-message-handler.service.ts` | Case for `MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE` that calls `SdkPermissionHandler.handleQuestionResponse()`                                          |

### Why It Appears Frozen

1. Backend sends `ASK_USER_QUESTION_REQUEST` successfully (confirmed in log)
2. Frontend receives the message but VSCodeService has no handler for it
3. Message is silently dropped (logged as "Unhandled message type" at debug level)
4. No question UI ever renders
5. Backend Promise in `awaitQuestionResponse()` waits for response that never comes
6. After 5-minute timeout, returns `{ behavior: 'deny' }` which the agent sees as "timed out"
7. Agent may retry or give up, but user never saw the question

### Is Moonshot Provider Relevant?

**No.** The Moonshot (Kimi) provider is unrelated to this bug:

- The provider successfully sends requests to the Claude SDK
- The SDK correctly invokes `canUseTool("AskUserQuestion")`
- The backend correctly builds and sends the request to webview
- The bug is in the **message routing layer**, not the LLM provider

---

## Recommended Fix

### Fix 1: Add Frontend Message Handler (CRITICAL)

**File**: `libs/frontend/core/src/lib/services/vscode.service.ts`

Add handler in `setupMessageListener()`:

```typescript
// Handle AskUserQuestion request from SDK (TASK_2025_136)
if (message.type === MESSAGE_TYPES.ASK_USER_QUESTION_REQUEST) {
  console.log('[VSCodeService] AskUserQuestion request received:', message.payload);
  if (message.payload && this.chatStore) {
    // Route to PermissionHandlerService via ChatStore
    this.chatStore.handleQuestionRequest(message.payload);
  } else if (!message.payload) {
    console.warn('[VSCodeService] ask-user-question:request received but payload is undefined!');
  } else {
    console.warn('[VSCodeService] ask-user-question:request received but ChatStore not registered!');
  }
}
```

### Fix 2: Add Backend Message Handler (CRITICAL)

**File**: `libs/backend/vscode-core/src/services/webview-message-handler.service.ts`

Add case in `handleMessage()`:

```typescript
case MESSAGE_TYPES.ASK_USER_QUESTION_RESPONSE:
  await this.handleAskUserQuestionResponse(webviewId, message);
  return;
```

Add handler method:

```typescript
/**
 * Handle AskUserQuestion responses (SDK clarifying questions)
 *
 * TASK_2025_136: Routes user answers back to SdkPermissionHandler
 */
private async handleAskUserQuestionResponse(
  webviewId: string,
  message: any
): Promise<void> {
  try {
    const { container } = await import('tsyringe');
    const payload = message.payload;

    const SDK_PERMISSION_HANDLER = 'SdkPermissionHandler';
    if (container.isRegistered(SDK_PERMISSION_HANDLER)) {
      const permissionHandler = container.resolve<ISdkPermissionHandler>(
        SDK_PERMISSION_HANDLER
      );
      permissionHandler.handleQuestionResponse({
        id: payload.id,
        answers: payload.answers,
      });
      this.logger.info(`[${webviewId}] AskUserQuestion response processed`, {
        requestId: payload.id,
        answerCount: Object.keys(payload.answers || {}).length,
      });
    } else {
      this.logger.warn(`[${webviewId}] SdkPermissionHandler not registered`);
    }
  } catch (error) {
    this.logger.error(
      `[${webviewId}] Failed to process AskUserQuestion response`,
      error instanceof Error ? error : new Error(String(error))
    );
  }
}
```

### Fix 3: Add ChatStore Bridge Method

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

Ensure ChatStore has method that delegates to PermissionHandlerService:

```typescript
/**
 * Handle AskUserQuestion request from backend
 * Delegates to PermissionHandlerService
 */
handleQuestionRequest(request: AskUserQuestionRequest): void {
  this.permissionHandler.handleQuestionRequest(request);
}
```

### Fix 4: Add UI Component (If Missing)

Verify that `QuestionCardComponent` or similar exists and is rendered when `questionRequests()` signal has items.

**File**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`

Check for:

```html
@for (questionReq of questionRequests(); track questionReq.id) {
<ptah-question-card [request]="questionReq" (answered)="onQuestionAnswered($event)" />
}
```

---

## Testing Checklist

After implementing the fix:

1. [ ] Send a prompt that triggers `AskUserQuestion` (e.g., "Help me choose a tech stack")
2. [ ] Verify question UI appears in webview
3. [ ] Select an answer and click submit
4. [ ] Verify backend receives response and resolves Promise
5. [ ] Verify agent continues with the selected answer
6. [ ] Test timeout behavior (wait 5+ minutes without answering)
7. [ ] Test multi-select questions
8. [ ] Test free-text "Other" option

---

## Files to Modify

| File                                                                       | Change                                                    |
| -------------------------------------------------------------------------- | --------------------------------------------------------- |
| `libs/frontend/core/src/lib/services/vscode.service.ts`                    | Add `ASK_USER_QUESTION_REQUEST` handler                   |
| `libs/backend/vscode-core/src/services/webview-message-handler.service.ts` | Add `ASK_USER_QUESTION_RESPONSE` handler                  |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                        | Add `handleQuestionRequest()` bridge method (if missing)  |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`   | Render question cards when `questionRequests()` has items |

---

## Risk Assessment

| Risk                          | Probability | Impact | Mitigation                                                        |
| ----------------------------- | ----------- | ------ | ----------------------------------------------------------------- |
| Missing QuestionCardComponent | LOW         | HIGH   | Verify component exists before implementing handlers              |
| Type mismatch in payload      | MEDIUM      | MEDIUM | Use shared types from `@ptah-extension/shared`                    |
| Circular dependency           | LOW         | HIGH   | Use lazy import pattern (already used in webview-message-handler) |
| Timeout too short             | LOW         | MEDIUM | 5 minutes is generous; matches SDK's 60s recommendation           |

---

## Conclusion

The AskUserQuestion tool is broken due to **incomplete message routing** in both directions:

1. Frontend `VSCodeService.setupMessageListener()` doesn't route `ASK_USER_QUESTION_REQUEST` messages
2. Backend `WebviewMessageHandlerService.handleMessage()` doesn't route `ASK_USER_QUESTION_RESPONSE` messages

The fix requires adding two message handlers (one in frontend, one in backend) and verifying the UI component exists. The existing `PermissionHandlerService.handleQuestionRequest()` and `SdkPermissionHandler.handleQuestionResponse()` methods are correctly implemented - they just need to be wired up to the message routing layer.

**Estimated Fix Time**: 2-4 hours (including testing)
**Complexity**: LOW-MEDIUM (pattern already established for permission requests)
