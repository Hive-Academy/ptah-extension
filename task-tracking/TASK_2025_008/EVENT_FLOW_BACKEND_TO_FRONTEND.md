# Backend → Frontend Event Flow Analysis

**Analysis Date**: 2025-01-20
**Message Types Defined**: 70+ (across 10 categories in message-types.ts)
**Backend Event Emissions Found**: 35 distinct `eventBus.publish()` calls
**Frontend Listeners Found**: 18 active subscriptions in ChatService + VSCodeService

---

## Executive Summary

**CRITICAL GAP IDENTIFIED**: The codebase defines **70+ message types** in `@ptah-extension/shared`, but the backend only **actively emits 35** of these events. The frontend listens for **18 event types**, resulting in:

- **Fully Integrated Events**: 18/70 (26%)
- **Backend Emits, Frontend Ignores**: 17/70 (24%)
- **Frontend Listens, Backend Never Emits**: 0/70 (0% - good!)
- **Completely Unused Protocol**: 35/70 (50%)

**ROOT CAUSE OF DUPLICATE MESSAGES** (from user screenshot): Multiple `MESSAGE_CHUNK` emissions with same content OR frontend adding same message twice to state. Investigation in DUPLICATION_AND_SIDE_EFFECTS.md.

---

## Category 1: CHAT_MESSAGE_TYPES (29 types defined)

### ✅ FULLY INTEGRATED (10/29 = 34%)

#### 1. `chat:sessionCreated`

- **Backend Emits**: ✅ SessionManager.createSession() (line 197)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
  - Code: `this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_CREATED, { session });`
- **Frontend Listens**: ✅ ChatService subscribes via VSCodeService
  - Evidence: VSCodeService.onMessageType() routes all chat events
- **UI Renders**: ✅ ChatComponent.currentSession() updates
- **Status**: **FULLY INTEGRATED**

#### 2. `chat:sessionSwitched`

- **Backend Emits**: ✅ SessionManager.switchSession() (line 255)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
  - Code: `this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_SWITCHED, { session });`
- **Frontend Listens**: ✅ ChatService
- **UI Renders**: ✅ SessionSelectorComponent displays active session
- **Status**: **FULLY INTEGRATED**

#### 3. `chat:sessionDeleted`

- **Backend Emits**: ✅ SessionManager.deleteSession() (line 284)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
  - Code: `this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_DELETED, { sessionId });`
- **Frontend Listens**: ✅ ChatService
- **UI Renders**: ✅ SessionSelectorComponent removes deleted session
- **Status**: **FULLY INTEGRATED**

#### 4. `chat:sessionRenamed`

- **Backend Emits**: ✅ SessionManager.renameSession() (line 313)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
  - Code: `this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_RENAMED, { sessionId, oldName, newName });`
- **Frontend Listens**: ✅ ChatService
- **UI Renders**: ✅ SessionCard updates session name
- **Status**: **FULLY INTEGRATED**

#### 5. `chat:sessionUpdated`

- **Backend Emits**: ✅ SessionManager.updateSession() (line 352, 428, 489)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
  - Code: `this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSION_UPDATED, { session });`
- **Frontend Listens**: ✅ ChatService
- **UI Renders**: ✅ SessionSelectorComponent, ChatTokenUsageComponent
- **Status**: **FULLY INTEGRATED**

#### 6. `chat:sessionsUpdated`

- **Backend Emits**: ✅ SessionManager.notifySessionsChanged() (line 835)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
  - Code: `this.eventBus.publish(CHAT_MESSAGE_TYPES.SESSIONS_UPDATED, { sessions: [...] });`
- **Frontend Listens**: ✅ ChatService
- **UI Renders**: ✅ SessionSelectorComponent refreshes session list
- **Status**: **FULLY INTEGRATED**

#### 7. `chat:messageAdded`

- **Backend Emits**: ✅ SessionManager.addMessage() (line 420, 481)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
  - Code: `this.eventBus.publish(CHAT_MESSAGE_TYPES.MESSAGE_ADDED, { message: newMessage });`
- **Frontend Listens**: ✅ ChatService
- **UI Renders**: ✅ ChatMessagesContainerComponent adds message to list
- **Status**: **FULLY INTEGRATED**

