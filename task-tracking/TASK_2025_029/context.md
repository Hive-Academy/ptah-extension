# TASK_2025_029: Tab-Based Multi-Session Support (Phases 2-4)

## Overview

Complete implementation of tab-based multi-session support for the Ptah extension. This builds on TASK_2025_027 (Phase 1: Proper Session Lifecycle) which established the foundation for Claude CLI session ID ownership.

## Background

### Phase 1 Complete (TASK_2025_027)

- ✅ Backend extracts real Claude CLI session UUID from JSONL stream
- ✅ Frontend handles `session:id-resolved` message
- ✅ Draft → Active session lifecycle implemented
- ✅ Session continuation works with `--resume` using real UUIDs

### Remaining Phases (This Task)

- Phase 2: Multi-Session State Management
- Phase 3: Tab UI Components
- Phase 4: Advanced Features (drag-to-reorder, keyboard shortcuts, etc.)

## User Intent

Transform the current single-session chat experience into a multi-session tabbed interface that allows users to:

- Work on multiple conversations simultaneously
- Quickly switch between active sessions
- Create new sessions without losing current context
- Close sessions with proper cleanup

## Design Reference

```
┌────────────────────────────────────────────────────────┐
│ [Session 1 ✕] [Session 2 ✕] [New Chat ✕] [+]          │ ← Tab bar
├────────────────────────────────────────────────────────┤
│                                                        │
│         Chat messages for active tab...                │
│                                                        │
├────────────────────────────────────────────────────────┤
│ [Input field...]                                       │
└────────────────────────────────────────────────────────┘
```

## Technical Foundation from Phase 1

### Data Model (Already Implemented)

```typescript
// SessionManager now has:
claudeSessionId: Signal<string | null>; // Real Claude CLI UUID
status: Signal<SessionStatus>; // 'fresh' | 'draft' | 'streaming' | 'loaded' | 'resuming' | 'switching'
```

### Key Insight

Phase 1 established that each session has a lifecycle:

1. **Fresh** → No session
2. **Draft** → User started typing, no Claude UUID yet
3. **Streaming** → Claude responded, real UUID received
4. **Loaded** → Historical session loaded from `.jsonl`

For multi-session, we wrap this in an array of `TabState` objects.

## Success Criteria

1. [ ] Multiple chat sessions open simultaneously as tabs
2. [ ] Tab bar displays session titles with close buttons
3. [ ] "+" button creates new session tab
4. [ ] Switching tabs preserves each session's state
5. [ ] Closing tab properly cleans up session
6. [ ] Session state persists across extension restarts
7. [ ] Keyboard shortcuts work (Ctrl+Tab, Ctrl+W)
8. [ ] No regression in single-session functionality

## Out of Scope

- Session templates
- Session search/filter
- Pin/unpin sessions
- Split view (side-by-side sessions)
- Session sharing/export

## Related Tasks

- TASK_2025_027: Phase 1 - Proper Session Lifecycle ✅
- TASK_2025_011: Session Management Simplification (uses Claude's storage)
- TASK_2025_023: Nested UI Rebuild (established ExecutionNode architecture)

## Reference Document

See `docs/future-enhancements/tab-based-session-management.md` for detailed design specifications.
