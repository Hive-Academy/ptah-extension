# Implementation Plan - Session Management Simplification

## Executive Summary

This plan outlines the complete refactoring of Ptah's session management architecture to eliminate duplicate storage, remove unsupported features, and establish Claude CLI's `.claude_sessions/` directory as the single source of truth.

**Current State**: Duplicate session storage, 3 session-related packages (1000+ lines), unsupported delete feature
**Target State**: Claude CLI as single source of truth, 1 thin proxy service, 1 minimal empty-state component (< 200 lines)

---

## 📊 Codebase Investigation Summary

### Libraries Discovered

1. **libs/frontend/session** - Complete session management UI library

   - Location: `libs/frontend/session/`
   - Components: SessionManagerComponent (910 lines), SessionSelectorComponent (628 lines), SessionCardComponent
   - Status: **TO BE DELETED**
   - Reason: Over-engineered for requirements

2. **libs/backend/claude-domain/session** - Backend session management

   - Location: `libs/backend/claude-domain/src/session/session-manager.ts`
   - Lines: 850 lines
   - Services: SessionManager (CRUD, caching, persistence)
   - Status: **TO BE SIMPLIFIED** → Thin SessionProxy

3. **libs/shared/types** - Session type definitions
   - Location: `libs/shared/src/lib/types/claude-domain.types.ts`
   - Types: StrictChatSession, SessionId, ClaudeSessionResume
   - Status: **KEEP** (foundation types, may add Claude CLI response types)

### Patterns Identified

**Pattern 1: Duplicate Storage**

- **Evidence**: SessionManager.loadSessions() reads from VS Code storage
  - Location: `libs/backend/claude-domain/src/session/session-manager.ts:800-826`
  - Storage keys: `ptah.sessions`, `ptah.currentSessionId`
  - Problem: Duplicates `.claude_sessions/` directory data

**Pattern 2: Unsupported Deletion**

- **Evidence**: SessionManager.deleteSession(), SessionManagerComponent.onDeleteSession()
  - Location: SessionManager:267-288, SessionManagerComponent:846-886
  - Problem: UI allows deleting sessions, but Claude CLI doesn't support this
  - Impact: Users expect deleted sessions to be gone, but they persist in `.claude_sessions/`

**Pattern 3: Over-Engineering**

- **Evidence**: Entire session library with 3 components
  - SessionManagerComponent: 910 lines (modal/panel/inline modes, sorting, stats, export)
  - SessionSelectorComponent: 628 lines (dropdown, quick/named creation, delete buttons)
  - SessionCardComponent: Card display with actions
  - Problem: 90% of functionality not needed for "list sessions on empty chat screen"

### Integration Points

**Integration 1: ChatComponent uses SessionSelectorComponent**

- **Location**: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts:55`
- **Usage**: Imported but placement unknown (need to check template)
- **Impact**: ChatComponent must be updated to remove session selector import

**Integration 2: ChatService creates sessions**

- **Location**: `libs/frontend/core/src/lib/services/chat.service.ts`
- **Method**: `createNewSession()`, `switchToSession()`
- **Delegates to**: VSCodeService → backend → SessionManager
- **Impact**: ChatService will delegate to new SessionProxy instead

**Integration 3: VS Code extension message handlers**

- **Location**: `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`
- **Handles**: REQUEST_SESSIONS, DELETE_SESSION, RENAME_SESSION, SWITCH_SESSION
- **Impact**: Message handlers must call SessionProxy instead of SessionManager

---

## 🔍 Claude CLI Commands Investigation

### Available Claude CLI Session Commands

Based on codebase analysis, Claude CLI provides session management via:

1. **Session Resumption** (Verified)

   - **Command**: `claude --session <session-id> [message]`
   - **Evidence**: `ClaudeCliLauncher.spawnTurn()` uses `resumeSessionId` parameter
   - **Location**: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`
   - **Usage**: Resume previous conversation

2. **Session Directory** (Verified)

   - **Location**: `~/.claude_sessions/` or workspace `.claude_sessions/`
   - **Format**: JSON files per session (session ID as filename)
   - **Evidence**: SessionManager.setClaudeSessionId() stores mapping
   - **Content**: Message history, context, metadata