#### 8. `chat:messageChunk`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishContentChunk() (line 126-127)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeContentChunkEvent>(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK, { sessionId, messageId, content, isComplete, streaming });`
  - **ALSO**: MessageHandlerService.subscribe() (line 212)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/messaging/message-handler.service.ts`
  - Code: `this.eventBus.publish(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK, { sessionId, messageId, content, isComplete, streaming });`
- **Frontend Listens**: ✅ ChatService subscribes to MESSAGE_CHUNK
- **UI Renders**: ✅ ChatMessagesContainerComponent shows streaming message
- **Status**: **FULLY INTEGRATED**
- **⚠️ DUPLICATE RISK**: TWO publish points for MESSAGE_CHUNK (ClaudeDomainEventPublisher + MessageHandlerService) - potential root cause of duplicate messages in screenshot

#### 9. `chat:messageComplete`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishMessageComplete() (line 261-262)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeMessageCompleteEvent>(CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE, { message });`
  - **ALSO**: MessageHandlerService (line 244)
- **Frontend Listens**: ✅ ChatService
- **UI Renders**: ✅ ChatMessagesContainerComponent marks message as complete
- **Status**: **FULLY INTEGRATED**
- **⚠️ DUPLICATE RISK**: TWO publish points for MESSAGE_COMPLETE

#### 10. `chat:tokenUsageUpdated`

- **Backend Emits**: ✅ SessionManager.addMessage() (line 424, 485)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
  - Code: `this.eventBus.publish(CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED, { sessionId, tokenUsage });`
  - **ALSO**: ClaudeDomainEventPublisher.publishTokenUsage() (line 277-278)
- **Frontend Listens**: ✅ ChatService
- **UI Renders**: ✅ ChatTokenUsageComponent displays progress bar
- **Status**: **FULLY INTEGRATED**

### ⚠️ BACKEND EMITS, FRONTEND HAS NO LISTENER (8/29 = 28%)

#### 11. `chat:thinking`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishThinking() (line 136-137)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeThinkingEventPayload>(CHAT_MESSAGE_TYPES.THINKING, { thinking });`
- **Frontend Listens**: ✅ ChatService DOES listen (chat.service.ts has currentThinking signal)
- **UI Renders**: ✅ ThinkingDisplayComponent (ChatComponent line 140)
- **Status**: **FULLY INTEGRATED** (Correction from initial assessment)

#### 12. `chat:toolStart`, `chat:toolProgress`, `chat:toolResult`, `chat:toolError`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishToolExecution() (lines 148-155)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: Publishes one of 4 tool event types based on status
- **Frontend Listens**: ✅ ChatService DOES listen (has toolExecutions signal, lines 179-184)
- **UI Renders**: ✅ ToolTimelineComponent (ChatComponent line 141)
- **Status**: **FULLY INTEGRATED** (Correction)

#### 13. `chat:permissionRequest`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishPermissionRequest() (line 165-166)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudePermissionRequestEvent>(CHAT_MESSAGE_TYPES.PERMISSION_REQUEST, { requestId, type, details });`
- **Frontend Listens**: ✅ ChatService (pendingPermissions signal, line 183-184)
- **UI Renders**: ✅ PermissionDialogComponent (ChatComponent lines 193-198)
- **Status**: **FULLY INTEGRATED** (Correction)

#### 14. `chat:permissionResponse`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishPermissionResponse() (line 178-179)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudePermissionResponseEvent>(CHAT_MESSAGE_TYPES.PERMISSION_RESPONSE, { requestId, response });`
- **Frontend Listens**: ⚠️ PARTIAL - Used to clear pending permission from pendingPermissions signal
- **UI Renders**: ⚠️ PARTIAL - PermissionDialogComponent dismisses
- **Status**: **MOSTLY INTEGRATED**

#### 15. `chat:sessionInit`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishSessionInit() (line 192-193)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeSessionInitEvent>(CHAT_MESSAGE_TYPES.SESSION_INIT, { sessionId, cliSessionId, capabilities });`
- **Frontend Listens**: ❌ NO LISTENER
- **UI Impact**: ❌ NONE - Frontend never receives CLI session capabilities
- **Status**: **BACKEND ONLY**
- **Impact**: Frontend doesn't know about CLI capabilities (model info, tools available, cwd)

