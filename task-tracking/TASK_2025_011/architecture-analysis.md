# Architecture Analysis - Session Management Current State

## Overview

This document provides a comprehensive analysis of the current session management architecture, identifying all components, dependencies, and integration points that will be affected by the refactoring.

---

## Component Inventory

### Backend Components

#### 1. SessionManager Service

- **Location**: `libs/backend/claude-domain/src/session/session-manager.ts`
- **Size**: 850 lines
- **Responsibility**: Complete session lifecycle management
- **Methods**: 30+ methods including:
  - CRUD: createSession, getSession, deleteSession, renameSession
  - Messages: addUserMessage, addAssistantMessage
  - Claude CLI mapping: setClaudeSessionId, getClaudeSessionInfo
  - Export: exportSession (JSON/Markdown)
  - Analytics: getSessionStatistics, getSessionsUIData
  - Bulk: bulkDeleteSessions
- **Storage**: VS Code workspace state
  - Key: `ptah.sessions` (all sessions)
  - Key: `ptah.currentSessionId` (active session)
- **Problem**: Duplicates `.claude_sessions/` data
- **Status**: TO BE SIMPLIFIED → SessionProxy (< 200 lines)

#### 2. ClaudeCliService

- **Location**: `libs/backend/claude-domain/src/cli/claude-cli.service.ts`
- **Size**: 200 lines
- **Responsibility**: Claude CLI integration facade
- **Method**: sendMessage(message, sessionId, resumeSessionId)
- **Integration**: Uses `--session <id>` flag for resumption
- **Status**: KEEP (already thin facade)

#### 3. ChatOrchestrationService

- **Location**: `libs/backend/claude-domain/src/chat/chat-orchestration.service.ts`
- **Integration**: Coordinates SessionManager + ClaudeCliService
- **Status**: MODIFY (update to use SessionProxy)

---

### Frontend Components

#### 1. SessionManagerComponent (Container)

- **Location**: `libs/frontend/session/src/lib/containers/session-manager/session-manager.component.ts`
- **Size**: 910 lines (VIOLATES 500-line guideline)
- **Responsibility**: Orchestrates session management UI
- **Features**:
  - Display modes: inline, panel, modal
  - Session cards with actions (switch, delete, duplicate, export)
  - Session statistics (total messages, tokens, averages)
  - Sorting: recent, alphabetical, usage
  - Pagination: "Load more" for large session lists
- **Actions**:
  - onSwitchSession, onCreateSession, onDeleteSession
  - onRenameSession, duplicateSession, exportSession
- **Integration**: Uses VSCodeService → backend handlers
- **Problem**: Over-engineered for "show sessions on empty chat screen"
- **Status**: TO BE DELETED

#### 2. SessionSelectorComponent (Presentation)

- **Location**: `libs/frontend/session/src/lib/components/session-selector/session-selector.component.ts`
- **Size**: 628 lines
- **Responsibility**: Dropdown session selector
- **Features**:
  - Current session display (name, tokens, messages, time ago)
  - Expandable dropdown with sessions list
  - Quick session creation (unnamed)
  - Named session creation (input prompt)
  - Delete session button (per session)
  - "Manage Sessions" button (opens SessionManager)
- **Signals**:
  - Inputs: currentSession, sessions, isLoading
  - Outputs: sessionSelected, sessionCreated, sessionDeleted
- **Integration**: Used by ChatComponent
- **Problem**: Delete feature doesn't work (CLI doesn't support it)
- **Status**: TO BE DELETED

#### 3. SessionCardComponent (Presentation)

- **Location**: `libs/frontend/session/src/lib/components/session-card/session-card.component.ts`
- **Responsibility**: Individual session card display
- **Features**:
  - Session metadata (name, messages, tokens, time ago)
  - Action buttons (switch, rename, delete, export)
  - Active/inactive states
  - Inline rename input
- **Status**: TO BE DELETED

---

### Shared Types

#### 1. StrictChatSession

- **Location**: `libs/shared/src/lib/types/message.types.ts`
- **Definition**:
  ```typescript
  interface StrictChatSession {
    readonly id: SessionId;
    readonly name: string;
    readonly messages: readonly StrictChatMessage[];
    readonly tokenUsage: { input; output; total; percentage };
    readonly createdAt: number;
    readonly lastActiveAt: number;
    readonly updatedAt: number;
    readonly messageCount: number;
    readonly workspaceId?: string;
  }
  ```