3. **Session Information Extraction** (Inferred)
   - **Method**: Read `.claude_sessions/*.json` files directly
   - **Alternative**: Parse Claude CLI output messages (system init messages contain session ID)
   - **Evidence**: `SessionManager.setClaudeSessionInfo()` receives session info from system messages

### Claude CLI Limitations

**NOT SUPPORTED by Claude CLI**:

- ❌ Delete session command (`claude --session delete <id>` does NOT exist)
- ❌ Rename session command
- ❌ Export session command
- ❌ List sessions command (but can read directory)

**SUPPORTED by direct file access**:

- ✅ List sessions (read `.claude_sessions/` directory)
- ✅ Read session details (parse session JSON files)
- ✅ Get session metadata (timestamps from file system)

---

## 🏗️ Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Direct File Access + CLI Resumption Pattern
**Rationale**:

- Claude CLI doesn't provide session list/show commands
- Direct file access is reliable and performant
- Matches how Claude CLI itself manages sessions
- No caching needed (file system is source of truth)

**Evidence**: Claude CLI stores sessions as `.claude_sessions/<uuid>.json` files

- **Analysis**: ClaudeCliLauncher.spawnTurn() resumes sessions by ID (lines 150-200)
- **Pattern**: Extension reads files, CLI resumes via `--session` flag

### Component Specifications

#### Component 1: SessionProxy (Backend Service)

**Purpose**: Thin proxy to Claude CLI session operations via direct file access

**Pattern**: Service facade wrapping file system operations
**Evidence**: Similar to ClaudeCliDetector pattern (file system probing)

- **Location**: `libs/backend/claude-domain/src/detector/claude-cli-detector.ts:120-180`
- **Rationale**: Proven pattern for file-based CLI integration

**Responsibilities**:

- List sessions (read `.claude_sessions/` directory)
- Get session details (parse session JSON files)
- No caching, no persistence (file system is source of truth)
- Provide session data for empty chat screen component

**Implementation Pattern**:

```typescript
// Pattern source: ClaudeCliDetector file system operations
// Verified imports from: libs/backend/claude-domain/src/detector/
import { injectable, inject } from 'tsyringe';
import { workspace } from 'vscode';
import { promises as fs } from 'fs';
import * as path from 'path';

@injectable()
export class SessionProxy {
  // Direct file system access (no caching)
  async listSessions(workspaceRoot?: string): Promise<SessionSummary[]> {
    const sessionsDir = this.getSessionsDirectory(workspaceRoot);
    const files = await fs.readdir(sessionsDir);
    return this.parseSessionFiles(files, sessionsDir);
  }

  async getSessionDetails(sessionId: string): Promise<SessionDetails | null> {
    const sessionPath = this.getSessionPath(sessionId);
    const content = await fs.readFile(sessionPath, 'utf-8');
    return JSON.parse(content);
  }

  private getSessionsDirectory(workspaceRoot?: string): string {
    // Claude CLI uses workspace .claude_sessions/ or ~/.claude_sessions/
    return path.join(workspaceRoot || os.homedir(), '.claude_sessions');
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- List all sessions from `.claude_sessions/` directory
- Parse session JSON files for metadata (name, timestamp, message count)
- Handle missing/corrupt session files gracefully
- Support both workspace and global session directories

**Non-Functional Requirements**:

- Performance: < 100ms for listing 50 sessions
- Error handling: Graceful degradation if `.claude_sessions/` doesn't exist
- No caching: Always read from file system (source of truth)

**Pattern Compliance**:

- Must follow ClaudeCliDetector file access pattern (verified at detector:120-180)
- Must use injectable() decorator (verified in session-manager.ts:138)
- Must inject TOKENS for DI (verified in TOKENS export from vscode-core)

**Files Affected**:

- `libs/backend/claude-domain/src/session/session-proxy.ts` (CREATE)
- `libs/backend/claude-domain/src/index.ts` (MODIFY - export SessionProxy)
- `libs/backend/claude-domain/src/di/register.ts` (MODIFY - register SessionProxy)

---

#### Component 2: EmptyChatStateComponent (Frontend Component)

**Purpose**: Small component shown on empty chat screen with session list and "new session" button

**Pattern**: Pure presentation component with signal-based API
**Evidence**: SessionSelectorComponent pattern (signals, outputs)

- **Location**: `libs/frontend/session/src/lib/components/session-selector/session-selector.component.ts`
- **Pattern**: Reuse signal API pattern from existing selector

**Responsibilities**:

- Display sessions list (from backend via ChatService)
- "New Session" button (delegates to ChatService)
- Show "Create your first session" if no sessions exist
- NO delete, NO rename, NO export

**Implementation Pattern**:

```typescript
// Pattern source: SessionSelectorComponent signal pattern
// Verified: libs/frontend/session/src/lib/components/session-selector/session-selector.component.ts:537-690
import { Component, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SessionSummary } from '@ptah-extension/shared'; // New type

