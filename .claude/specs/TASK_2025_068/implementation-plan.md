# Implementation Plan - TASK_2025_068

**Task**: Session ID System Refactoring + Named Sessions  
**Strategy**: Strengthen Dual-ID System (Research Recommendation)  
**Date**: 2025-12-11T13:35:00+02:00  
**Architect**: software-architect

---

## Goal

Eliminate UUID validation errors, race conditions, and complexity in the current dual session ID system by generating proper UUIDs for placeholder IDs, implementing atomic resolution operations, and adding named session support with custom metadata storage.

**Key Insight from Research**: The Claude Agent SDK **requires an initial prompt** to create a session - empty session creation is not possible. Therefore, the dual-ID system exists for a valid architectural reason: the frontend needs a session ID **before** the user sends their first message (to create the tab), but the SDK only provides the real UUID **after** processing that first message. Instead of forcing workarounds with placeholder prompts (which waste API calls), we'll **strengthen the existing dual-ID system** to make it robust and reliable.

> **CRITICAL USER REQUIREMENT**: "I don't think it's a good practice to initialize the session with a placeholder prompt." - User feedback rejecting alternative approaches that misalign with SDK design.

---

## User Review Required

> [!WARNING] > **Breaking Change**: `placeholderSessionId` field changes from `string` format (`msg_123_abc`) to proper UUID v4 format  
> **Impact**: Existing sessions with old placeholder format will ignore the field (backward compatible via graceful degradation)  
> **Mitigation**: Frontend will continue to use `claudeSessionId` as authoritative, old placeholders simply won't match UUID validation

> [!IMPORTANT] > **Named Sessions UX Decision**: ✅ **APPROVED**
>
> - **Default naming format**: Slugified timestamp (e.g., `session-12-11-14-45`)
> - **Session name**: Optional (empty input generates default)
> - **UI Component**: Use existing `@ptah-extension/ui` PopoverComponent

> [!IMPORTANT] > **Session Name Input UX**: ✅ **APPROVED**
>
> - Use existing `PopoverComponent` from `@ptah-extension/ui`
> - Text input for session name (placeholder: "Enter session name (optional)")
> - Two buttons: "Create" (primary) and "Cancel" (secondary)
> - Empty input → generates slugified timestamp: `session-12-11-14-45`
> - ESC key → closes popover, Enter key → creates session
> - Positioned below "New Session" button

---

## Proposed Changes

### Component 1: Frontend Session Types

**Purpose**: Fix UUID validation by changing placeholder ID generation to use proper UUIDs

---

#### [MODIFY] [chat.types.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat.types.ts#L53-L96)

**Line Range**: 53-96  
**Changes**:

- Update `TabState` interface documentation for `placeholderSessionId` to clarify it's a proper UUID (not `msg_` prefix)
- Add `name` field to `TabState` for session naming