- **Status**: KEEP (foundation type)

#### 2. SessionId (Branded Type)

- **Location**: `libs/shared/src/lib/types/branded.types.ts`
- **Definition**: Branded UUID v4 string
- **Methods**: create(), from(), validate()
- **Status**: KEEP (prevents ID type mixing)

#### 3. SessionUIData (SessionManager-specific)

- **Location**: `libs/backend/claude-domain/src/session/session-manager.ts:38-52`
- **Definition**:
  ```typescript
  interface SessionUIData {
    readonly id: string;
    readonly name: string;
    readonly messageCount: number;
    readonly tokenUsage: { input; output; total };
    readonly createdAt: number;
    readonly lastActiveAt: number;
    readonly isActive: boolean;
  }
  ```
- **Status**: REPLACE with SessionSummary (lighter weight)

---

## Integration Points

### 1. ChatComponent → SessionSelectorComponent

- **Location**: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts`
- **Line**: 55 (import), 83 (imports array)
- **Usage**: Imported but usage in template unknown (need to check)
- **Change Required**: Remove SessionSelectorComponent, add EmptyChatStateComponent

### 2. ChatService Session Methods

- **Location**: `libs/frontend/core/src/lib/services/chat.service.ts`
- **Methods**:
  - createNewSession(name?: string): Promise<void>
  - switchToSession(sessionId: SessionId): Promise<void>
  - Current implementation delegates to VSCodeService → backend
- **Change Required**:
  - Add: sessions signal, refreshSessions() method
  - Remove: deleteSession(), renameSession(), exportSession() (if exist)

### 3. Backend Message Handlers

- **Location**: `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`
- **Handlers** (session-related):
  - REQUEST_SESSIONS: Calls SessionManager.getAllSessions()
  - CREATE_SESSION: Calls SessionManager.createSession()
  - DELETE_SESSION: Calls SessionManager.deleteSession()
  - RENAME_SESSION: Calls SessionManager.renameSession()
  - SWITCH_SESSION: Calls SessionManager.switchSession()
- **Change Required**:
  - REQUEST_SESSIONS: Call SessionProxy.listSessions()
  - CREATE_SESSION: Delegate to ClaudeCliService (already does?)
  - DELETE_SESSION: Remove handler (unsupported)
  - RENAME_SESSION: Remove handler (unsupported)
  - SWITCH_SESSION: Update to use SessionProxy

### 4. DI Registration

- **Location**: `libs/backend/claude-domain/src/di/register.ts`
- **Current Registration**:
  ```typescript
  container.register(TOKENS.SESSION_MANAGER, {
    useClass: SessionManager,
  });
  ```
- **Change Required**:
  - Add: SESSION_PROXY registration
  - Keep or remove: SESSION_MANAGER (depends on Phase 5 decision)

---

## Claude CLI Session Management Analysis

### Session Storage Location

**Primary Location**: `.claude_sessions/` directory

- **Workspace Sessions**: `<workspace-root>/.claude_sessions/`
- **Global Sessions**: `~/.claude_sessions/` (user home directory)

### Session File Format

Based on codebase analysis (ClaudeCliLauncher, SessionManager):

**File naming**: `<session-id>.json` (UUID v4)

**Expected JSON structure** (inferred):

```json
{
  "id": "uuid-v4-session-id",
  "created_at": 1734567890000,
  "updated_at": 1734567890000,
  "messages": [
    {
      "role": "user" | "assistant",
      "content": "...",
      "timestamp": 1734567890000
    }
  ],
  "metadata": {
    "model": "claude-sonnet-4",
    "cwd": "/workspace/path",
    "tools": ["Bash", "Read", "Edit"]
  }
}
```

### Session Operations via Claude CLI

**Supported Operations**:

1. **Resume Session**:

   - Command: `claude --session <session-id> [message]`
   - Evidence: ClaudeCliLauncher.spawnTurn() uses resumeSessionId parameter
   - Usage: Continue existing conversation

2. **List Sessions** (indirect):

   - No CLI command, but can read `.claude_sessions/` directory
   - Method: File system operations (fs.readdir)

3. **Get Session Details** (indirect):
   - No CLI command, but can read session JSON file
   - Method: File system operations (fs.readFile + JSON.parse)

**Unsupported Operations**:

- ❌ Delete session
- ❌ Rename session
- ❌ Export session
- ❌ Explicit list/show commands

---

## Dependency Graph

### Current Dependencies

```
apps/ptah-extension-vscode
  └─ SessionManager (via handlers)
     └─ IStorageService (VS Code workspace state)
     └─ IEventBus (event publishing)