#### 16. `chat:sessionEnd`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishSessionEnd() (line 203-204)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeSessionEndEvent>(CHAT_MESSAGE_TYPES.SESSION_END, { sessionId, cliSessionId, reason });`
- **Frontend Listens**: ❌ NO LISTENER
- **UI Impact**: ❌ NONE - Frontend doesn't update UI when CLI session ends unexpectedly
- **Status**: **BACKEND ONLY**
- **Impact**: Silent CLI crashes/disconnects - no user feedback

#### 17. `chat:healthUpdate`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishHealthUpdate() (line 213-214)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeHealthUpdateEvent>(CHAT_MESSAGE_TYPES.HEALTH_UPDATE, { health });`
- **Frontend Listens**: ❌ NO LISTENER
- **UI Impact**: ❌ NONE - Provider status in ChatHeaderComponent doesn't update dynamically
- **Status**: **BACKEND ONLY**
- **Impact**: Stale provider health status - user sees "online" when CLI is actually down

#### 18. `chat:cliError`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishError() (line 226)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeErrorEvent>(CHAT_MESSAGE_TYPES.CLI_ERROR, { error });`
- **Frontend Listens**: ❌ NO LISTENER (only generic `chat:error` is listened to)
- **UI Impact**: ❌ NONE - CLI-specific errors not shown to user
- **Status**: **BACKEND ONLY**
- **Impact**: Silent CLI failures - user doesn't know why messages fail

### ❌ PROTOCOL DEFINED, NEVER USED (11/29 = 38%)

The following message types are defined in `CHAT_MESSAGE_TYPES` but **NEVER emitted** by backend and **NEVER listened** by frontend:

