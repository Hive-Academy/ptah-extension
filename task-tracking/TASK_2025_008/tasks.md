# Task Breakdown - TASK_2025_008

**Implementation Plan**: #file:./bugfix-implementation-plan.md
**Context**: #file:./context.md

---

## Task Summary

- **Total Tasks**: 9
- **Backend Tasks**: 3
- **Frontend Tasks**: 6
- **Integration Tasks**: 0 (Integrated into respective FE/BE tasks)

---

## Task List

### 1. Implement Message Deduplication (Frontend)

**Type**: FRONTEND
**Complexity**: Level 2
**Estimated Time**: 1 hour
**Status**: IN PROGRESS

**Description**:
Implement message and chunk deduplication in `ChatService` to prevent duplicate messages in the UI. Use a `Set` to track processed IDs.

**Files to Change**:

- `libs/frontend/core/src/lib/services/chat.service.ts` - Add `processedMessageIds` and `processedChunkIds` Sets, implement checks in `addMessage` and `onMessageChunk`.
- `libs/frontend/core/src/lib/services/chat-state.service.ts` - (If needed for state updates)

**Verification Criteria**:

- [ ] `processedMessageIds` Set exists and tracks IDs
- [ ] Duplicate messages are logged (warn) and ignored
- [ ] Duplicate chunks are logged (warn) and ignored
- [ ] Git commit created: `fix(chat): implement message deduplication to prevent UI ghosts`

**Dependencies**: None

---

### 2. Implement State Restoration Handler (Backend)

**Type**: BACKEND
**Complexity**: Level 2
**Estimated Time**: 1.5 hours
**Status**: PENDING

**Description**:
Implement the backend handler for `REQUEST_INITIAL_DATA`. It should gather current session, all sessions, and workspace info, then publish `INITIAL_DATA`.

**Files to Change**:

- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` - Subscribe to `REQUEST_INITIAL_DATA`, publish `INITIAL_DATA`.

**Verification Criteria**:

- [ ] Handler for `SYSTEM_MESSAGE_TYPES.REQUEST_INITIAL_DATA` exists
- [ ] Publishes `SYSTEM_MESSAGE_TYPES.INITIAL_DATA` with correct payload
- [ ] Git commit created: `fix(backend): add initial state restoration handler`

**Dependencies**: None

---

### 3. Implement State Restoration Request & Listener (Frontend)

**Type**: FRONTEND
**Complexity**: Level 2
**Estimated Time**: 1.5 hours
**Status**: PENDING

**Description**:
Request initial data on app init and restore state when data is received.

**Files to Change**:

- `apps/ptah-extension-webview/src/app/app.ts` - Send `REQUEST_INITIAL_DATA` in `ngOnInit`.
- `libs/frontend/core/src/lib/services/vscode.service.ts` - (Optional) Ensure message typing supports this.
- `libs/frontend/core/src/lib/services/chat.service.ts` - Listen for `INITIAL_DATA` and update `ChatState`.

**Verification Criteria**:

- [ ] `REQUEST_INITIAL_DATA` sent on init
- [ ] `INITIAL_DATA` listener updates `ChatState` (sessions, current session)
- [ ] Git commit created: `fix(webview): restore chat state on reload`

**Dependencies**: Task 2 (Backend must handle request for E2E, but can be implemented independently)

---

### 4. Implement Model Selection Logic & Types (Backend)

**Type**: BACKEND
**Complexity**: Level 2
**Estimated Time**: 1.5 hours
**Status**: PENDING

**Description**:
Add `SELECT_MODEL` message type and implement backend logic to persist model selection and update provider state.

**Files to Change**:

- `libs/shared/src/lib/constants/message-types.ts` - Add `PROVIDER_MESSAGE_TYPES.SELECT_MODEL`.
- `libs/shared/src/lib/types/message.types.ts` - Add `ProviderSelectModelPayload`.
- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` - Handle `SELECT_MODEL`.
- `libs/backend/claude-domain/src/provider/provider-orchestration.service.ts` - Implement `selectModel` with config persistence.

**Verification Criteria**:

- [ ] `SELECT_MODEL` message type defined
- [ ] Backend persists selection to config
- [ ] Backend updates current model state
- [ ] Git commit created: `fix(backend): implement model selection persistence`

