# TASK_2025_050: Frontend SDK Integration

## Overview

Create stop button UI, add SDK detection logic to frontend services, and wire model/permission selectors to SDK methods.

## Prerequisites

- TASK_2025_049 must be complete (critical SDK bugs fixed)
- TASK_2025_051 must be complete (SDK backend wiring)

## Scope

### 1. Stop Button UI

- Create stop button in `chat-view.component.html`
- Show when `isStreaming()` is true
- Call `chatStore.abortCurrentMessage()` on click
- Wire to `SdkAgentAdapter.interruptSession()` when SDK active

### 2. SDK Detection Logic

- Add method to detect if current session uses SDK vs CLI
- Update `ModelStateService.switchModel()` to route correctly
- Update `AutopilotStateService.toggleAutopilot()` to route correctly
- Update `ChatStore.abortCurrentMessage()` to route correctly

### 3. Permission Level Mapping

```
Frontend → SDK Mode
'ask' → 'default'
'auto-edit' → 'acceptEdits'
'yolo' → 'bypassPermissions'
```

## Existing Components (Ready to Wire)

- `ModelSelectorComponent` - Has dropdown, calls `ModelStateService.switchModel()`
- `AutopilotPopoverComponent` - Has popover, calls `AutopilotStateService` methods
- `ChatStore.abortCurrentMessage()` - Service method exists, RPC call: `chat:abort`

## Files to Modify

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` (add stop button)
- `libs/frontend/core/src/lib/services/model-state.service.ts` (add SDK detection)
- `libs/frontend/core/src/lib/services/autopilot-state.service.ts` (add SDK detection)
- `libs/frontend/chat/src/lib/services/chat.store.ts` (add SDK detection)

## Blocked By

- TASK_2025_049: SDK critical bugs (race conditions, message queue)
- TASK_2025_051: SDK backend wiring (RPC handlers not connected)

## Created

2025-12-07