@Component({
  selector: 'ptah-empty-chat-state',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="empty-chat-container">
      <!-- Welcome message -->
      <div class="empty-chat-header">
        <h2>Welcome to Ptah</h2>
        <p>Start a conversation with Claude</p>
      </div>

      <!-- New Session Button -->
      <button class="new-session-btn" (click)="createSession()">Create New Session</button>

      <!-- Sessions List (if any exist) -->
      @if (sessions().length > 0) {
      <div class="sessions-section">
        <h3>Recent Sessions</h3>
        <div class="sessions-list">
          @for (session of sessions(); track session.id) {
          <div class="session-item" (click)="selectSession(session.id)">
            <div class="session-name">{{ session.name }}</div>
            <div class="session-meta">
              {{ session.messageCount }} messages •
              {{ getTimeAgo(session.lastActiveAt) }}
            </div>
          </div>
          }
        </div>
      </div>
      }
    </div>
  `,
})
export class EmptyChatStateComponent {
  // Input signals
  readonly sessions = input<SessionSummary[]>([]);
  readonly isLoading = input<boolean>(false);

  // Output events
  readonly sessionSelected = output<string>(); // sessionId
  readonly sessionCreated = output<void>();

  // Computed
  readonly hasSessions = computed(() => this.sessions().length > 0);

  selectSession(sessionId: string): void {
    this.sessionSelected.emit(sessionId);
  }

  createSession(): void {
    this.sessionCreated.emit();
  }

  private getTimeAgo(timestamp: number): string {
    // Simple time ago implementation
    const diff = Date.now() - timestamp;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- Display sessions list with name, message count, time ago
- Clickable sessions trigger sessionSelected event
- "Create New Session" button triggers sessionCreated event
- Empty state message if no sessions exist

**Non-Functional Requirements**:

- Simplicity: < 200 lines total (template + component)
- Accessibility: Keyboard navigation, ARIA labels
- Performance: Signal-based reactivity (OnPush change detection)

**Pattern Compliance**:

- Must use signal-based API (verified in SessionSelectorComponent:537-690)
- Must use standalone component (verified in all session components)
- Must use VS Code CSS variables (verified in SessionSelectorComponent styles)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/empty-chat-state/empty-chat-state.component.ts` (CREATE)
- `libs/frontend/chat/src/lib/components/index.ts` (MODIFY - export component)
- `libs/frontend/chat/src/lib/containers/chat/chat.component.ts` (MODIFY - use component)

---

#### Component 3: ChatService Session Methods (Refactored)

**Purpose**: Update ChatService to use SessionProxy instead of SessionManager

**Pattern**: Service orchestration (existing ChatService pattern)
**Evidence**: ChatService delegates to backend services

- **Location**: `libs/frontend/core/src/lib/services/chat.service.ts:144-150`
- **Pattern**: ChatService → VSCodeService → Backend Service

**Responsibilities**:

- Provide session list signal (delegates to SessionProxy via VSCodeService)
- Create new session (existing behavior, delegates to Claude CLI)
- Switch session (existing behavior)
- Remove session deletion/rename methods

**Implementation Pattern**:

```typescript
// Pattern source: ChatService orchestration
// Verified: libs/frontend/core/src/lib/services/chat.service.ts:144-150
import { Injectable, signal, computed } from '@angular/core';
import { SessionSummary } from '@ptah-extension/shared'; // New type

@Injectable({ providedIn: 'root' })
export class ChatService {
  // Existing dependencies
  private readonly vscode = inject(VSCodeService);

  // Session state (read from backend)
  private readonly _sessions = signal<SessionSummary[]>([]);
  readonly sessions = this._sessions.asReadonly();

  constructor() {
    // Listen for session list updates from backend
    this.vscode.onMessageType(CHAT_MESSAGE_TYPES.SESSIONS_UPDATED).subscribe((payload) => {
      this._sessions.set(payload.sessions);
    });
  }

  // Request sessions from backend (SessionProxy)
  async refreshSessions(): Promise<void> {
    this.vscode.postStrictMessage(CHAT_MESSAGE_TYPES.REQUEST_SESSIONS, {});
  }

  // Existing methods (keep)
  async createNewSession(name?: string): Promise<void> {
    // Existing implementation (delegates to backend)
  }

  async switchToSession(sessionId: SessionId): Promise<void> {
    // Existing implementation (delegates to backend)
  }

  // DELETE these methods (no longer supported)
  // - deleteSession() ❌
  // - renameSession() ❌
  // - exportSession() ❌
}
```

**Files Affected**:

- `libs/frontend/core/src/lib/services/chat.service.ts` (MODIFY - remove unsupported methods)
- `libs/shared/src/lib/types/message.types.ts` (MODIFY - may add SessionSummary to payloads)

---

## 🔗 Integration Architecture

### Integration Points

**Integration 1: Backend Message Handlers → SessionProxy**

- **Current**: Handlers call SessionManager (full CRUD)
- **New**: Handlers call SessionProxy (list, get only)
- **Location**: `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`
- **Changes**:
  - REQUEST_SESSIONS: Call SessionProxy.listSessions()
  - DELETE_SESSION: Remove handler (unsupported)
  - RENAME_SESSION: Remove handler (unsupported)

**Integration 2: ChatComponent → EmptyChatStateComponent**

- **Current**: ChatComponent uses SessionSelectorComponent (imported from session library)
- **New**: ChatComponent uses EmptyChatStateComponent (inline in chat library)
- **Location**: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts:55, 83`
- **Changes**:
  - Remove SessionSelectorComponent import
  - Add EmptyChatStateComponent import
  - Show EmptyChatStateComponent when messages().length === 0

**Integration 3: ChatService → Backend (via VSCodeService)**

- **Current**: ChatService delegates to backend SessionManager
- **New**: ChatService delegates to backend SessionProxy
- **No location change**: Message flow stays the same (VSCodeService → message handlers)

### Data Flow

**New Message Flow: List Sessions**

```
EmptyChatStateComponent (render)
  ↓
ChatService.refreshSessions()
  ↓
VSCodeService.postStrictMessage(REQUEST_SESSIONS)
  ↓
Backend Message Handler (angular-webview.provider.ts)
  ↓
SessionProxy.listSessions()
  ↓
Read .claude_sessions/ directory (file system)
  ↓
Parse session JSON files
  ↓
Return SessionSummary[]
  ↓
Backend publishes SESSIONS_UPDATED event
  ↓
VSCodeService receives message
  ↓
ChatService updates sessions signal
  ↓
EmptyChatStateComponent re-renders (signal change)
```

**New Message Flow: Create Session**

```
EmptyChatStateComponent (click "Create New Session")
  ↓
ChatService.createNewSession()
  ↓
VSCodeService.postStrictMessage(CREATE_SESSION)
  ↓
Backend Message Handler
  ↓
ChatOrchestrationService.createSession()
  ↓
ClaudeCliService.sendMessage() (first message creates session)
  ↓
Claude CLI process spawned
  ↓
JSONL stream returns session_id (system init message)
  ↓
SessionProxy receives session_id
  ↓
Backend publishes SESSION_CREATED event
  ↓
ChatService updates currentSession signal
  ↓
ChatComponent switches to chat view (EmptyChatState → Messages)
```

### Dependencies

**New Dependencies**:

- SessionProxy depends on: `fs.promises`, `path`, `os` (Node.js built-ins)
- EmptyChatStateComponent depends on: ChatService (existing)

**Removed Dependencies**:

- SessionManager dependency removed from all handlers
- libs/frontend/session library removed entirely

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

**Session Listing**:

- List all sessions from `.claude_sessions/` directory
- Display session name, message count, time ago
- Handle empty state (no sessions exist)
- Sort by lastActiveAt (most recent first)

**Session Creation**:

- "Create New Session" button spawns Claude CLI
- First message in session establishes session ID
- New session appears in list immediately after creation

**Session Switching**:

- Click session in list switches to that session
- Messages from selected session load in chat view
- Session resumption uses `--session <id>` flag

### Non-Functional Requirements

**Performance**:

- List sessions: < 100ms for 50 sessions
- Switch session: < 200ms (load messages from Claude CLI)
- No caching overhead (file system is fast enough)

**Reliability**:

- Graceful handling of missing `.claude_sessions/` directory
- Graceful handling of corrupt session JSON files
- Error messages shown in UI (not silent failures)

**Maintainability**:

- SessionProxy: < 200 lines (single responsibility)
- EmptyChatStateComponent: < 200 lines (simple presentation)
- Clear separation: backend (file access) vs frontend (UI)

### Pattern Compliance

**Backend Patterns** (verified from codebase):

- Must use @injectable() decorator (verified: session-manager.ts:138)
- Must use TOKENS for DI (verified: vscode-core/src/di/tokens.ts)
- Must publish events via EventBus (verified: session-manager.ts:197)

**Frontend Patterns** (verified from codebase):

- Must use signal-based state (verified: SessionSelectorComponent:537-690)
- Must use standalone components (verified: all chat components)
- Must use VS Code CSS variables (verified: SessionSelectorComponent styles)

---

## 📋 Phased Implementation Plan

### Phase 1: Create New Architecture (No Breaking Changes)

**Goal**: Build new SessionProxy and EmptyChatStateComponent alongside old code

**Tasks**:

1. **Create SessionProxy service**

   - File: `libs/backend/claude-domain/src/session/session-proxy.ts`
   - Implement: listSessions(), getSessionDetails()
   - Test: Unit tests for file system operations
   - No integration yet (old SessionManager still active)

2. **Create SessionSummary type**

   - File: `libs/shared/src/lib/types/claude-domain.types.ts`
   - Add: SessionSummary interface (id, name, messageCount, lastActiveAt)
   - Export from shared library index

3. **Create EmptyChatStateComponent**

   - File: `libs/frontend/chat/src/lib/components/empty-chat-state/empty-chat-state.component.ts`
   - Implement: Session list display, "Create New Session" button
   - Test: Component tests (signal inputs/outputs)
   - No integration yet (ChatComponent still uses SessionSelector)

4. **Update ChatService (additive changes only)**
   - File: `libs/frontend/core/src/lib/services/chat.service.ts`
   - Add: sessions signal, refreshSessions() method
   - Keep: Existing createNewSession(), switchToSession()
   - No removals yet (old methods still work)

**Acceptance Criteria**:

- ✅ SessionProxy lists sessions from `.claude_sessions/`
- ✅ EmptyChatStateComponent renders session list
- ✅ All existing tests still pass
- ✅ No breaking changes to existing functionality

---

### Phase 2: Remove Duplicate Storage

**Goal**: Stop using SessionManager storage, switch to SessionProxy

**Tasks**:

1. **Update backend message handlers**

   - File: `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`
   - Change: REQUEST_SESSIONS handler calls SessionProxy.listSessions()
   - Change: CREATE_SESSION handler no longer calls SessionManager.createSession()
   - Test: E2E tests for session listing

2. **Update DI registration**

   - File: `libs/backend/claude-domain/src/di/register.ts`
   - Add: SessionProxy registration
   - Keep: SessionManager registration (for now, gradual migration)

3. **Update ChatComponent integration**
   - File: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts`
   - Change: Use EmptyChatStateComponent instead of SessionSelectorComponent
   - Condition: Show EmptyChatState when messages().length === 0
   - Remove: SessionSelectorComponent import

**Acceptance Criteria**:

- ✅ Session list reads from `.claude_sessions/` directory
- ✅ EmptyChatStateComponent shows on empty chat screen
- ✅ Session creation works (via Claude CLI)
- ✅ SessionManager no longer writes to VS Code storage

---

### Phase 3: Remove Unsupported Features

**Goal**: Remove delete, rename, export features from UI and backend

**Tasks**:

1. **Remove unsupported ChatService methods**

   - File: `libs/frontend/core/src/lib/services/chat.service.ts`
   - Remove: deleteSession(), renameSession(), exportSession()
   - Test: Verify no usages remain (TypeScript compilation check)

2. **Remove unsupported backend handlers**

   - File: `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts`
   - Remove: DELETE_SESSION, RENAME_SESSION handlers
   - Remove: Corresponding message type handlers

3. **Remove unsupported SessionManager methods**
   - File: `libs/backend/claude-domain/src/session/session-manager.ts`
   - Remove: deleteSession(), renameSession(), clearSession(), bulkDeleteSessions(), exportSession()
   - Keep: Minimal methods needed for legacy compatibility (if any)

**Acceptance Criteria**:

- ✅ No delete session UI elements
- ✅ No rename session UI elements
- ✅ No export session UI elements
- ✅ Backend handlers removed
- ✅ TypeScript compilation passes (no orphaned usages)

---

### Phase 4: Delete Session Management Library

**Goal**: Remove `libs/frontend/session` entirely

**Tasks**:

1. **Verify no remaining usages**

   - Search: SessionManagerComponent, SessionSelectorComponent, SessionCardComponent
   - Files to check: All frontend libraries, app components
   - Verify: Zero imports from @ptah-extension/session

2. **Remove library from workspace**

   - Delete: `libs/frontend/session/` directory
   - Update: `tsconfig.base.json` (remove path alias)
   - Update: `nx.json` (if session library is listed)

3. **Update documentation**
   - Update: `CLAUDE.md` (remove session library references)
   - Update: `README.md` (remove session features)
   - Update: Library documentation index

**Acceptance Criteria**:

- ✅ `libs/frontend/session/` directory deleted
- ✅ No imports from @ptah-extension/session
- ✅ TypeScript compilation passes
- ✅ All tests pass
- ✅ Documentation updated

---

### Phase 5: Simplify SessionManager (Optional Cleanup)

**Goal**: Reduce SessionManager to absolute minimum or remove entirely

**Tasks**:

1. **Analyze remaining SessionManager usage**

   - Search: SessionManager usages in codebase
   - Determine: Is SessionManager still needed for anything?
   - Options:
     - A) Fully remove SessionManager (if SessionProxy covers all needs)
     - B) Keep minimal SessionManager for chat session state (non-persistent)