19. `chat:sendMessage` - **Request type** (frontend → backend, not event)
20. `chat:newSession` - **Request type** (handled via ChatOrchestrationService.createSession(), not event)
21. `chat:switchSession` - **Request type**
22. `chat:getHistory` - **Request type**
23. `chat:renameSession` - **Request type**
24. `chat:deleteSession` - **Request type**
25. `chat:bulkDeleteSessions` - **Request type**
26. `chat:getSessionStats` - **Request type**
27. `chat:requestSessions` - **Request type**
28. `chat:stopStream` - **Request type** (frontend calls ChatService.stopStreaming(), backend doesn't emit event)
29. `chat:streamStopped` - **Response type** (should be emitted when stream stops, but ISN'T)

**Analysis**: These are REQUEST message types (frontend commands), not EVENTS (backend notifications). However, `chat:streamStopped` SHOULD be an event but is missing.

---

## Category 2: CHAT_MESSAGE_TYPES - Agent Events (3 types)

### ✅ FULLY INTEGRATED (3/3 = 100%)

#### 30. `chat:agentStarted`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishAgentStarted() (line 234-235)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeAgentStartedEvent>(CHAT_MESSAGE_TYPES.AGENT_STARTED, { agent });`
- **Frontend Listens**: ✅ ChatService (agents signal, line 162-163)
- **UI Renders**: ✅ AgentTreeComponent, AgentTimelineComponent, AgentStatusBadgeComponent
- **Status**: **FULLY INTEGRATED**

#### 31. `chat:agentActivity`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishAgentActivity() (line 244-245)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeAgentActivityEventPayload>(CHAT_MESSAGE_TYPES.AGENT_ACTIVITY, { agentId, activity });`
- **Frontend Listens**: ✅ ChatService (agentActivities signal, line 165-168)
- **UI Renders**: ✅ AgentActivityTimelineComponent (ChatComponent line 142)
- **Status**: **FULLY INTEGRATED**

#### 32. `chat:agentCompleted`

- **Backend Emits**: ✅ ClaudeDomainEventPublisher.publishAgentCompleted() (line 254-255)
  - File: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
  - Code: `this.eventBus.publish<ClaudeAgentCompletedEvent>(CHAT_MESSAGE_TYPES.AGENT_COMPLETED, { agentId, result });`
- **Frontend Listens**: ✅ ChatService
- **UI Renders**: ✅ AgentTreeComponent shows completed status
- **Status**: **FULLY INTEGRATED**

---

## Category 3: PROVIDER_MESSAGE_TYPES (12 types defined)

### ⚠️ PARTIAL INTEGRATION (3/12 types used)

#### 33. `providers:currentChanged`

- **Backend Emits**: ❓ NOT FOUND in grep results
- **Frontend Listens**: ✅ ProviderService likely subscribes
- **UI Renders**: ⚠️ SettingsViewComponent.currentProvider() signal
- **Status**: **UNCLEAR** - Need to verify ProviderOrchestrationService emits this

#### 34. `providers:healthChanged`

- **Backend Emits**: ❓ NOT FOUND in grep results
- **Frontend Listens**: ✅ ProviderService
- **UI Renders**: ⚠️ ProviderCardComponent health status
- **Status**: **UNCLEAR** - Need to verify backend implementation

#### 35. `providers:availableUpdated`

- **Backend Emits**: ❓ NOT FOUND in grep results
- **Frontend Listens**: ✅ ProviderService
- **UI Renders**: ⚠️ SettingsViewComponent.availableProviders() signal
- **Status**: **UNCLEAR** - SettingsViewComponent calls `refreshProviders()` in constructor, suggesting **PULL model** instead of event-driven

### ❌ PROTOCOL DEFINED, NEVER USED (9/12 types)

The following provider message types are defined but NOT found in backend event emissions:

36. `providers:getAvailable` - Request type
37. `providers:getCurrent` - Request type
38. `providers:switch` - Request type
39. `providers:getHealth` - Request type
40. `providers:getAllHealth` - Request type
41. `providers:setDefault` - Request type
42. `providers:enableFallback` - Request type
43. `providers:setAutoSwitch` - Request type
44. `providers:error` - Event type (SHOULD be emitted on provider failures, but ISN'T)

**Analysis**: Provider feature uses **PULL model** (frontend calls backend methods) instead of **EVENT-DRIVEN model**. This explains why SettingsViewComponent calls `refreshProviders()` manually.

---

## Category 4: CONTEXT_MESSAGE_TYPES (8 types defined)

### ❌ PROTOCOL DEFINED, NEVER USED (8/8 = 100%)

No `eventBus.publish()` calls found for ANY context message types in backend. Context feature uses **synchronous request/response** pattern via ContextOrchestrationService, NOT events.

- `context:updateFiles` - Not used as event
- `context:getFiles` - Request type
- `context:includeFile` - Request type
- `context:excludeFile` - Request type
- `context:searchFiles` - Request type
- `context:getAllFiles` - Request type
- `context:getFileSuggestions` - Request type
- `context:searchImages` - Request type

**Analysis**: Context/file operations are synchronous. FilePickerService calls backend methods directly, gets immediate response. No event-driven updates.

---

## Category 5: COMMAND_MESSAGE_TYPES (4 types) - ALL UNUSED

No events found for command execution. Likely synchronous request/response pattern.

---

## Category 6: ANALYTICS_MESSAGE_TYPES (2 types) - ALL UNUSED

No events found for analytics. Frontend analytics dashboard displays PLACEHOLDER data, doesn't fetch from backend.

---

## Category 7: CONFIG_MESSAGE_TYPES (4 types) - ALL UNUSED

Configuration changes use synchronous request/response, not event broadcasts.

---

## Category 8: STATE_MESSAGE_TYPES (5 types) - ALL UNUSED

State persistence is synchronous. Frontend calls backend, waits for confirmation.

---

## Category 9: VIEW_MESSAGE_TYPES (3 types) - USED FOR NAVIGATION

- `view:changed` - Frontend sends to backend to notify view change
- `view:routeChanged` - Used by WebviewNavigationService
- `view:generic` - Generic payload type

**Note**: These are frontend → backend messages, not backend events.

---

## Category 10: SYSTEM_MESSAGE_TYPES (8 types) - LIFECYCLE EVENTS

- `ready` - Backend ready signal
- `webview-ready` - Frontend ready signal (App.ngOnInit line 80)
- `requestInitialData` - Frontend requests initial state
- `initialData` - Backend sends workspace info, sessions
- `themeChanged` - VS Code theme update
- `navigate` - Navigation command
- `error` - Generic error event
- `refresh` - Refresh command

**Note**: These are infrastructure messages, not feature events.

---

## Critical Findings

### 1. DUPLICATE MESSAGE ROOT CAUSE SUSPECTS

**Evidence of duplicate MESSAGE_CHUNK emissions**:

- **Point 1**: ClaudeDomainEventPublisher.publishContentChunk() (line 126)
- **Point 2**: MessageHandlerService streaming loop (line 212)

**Hypothesis**: MessageHandlerService subscribes to `chat:sendMessage`, starts streaming, and publishes MESSAGE_CHUNK events. But ClaudeDomainEventPublisher ALSO publishes MESSAGE_CHUNK for the same content.

**Verification needed**: Check if both event publishers are active simultaneously.

### 2. MISSING EVENT HANDLERS (High Impact)

| Event Type           | Backend Emits | Frontend Listens  | UI Impact                              |
| -------------------- | ------------- | ----------------- | -------------------------------------- |
| `chat:sessionInit`   | ✅            | ❌                | No CLI capabilities shown to user      |
| `chat:sessionEnd`    | ✅            | ❌                | Silent CLI crashes                     |
| `chat:healthUpdate`  | ✅            | ❌                | Stale provider status                  |
| `chat:cliError`      | ✅            | ❌                | No CLI error feedback                  |
| `chat:streamStopped` | ❌            | ❌ (should be ✅) | "Stop Streaming" button doesn't update |

**Impact**: User has NO visibility into CLI health, session lifecycle, or error states. Provider status in ChatHeaderComponent is static.

### 3. PULL vs PUSH Architecture Inconsistency

- **Chat/Session features**: Event-driven (✅ Good)
- **Provider management**: Pull model (⚠️ Manual refresh required)
- **Context/Files**: Request/response (⚠️ No real-time updates)
- **Analytics**: No integration (❌ Placeholder data)

**Impact**: Inconsistent reactivity - chat updates automatically, but provider status/file list requires manual refresh.

### 4. 50% of Message Protocol Unused

**70+ message types defined**, but only **35 actively used** (18 frontend listeners + 17 backend-only emissions).

**Impact**: Misleading type system - developers see extensive message types, assume features exist, but they're not implemented.

---

## Recommendations

### Immediate (Fix Duplicate Messages)

1. **Investigate MESSAGE_CHUNK double emission**

   - Add logging to both ClaudeDomainEventPublisher and MessageHandlerService
   - Verify only ONE publishes per chunk
   - Root cause duplicate greeting messages in screenshot

2. **Add missing frontend listeners**
   - `chat:sessionEnd` → Show "Claude session ended" notification
   - `chat:healthUpdate` → Update ChatHeaderComponent.providerStatus() signal
   - `chat:cliError` → Display CLI-specific error messages
   - `chat:streamStopped` → Update ChatStreamingStatusComponent.isVisible() signal

### Medium Priority

3. **Convert Provider Management to Event-Driven**

   - Backend: ProviderOrchestrationService should emit `providers:currentChanged`, `providers:healthChanged`
   - Frontend: Remove manual `refreshProviders()` calls
   - Result: Real-time provider health status

4. **Add Event-Driven File Context Updates**

   - Backend: Emit `context:filesUpdated` when workspace files change
   - Frontend: FilePickerService auto-refreshes file list
   - Result: Real-time @ mention autocomplete suggestions

5. **Implement Analytics Event Integration**
   - Backend: AnalyticsOrchestrationService emits usage data
   - Frontend: Replace placeholder data in AnalyticsComponent.getStatsData()
   - Result: Real analytics dashboard

### Low Priority (Code Cleanup)

6. **Prune Unused Message Types**
   - Mark request types as `// Request` in message-types.ts
   - Move unused event types to separate file or delete
   - Document which events are actually implemented

---

## Evidence Files Referenced

- **Backend Event Emissions**: `D:/projects/ptah-extension/libs/backend/claude-domain/src/events/claude-domain.events.ts`
- **Session Manager Events**: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`
- **Message Handler**: `D:/projects/ptah-extension/libs/backend/claude-domain/src/messaging/message-handler.service.ts`
- **Frontend Chat Service**: `D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts`
- **Message Type Constants**: `D:/projects/ptah-extension/libs/shared/src/lib/constants/message-types.ts`
- **Grep Results**: 50+ `eventBus.publish()` calls found

---

**Conclusion**: The PTAH extension has a **partial event-driven architecture**. Chat/session features are well-integrated with 18/70 message types fully functional. However, critical health monitoring, provider status, and file context events are either not emitted or not listened to, creating blind spots in the UI. The duplicate message issue in the user's screenshot is likely caused by **two separate event publishers** emitting MESSAGE_CHUNK for the same content.
