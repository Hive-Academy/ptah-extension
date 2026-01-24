# Task Context: TASK_2025_117

## Task ID

TASK_2025_117

## User Request

Add a split-pane/split-view feature that allows users to view and interact with multiple chat tabs simultaneously side-by-side. This enhances the multi-agent orchestration experience by enabling users to monitor multiple agent conversations in parallel.

## Task Type

FEATURE

## Complexity Assessment

**Medium** (Estimated 6-8 hours)

### Complexity Factors

1. **New UI Components**: Split-pane container, resizer, pane manager service
2. **State Management**: Each pane needs its own tab context
3. **Existing Infrastructure**: Tab system already works correctly
4. **Permission System**: Already validated - uses `toolUseId` for safe cross-tab matching
5. **Angular CDK**: Already in project, can use for drag-drop and resize

## Research Summary (Pre-Task Analysis)

### Current Tab Architecture ✅ Working

- `TabManagerService` with signal-based `_tabs` and `_activeTabId`
- Each tab has isolated `messages[]`, `streamingState`, and `status`
- Concurrent streaming already works (events route correctly via `tabId`)

### Event Routing ✅ Verified

| Event Type            | Has `tabId`?  | Routing Method                 |
| --------------------- | ------------- | ------------------------------ |
| `CHAT_CHUNK`          | ✅ Yes        | Direct tab lookup by `tabId`   |
| `CHAT_COMPLETE`       | ✅ Yes        | Direct tab lookup by `tabId`   |
| `CHAT_ERROR`          | ✅ Yes        | Direct tab lookup by `tabId`   |
| `SESSION_ID_RESOLVED` | ✅ Yes        | Direct tab lookup by `tabId`   |
| `PERMISSION_REQUEST`  | Via toolUseId | Matched via unique `toolUseId` |

### Permission System ✅ Safe for Multi-Pane

User correctly identified that permissions are safe:

- `toolUseId` is globally unique UUID from Claude SDK
- Each tab's `streamingState.toolCallMap` only contains its own tool IDs
- Matching via `toolUseId → toolCallId` prevents cross-tab conflicts
- Minor UX optimization: Each pane should filter permissions by its tab context

### Proposed Architecture (Recommended: Split-View Panes)

```
┌──────────────────────────────────────────────────────────────┐
│ Tab Bar (existing)                                           │
├────────────────────────────┬─────────────────────────────────┤
│ Pane 1                     │ Pane 2                          │
│ ┌────────────────────────┐ │ ┌─────────────────────────────┐ │
│ │ ChatViewComponent      │ │ │ ChatViewComponent           │ │
│ │ (tabId = "tab_abc")    │ │ │ (tabId = "tab_xyz")         │ │
│ │                        │ │ │                             │ │
│ │ [Messages...]          │ │ │ [Messages...]               │ │
│ │ [Permissions...]       │ │ │ [Permissions...]            │ │
│ │                        │◄┼►│                             │ │
│ │ [Chat Input]           │ │ │ [Chat Input]                │ │
│ └────────────────────────┘ │ └─────────────────────────────┘ │
└────────────────────────────┴─────────────────────────────────┘
                             ↑
                         Resizer
```

## Key Files to Create/Modify

### New Files

| File                                                                                | Purpose                            |
| ----------------------------------------------------------------------------------- | ---------------------------------- |
| `libs/frontend/chat/src/lib/services/pane-manager.service.ts`                       | Signal-based pane state management |
| `libs/frontend/chat/src/lib/components/organisms/split-pane-container.component.ts` | Container managing pane layout     |
| `libs/frontend/chat/src/lib/components/molecules/pane-resizer.component.ts`         | Draggable divider between panes    |
| `libs/frontend/chat/src/lib/components/molecules/pane-header.component.ts`          | Tab selector per pane              |

### Files to Modify

| File                            | Changes                                                              |
| ------------------------------- | -------------------------------------------------------------------- |
| `app-shell.component.html`      | Replace single `<ptah-chat-view>` with `<ptah-split-pane-container>` |
| `chat-view.component.ts`        | Add `tabId` input for pane-specific context                          |
| `permission-handler.service.ts` | Add `getPermissionsForTab(tabId)` method                             |

## Created

2026-01-24

## Status

📋 Initialized - Awaiting PM phase