libs/frontend/chat
  └─ SessionSelectorComponent
     └─ ChatService
        └─ VSCodeService
           └─ Backend handlers
              └─ SessionManager

libs/frontend/core (ChatService)
  └─ VSCodeService
     └─ Backend handlers
        └─ SessionManager
```

### Target Dependencies

```
apps/ptah-extension-vscode
  └─ SessionProxy (via handlers)
     └─ fs.promises (file system)
     └─ path (Node.js built-in)

libs/frontend/chat
  └─ EmptyChatStateComponent
     └─ ChatService
        └─ VSCodeService
           └─ Backend handlers
              └─ SessionProxy

libs/frontend/core (ChatService)
  └─ VSCodeService
     └─ Backend handlers
        └─ SessionProxy
```

**Key Change**: SessionManager → SessionProxy (storage → file system)

---

## Message Flow Analysis

### Current Flow: Request Sessions

```
SessionSelectorComponent (onInit)
  ↓ fetchAllSessions()
VSCodeService.postStrictMessage(REQUEST_SESSIONS)
  ↓ (webview → extension)
Backend Message Handler
  ↓ sessionManager.getAllSessions()
SessionManager.getAllSessions()
  ↓ return sessions from memory (loaded from VS Code storage)
Backend publishes SESSIONS_UPDATED event
  ↓ (extension → webview)
VSCodeService.onMessageType(SESSIONS_UPDATED)
  ↓ observable stream
SessionSelectorComponent._allSessions.set(sessions)
  ↓ signal update
Component re-renders
```

**Problem**: SessionManager reads from VS Code storage, which duplicates `.claude_sessions/`

### Target Flow: Request Sessions

```
EmptyChatStateComponent (onInit)
  ↓ chatService.refreshSessions()
ChatService.refreshSessions()
  ↓
VSCodeService.postStrictMessage(REQUEST_SESSIONS)
  ↓ (webview → extension)
Backend Message Handler
  ↓ sessionProxy.listSessions()
SessionProxy.listSessions()
  ↓ fs.readdir('.claude_sessions/')
  ↓ Parse session JSON files
  ↓ return SessionSummary[]
Backend publishes SESSIONS_UPDATED event
  ↓ (extension → webview)
VSCodeService.onMessageType(SESSIONS_UPDATED)
  ↓ observable stream
ChatService._sessions.set(sessions)
  ↓ signal update