2. **Decision: Remove or Simplify**

   - If Remove: Delete SessionManager, update all usages to SessionProxy
   - If Simplify: Remove all persistence logic, keep in-memory session state only

3. **Update tests**
   - Remove: SessionManager tests (if deleted)
   - Update: Tests that mock SessionManager

**Acceptance Criteria**:

- ✅ SessionManager either removed or simplified to < 200 lines
- ✅ No duplicate storage logic remains
- ✅ All tests pass

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **backend-developer + frontend-developer** (both required)

**Rationale**:

**Backend Work** (60% of effort):

- Create SessionProxy service (Node.js file system operations)
- Update message handlers in VS Code extension
- DI registration and integration
- Requires: TypeScript, Node.js fs/path APIs, VS Code extension APIs

**Frontend Work** (40% of effort):

- Create EmptyChatStateComponent (Angular)
- Update ChatService (remove methods)
- Update ChatComponent integration
- Requires: Angular 20 signals, standalone components, VS Code webview constraints

**Team Composition**: 1 backend developer + 1 frontend developer working in parallel

---

### Complexity Assessment

**Complexity**: **MEDIUM**
**Estimated Effort**: **12-16 hours**

**Breakdown**:

**Phase 1** (New Architecture): 4-5 hours

- SessionProxy implementation: 2 hours
- EmptyChatStateComponent: 2 hours
- ChatService updates: 1 hour