**Pattern Reference**: [sdk-session.types.ts:89-140](file:///d:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/types/sdk-session.types.ts#L89-L140) (StoredSession interface with `name` field)

**Before**:

```typescript
export interface TabState {
  /** Unique tab identifier (frontend-generated) */
  id: string;

  /** Real Claude CLI session UUID (null if draft) */
  claudeSessionId: string | null;

  /** Placeholder session ID used during streaming before real ID resolved */
  placeholderSessionId?: string | null;

  /** Display title for the tab */
  title: string;
  // ...
}
```

**After**:

```typescript
export interface TabState {
  /** Unique tab identifier (frontend-generated) */
  id: string;

  /** Real Claude CLI session UUID (null if draft) */
  claudeSessionId: string | null;

  /**
   * Placeholder session ID (proper UUID v4) used temporarily before Claude SDK resolves real ID.
   * Generated via uuid.v4() at tab creation.
   * Cleared after session:id-resolved event updates claudeSessionId.
   *
   * @example "550e8400-e29b-41d4-a716-446655440000"
   */
  placeholderSessionId: string | null;

  /** User-provided or auto-generated session name */
  name: string;

  /** Display title for the tab (deprecated - use name instead) */
  title: string;
  // ...
}
```

**Quality Requirements**:

- ✅ `placeholderSessionId` documentation updated to specify UUID v4 format
- ✅ `name` field added with clear documentation
- ✅ Backward compatible (existing code treating placeholderSessionId as string still works)

---

### Component 2: Frontend Tab Management

**Purpose**: Generate proper UUIDs for placeholder IDs and include session naming

---

#### [MODIFY] [tab-manager.service.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/tab-manager.service.ts)

**Changes**:

- Install `uuid` package if not already available
- Import `v4 as uuidv4` from `uuid`
- Update `createNewTab()` to generate proper UUID for `placeholderSessionId`
- Add `name` parameter to `createNewTab()` with default name generation using timestamp
- Update `resolveSessionId()` to use atomic signal update operation

**Pattern Reference**: [chat.store.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/chat.store.ts) (signal-based state management pattern)

**Example**:

```typescript
import { v4 as uuidv4 } from 'uuid';

createNewTab(name?: string): TabState {
  const placeholderId = uuidv4(); // ✅ Proper UUID instead of msg_${Date.now()}_${random}
  const sessionName = name || `Session ${new Date().toLocaleString()}`;

  return {
    id: this.generateTabId(),
    placeholderSessionId: placeholderId, // Valid UUID v4
    claudeSessionId: null,
    name: sessionName,
    title: sessionName, // Keep for backward compatibility
    status: 'draft',
    // ... other fields
  };
}

/**
 * Atomically resolve placeholder session ID to real Claude session ID.
 * Prevents race conditions during tab switching.
 */
resolveSessionId(placeholderId: string, claudeSessionId: string): void {
  this.updateTabs(tabs => tabs.map(tab =>
    tab.placeholderSessionId === placeholderId
      ? {
          ...tab,
          claudeSessionId,
          placeholderSessionId: null, // ✅ Clear after resolution
          status: 'active'
        }
      : tab
  ));
}
```

**Quality Requirements**:

- ✅ Uses `uuid.v4()` for placeholder IDs (passes UUID validation)
- ✅ Atomic resolution operation (no race conditions)
- ✅ Session naming with timestamp default
- ✅ Backward compatible (title field maintained)

---

#### [MODIFY] [pending-session-manager.service.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/pending-session-manager.service.ts)

**Changes**:

- Remove 60-second timeout cleanup logic (no longer needed with atomic resolution)
- Simplify to immediate cleanup after resolution
- Keep service file (refactor, don't delete) to maintain minimal coordination logic

**Pattern Reference**: Existing constructor and methods, simplified

**Before** (with timeout):

```typescript
add(placeholderId: string, tabId: string): void {
  this.resolutions.set(placeholderId, tabId);

  // 60-second timeout cleanup
  setTimeout(() => {
    if (this.resolutions.has(placeholderId)) {
      this.resolutions.delete(placeholderId);
      this.logger.warn('Placeholder session timed out', { placeholderId });
    }
  }, 60000);
}
```

**After** (immediate cleanup):

```typescript
add(placeholderId: string, tabId: string): void {
  this.resolutions.set(placeholderId, tabId);
  // ❌ No timeout - resolution is now immediate and atomic
}

resolve(placeholderId: string, realId: string): void {
  const tabId = this.resolutions.get(placeholderId);
  if (tabId) {
    this.tabManager.resolveSessionId(placeholderId, realId);
    this.resolutions.delete(placeholderId); // ✅ Immediate cleanup
  }
}
```

**Quality Requirements**:

- ✅ No memory leaks (immediate cleanup, no 60s retention)
- ✅ Simpler logic (remove timeout complexity)
- ✅ Atomic coordination with TabManager

---

### Component 3: Shared RPC Types

**Purpose**: Add session name parameter to RPC types for backend-frontend communication

---

#### [MODIFY] [rpc.types.ts](file:///d:/projects/ptah-extension/libs/shared/src/lib/types/rpc.types.ts#L17-L59)

**Line Range**: 17-59 (ChatStartParams and related types)  
**Changes**:

- Add `name?: string` parameter to `ChatStartParams`
- Add `name?: string` parameter to `ChatContinueParams` (for late naming)

**Pattern Reference**: Existing RPC types with optional parameters

**Before**:

```typescript
export interface ChatStartParams {
  prompt?: string;
  sessionId: SessionId;
  workspacePath?: string;
  options?: {
    model?: string;
    systemPrompt?: string;
    files?: string[];
  };
}
```

**After**:

```typescript
export interface ChatStartParams {
  prompt?: string;
  sessionId: SessionId;
  /** User-provided session name (optional) */
  name?: string;
  workspacePath?: string;
  options?: {
    model?: string;
    systemPrompt?: string;
    files?: string[];
  };
}

export interface ChatContinueParams {
  prompt: string;
  sessionId: SessionId;
  /** User-provided session name (optional - for late naming) */
  name?: string;
  workspacePath?: string;
  model?: string;
  files?: string[];
}
```

**Quality Requirements**:

- ✅ Type-safe session naming in RPC calls
- ✅ Optional parameter (backward compatible)
- ✅ Available in both start and continue flows

---

### Component 4: Backend Session Storage

**Purpose**: Store session names in backend session records

---

#### [MODIFY] [session-lifecycle-manager.ts](file:///d:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts)

**Changes**:

- Update `createSessionRecord()` to accept optional `name` parameter
- Pass name to `SdkSessionStorage.saveSession()`
- Generate default name if not provided: `Session ${new Date().toLocaleString()}`

**Pattern Reference**: [sdk-session-storage.ts](file:///d:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/sdk-session-storage.ts) (session persistence pattern)

**Example**:

```typescript
async createSessionRecord(sessionId: SessionId, name?: string): Promise<void> {
  const sessionName = name || `Session ${new Date().toLocaleString()}`;

  const storedSession: StoredSession = {
    id: sessionId,
    workspaceId: this.configManager.getWorkspaceId(),
    name: sessionName, // ✅ Store user-provided or generated name
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    messages: [],
    totalTokens: { input: 0, output: 0 },
    totalCost: 0,
  };

  await this.storage.saveSession(storedSession);
}

/**
 * Update session with real Claude session ID when resolved
 * NOTE: Name is already stored from createSessionRecord(), no update needed
 */
async updateClaudeSessionId(
  placeholderSessionId: SessionId,
  claudeSessionId: string
): Promise<void> {
  const session = await this.storage.getSession(placeholderSessionId);
  if (!session) return;

  const updatedSession: StoredSession = {
    ...session,
    claudeSessionId, // Real SDK session ID
    // name preserved from original creation
  };
  await this.storage.saveSession(updatedSession);
}
```

**Quality Requirements**:

- ✅ Session names stored in `StoredSession.name` field (already exists in schema)
- ✅ Default name generation with consistent format
- ✅ No schema migration required (field already exists)

---

#### [MODIFY] [sdk-agent-adapter.ts](file:///d:/projects/ptah-extension/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L400-L430)

**Line Range**: 400-430 (startChatSession method)  
**Changes**:

- Accept `name` parameter in `AISessionConfig` (or add custom parameter)
- Pass name to `sessionLifecycle.createSessionRecord(sessionId, name)`

**Pattern Reference**: Existing session creation flow with config object

**Example**:

```typescript
async startChatSession(
  sessionId: SessionId,
  config?: AISessionConfig & { name?: string } // ✅ Add name parameter
): Promise<AsyncIterable<ExecutionNode>> {
  // ... existing initialization ...

  // Create session record with name
  await this.sessionLifecycle.createSessionRecord(sessionId, config?.name);

  // ... rest of method unchanged ...
}
```

**Quality Requirements**:

- ✅ Session name passed from RPC layer to storage
- ✅ Backward compatible (name is optional)

---

### Component 5: Backend RPC Handlers

**Purpose**: Extract session name from RPC parameters and pass to session creation

---

#### [MODIFY] [rpc-method-registration.service.ts](file:///d:/projects/ptah-extension/apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts#L252-L312)

**Line Range**: 252-312 (chat:start RPC handler)  
**Changes**:

- Extract `name` from `ChatStartParams`
- Pass name to `startChatSession()` via config object
- Log session name for debugging

**Pattern Reference**: Existing RPC parameter extraction pattern (lines 258-262)

**Before**:

```typescript
this.rpcHandler.registerMethod<ChatStartParams, ChatStartResult>(
  'chat:start',
  async (params) => {
    try {
      const { prompt, sessionId, workspacePath, options } = params;
      // ...
      const stream = await this.sdkAdapter.startChatSession(sessionId, {
        workspaceId: workspacePath,
        model: options?.model || currentModel,
        systemPrompt: options?.systemPrompt,
        projectPath: workspacePath,
      });
      // ...
    }
  }
);
```

**After**:

```typescript
this.rpcHandler.registerMethod<ChatStartParams, ChatStartResult>(
  'chat:start',
  async (params) => {
    try {
      const { prompt, sessionId, workspacePath, options, name } = params; // ✅ Extract name
      this.logger.debug('RPC: chat:start called', {
        sessionId,
        workspacePath,
        sessionName: name, // ✅ Log for debugging
      });

      // ...
      const stream = await this.sdkAdapter.startChatSession(sessionId, {
        workspaceId: workspacePath,
        model: options?.model || currentModel,
        systemPrompt: options?.systemPrompt,
        projectPath: workspacePath,
        name, // ✅ Pass to session creation
      });
      // ...
    }
  }
);
```

**Quality Requirements**:

- ✅ Session name extracted from RPC params
- ✅ Logged for debugging
- ✅ Passed to backend session creation

---

### Component 6: Frontend RPC Calls

**Purpose**: Send session name from frontend to backend

---

#### [MODIFY] [message-sender.service.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/message-sender.service.ts)

**Changes**:

- Update `sendMessage()` to include `name` parameter from `TabState`
- Pass name in both `chat:start` and `chat:continue` RPC calls

**Pattern Reference**: Existing RPC call pattern with parameter construction

**Example**:

```typescript
async sendMessage(
  sessionId: string,
  prompt: string,
  options?: { files?: string[]; model?: string }
): Promise<void> {
  const tab = this.tabManager.findTabBySessionId(sessionId);
  if (!tab) throw new Error(`Tab not found for session ${sessionId}`);

  const isNewSession = tab.status === 'draft' && tab.messages.length === 0;

  if (isNewSession) {
    await this.rpc.call<ChatStartResult>('chat:start', {
      sessionId: SessionId.from(sessionId),
      prompt,
      name: tab.name, // ✅ Send session name
      workspacePath: this.getWorkspacePath(),
      options: {
        model: options?.model,
        files: options?.files,
      },
    });
  } else {
    await this.rpc.call<ChatContinueResult>('chat:continue', {
      sessionId: SessionId.from(sessionId),
      prompt,
      name: tab.name, // ✅ Send session name (support late naming)
      workspacePath: this.getWorkspacePath(),
      model: options?.model,
      files: options?.files,
    });
  }
}
```

**Quality Requirements**:

- ✅ Session name sent in RPC calls
- ✅ Available in both start and continue flows
- ✅ Type-safe (TypeScript ensures name exists in params)

---

### Component 7: Frontend Session Resolution

**Purpose**: Handle session ID resolution with atomic updates

---

#### [MODIFY] [session-loader.service.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts)

**Changes**:

- Update `handleSessionIdResolved()` to call `TabManager.resolveSessionId()` with atomic operation
- Add logging for resolution events
- Handle backward compatibility (ignore legacy placeholders with `msg_` prefix)

**Pattern Reference**: Existing event handler pattern

**Example**:

```typescript
handleSessionIdResolved(placeholder: string, real: string): void {
  this.logger.info('[SessionLoader] Session ID resolved', {
    placeholder,
    real
  });

  // Backward compatibility: Ignore legacy non-UUID placeholders
  if (!placeholder.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
    this.logger.warn('[SessionLoader] Skipping legacy placeholder ID', {
      placeholder,
      format: 'non-UUID'
    });
    return;
  }

  // Atomic resolution via TabManager
  this.tabManager.resolveSessionId(placeholder, real);
}
```

**Quality Requirements**:

- ✅ Atomic resolution operation
- ✅ Backward compatible (graceful degradation for legacy IDs)
- ✅ Proper logging for debugging

---

### Component 8: Package Dependencies

**Purpose**: Ensure UUID library is available

---

#### [MODIFY] [package.json](file:///d:/projects/ptah-extension/package.json)

**Changes**:

- Add `uuid` package if not already present
- Add `@types/uuid` for TypeScript definitions

**Pattern Reference**: Existing dependency management

**Example**:

```json
{
  "dependencies": {
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/uuid": "^10.0.0"
  }
}
```

**Quality Requirements**:

- ✅ UUID generation available in frontend
- ✅ Type definitions for UUID v4 function

---

### Component 9: Session Name Input UI

**Purpose**: Provide user interface for collecting session name when creating new sessions using existing PopoverComponent

---

#### [MODIFY] [app-shell.component.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/app-shell.component.ts)

**Changes**:

- Import `PopoverComponent` from `@ptah-extension/ui`
- Add signal for popover open state
- Add signal for session name input value
- Update `createNewSession()` to toggle popover
- Add helper method for generating slugified default session name
- Add `handleCreateSession()` callback

**Pattern Reference**: [confirmation-dialog.component.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/components/molecules/confirmation-dialog.component.ts) (existing component pattern)

**Implementation**:

```typescript
import { Component, signal, inject, ChangeDetectionStrategy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms'; // Added FormsModule
import { LucideAngularModule, Settings, Plus, PanelLeftClose, PanelLeftOpen, ChevronDown, Check, X } from 'lucide-angular'; // Added Check, X
import { ChatStore } from '../../data-access/chat.store';
import { TabManager } from '../../data-access/tab-manager.service';
import { MessageSenderService } from '../../services/message-sender.service';
import { ChatMessageComponent } from '../molecules/chat-message.component';
import { ChatInputComponent } from '../molecules/chat-input.component';
import { ChatHeaderComponent } from '../molecules/chat-header.component';
import { ChatSidebarComponent } from '../molecules/chat-sidebar.component';
import { PopoverComponent } from '@ptah-extension/ui'; // Added PopoverComponent

/**
 * Main application shell component.
 * Manages the overall layout and interaction between chat components.
 */
@Component({
  selector: 'ptah-app-shell',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule, // Added FormsModule
    LucideAngularModule,
    ChatMessageComponent,
    ChatInputComponent,
    ChatHeaderComponent,
    ChatSidebarComponent,
    PopoverComponent, // Added PopoverComponent
  ],
  templateUrl: './app-shell.component.html',
  styleUrl: './app-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent {
  // Injected services
  protected readonly chatStore = inject(ChatStore);
  protected readonly tabManager = inject(TabManager);
  private readonly messageSender = inject(MessageSenderService);

  // Lucide icons
  readonly SettingsIcon = Settings;
  readonly PlusIcon = Plus;
  readonly CheckIcon = Check; // ✅ Added for "Create" button
  readonly XIcon = X; // ✅ Added for "Cancel" button
  readonly PanelLeftCloseIcon = PanelLeftClose;
  readonly PanelLeftOpenIcon = PanelLeftOpen;
  readonly ChevronDownIcon = ChevronDown;

  // Sidebar state
  readonly isSidebarOpen = signal(true);

  // Popover state
  private readonly _sessionNamePopoverOpen = signal(false);
  readonly sessionNamePopoverOpen = this._sessionNamePopoverOpen.asReadonly();

  // Session name input
  readonly sessionNameInput = signal('');

  /**
   * Generate slugified default session name from current timestamp
   * Format: session-MM-DD-HH-mm (e.g., "session-12-11-14-45")
   */
  private generateDefaultSessionName(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `session-${month}-${day}-${hours}-${minutes}`;
  }

  /**
   * Open session name popover
   */
  createNewSession(): void {
    this.sessionNameInput.set('');
    this._sessionNamePopoverOpen.set(true);
  }

  /**
   * Handle session creation from popover
   */
  handleCreateSession(): void {
    const name = this.sessionNameInput().trim();
    const sessionName = name || this.generateDefaultSessionName();

    // Create new tab with name
    this.tabManager.createNewTab(sessionName);

    // Clear current session (activates new tab)
    this.chatStore.clearCurrentSession();

    // Close popover
    this._sessionNamePopoverOpen.set(false);
  }

  /**
   * Handle popover close (backdrop click or ESC)
   */
  handleCancelSession(): void {
    this._sessionNamePopoverOpen.set(false);
    this.sessionNameInput.set('');
  }

  /**
   * Send a message to the current chat session.
   * @param message The message content.
   */
  async sendMessage(message: string): Promise<void> {
    const currentSessionId = this.chatStore.currentSessionId();
    if (currentSessionId) {
      await this.messageSender.sendMessage(currentSessionId, message);
    }
  }

  /**
   * Toggle the sidebar visibility.
   */
  toggleSidebar(): void {
    this.isSidebarOpen.update((isOpen) => !isOpen);
  }
}
```

**Quality Requirements**:

- ✅ Uses existing `PopoverComponent` from `@ptah-extension/ui`
- ✅ Slugified default naming: `session-MM-DD-HH-mm`
- ✅ Signal-based reactive state
- ✅ Optional session name (empty = default)

---

#### [MODIFY] [app-shell.component.html](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/app-shell.component.html#L24-L32)

**Line Range**: 24-32 ("New Session" button)  
**Changes**:

- Wrap "New Session" button with `PopoverComponent`
- Add popover content with input field and buttons
- Wire up popover state and event handlers

**Before**:

```html
<!-- New session icon button -->
<button class="btn btn-primary btn-sm btn-square flex-shrink-0" (click)="createNewSession()" aria-label="New Session" title="New Session">
  <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
</button>
```

**After**:

```html
<!-- New session popover -->
<ptah-popover [isOpen]="sessionNamePopoverOpen()" [position]="'below'" [hasBackdrop]="true" [backdropClass]="'cdk-overlay-transparent-backdrop'" (closed)="handleCancelSession()">
  <!-- Trigger: New Session button -->
  <button trigger class="btn btn-primary btn-sm btn-square flex-shrink-0" (click)="createNewSession()" aria-label="New Session" title="New Session">
    <lucide-angular [img]="PlusIcon" class="w-3.5 h-3.5" />
  </button>

  <!-- Popover content -->
  <div content class="p-4 w-80">
    <h3 class="text-sm font-semibold mb-3">New Session</h3>

    <!-- Input field -->
    <input #nameInput type="text" class="input input-bordered input-sm w-full mb-3" placeholder="Enter session name (optional)" [(ngModel)]="sessionNameInput" (keydown.enter)="handleCreateSession()" (keydown.escape)="handleCancelSession()" autofocus />

    <!-- Action buttons -->
    <div class="flex gap-2 justify-end">
      <button class="btn btn-ghost btn-sm gap-1" (click)="handleCancelSession()">
        <lucide-angular [img]="XIcon" class="w-3.5 h-3.5" />
        Cancel
      </button>
      <button class="btn btn-primary btn-sm gap-1" (click)="handleCreateSession()">
        <lucide-angular [img]="CheckIcon" class="w-3.5 h-3.5" />
        Create
      </button>
    </div>
  </div>
</ptah-popover>
```

**Quality Requirements**:

- ✅ Uses `PopoverComponent API` (isOpen, position, hasBackdrop, closed event)
- ✅ Trigger slot: "New Session" button
- ✅ Content slot: Input form with Cancel/Create buttons
- ✅ Keyboard shortcuts: Enter = create, ESC = cancel
- ✅ Auto-positioned below button via PopoverComponent

---

#### [MODIFY] [app-shell.component.ts](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/components/templates/app-shell.component.ts#L68-L73)

**Line Range**: 68-73 (Lucide icons)  
**Changes**:

- Add `Check` and `X` icons for popover buttons

**Before**:

```typescript
// Lucide icons
readonly SettingsIcon = Settings;
readonly PlusIcon = Plus;
readonly PanelLeftCloseIcon = PanelLeftClose;
readonly PanelLeftOpenIcon = PanelLeftOpen;
readonly ChevronDownIcon = ChevronDown;
```

**After**:

```typescript
// Lucide icons
readonly SettingsIcon = Settings;
readonly PlusIcon = Plus;
readonly CheckIcon = Check; // ✅ Added for "Create" button
readonly XIcon = X; // ✅ Added for "Cancel" button
readonly PanelLeftCloseIcon = PanelLeftClose;
readonly PanelLeftOpenIcon = PanelLeftOpen;
readonly ChevronDownIcon = ChevronDown;
```

**Quality Requirements**:

- ✅ Icons available for popover buttons

---

## Architecture Summary

### Data Flow: New Session Creation

```
User clicks "New Session" (optional name: "Bug Fix")
  ↓
Frontend: tab-manager.service.ts
  - placeholderId = uuidv4() → "550e8400-e29b-41d4-a716-446655440000" ✅ Valid UUID
  - name = "Bug Fix" || `Session ${timestamp}`
  - Create TabState { placeholderSessionId, name, claudeSessionId: null }
  ↓
User types first message: "Fix login bug"
  ↓
Frontend: message-sender.service.ts
  - RPC: chat:start { sessionId: placeholderId, prompt: "Fix login bug", name: "Bug Fix" }
  ↓
Backend: rpc-method-registration.service.ts
  - Extract name from params
  - sdkAdapter.startChatSession(placeholderId, { name: "Bug Fix" })
  ↓
Backend: sdk-agent-adapter.ts
  - sessionLifecycle.createSessionRecord(placeholderId, "Bug Fix")
  - SDK: query({ prompt: "Fix login bug" })
  ↓
Backend: stream-transformer.ts
  - SDK emits system:init { session_id: "abc-123-def-456" } ← Real Claude UUID
  - sessionIdResolved(placeholderId, "abc-123-def-456")
  ↓
Backend: rpc-method-registration.service.ts (callback)
  - webview.sendMessage('session:id-resolved', { sessionId: placeholderId, realSessionId: "abc-123-def-456" })
  ↓
Frontend: session-loader.service.ts
  - tabManager.resolveSessionId(placeholderId, "abc-123-def-456")
  - Atomic update: { claudeSessionId: "abc-123-def-456", placeholderSessionId: null }
  ↓
Done. Tab now has real Claude session ID.
```

### Key Improvements Over Current System

| Aspect              | Current System                          | Strengthened System                   |
| ------------------- | --------------------------------------- | ------------------------------------- |
| **UUID Validation** | ❌ `msg_123_abc` fails validation       | ✅ `uuidv4()` passes validation       |
| **Race Conditions** | ⚠️ Tab switching during resolution      | ✅ Atomic signal update (no races)    |
| **Cleanup**         | ⚠️ 60-second timeout (memory leak risk) | ✅ Immediate cleanup after resolution |
| **Named Sessions**  | ❌ Not supported                        | ✅ Custom metadata storage            |
| **API Waste**       | ✅ Session starts with user message     | ✅ Session starts with user message   |
| **Semantics**       | ⚠️ `msg_` prefix confusing              | ✅ Clear UUID placeholder             |

---

## Verification Plan

### Automated Tests

#### Unit Tests

```bash
# Frontend - Tab Manager UUID generation
npx nx test chat --testPathPattern=tab-manager.service.spec.ts

# Test Cases:
# - createNewTab() generates valid UUID v4 for placeholderSessionId
# - placeholderSessionId matches UUID regex pattern
# - resolveSessionId() atomically updates tab state
# - Session name defaults to "Session {timestamp}" when not provided
```

```bash
# Backend - Session record creation
npx nx test agent-sdk --testPathPattern=session-lifecycle-manager.spec.ts

# Test Cases:
# - createSessionRecord() stores custom session name
# - createSessionRecord() generates default name when none provided
# - updateClaudeSessionId() preserves session name
```

```bash
# Shared - RPC type definitions
npx nx test shared --testPathPattern=rpc.types.spec.ts

# Test Cases:
# - ChatStartParams accepts optional name parameter
# - ChatContinueParams accepts optional name parameter
# - Type definitions compile without errors
```

#### Integration Tests

```bash
# Full session creation flow
npx nx test chat --testPathPattern=session-creation.integration.spec.ts

# Test Cases:
# - Frontend generates UUID, backend resolves to real Claude ID
# - Session name propagates from frontend → RPC → backend storage
# - session:id-resolved event triggers atomic tab update
# - Legacy sessions with msg_ prefix gracefully ignored
```

### Manual Verification

#### Scenario 1: Create Named Session

1. Open Ptah extension webview
2. Click "New Session" button
3. **Expected**: See input field for session name
4. Enter name: "API Integration Work"
5. Type first message: "Help me integrate REST API"
6. Send message
7. **Expected**:
   - Tab title shows "API Integration Work"
   - Backend logs show UUID placeholder: `550e8400-e29b-41d4-a716-446655440000`
   - After resolution, `claudeSessionId` is set to real Claude UUID
   - Session list shows "API Integration Work" (not UUID)

#### Scenario 2: Create Anonymous Session

1. Click "New Session" without entering name
2. **Expected**: Tab title shows `Session 12/11/2025, 1:45 PM` (timestamp format)
3. Send first message
4. **Expected**: Session functions normally, UUID placeholder resolves correctly

#### Scenario 3: Load Legacy Session

1. Have existing session with old `placeholderSessionId: "msg_1234567_abc"`
2. Restart extension
3. Load session from session list
4. **Expected**:
   - Session loads successfully
   - Messages display correctly
   - `placeholderSessionId` field ignored (uses `claudeSessionId` only)
   - Console warning logged: "Skipping legacy placeholder ID"

#### Scenario 4: UUID Validation

1. Open Developer Tools → Console
2. Create new session
3. Inspect frontend state (via Redux DevTools or signal logging)
4. **Expected**: `placeholderSessionId` matches UUID regex `/^[0-9a-f]{8}-...$/`
5. Send message
6. **Expected**: No UUID validation errors in logs

#### Scenario 5: Race Condition Test

1. Create new session
2. While streaming first response, switch to different tab
3. **Expected**: `session:id-resolved` event updates correct tab
4. Switch back to new session tab
5. **Expected**: Message continues streaming without errors

---

## Team-Leader Handoff

**Developer Type**: Both (backend-developer AND frontend-developer required)  
**Complexity**: High  
**Estimated Tasks**: 12-15 atomic tasks  
**Batch Strategy**: Layer-based (shared types → backend → frontend → integration)

### Recommended Task Batches

**Batch 1: Shared Type Updates** (3 tasks)

1. Update `TabState` interface in `chat.types.ts` (add `name` field, update placeholderSessionId docs)
2. Update `ChatStartParams` and `ChatContinueParams` in `rpc.types.ts` (add `name` parameter)
3. Install/verify `uuid` package dependency

**Batch 2: Backend Session Management** (4 tasks)

1. Update `SessionLifecycleManager.createSessionRecord()` to accept name parameter
2. Update `SdkAgentAdapter.startChatSession()` to accept name in config
3. Update RPC handler for `chat:start` to extract and pass name
4. Update RPC handler for `chat:continue` to extract and pass name

**Batch 3: Frontend Tab Management + UI** (4 tasks)

1. Update `AppShellComponent` to add popover state signals and slugified name generator
2. Update `app-shell.component.html` to wrap "New Session" button with PopoverComponent
3. Update `TabManager.createNewTab()` to use `uuidv4()` and accept name parameter
4. Update `TabManager.resolveSessionId()` to use atomic signal update

**Batch 4: Frontend RPC Integration** (2 tasks)

1. Update `MessageSenderService` to send name in RPC calls
2. Update `SessionLoaderService.handleSessionIdResolved()` for atomic resolution

**Batch 5: Session Resolution & Cleanup** (2 tasks)

1. Update `PendingSessionManagerService` to remove timeout logic
2. Add backward compatibility handling for legacy placeholder IDs

**Batch 6: Testing & Documentation** (2 tasks)

1. Write unit tests for UUID generation, atomic resolution, and dialog UX
2. Update session management documentation

---

**Total Estimated Effort**: 16-20 hours (including UI integration and testing)
**Total Tasks**: 17 atomic tasks across 6 batches (using existing PopoverComponent reduces complexity)