EmptyChatStateComponent re-renders
```

**Improvement**: SessionProxy reads directly from `.claude_sessions/` (single source of truth)

---

## Impact Analysis

### Breaking Changes for Users

**Feature Removals**:

1. ❌ Delete session button (non-functional anyway)
2. ❌ Rename session button (not critical)
3. ❌ Export session to JSON/Markdown (rarely used)
4. ❌ Session statistics dashboard (over-engineered)
5. ❌ Session duplicate feature (edge case)

**User Impact Assessment**:

- **LOW**: Most users only need to list and switch sessions
- **MEDIUM**: Power users may miss export feature
- **RATIONALE**: Features removed don't work correctly or aren't supported by Claude CLI

### Technical Debt Reduction

**Eliminated Complexity**:

1. Duplicate storage synchronization bugs
2. Session lifecycle management overhead
3. Over-engineered UI components (900+ lines → 200 lines)
4. Entire frontend session library removal

**Code Quality Improvements**:

- Reduction: ~70% less session management code
- Simplification: Single source of truth (`.claude_sessions/`)
- Alignment: UI features match CLI capabilities

---

## Risk Assessment

### High Risks

**Risk 1: Claude CLI session format changes**

- **Probability**: LOW
- **Impact**: HIGH
- **Mitigation**: Parse session files defensively, graceful error handling

**Risk 2: `.claude_sessions/` directory doesn't exist**

- **Probability**: MEDIUM (new workspaces)
- **Impact**: MEDIUM
- **Mitigation**: Create directory if missing, show helpful error message

### Medium Risks

**Risk 3: Session JSON file corruption**

- **Probability**: LOW
- **Impact**: MEDIUM
- **Mitigation**: Try-catch around JSON.parse, skip corrupted files

**Risk 4: Performance with many sessions (100+)**

- **Probability**: LOW
- **Impact**: LOW
- **Mitigation**: Async file operations, pagination in UI

### Low Risks

**Risk 5: User expectations mismatch**

- **Probability**: MEDIUM
- **Impact**: LOW
- **Mitigation**: Clear documentation, helpful empty states

---

## Testing Strategy

### Unit Tests Required

1. **SessionProxy.listSessions()**

   - Test: Empty directory returns []
   - Test: Directory with 5 sessions returns 5 summaries
   - Test: Corrupt JSON file is skipped gracefully
   - Test: Non-existent directory throws helpful error

2. **SessionProxy.getSessionDetails()**

   - Test: Valid session ID returns parsed session
   - Test: Invalid session ID returns null
   - Test: Corrupt JSON throws error

3. **EmptyChatStateComponent**
   - Test: Empty sessions list shows "Create First Session" message
   - Test: Sessions list renders correctly
   - Test: Click session emits sessionSelected event
   - Test: Click "Create New Session" emits sessionCreated event

### Integration Tests Required

1. **Session List E2E**

   - Given: `.claude_sessions/` has 3 sessions
   - When: User opens empty chat screen
   - Then: 3 sessions displayed

2. **Session Creation E2E**

   - Given: Empty chat screen displayed
   - When: User clicks "Create New Session"
   - Then: Chat view loads with new session active

3. **Session Switching E2E**
   - Given: Empty chat screen with 2 sessions
   - When: User clicks session A
   - Then: Chat view loads session A messages

### Regression Tests Required

1. **Existing session resumption still works**

   - Verify: ClaudeCliService.sendMessage() with resumeSessionId
   - Verify: `--session <id>` flag passed to Claude CLI

2. **Session creation via first message still works**
   - Verify: New session created on first Claude CLI turn
   - Verify: Session ID extracted from system init message

---

## Documentation Updates Required

### User-Facing Documentation

1. **README.md**

   - Remove: Session deletion feature
   - Remove: Session rename feature
   - Remove: Session export feature
   - Update: Session management section (simplified)

2. **CHANGELOG.md**
   - Add: BREAKING CHANGE: Session deletion/rename/export removed
   - Add: IMPROVEMENT: Faster session loading (direct file access)

### Developer Documentation

1. **CLAUDE.md** (project root)

   - Update: Session management architecture
   - Remove: Session library references

2. **libs/backend/claude-domain/CLAUDE.md**

   - Add: SessionProxy documentation
   - Update or remove: SessionManager documentation

3. **libs/frontend/chat/CLAUDE.md**
   - Add: EmptyChatStateComponent documentation
   - Remove: SessionSelectorComponent references

---

## Rollback Contingency

### Rollback Triggers

**Trigger 1**: SessionProxy cannot read `.claude_sessions/` reliably
**Trigger 2**: EmptyChatStateComponent has critical bugs
**Trigger 3**: Session switching breaks in production

### Rollback Procedure

1. **Git Revert**:

   - Revert all commits in Phase 1-4
   - Restore `libs/frontend/session/` library

2. **Configuration Restore**:

   - Restore SessionManager DI registration
   - Restore backend message handlers

3. **Verification**:
   - Run full test suite
   - Verify session listing works
   - Verify session creation works

**Estimated Rollback Time**: 30 minutes

---

## Success Criteria

### Functional Criteria

- ✅ Sessions list loads from `.claude_sessions/` directory
- ✅ EmptyChatStateComponent shows on empty chat screen
- ✅ User can create new session
- ✅ User can switch between sessions
- ✅ Session messages load correctly after switch
- ✅ No duplicate storage in VS Code workspace state

### Non-Functional Criteria

- ✅ Session list loads in < 100ms (50 sessions)
- ✅ Code size reduced by ~70% (1000+ lines → < 400 lines)
- ✅ Zero regression test failures
- ✅ Documentation fully updated
- ✅ All TypeScript compilation passes

### Quality Criteria

- ✅ No `any` types in new code
- ✅ All new code has unit tests (80%+ coverage)
- ✅ Signal-based reactivity (no unnecessary re-renders)
- ✅ Graceful error handling (no silent failures)
- ✅ Accessibility compliant (ARIA labels, keyboard navigation)

---

## Next Steps

1. **Review this analysis** with team-leader
2. **Get approval** for phased implementation plan
3. **Assign developers**:
   - Backend developer: SessionProxy implementation
   - Frontend developer: EmptyChatStateComponent implementation
4. **Create atomic tasks** in tasks.md (team-leader responsibility)
5. **Begin Phase 1** implementation