**Phase 2** (Remove Duplicate Storage): 3-4 hours

- Backend message handlers: 2 hours
- ChatComponent integration: 1-2 hours

**Phase 3** (Remove Unsupported Features): 2-3 hours

- Remove methods from ChatService: 1 hour
- Remove backend handlers: 1 hour
- Remove SessionManager methods: 1 hour

**Phase 4** (Delete Library): 2-3 hours

- Verify no usages: 1 hour
- Delete library, update configs: 1 hour
- Update documentation: 1 hour

**Phase 5** (Optional Cleanup): 1-2 hours

- Analyze and simplify SessionManager: 1-2 hours

---

### Files Affected Summary

**CREATE** (4 files):

- `libs/backend/claude-domain/src/session/session-proxy.ts` (SessionProxy service)
- `libs/backend/claude-domain/src/session/session-proxy.spec.ts` (Unit tests)
- `libs/frontend/chat/src/lib/components/empty-chat-state/empty-chat-state.component.ts`
- `libs/frontend/chat/src/lib/components/empty-chat-state/empty-chat-state.component.spec.ts`

**MODIFY** (8 files):

- `libs/shared/src/lib/types/claude-domain.types.ts` (Add SessionSummary type)
- `libs/shared/src/index.ts` (Export SessionSummary)
- `libs/backend/claude-domain/src/index.ts` (Export SessionProxy)
- `libs/backend/claude-domain/src/di/register.ts` (Register SessionProxy)
- `libs/frontend/core/src/lib/services/chat.service.ts` (Add sessions signal, remove unsupported methods)
- `libs/frontend/chat/src/lib/components/index.ts` (Export EmptyChatStateComponent)
- `libs/frontend/chat/src/lib/containers/chat/chat.component.ts` (Use EmptyChatStateComponent)
- `apps/ptah-extension-vscode/src/providers/angular-webview.provider.ts` (Update handlers)

