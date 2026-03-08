# Requirements Document - TASK_2025_050: Frontend SDK Integration

## Introduction

This task completes the frontend integration with the new SDK-based backend by adding UI controls for session interruption and updating existing model/permission services to route through SDK methods instead of CLI-based RPC handlers.

**Business Value**: Enables users to control AI sessions in real-time (stop, switch models, toggle autopilot) with the new 10x faster SDK backend, completing the migration from CLI-based architecture.

**Prerequisites Completed**:

- TASK_2025_049: SDK critical fixes (race conditions, message queue) ✅
- TASK_2025_051: SDK backend wiring (RPC handlers connected) ✅

## Task Classification

- **Type**: FEATURE
- **Priority**: P1-High (blocks SDK migration completion)
- **Complexity**: Medium
- **Estimated Effort**: 4-6 hours

## Workflow Dependencies

- **Research Needed**: No (SDK methods already documented in TASK_2025_049)
- **UI/UX Design Needed**: No (stop button uses existing DaisyUI patterns)

---

## Requirements

### Requirement 1: Stop Button UI

**User Story**: As a user chatting with Claude using the SDK backend, I want a stop button visible during streaming, so that I can interrupt long-running operations immediately.

#### Acceptance Criteria

1. WHEN `isStreaming()` is true THEN stop button SHALL be visible in chat view header area
2. WHEN user clicks stop button THEN `chatStore.abortCurrentMessage()` SHALL be called immediately
3. WHEN stop is in progress (`isStopping()` is true) THEN button SHALL show loading state and be disabled
4. WHEN streaming ends THEN stop button SHALL be hidden within 100ms
5. WHEN stop button is visible THEN button SHALL be styled with DaisyUI `btn btn-ghost btn-sm` with stop icon

#### Technical Specification

**File**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

**UI Design**:

```html
<!-- Stop button - visible only during streaming -->
@if (chatStore.isStreaming()) {
<button class="btn btn-ghost btn-sm" [disabled]="chatStore.isStopping()" (click)="chatStore.abortCurrentMessage()" title="Stop generation">
  @if (chatStore.isStopping()) {
  <span class="loading loading-spinner loading-xs"></span>
  } @else {
  <svg class="w-4 h-4" ...><!-- Stop icon --></svg>
  } Stop
</button>
}
```

---

### Requirement 2: SDK Detection in ChatStore

**User Story**: As a developer integrating SDK, I want `ChatStore.abortCurrentMessage()` to detect if the current session is SDK-based, so that it routes to the correct backend method (SDK interrupt vs CLI abort).

#### Acceptance Criteria

1. WHEN `abortCurrentMessage()` is called AND session is SDK-based THEN abort SHALL route to SDK interrupt RPC
2. WHEN abort is called THEN existing queue handling logic SHALL be preserved
3. WHEN abort fails THEN error SHALL be logged with context (SDK vs CLI)
4. WHEN session type is unknown THEN abort SHALL fall back to `chat:abort` RPC

#### Technical Specification

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

**Changes**:

- Add private signal `_isCurrentSessionSdk = signal(false)`
- Add method `isCurrentSessionSdk(): boolean` as computed from session metadata
- Update `abortCurrentMessage()` to check session type before RPC call
- The backend RPC handler (`chat:abort`) already routes correctly via TASK_2025_051

> **Note**: Since TASK_2025_051 unified the RPC handlers to always use SDK, detection may not be strictly necessary. However, adding the detection signal provides future flexibility for hybrid scenarios.

---

### Requirement 3: Model Switching SDK Integration

**User Story**: As a user, I want the model selector dropdown to work with SDK sessions, so that I can switch Claude models mid-conversation.

#### Acceptance Criteria

1. WHEN user switches model THEN `ModelStateService.switchModel()` SHALL call backend RPC immediately
2. WHEN session is active THEN model change SHALL take effect on next message
3. WHEN RPC fails THEN model selection SHALL rollback to previous value with error toast
4. WHEN model switch succeeds THEN UI SHALL reflect new model within 100ms

#### Technical Specification

**File**: `libs/frontend/core/src/lib/services/model-state.service.ts`

**Current Implementation Already Correct**:

- `switchModel()` calls `config:model-switch` RPC ✅
- Optimistic update with rollback ✅
- Race condition protection ✅

**Backend Required Change** (already done in TASK_2025_051):

- `config:model-switch` RPC handler calls `SdkAgentAdapter.setSessionModel()`

---

### Requirement 4: Permission Level SDK Integration

**User Story**: As a user, I want the autopilot toggle and permission level selector to work with SDK sessions, so that I can control Claude's autonomy level mid-conversation.

#### Acceptance Criteria

1. WHEN user toggles autopilot THEN `AutopilotStateService.toggleAutopilot()` SHALL call backend RPC
2. WHEN user changes permission level THEN `setPermissionLevel()` SHALL map frontend levels to SDK modes:
   - `'ask'` → `'default'`
   - `'auto-edit'` → `'acceptEdits'`
   - `'yolo'` → `'bypassPermissions'`
3. WHEN RPC fails THEN permission state SHALL rollback with error logged
4. WHEN permission change succeeds THEN UI SHALL reflect immediately

#### Technical Specification

**File**: `libs/frontend/core/src/lib/services/autopilot-state.service.ts`

**Current Implementation Already Correct**:

- `toggleAutopilot()` calls `config:autopilot-toggle` RPC ✅
- `setPermissionLevel()` calls `config:autopilot-level` RPC ✅
- Optimistic update with rollback ✅

**Backend Required Change** (already done in TASK_2025_051):

- RPC handlers map permission levels and call `SdkAgentAdapter.setSessionPermissionMode()`

---

## Non-Functional Requirements

### Performance Requirements

- **Stop Response Time**: 95% of stop button clicks SHALL trigger backend interrupt within 50ms (frontend to RPC)
- **UI Update Latency**: Stop button visibility SHALL update within 16ms of `isStreaming()` signal change
- **Model/Permission Switch**: UI SHALL reflect changes within 100ms of user action (optimistic update)

### Reliability Requirements

- **Error Recovery**: All SDK control methods SHALL handle network failures with user-friendly error messages
- **State Consistency**: Frontend signals SHALL remain consistent with backend state after all operations
- **Rollback**: Failed operations SHALL restore previous state without data loss

### Accessibility Requirements

- **Keyboard Navigation**: Stop button SHALL be focusable via Tab and activatable via Enter/Space
- **Screen Reader**: Stop button SHALL have `aria-label="Stop generation"` when visible
- **Disabled State**: Stop button SHALL have `aria-disabled="true"` when `isStopping()` is true

### Code Quality Requirements

- **No Any Types**: All implementations SHALL use strict TypeScript types
- **Signal Pattern**: All state SHALL use Angular signal-based pattern (private mutable, public readonly)
- **Test Coverage**: New functionality SHALL have minimum 80% test coverage

---

## Stakeholder Analysis

### Primary Stakeholders

| Stakeholder | Impact | Involvement      | Success Criteria           |
| ----------- | ------ | ---------------- | -------------------------- |
| End Users   | High   | Testing/Feedback | Stop button works reliably |
| Dev Team    | Medium | Implementation   | Clean SDK integration      |

### User Personas

**Power User**: Wants instant stop capability when Claude takes wrong direction  
**New User**: Needs visible, intuitive stop control during first interactions

---

## Risk Analysis

### Technical Risks

| Risk                         | Probability | Impact | Mitigation                               | Contingency                   |
| ---------------------------- | ----------- | ------ | ---------------------------------------- | ----------------------------- |
| SDK interrupt race condition | Low         | Medium | Use existing abort guard (`_isStopping`) | Fall back to CLI abort        |
| Signal update timing         | Low         | Low    | Use synchronous signal updates           | Add explicit change detection |

### Integration Risks

| Risk                         | Probability | Impact | Mitigation                      |
| ---------------------------- | ----------- | ------ | ------------------------------- |
| Backend RPC not wired        | Low         | High   | TASK_2025_051 verified complete |
| Permission mapping incorrect | Low         | Medium | Map validated against SDK docs  |

---

## Dependencies

### Technical Dependencies

- `@ptah-extension/shared`: ExecutionNode, PermissionLevel types
- `@ptah-extension/core`: ClaudeRpcService, VSCodeService
- `@ptah-extension/chat`: ChatStore, TabManagerService
- DaisyUI: Button, loading spinner components

### Task Dependencies

- TASK_2025_049: SDK critical fixes ✅ Complete
- TASK_2025_051: SDK backend wiring ✅ Complete

---

## Success Metrics

1. **Stop Button Visibility**: 100% correlation between `isStreaming()` and button visibility
2. **Stop Latency**: <100ms from click to streaming cessation
3. **Zero Regressions**: All existing model/permission tests pass
4. **User Satisfaction**: Stop functionality works on first attempt

---

## Files Summary

### Files to Modify

| File                                                                       | Change                                      | Priority |
| -------------------------------------------------------------------------- | ------------------------------------------- | -------- |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` | Add stop button UI                          | P0       |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`   | No changes needed (signals already exposed) | -        |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                        | Verify `isStopping()` signal is public      | P1       |
| `libs/frontend/core/src/lib/services/model-state.service.ts`               | No changes needed (RPC already correct)     | -        |
| `libs/frontend/core/src/lib/services/autopilot-state.service.ts`           | No changes needed (RPC already correct)     | -        |

### Estimated Line Changes

- **New Lines**: ~30 (stop button HTML + accessibility)
- **Modified Lines**: ~5 (expose `isStopping` signal if needed)
- **Deleted Lines**: 0

---

## Verification Plan

### Automated Tests

1. **Unit Test - Stop Button Visibility**:
   ```bash
   nx test chat --testNamePattern="ChatViewComponent.*stop"
   ```
2. **Unit Test - Abort Function**:
   ```bash
   nx test chat --testNamePattern="ChatStore.*abort"
   ```

### Manual Verification

1. **Stop Button Test**:

   - Start a new chat and send a message that triggers long response
   - VERIFY: Stop button appears during streaming
   - Click stop button
   - VERIFY: Button shows loading spinner, then disappears
   - VERIFY: Streaming stops within 1 second

2. **Model Switch Test** (already working, sanity check):

   - Open model selector dropdown
   - Switch from Sonnet to Opus
   - VERIFY: UI reflects change immediately
   - Send message
   - VERIFY: Response uses selected model

3. **Permission Toggle Test** (already working, sanity check):
   - Toggle autopilot on/off
   - VERIFY: UI reflects change immediately