**Dependencies**: None

---

### 5. Implement Model Selection UI Trigger (Frontend)

**Type**: FRONTEND
**Complexity**: Level 1
**Estimated Time**: 1 hour
**Status**: PENDING

**Description**:
Update `ChatComponent` to send `SELECT_MODEL` message when agent is changed.

**Files to Change**:

- `libs/frontend/chat/src/lib/containers/chat/chat.component.ts` - Update `onAgentChange` to post message.

**Verification Criteria**:

- [ ] `onAgentChange` sends `SELECT_MODEL` message
- [ ] Git commit created: `fix(chat): sync model selection with backend`

**Dependencies**: Task 4 (Needs message types)

---

### 6. Implement File Attachment UI (Frontend)

**Type**: FRONTEND
**Complexity**: Level 2
**Estimated Time**: 1.5 hours
**Status**: PENDING

**Description**:
Integrate `FileSuggestionsDropdownComponent` into `ChatInputAreaComponent`. Detect `@` mentions to show the dropdown.

**Files to Change**:

- `libs/frontend/chat/src/lib/components/chat-input/chat-input-area.component.ts` - Import dropdown, implement `@` detection logic.

**Verification Criteria**:

- [ ] `FileSuggestionsDropdownComponent` imported
- [ ] `@` triggers `showFileSuggestions` signal
- [ ] Git commit created: `fix(chat-input): add file attachment autocomplete`

**Dependencies**: None

---

### 7. Implement File Attachment Logic (Frontend)

**Type**: FRONTEND
**Complexity**: Level 2
**Estimated Time**: 1 hour
**Status**: PENDING

**Description**:
Pass selected files from input area to `ChatComponent` and then to `ChatService` to be included in the `sendMessage` payload.

**Files to Change**:

- `libs/frontend/chat/src/lib/containers/chat/chat.component.ts` - Pass files to `sendMessage`.
- `libs/frontend/core/src/lib/services/chat.service.ts` - Update `sendMessage` signature and payload.
- `libs/frontend/core/src/lib/services/chat-state.service.ts` - Add `selectedFiles` signal.

**Verification Criteria**:

- [ ] `sendMessage` payload includes `files` array
- [ ] `selectedFiles` signal tracks selection
- [ ] Git commit created: `fix(chat): send attached files to backend`

**Dependencies**: Task 6

---

### 8. Implement Analytics Service Persistence (Backend)

**Type**: BACKEND
**Complexity**: Level 2
**Estimated Time**: 1 hour
**Status**: PENDING

**Description**:
Ensure `AnalyticsOrchestrationService` persists data and can return it via `ANALYTICS_MESSAGE_TYPES.GET_DATA`.

**Files to Change**:

- `libs/backend/claude-domain/src/analytics/analytics-orchestration.service.ts` - Add persistence (if missing) and ensure data retrieval logic.

**Verification Criteria**:

- [ ] Analytics data persists across reloads
- [ ] Service returns correct data structure
- [ ] Git commit created: `fix(analytics): persist usage stats`

**Dependencies**: None

---

### 9. Implement Analytics UI & Service (Frontend)

**Type**: FRONTEND
**Complexity**: Level 2
**Estimated Time**: 1.5 hours
**Status**: PENDING

**Description**:
Fetch real analytics data on init and display it in `AnalyticsComponent`.

**Files to Change**:

- `libs/frontend/core/src/lib/services/analytics.service.ts` - Add `fetchAnalyticsData`.
- `libs/frontend/analytics/src/lib/containers/analytics/analytics.component.ts` - Call fetch on init, update signals.

**Verification Criteria**:

- [ ] `fetchAnalyticsData` calls backend
- [ ] UI displays real data (no hardcoded zeros)
- [ ] Git commit created: `fix(analytics): display real usage data`

**Dependencies**: Task 8

---

## Execution Order

1. Task 1 (Fix Duplication)
2. Task 2 -> Task 3 (Fix State Restoration)
3. Task 4 -> Task 5 (Fix Model Selection)
4. Task 6 -> Task 7 (Fix File Attachment)
5. Task 8 -> Task 9 (Fix Analytics)