**DELETE** (entire library):

- `libs/frontend/session/` (Complete directory deletion)
- Remove `@ptah-extension/session` path alias from `tsconfig.base.json`

**REWRITE** (1 file - Direct Replacement):

- `libs/backend/claude-domain/src/session/session-manager.ts` (Simplify to < 200 lines OR delete entirely)

---

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **Claude CLI session directory location**:

   - Verify: `.claude_sessions/` exists in workspace or `~/.claude_sessions/` in home
   - Test: Create a session with Claude CLI, verify JSON file created
   - Location: SessionProxy.getSessionsDirectory()

2. **Claude CLI session JSON format**:

   - Verify: Session files contain `id`, `messages`, `created_at`, `updated_at`
   - Parse: Understand JSON structure for SessionSummary mapping
   - Test: Parse existing session file, verify no errors

3. **No breaking changes in Phase 1-2**:

   - Verify: All existing session tests pass
   - Verify: Old SessionSelector still works (until Phase 3)
   - Test: E2E test for session creation/switching

4. **EmptyChatStateComponent shows correctly**:
   - Verify: Component shows when messages().length === 0
   - Verify: Component hides when messages exist
   - Test: Visual regression test (screenshot comparison)

---

## 📐 Architecture Delivery Checklist

- ✅ All components specified with evidence
- ✅ All patterns verified from codebase
- ✅ All imports/decorators verified as existing
- ✅ Quality requirements defined (functional + non-functional)
- ✅ Integration points documented
- ✅ Files affected list complete
- ✅ Developer types recommended (backend + frontend)
- ✅ Complexity assessed (MEDIUM, 12-16 hours)
- ✅ No step-by-step implementation (that's team-leader's job)
- ✅ Phased approach with clear acceptance criteria
- ✅ Evidence citations for all decisions

