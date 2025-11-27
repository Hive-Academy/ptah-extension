# Task Context for TASK_2025_018

## User Intent

Fix session message loading bug - previous sessions show no messages when clicked despite TASK_2025_014 completing successfully. Messages should load from `.jsonl` files when switching sessions.

## Conversation Summary - Critical Findings

### 1. **Complete Event Flow Analysis**

**Session Switch Flow** (from investigation):

```
User clicks session → SessionDropdownComponent.selectSession()
  ↓
ChatHeaderComponent.onSessionSelected() → ChatService.switchToSession()
  ↓
Frontend: Clears messages + posts SWITCH_SESSION message
  ↓
Backend: MessageHandlerService subscribes to SWITCH_SESSION
  ↓
ChatOrchestrationService.switchSession() calls SessionManager.switchSession()
  ↓
SessionManager.switchSession() → SessionProxy.getSessionMessages() (reads .jsonl)
  ↓
SessionManager emits SESSION_SWITCHED event with session data
  ↓
Frontend: ChatService receives SESSION_SWITCHED
  ↓
Frontend: Posts GET_HISTORY message
  ↓
Backend: ChatOrchestrationService.getHistory() → SessionProxy.getSessionMessages()
  ↓
Backend: publishResponse('chat:getHistory', result)
  ↓
Frontend: Listens to 'chat:getHistory:response' at chat.service.ts:746-810
  ↓
Frontend: updateMessages() called with messages from response
  ✅ EXPECTED: Messages displayed in UI
```

### 2. **Empty JSONL Files Issue**

From vscode-app-1763677356626.log:

```
SessionProxy: Skipping corrupt file 4c47afc3-a01b-4bb8-aca9-2b7ce4bb75ee.jsonl: Error: Failed to parse session file C:\Users\abdal\.claude\projects\d--projects-anubis-mcp\4c47afc3-a01b-4bb8-aca9-2b7ce4bb75ee.jsonl: File is empty
```

**Root Cause**: Multiple .jsonl files are empty (0 bytes), causing parsing errors and being skipped.

### 3. **Potential Issues Identified**

**Issue A: Empty JSONL Files**

- Symptom: Parsing errors for empty files
- Impact: Sessions exist but have no messages
- Location: jsonl-session-parser.ts:126 throws error for empty files
- Fix Needed: Gracefully handle empty files (return empty array instead of error)

**Issue B: Event Bridge Configuration**

- Symptom: Events may not reach frontend
- Verification Needed: Check WebviewMessageBridge forwards `chat:getHistory:response`
- Location: libs/backend/vscode-core/src/messaging/webview-message-bridge.ts
- Fix Needed: Ensure response events are in FORWARDED_EVENTS list

**Issue C: Frontend Event Listener**

- Symptom: Frontend may not process response correctly
- Verification Needed: Check toResponseType() helper works correctly
- Location: chat.service.ts:747 uses toResponseType(CHAT_MESSAGE_TYPES.GET_HISTORY)
- Fix Needed: Verify event type transformation

### 4. **Files Involved**

**Backend**:

- `libs/backend/claude-domain/src/session/jsonl-session-parser.ts` - Empty file handling
- `libs/backend/claude-domain/src/session/session-proxy.ts` - Session message retrieval
- `libs/backend/vscode-core/src/messaging/webview-message-bridge.ts` - Event forwarding
- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` - Response publishing

**Frontend**:

- `libs/frontend/core/src/lib/services/chat.service.ts` - Event listeners (lines 746-810)
- `libs/frontend/core/src/lib/utils/event-subscription-helpers.ts` - toResponseType() helper

## Technical Context

- **Branch**: feature/TASK_2025_018
- **Created**: 2025-11-23
- **Task Type**: BUGFIX
- **Complexity**: Medium (event flow debugging + empty file handling)
- **Estimated Duration**: 3-5 hours
- **Related Tasks**:
  - TASK_2025_014 (Session Storage Migration - COMPLETE) - Original implementation
  - TASK_2025_011 (Session Management Simplification - PLANNED) - Future improvements

## Key Constraints

1. **TASK_2025_014 Implementation Correct**: The backend reads .jsonl files correctly for non-empty files
2. **Event Flow Complete**: All event listeners and publishers exist
3. **No Breaking Changes**: Fix must not break existing working sessions
4. **Graceful Degradation**: Empty sessions should display empty state, not errors

## Execution Strategy

**BUGFIX Strategy** (per orchestration guidelines):

```
Phase 1: researcher-expert → Diagnose root cause(s) via code inspection and log analysis
         ↓
Phase 2a: team-leader MODE 1 (DECOMPOSITION) → Create tasks.md for bug fix steps
         ↓
Phase 2b: team-leader MODE 2 (ITERATIVE LOOP) → For each fix task:
         - Assigns task to appropriate developer (backend or frontend)
         - Developer implements fix, commits git
         - team-leader MODE 2 verifies (git + file + tests)
         - Repeat for next fix task
         ↓
Phase 2c: team-leader MODE 3 (COMPLETION) → Final verification
         ↓
         USER CHOICE ✋ (Ask: "tester, reviewer, both, or skip?")
         ↓
Phase 3: [USER CHOICE] senior-tester and/or code-reviewer
         ↓
Phase 4: USER handles git (branch, commit, push, PR)
         ↓
Phase 5: modernization-detector → Creates future-enhancements.md, updates registry
```

## Success Criteria

1. ✅ Empty .jsonl files handled gracefully (no errors)
2. ✅ Session switching loads messages correctly for non-empty sessions
3. ✅ Empty sessions display empty state in UI
4. ✅ Event flow verified: SWITCH_SESSION → SESSION_SWITCHED → GET_HISTORY → response → UI update
5. ✅ No regressions in existing session functionality
6. ✅ All existing tests pass

## Risk Assessment

**Low Risk**:

- Empty file handling is isolated change
- Event flow already works (just needs verification/debugging)

**Medium Risk**:

- Event bridge configuration may need updates
- Frontend event listener may have subtle issues

**Mitigation**:

- Test with both empty and non-empty sessions
- Verify event flow with debug logging
- Regression test existing sessions
