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

## Architecture Pivot (2026-01-29)

### Decision: Option B2 - VS Code Native Sidebar + Editor WebviewPanel

The original plan (Option A: In-App CSS Split) was rejected during re-evaluation due to:
1. **Singleton pollution risk**: All Angular services are `providedIn: 'root'` singletons. Threading `tabId` through MessageSenderService, ConversationService, ChatStore, and every future service is fragile.
2. **Cross-talk risk**: One missed `tabId` parameter = bugs between sessions.
3. **Separation of concerns**: No true isolation between sessions in the same DOM.

**Chosen approach**: Option B2 - VS Code Native Multi-Webview
- Primary sidebar keeps `ptah.main` webview (existing)
- "Open in Editor Panel" action creates a `WebviewPanel` in the editor area
- Each webview is a **fully independent Angular app instance** with its own DI container
- Zero refactoring of ChatStore/SessionManager/MessageSenderService singletons
- Shared state (session list, model selection, license) coordinated through extension host
- ~15-25MB memory overhead per additional panel (acceptable for power-user feature)

### Key Benefits
- **Perfect session isolation** - physically separate Angular instances
- **Zero cross-talk risk** - impossible by design
- **Natural VS Code UX** - users already know editor splits (Ctrl+\)
- **Future-proof** - adding 3rd or 4th view is trivial
- **No existing code changes** - services work as-is in each isolated instance

### Coordination Requirements (Extension Host)
- Session list synchronization between views
- Model selection propagation (global config)
- License state sharing (passed at HTML generation time)
- "Which sessions are open where" tracking (prevent duplicates)

## Status

🔄 Re-Architecture Phase - Invoking Software Architect for B2 implementation plan