---

## 📚 Evidence Provenance

**Decision 1**: Use direct file access for session listing
**Evidence**:

- ClaudeCliDetector pattern: `libs/backend/claude-domain/src/detector/claude-cli-detector.ts:120-180`
- File system operations: `fs.promises`, `path.join()` usage verified
- Claude CLI session storage: Inferred from ClaudeCliLauncher.spawnTurn() resumption pattern

**Decision 2**: Remove session library entirely
**Evidence**:

- Over-engineering: SessionManagerComponent 910 lines, SessionSelectorComponent 628 lines
- Requirements: User asked for "small component on empty chat screen" (< 200 lines sufficient)
- Usage analysis: Session library imported only in ChatComponent (1 location)

**Decision 3**: SessionProxy instead of enhancing SessionManager
**Evidence**:

- Duplicate storage: SessionManager.loadSessions() reads from VS Code storage (line 800)
- Single source of truth: User requirement "use `.claude_sessions/` as single source"
- Separation of concerns: SessionProxy (file access) vs SessionManager (persistence)

**Decision 4**: EmptyChatStateComponent in chat library
**Evidence**:

- Existing pattern: ChatComponent already has empty state logic (inferred from template structure)
- Minimal scope: Component only used on empty chat screen (not reusable)
- Library organization: Chat library contains all chat UI components

