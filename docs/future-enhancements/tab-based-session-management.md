# Future Enhancement: Tab-Based Session Management

## Overview

This document describes a deferred enhancement from TASK_2025_023 (Batch 7, Task 7.5) to implement tab-based session management, replacing the current sidebar drawer pattern with a more intuitive tab interface.

## Current State

**Current Implementation**:

- Sidebar drawer for session navigation
- Single active session visible at a time
- Basic session switching via list selection

## Desired State (Based on Design Reference)

**Tab-Based Interface**:

```
┌────────────────────────────────────────┐
│ [Session 1 ✕] [Session 2 ✕] [+]       │ ← Tab bar with close buttons
├────────────────────────────────────────┤
│                                        │
│         Chat messages...               │
│                                        │
└────────────────────────────────────────┘
```

**Features**:

- Horizontal tab bar at top of chat view
- Each tab shows session name/title
- Close button (✕) on each tab
- "+" button to create new session
- Visual indication of active tab
- Drag-to-reorder tabs (optional)
- Maximum visible tabs with overflow scrolling

## Why Deferred?

This is a **major architectural change** requiring:

1. **State Management Overhaul**:

   - Multiple sessions loaded simultaneously
   - Tab state persistence across sessions
   - Active tab tracking

2. **Component Restructuring**:

   - New `TabBarComponent` for session management
   - Refactor `ChatViewComponent` to be tab-aware
   - Session lifecycle management (create/close/switch)

3. **Backend Integration**:

   - Multi-session message history
   - Session metadata storage (names, order)
   - Session cleanup on close

4. **UI/UX Complexity**:
   - Tab overflow handling
   - Keyboard shortcuts (Ctrl+Tab, Ctrl+W)
   - Context menus (rename, duplicate, close others)
   - Unsaved changes warning on close

## Estimated Effort

- **Complexity**: Level 3-4 (Complex component system)
- **Time**: 2-3 days for complete implementation
- **Risk**: High (touches core session management)

## Implementation Plan (When Prioritized)

### Phase 1: Component Structure

```typescript
// New components needed:
libs/frontend/chat/src/lib/components/organisms/
  ├── tab-bar.component.ts           // Tab management UI
  ├── tab-item.component.ts          // Individual tab
  └── session-tab-manager.service.ts // Tab state logic
```

### Phase 2: State Management

```typescript
// Extend ChatStore for multi-session:
interface TabState {
  id: string;
  sessionId: string;
  title: string;
  order: number;
  isDirty: boolean; // Unsaved changes
}

class ChatStore {
  private readonly _tabs = signal<TabState[]>([]);
  private readonly _activeTabId = signal<string | null>(null);

  readonly tabs = this._tabs.asReadonly();
  readonly activeTab = computed(() => this.tabs().find((t) => t.id === this._activeTabId()));
}
```

### Phase 3: Backend Integration

```typescript
// Add to SessionManager:
interface SessionMetadata {
  id: string;
  title: string;
  lastAccessed: Date;
  messageCount: number;
}

class SessionManager {
  async listSessions(): Promise<SessionMetadata[]>;
  async createSession(title: string): Promise<SessionId>;
  async closeSession(id: SessionId): Promise<void>;
  async renameSession(id: SessionId, title: string): Promise<void>;
}
```

### Phase 4: UI Implementation

- Replace sidebar drawer with horizontal tab bar
- Add close buttons with confirmation
- Implement drag-to-reorder (optional)
- Add keyboard shortcuts
- Add context menu

## Design Reference

Based on screenshots from Roo Code and TRAE extensions:

- Tab height: ~40px
- Max tab width: 200px
- Overflow: horizontal scroll with arrows
- Close button: always visible (not just on hover)
- Active tab: distinct background color
- Inactive tabs: subtle hover effect

## Dependencies

**Must be completed first**:

- [ ] Session persistence in backend
- [ ] Session metadata storage
- [ ] Multi-session message history

**Nice to have**:

- [ ] Session templates (start new session with template)
- [ ] Session search/filter
- [ ] Pin/unpin sessions

## Related Issues

- Current sidebar drawer: `libs/frontend/chat/src/lib/components/organisms/session-list.component.ts`
- Session management: `libs/backend/claude-domain/src/lib/session/`

## Testing Considerations

**New test coverage needed**:

- Tab creation/deletion
- Tab switching preserves state
- Session close with unsaved changes
- Tab overflow scrolling
- Keyboard navigation
- Drag-to-reorder (if implemented)

## Rollout Strategy

**Recommended approach**:

1. Implement behind feature flag
2. Beta test with internal users
3. Gradual rollout with fallback to drawer
4. Full migration after stability confirmed

## Alternative Approaches

**Option A: Hybrid approach**

- Keep sidebar drawer for session list
- Add "Open in new tab" action
- Tabs only for multi-session workflows

**Option B: Split view**

- Vertical split for 2 sessions side-by-side
- Simpler than full tab system
- Limited to 2 sessions max

**Option C: Accordion panels**

- Collapsible session panels
- All sessions visible at once
- No tab bar needed

## Conclusion

Tab-based session management is a valuable enhancement but requires significant architectural changes. Defer until current implementation is stable and user feedback indicates strong demand for multi-session workflows.

**Decision**: Defer to future sprint after Priority 1 and Priority 2 enhancements are validated.