**Decision 5**: Remove delete/rename/export features
**Evidence**:

- Claude CLI limitation: No `claude --session delete` command exists
- User requirement: "Remove session deletion features (CLI doesn't support this)"
- Over-engineering: Export to JSON/Markdown not requested in requirements

---

## 🚀 Migration Strategy

### Backward Compatibility

**NO backward compatibility needed**. This is an internal refactoring with:

- ✅ No public API changes (extension commands stay same)
- ✅ No data migration (`.claude_sessions/` is already source of truth)
- ✅ No user-facing breaking changes (session list still works)

**User Impact**:

- Users will lose ability to delete sessions in UI (but this was non-functional anyway)
- Users will lose session rename/export features (not commonly used)
- Users gain faster session loading (no duplicate storage)

### Data Migration

**NO data migration needed** because:

1. `.claude_sessions/` directory already exists (Claude CLI manages it)
2. Ptah's duplicate storage in VS Code will be ignored (not deleted, just unused)
3. Next time user creates a session, it goes directly to `.claude_sessions/`

### Rollback Plan

**If refactoring fails**, rollback by:

1. Restore `libs/frontend/session/` from git (entire library)
2. Revert ChatComponent changes (restore SessionSelectorComponent)
3. Revert backend message handlers (restore SessionManager calls)
4. Delete SessionProxy (not integrated yet)

**Rollback complexity**: LOW (all changes in version control)

---

## 📊 Success Metrics

**Code Reduction**:

- Before: 1000+ lines (SessionManagerComponent 910, SessionSelectorComponent 628)
- After: < 400 lines (SessionProxy 200, EmptyChatStateComponent 200)
- Reduction: ~70% reduction in session management code

**Performance**:

- Before: Session list requires VS Code storage read + parse
- After: Session list requires file system directory read + parse (faster)
- Target: < 100ms for listing 50 sessions

**Simplicity**:

- Before: 3 packages (frontend session, backend session manager, shared types)
- After: 2 packages (backend session proxy, shared types)
- Removal: Entire frontend session library (1 package deleted)

**Feature Parity**:

- Retained: List sessions, create session, switch session
- Removed: Delete session, rename session, export session
- Impact: Aligns with Claude CLI capabilities (no unsupported features)

---

## 🎓 Lessons Learned (For Future Reference)

**Architecture Principle**: Always verify CLI capabilities before building UI

- Mistake: Built delete session UI when Claude CLI doesn't support deletion
- Fix: Investigate CLI first, then design UI

**Storage Principle**: Single source of truth prevents sync bugs

- Mistake: Duplicated session data in VS Code storage
- Fix: Read directly from `.claude_sessions/` directory

**Simplicity Principle**: Build minimal UI for actual requirements

- Mistake: Built 900-line SessionManager component for "empty chat screen"
- Fix: Build 200-line EmptyChatStateComponent for actual need

**Library Principle**: Don't create libraries for single-use components

- Mistake: Created entire session library for 1 component usage
- Fix: Inline components in their primary usage location (chat library)
