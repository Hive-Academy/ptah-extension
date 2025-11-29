# Development Tasks - TASK_2025_029

**Task Type**: Frontend (Angular)
**Total Tasks**: 14
**Total Batches**: 5
**Batching Strategy**: Phase-based (State Foundation → UI Components → Integration → Polish → Advanced)
**Status**: 4/5 batches complete (80%)

---

## Batch 1: State Foundation (Phase 2.1-2.3)

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Git Commit**: e8c369d
**Tasks in Batch**: 3
**Dependencies**: None (foundation)
**Estimated Duration**: 1 day
**Commit Pattern**: feat(webview): [description]

### Task 1.1: Define TabState Interface in chat.types.ts

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.types.ts
**Action**: MODIFY
**Status**: ✅ COMPLETE
**Specification Reference**: implementation-plan.md:13-49

**Description**: Add TabState interface to represent individual tab/session state in the multi-session UI.

**Quality Requirements**:

- ✅ Interface follows existing TypeScript patterns in chat.types.ts
- ✅ All properties have JSDoc comments
- ✅ Uses existing types (SessionStatus, ExecutionChatMessage, ExecutionNode)
- ✅ Exported from chat.types.ts

**Implementation Details**:

Add the following interface to chat.types.ts (after existing interfaces):

```typescript
/**
 * Represents a single tab/session in the multi-session UI
 */
export interface TabState {
  /** Unique tab identifier (frontend-generated) */
  id: string;

  /** Real Claude CLI session UUID (null if draft) */
  claudeSessionId: string | null;

  /** Display title for the tab */
  title: string;

  /** Tab order position */
  order: number;

  /** Current session status */
  status: SessionStatus;

  /** Whether session has unsent input */
  isDirty: boolean;

  /** Timestamp of last activity */
  lastActivityAt: number;

  /** Messages for this session */
  messages: ExecutionChatMessage[];

  /** Current execution tree (if streaming) */
  executionTree: ExecutionNode | null;
}
```

**Imports to Add**:

- ExecutionChatMessage (should already exist from shared)
- ExecutionNode (should already exist from shared)

**Verification**:

- ✅ File exists at D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.types.ts
- ✅ TabState interface exported
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`

---

### Task 1.2: Create TabManagerService

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts
**Action**: CREATE
**Status**: ✅ COMPLETE
**Specification Reference**: implementation-plan.md:51-84

**Description**: Create service to manage multiple tab states using Angular signals. This is the central state manager for all tabs.

**Quality Requirements**:

- ✅ Uses Angular 20+ signal-based state management
- ✅ Follows existing service patterns (SessionManager, ChatStore)
- ✅ All signals are readonly (exposed via .asReadonly())
- ✅ Computed signals for derived state
- ✅ Injectable with providedIn: 'root'
- ✅ All methods have JSDoc comments

**Implementation Details**:

```typescript
import { Injectable, signal, computed, inject } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { TabState } from './chat.types';

/**
 * TabManagerService - Manages multi-session tab state
 *
 * Responsibilities:
 * - Create, close, switch between tabs
 * - Track active tab
 * - Persist tab state to VS Code workspace
 * - Resolve Claude session IDs when responses arrive
 */
@Injectable({ providedIn: 'root' })
export class TabManagerService {
  private readonly vscodeService = inject(VSCodeService);

  // Private state signals
  private readonly _tabs = signal<TabState[]>([]);
  private readonly _activeTabId = signal<string | null>(null);

  // Public readonly signals
  readonly tabs = this._tabs.asReadonly();
  readonly activeTabId = this._activeTabId.asReadonly();

  // Computed signals
  readonly activeTab = computed(() => this._tabs().find((t) => t.id === this._activeTabId()) ?? null);
  readonly tabCount = computed(() => this._tabs().length);

  /**
   * Create a new tab
   * @param title - Optional tab title (defaults to "New Chat")
   * @returns Tab ID
   */
  createTab(title?: string): string {
    const id = this.generateTabId();
    const newTab: TabState = {
      id,
      claudeSessionId: null,
      title: title || 'New Chat',
      order: this._tabs().length,
      status: 'fresh',
      isDirty: false,
      lastActivityAt: Date.now(),
      messages: [],
      executionTree: null,
    };

    this._tabs.update((tabs) => [...tabs, newTab]);
    this._activeTabId.set(id);
    this.saveTabState();

    return id;
  }

  /**
   * Close a tab
   * @param tabId - Tab ID to close
   */
  closeTab(tabId: string): void {
    const tabs = this._tabs();
    const tabIndex = tabs.findIndex((t) => t.id === tabId);

    if (tabIndex === -1) return;

    // Remove tab
    this._tabs.update((tabs) => tabs.filter((t) => t.id !== tabId));

    // Switch to adjacent tab if closing active
    if (this._activeTabId() === tabId) {
      const remaining = this._tabs();
      if (remaining.length > 0) {
        // Switch to tab at same index, or last tab if we closed the last one
        const newActiveIndex = Math.min(tabIndex, remaining.length - 1);
        this._activeTabId.set(remaining[newActiveIndex].id);
      } else {
        this._activeTabId.set(null);
      }
    }

    this.saveTabState();
  }

  /**
   * Switch to a different tab
   * @param tabId - Tab ID to switch to
   */
  switchTab(tabId: string): void {
    const tab = this._tabs().find((t) => t.id === tabId);
    if (!tab) {
      console.warn(`[TabManager] Tab not found: ${tabId}`);
      return;
    }

    this._activeTabId.set(tabId);
    this.saveTabState();
  }

  /**
   * Update tab properties
   * @param tabId - Tab ID to update
   * @param updates - Partial tab state updates
   */
  updateTab(tabId: string, updates: Partial<TabState>): void {
    this._tabs.update((tabs) => tabs.map((tab) => (tab.id === tabId ? { ...tab, ...updates, lastActivityAt: Date.now() } : tab)));
    this.saveTabState();
  }

  /**
   * Reorder tabs via drag-and-drop
   * @param fromIndex - Source index
   * @param toIndex - Target index
   */
  reorderTabs(fromIndex: number, toIndex: number): void {
    this._tabs.update((tabs) => {
      const result = [...tabs];
      const [removed] = result.splice(fromIndex, 1);
      result.splice(toIndex, 0, removed);

      // Update order property
      return result.map((tab, index) => ({ ...tab, order: index }));
    });
    this.saveTabState();
  }

  /**
   * Resolve real Claude session ID for a tab
   * Called when backend responds with real UUID
   * @param tabId - Tab ID
   * @param claudeSessionId - Real Claude CLI session UUID
   */
  resolveSessionId(tabId: string, claudeSessionId: string): void {
    this.updateTab(tabId, {
      claudeSessionId,
      status: 'streaming',
    });
  }

  /**
   * Save tab state to VS Code workspace state
   */
  saveTabState(): void {
    const state = {
      tabs: this._tabs(),
      activeTabId: this._activeTabId(),
    };

    // VS Code workspace state API (available via VSCodeService)
    // This will be implemented when VSCodeService provides workspace state methods
    console.log('[TabManager] Saving tab state:', state);
  }

  /**
   * Load tab state from VS Code workspace state
   */
  loadTabState(): void {
    // VS Code workspace state API (available via VSCodeService)
    // This will be implemented when VSCodeService provides workspace state methods
    console.log('[TabManager] Loading tab state (not implemented yet)');
  }

  /**
   * Generate unique tab ID
   */
  private generateTabId(): string {
    return `tab_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
```

**Imports to Verify**:

- Injectable, signal, computed, inject from '@angular/core'
- VSCodeService from '@ptah-extension/core'
- TabState from './chat.types'

**Verification**:

- ✅ File created at D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts
- ✅ Service is injectable
- ✅ All signals are readonly
- ✅ All methods documented
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`

---

### Task 1.3: Refactor ChatStore to Use TabManager

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
**Action**: MODIFY
**Status**: ✅ COMPLETE
**Dependencies**: Tasks 1.1, 1.2 (TabState and TabManager must exist)
**Specification Reference**: implementation-plan.md:86-118

**Description**: Refactor ChatStore to delegate multi-session state to TabManagerService. All operations now work on "active tab" context.

**Quality Requirements**:

- ✅ Maintains backward compatibility (existing components should work)
- ✅ Uses computed signals for state from active tab
- ✅ All session operations are tab-aware
- ✅ handleSessionIdResolved() updates correct tab
- ✅ No breaking changes to public API

**Implementation Details**:

1. **Add TabManager injection** (after other service injections):

```typescript
private readonly tabManager = inject(TabManagerService);
```

2. **Replace single-session signals with computed from active tab**:

Remove these private signals:

```typescript
// REMOVE:
// private readonly _currentSessionId = signal<string | null>(null);
// private readonly _messages = signal<readonly ExecutionChatMessage[]>([]);
// private readonly _currentExecutionTree = signal<ExecutionNode | null>(null);
```

Replace readonly signals with computed from active tab:

```typescript
// Change from signals to computed signals from active tab
readonly currentSessionId = computed(() => this.tabManager.activeTab()?.claudeSessionId ?? null);
readonly messages = computed(() => this.tabManager.activeTab()?.messages ?? []);
readonly currentExecutionTree = computed(() => this.tabManager.activeTab()?.executionTree ?? null);
readonly isStreaming = computed(() => {
  const tab = this.tabManager.activeTab();
  return tab?.status === 'streaming' || tab?.status === 'resuming';
});
```

3. **Update clearCurrentSession()** to create new tab:

```typescript
clearCurrentSession(): void {
  console.log('[ChatStore] Clearing current session for new conversation');

  // Create new tab instead of just clearing state
  const newTabId = this.tabManager.createTab('New Chat');
  this.tabManager.switchTab(newTabId);

  this.currentMessageId = null;
  this.sessionManager.clearSession();
}
```

4. **Update startNewConversation()** to work with active tab:

```typescript
async startNewConversation(content: string, files?: string[]): Promise<void> {
  // ... existing service ready checks ...

  // Get or create active tab
  let activeTabId = this.tabManager.activeTabId();
  if (!activeTabId) {
    activeTabId = this.tabManager.createTab();
    this.tabManager.switchTab(activeTabId);
  }

  // Generate session ID for this tab
  const sessionId = this.generateId();

  // Update tab with draft status
  this.tabManager.updateTab(activeTabId, {
    title: content.substring(0, 50) || 'New Chat',
    status: 'draft',
    isDirty: false,
  });

  // ... rest of existing implementation, but update tab instead of signals ...

  // After adding user message, update tab messages
  const userMessage = createExecutionChatMessage({
    id: this.generateId(),
    role: 'user',
    rawContent: content,
    files,
    sessionId: null as any,
  });

  this.tabManager.updateTab(activeTabId, {
    messages: [...(this.tabManager.activeTab()?.messages ?? []), userMessage],
  });

  // ... rest of RPC call ...
}
```

5. **Update handleSessionIdResolved()** to update correct tab:

```typescript
handleSessionIdResolved(data: { sessionId: string; realSessionId: string }): void {
  console.log('[ChatStore] Session ID resolved:', data);

  const { realSessionId } = data;
  const activeTabId = this.tabManager.activeTabId();

  if (!activeTabId) {
    console.warn('[ChatStore] No active tab for session ID resolution');
    return;
  }

  const activeTab = this.tabManager.activeTab();
  if (activeTab?.status !== 'draft') {
    console.warn('[ChatStore] Ignoring session ID resolution for non-draft tab');
    return;
  }

  // Update tab with real session ID
  this.tabManager.resolveSessionId(activeTabId, realSessionId);

  // Update messages with real session ID
  const updatedMessages = activeTab.messages.map((msg) => ({
    ...msg,
    sessionId: msg.sessionId === null ? realSessionId : msg.sessionId,
  }));

  this.tabManager.updateTab(activeTabId, {
    messages: updatedMessages,
  });

  // Update SessionManager
  this.sessionManager.setClaudeSessionId(realSessionId);

  // Refresh session list
  this.loadSessions().catch((err) => {
    console.warn('[ChatStore] Failed to refresh sessions:', err);
  });
}
```

6. **Update processJsonlChunk()** to update active tab's execution tree:

```typescript
processJsonlChunk(chunk: JSONLMessage): void {
  try {
    const activeTabId = this.tabManager.activeTabId();
    if (!activeTabId) {
      console.warn('[ChatStore] No active tab for JSONL processing');
      return;
    }

    const activeTab = this.tabManager.activeTab();
    const result = this.jsonlProcessor.processChunk(
      chunk,
      activeTab?.executionTree ?? null
    );

    if (result.newMessageStarted) {
      this.currentMessageId = result.messageId ?? null;
    }

    if (result.tree !== activeTab?.executionTree) {
      this.tabManager.updateTab(activeTabId, {
        executionTree: result.tree,
      });
    }

    if (result.streamComplete) {
      this.finalizeCurrentMessage();
    }
  } catch (error) {
    console.error('[ChatStore] Error processing JSONL chunk:', error, chunk);
  }
}
```

7. **Update finalizeCurrentMessage()** to add message to active tab:

```typescript
private finalizeCurrentMessage(): void {
  const activeTabId = this.tabManager.activeTabId();
  if (!activeTabId) return;

  const activeTab = this.tabManager.activeTab();
  const tree = activeTab?.executionTree;

  if (!tree || !this.currentMessageId) return;

  // ... existing finalization logic ...

  const assistantMessage = createExecutionChatMessage({
    id: this.currentMessageId,
    role: 'assistant',
    executionTree: finalTree,
    sessionId: activeTab.claudeSessionId ?? undefined,
  });

  // Add to active tab's messages
  this.tabManager.updateTab(activeTabId, {
    messages: [...activeTab.messages, assistantMessage],
    executionTree: null,
    status: 'loaded',
  });

  this.currentMessageId = null;
  this.sessionManager.setStatus('loaded');
}
```

**Critical Notes**:

- DO NOT remove \_sessions signal (still needed for sidebar session list)
- DO NOT change currentSession computed (still used by sidebar)
- Keep loadSessions() and switchSession() unchanged (sidebar functionality)
- Only refactor current session/messages/execution tree to use TabManager

**Verification**:

- ✅ File modified at D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts
- ✅ TabManager injected and used
- ✅ currentSessionId, messages, currentExecutionTree are computed from active tab
- ✅ All tab operations update TabManager state
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`
- ✅ Existing ChatViewComponent still works (uses same signals)

---

**Batch 1 Verification Requirements**:

- ✅ All 3 files exist with changes
- ✅ TabState interface exported from chat.types.ts
- ✅ TabManagerService injectable and functional
- ✅ ChatStore uses TabManager for multi-session state
- ✅ Build passes: `npx nx build chat`
- ✅ No breaking changes to existing components

---

## Batch 2: Basic Tab UI (Phase 3.1-3.2)

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Git Commit**: 0e65f31
**Tasks in Batch**: 2
**Dependencies**: Batch 1 complete (TabManager must exist)
**Estimated Duration**: 1 day
**Commit Pattern**: feat(webview): [description]

### Task 2.1: Create TabItemComponent

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tab-item.component.ts
**Action**: CREATE
**Status**: ✅ COMPLETE
**Specification Reference**: implementation-plan.md:183-236

**Description**: Create individual tab component showing tab title, status indicator, and close button.

**Quality Requirements**:

- ✅ Uses Angular 20+ standalone component
- ✅ Signal-based inputs via input.required()
- ✅ Signal-based outputs via output()
- ✅ DaisyUI styling for consistent look
- ✅ Lucide icons for visual indicators
- ✅ OnPush change detection

**Implementation Details**:

```typescript
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule, X, Edit3, Loader2 } from 'lucide-angular';
import { TabState } from '../../services/chat.types';

/**
 * TabItemComponent - Individual tab in tab bar
 *
 * Displays tab title, status indicator, and close button.
 * Emits events for tab selection and closure.
 */
@Component({
  selector: 'ptah-tab-item',
  standalone: true,
  imports: [LucideAngularModule, NgClass],
  template: `
    <div
      class="group flex items-center gap-1 px-3 py-1.5 cursor-pointer border-r border-base-300 max-w-[200px] min-w-[100px]"
      [ngClass]="{
        'bg-base-100 border-b-2 border-b-primary': isActive(),
        'bg-base-200 hover:bg-base-300': !isActive()
      }"
      (click)="select.emit(tab().id)"
    >
      <!-- Status indicator -->
      @if (tab().status === 'streaming' || tab().status === 'resuming') {
      <lucide-angular [img]="LoaderIcon" class="w-3 h-3 text-primary animate-spin" />
      } @else if (tab().status === 'draft') {
      <lucide-angular [img]="EditIcon" class="w-3 h-3 text-warning" />
      }

      <!-- Tab title -->
      <span class="truncate text-sm flex-1" [title]="tab().title">
        {{ tab().title || 'New Chat' }}
      </span>

      <!-- Close button -->
      <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" (click)="onClose($event)" [title]="'Close tab'">
        <lucide-angular [img]="XIcon" class="w-3 h-3" />
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabItemComponent {
  readonly tab = input.required<TabState>();
  readonly isActive = input.required<boolean>();

  readonly select = output<string>();
  readonly close = output<string>();

  readonly XIcon = X;
  readonly EditIcon = Edit3;
  readonly LoaderIcon = Loader2;

  onClose(event: Event): void {
    event.stopPropagation();
    this.close.emit(this.tab().id);
  }
}
```

**DaisyUI Classes Used**:

- btn, btn-ghost, btn-xs, btn-square
- group (for hover states)
- border-r, border-b-2, border-base-300, border-b-primary
- bg-base-100, bg-base-200, bg-base-300
- text-primary, text-warning
- hover:bg-base-300, hover:opacity-100

**Lucide Icons**:

- X (close button)
- Edit3 (draft status)
- Loader2 (streaming status with spin animation)

**Verification**:

- ✅ File created at D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tab-item.component.ts
- ✅ Component is standalone
- ✅ Uses input.required() and output()
- ✅ OnPush change detection
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`

---

### Task 2.2: Create TabBarComponent

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\tab-bar.component.ts
**Action**: CREATE
**Status**: ✅ COMPLETE
**Dependencies**: Task 2.1 (TabItemComponent must exist)
**Specification Reference**: implementation-plan.md:136-181

**Description**: Create tab bar container that holds all tabs and "new tab" button. Uses horizontal scrolling for overflow.

**Quality Requirements**:

- ✅ Uses Angular 20+ standalone component
- ✅ Imports TabItemComponent
- ✅ Injects TabManagerService
- ✅ Horizontal scrolling for many tabs
- ✅ DaisyUI styling
- ✅ OnPush change detection

**Implementation Details**:

```typescript
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { LucideAngularModule, Plus } from 'lucide-angular';
import { TabItemComponent } from '../molecules/tab-item.component';
import { TabManagerService } from '../../services/tab-manager.service';

/**
 * TabBarComponent - Container for all tabs with new tab button
 *
 * Displays all open tabs in a horizontal scrollable bar.
 * Allows creating new tabs and switching between existing ones.
 */
@Component({
  selector: 'ptah-tab-bar',
  standalone: true,
  imports: [TabItemComponent, LucideAngularModule],
  template: `
    <div class="flex items-center bg-base-200 border-b border-base-300 h-10 px-1 overflow-x-auto">
      <!-- Tab items -->
      @for (tab of tabs(); track tab.id) {
      <ptah-tab-item [tab]="tab" [isActive]="tab.id === activeTabId()" (select)="onSelectTab($event)" (close)="onCloseTab($event)" />
      }

      <!-- New tab button -->
      <button class="btn btn-ghost btn-sm btn-square ml-1 flex-shrink-0" (click)="onCreateTab()" [title]="'New chat (Ctrl+T)'">
        <lucide-angular [img]="PlusIcon" class="w-4 h-4" />
      </button>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBarComponent {
  private readonly tabManager = inject(TabManagerService);

  readonly tabs = this.tabManager.tabs;
  readonly activeTabId = this.tabManager.activeTabId;

  readonly PlusIcon = Plus;

  onSelectTab(tabId: string): void {
    this.tabManager.switchTab(tabId);
  }

  onCloseTab(tabId: string): void {
    this.tabManager.closeTab(tabId);
  }

  onCreateTab(): void {
    const newTabId = this.tabManager.createTab();
    this.tabManager.switchTab(newTabId);
  }
}
```

**DaisyUI Classes Used**:

- btn, btn-ghost, btn-sm, btn-square
- bg-base-200
- border-b, border-base-300
- overflow-x-auto (horizontal scroll)
- flex-shrink-0 (prevent new tab button from shrinking)

**Lucide Icons**:

- Plus (new tab button)

**Verification**:

- ✅ File created at D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\tab-bar.component.ts
- ✅ Component is standalone
- ✅ TabItemComponent imported and used
- ✅ TabManagerService injected
- ✅ OnPush change detection
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`

---

**Batch 2 Verification Requirements**:

- ✅ Both components created
- ✅ TabItemComponent renders tab with status indicator
- ✅ TabBarComponent renders all tabs horizontally
- ✅ Build passes: `npx nx build chat`
- ✅ No TypeScript compilation errors

---

## Batch 3: UI Integration (Phase 3.3-3.4)

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Git Commit**: 26382ba
**Tasks in Batch**: 2
**Dependencies**: Batch 2 complete (TabBarComponent must exist)
**Estimated Duration**: 0.5 day
**Commit Pattern**: feat(webview): [description]

### Task 3.1: Integrate TabBar into AppShell

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html
**Action**: MODIFY
**Status**: ✅ COMPLETE
**Dependencies**: Task 2.2 (TabBarComponent must exist)
**Specification Reference**: implementation-plan.md:238-252

**Description**: Add TabBarComponent above ChatViewComponent in the main content area of AppShell.

**Quality Requirements**:

- ✅ TabBar positioned at top of main content (below header)
- ✅ ChatView takes remaining vertical space
- ✅ No layout shifts or overflow issues
- ✅ Maintains existing sidebar functionality

**Implementation Details**:

Replace the current main content section (lines 87-119) with:

```html
<!-- Main Content -->
<div class="flex-1 flex flex-col min-w-0">
  <!-- Header -->
  <div class="navbar bg-base-100 border-b border-base-300 min-h-[40px] px-2 gap-2">
    <!-- Sidebar toggle -->
    <button class="btn btn-square btn-ghost btn-sm" aria-label="Toggle sidebar" (click)="toggleSidebar()">
      <lucide-angular [img]="sidebarOpen() ? PanelLeftCloseIcon : PanelLeftOpenIcon" class="w-4 h-4" />
    </button>

    <!-- Title -->
    <div class="flex-1">
      <span class="text-lg font-bold">Ptah</span>
    </div>

    <!-- Header actions -->
    <div class="flex gap-1">
      <button class="btn btn-square btn-ghost btn-sm" aria-label="Settings">
        <lucide-angular [img]="SettingsIcon" class="w-4 h-4" />
      </button>
    </div>
  </div>

  <!-- Tab bar at top -->
  <ptah-tab-bar />

  <!-- Chat View takes remaining space -->
  <div class="flex-1 overflow-hidden">
    <ptah-chat-view />
  </div>
</div>
```

**Key Changes**:

- Add `<ptah-tab-bar />` after header
- Wrap `<ptah-chat-view>` in `<div class="flex-1 overflow-hidden">` for proper flex layout

**Verification**:

- ✅ File modified at D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.html
- ✅ TabBar appears at top of main content
- ✅ ChatView fills remaining vertical space
- ✅ No layout overflow issues
- ✅ Build passes: `npx nx build chat`

---

### Task 3.2: Update AppShell Component to Import TabBarComponent

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts
**Action**: MODIFY
**Status**: ✅ COMPLETE
**Dependencies**: Tasks 2.2, 3.1 (TabBarComponent exists and used in template)
**Specification Reference**: implementation-plan.md:238-252

**Description**: Add TabBarComponent to AppShellComponent imports array.

**Quality Requirements**:

- ✅ TabBarComponent imported
- ✅ Added to standalone component imports array
- ✅ No TypeScript compilation errors

**Implementation Details**:

1. Add import statement (after ChatViewComponent import):

```typescript
import { TabBarComponent } from '../organisms/tab-bar.component';
```

2. Add to imports array:

```typescript
@Component({
  selector: 'ptah-app-shell',
  standalone: true,
  imports: [ChatViewComponent, TabBarComponent, DatePipe, LucideAngularModule],
  templateUrl: './app-shell.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
```

**Verification**:

- ✅ File modified at D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts
- ✅ TabBarComponent imported
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`
- ✅ TabBar visible in running application

---

**Batch 3 Verification Requirements**:

- ✅ Both files modified
- ✅ TabBar visible at top of main content area
- ✅ ChatView still functional below TabBar
- ✅ Build passes: `npx nx build chat`
- ✅ No visual or layout regressions

---

## Batch 4: Polish & Shortcuts (Phase 4.1-4.4)

**Status**: ✅ COMPLETE
**Developer**: frontend-developer
**Git Commit**: a961dd0
**Tasks in Batch**: 4
**Dependencies**: Batch 3 complete (UI integrated and working)
**Estimated Duration**: 0.5 day
**Commit Pattern**: feat(webview): [description]

### Task 4.1: Create KeyboardShortcutsService

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\keyboard-shortcuts.service.ts
**Action**: CREATE
**Status**: ✅ COMPLETE
**Specification Reference**: implementation-plan.md:270-315

**Description**: Create service to handle global keyboard shortcuts for tab operations (Ctrl+T new tab, Ctrl+W close tab, Ctrl+Tab cycle tabs).

**Quality Requirements**:

- ✅ Uses RxJS fromEvent for keyboard event handling
- ✅ Uses takeUntilDestroyed for automatic cleanup
- ✅ Prevents default browser behavior
- ✅ Handles both Ctrl (Windows/Linux) and Cmd (Mac)
- ✅ Injectable with providedIn: 'root'

**Implementation Details**:

```typescript
import { Injectable, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fromEvent } from 'rxjs';
import { TabManagerService } from './tab-manager.service';

/**
 * KeyboardShortcutsService - Global keyboard shortcuts for tab operations
 *
 * Shortcuts:
 * - Ctrl+T / Cmd+T: Create new tab
 * - Ctrl+W / Cmd+W: Close active tab
 * - Ctrl+Tab / Cmd+Tab: Next tab
 * - Ctrl+Shift+Tab / Cmd+Shift+Tab: Previous tab
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService {
  private readonly tabManager = inject(TabManagerService);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.setupShortcuts();
  }

  private setupShortcuts(): void {
    fromEvent<KeyboardEvent>(window, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((event) => {
        // Check for Ctrl (Windows/Linux) or Meta (Mac)
        const isModifierKey = event.ctrlKey || event.metaKey;

        if (!isModifierKey) return;

        switch (event.key) {
          case 't':
          case 'T':
            event.preventDefault();
            this.createNewTab();
            break;

          case 'w':
          case 'W':
            event.preventDefault();
            this.closeActiveTab();
            break;

          case 'Tab':
            event.preventDefault();
            this.cycleTab(event.shiftKey ? -1 : 1);
            break;
        }
      });
  }

  private createNewTab(): void {
    const newTabId = this.tabManager.createTab();
    this.tabManager.switchTab(newTabId);
  }

  private closeActiveTab(): void {
    const activeId = this.tabManager.activeTabId();
    if (activeId) {
      this.tabManager.closeTab(activeId);
    }
  }

  private cycleTab(direction: 1 | -1): void {
    const tabs = this.tabManager.tabs();
    if (tabs.length <= 1) return;

    const activeId = this.tabManager.activeTabId();
    const currentIndex = tabs.findIndex((t) => t.id === activeId);

    if (currentIndex === -1) return;

    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    this.tabManager.switchTab(tabs[nextIndex].id);
  }
}
```

**Imports to Verify**:

- Injectable, inject, DestroyRef from '@angular/core'
- takeUntilDestroyed from '@angular/core/rxjs-interop'
- fromEvent from 'rxjs'
- TabManagerService from './tab-manager.service'

**Verification**:

- ✅ File created at D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\keyboard-shortcuts.service.ts
- ✅ Service is injectable
- ✅ Keyboard events handled properly
- ✅ Shortcuts work in running app
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`

---

### Task 4.2: Initialize KeyboardShortcutsService in AppShell

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts
**Action**: MODIFY
**Status**: ✅ COMPLETE
**Dependencies**: Task 4.1 (KeyboardShortcutsService must exist)
**Specification Reference**: implementation-plan.md:270-315

**Description**: Inject and initialize KeyboardShortcutsService in AppShellComponent to activate global shortcuts.

**Quality Requirements**:

- ✅ Service injected in constructor
- ✅ Service automatically initializes on app load
- ✅ No manual initialization needed

**Implementation Details**:

1. Add import:

```typescript
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
```

2. Inject in constructor (before existing injections):

```typescript
export class AppShellComponent {
  // Initialize keyboard shortcuts (constructor injection triggers setup)
  private readonly keyboardShortcuts = inject(KeyboardShortcutsService);

  readonly chatStore = inject(ChatStore);
  // ... rest of existing code
```

**Verification**:

- ✅ File modified at D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\app-shell.component.ts
- ✅ KeyboardShortcutsService injected
- ✅ Shortcuts work when app loads
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`

---

### Task 4.3: Add Tab Persistence Methods to VSCodeService (Placeholder)

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts
**Action**: MODIFY
**Status**: ✅ COMPLETE
**Specification Reference**: implementation-plan.md:330-350

**Description**: Update tab persistence methods in TabManagerService to use localStorage as temporary solution (VS Code workspace state integration will come later).

**Quality Requirements**:

- ✅ Uses localStorage for temporary persistence
- ✅ Handles serialization/deserialization errors
- ✅ Graceful fallback if localStorage unavailable
- ✅ Clear console warnings for not-yet-implemented features

**Implementation Details**:

Update saveTabState() method:

```typescript
/**
 * Save tab state to browser localStorage (temporary)
 * TODO: Integrate with VS Code workspace state API
 */
saveTabState(): void {
  try {
    const state = {
      tabs: this._tabs(),
      activeTabId: this._activeTabId(),
      version: 1, // For future migration
    };

    localStorage.setItem('ptah.tabs', JSON.stringify(state));
    console.log('[TabManager] Tab state saved to localStorage');
  } catch (error) {
    console.warn('[TabManager] Failed to save tab state:', error);
  }
}
```

Update loadTabState() method:

```typescript
/**
 * Load tab state from browser localStorage (temporary)
 * TODO: Integrate with VS Code workspace state API
 */
loadTabState(): void {
  try {
    const stored = localStorage.getItem('ptah.tabs');
    if (!stored) {
      console.log('[TabManager] No saved tab state found');
      return;
    }

    const state = JSON.parse(stored);

    if (state.version !== 1) {
      console.warn('[TabManager] Incompatible tab state version');
      return;
    }

    if (state.tabs && Array.isArray(state.tabs)) {
      this._tabs.set(state.tabs);
      this._activeTabId.set(state.activeTabId);
      console.log('[TabManager] Loaded tab state from localStorage:', state.tabs.length, 'tabs');
    }
  } catch (error) {
    console.warn('[TabManager] Failed to load tab state:', error);
  }
}
```

Add initialization call in constructor:

```typescript
constructor() {
  // Load saved tab state on service initialization
  this.loadTabState();

  // If no tabs loaded, create initial tab
  if (this._tabs().length === 0) {
    this.createTab('New Chat');
  }
}
```

**Verification**:

- ✅ File modified at D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts
- ✅ Tab state persists across page reloads
- ✅ Handles errors gracefully
- ✅ Creates initial tab if none exist
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`

---

### Task 4.4: Add Close Confirmation for Dirty/Streaming Tabs

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts
**Action**: MODIFY
**Status**: ✅ COMPLETE
**Dependencies**: Task 4.3 (closeTab method already exists)
**Specification Reference**: implementation-plan.md:352-380

**Description**: Add confirmation dialog when closing tabs with unsaved input or active streaming.

**Quality Requirements**:

- ✅ Uses native window.confirm for VS Code webview compatibility
- ✅ Only shows confirmation for dirty or streaming tabs
- ✅ Allows closing without confirmation for clean tabs
- ✅ Graceful cancellation handling

**Implementation Details**:

Replace existing closeTab() method:

```typescript
/**
 * Close a tab (with confirmation for dirty/streaming tabs)
 * @param tabId - Tab ID to close
 */
closeTab(tabId: string): void {
  const tabs = this._tabs();
  const tab = tabs.find((t) => t.id === tabId);

  if (!tab) return;

  // Check if tab needs confirmation
  const needsConfirmation =
    tab.isDirty ||
    tab.status === 'streaming' ||
    tab.status === 'resuming';

  if (needsConfirmation) {
    const confirmed = window.confirm(
      'Close tab?\n\nThis session has unsaved changes or is actively streaming. Are you sure you want to close it?'
    );

    if (!confirmed) {
      console.log('[TabManager] Tab close cancelled by user');
      return;
    }
  }

  const tabIndex = tabs.findIndex((t) => t.id === tabId);

  // Remove tab
  this._tabs.update((tabs) => tabs.filter((t) => t.id !== tabId));

  // Switch to adjacent tab if closing active
  if (this._activeTabId() === tabId) {
    const remaining = this._tabs();
    if (remaining.length > 0) {
      // Switch to tab at same index, or last tab if we closed the last one
      const newActiveIndex = Math.min(tabIndex, remaining.length - 1);
      this._activeTabId.set(remaining[newActiveIndex].id);
    } else {
      this._activeTabId.set(null);
    }
  }

  this.saveTabState();
  console.log('[TabManager] Tab closed:', tabId);
}
```

**Verification**:

- ✅ File modified at D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts
- ✅ Confirmation dialog appears for dirty/streaming tabs
- ✅ No confirmation for clean tabs
- ✅ Tab closes after confirmation
- ✅ Tab remains open if cancelled
- ✅ No TypeScript compilation errors
- ✅ Build passes: `npx nx build chat`

---

**Batch 4 Verification Requirements**:

- ✅ All 4 tasks complete
- ✅ Keyboard shortcuts work (Ctrl+T, Ctrl+W, Ctrl+Tab)
- ✅ Tab state persists across reloads
- ✅ Close confirmation works for dirty tabs
- ✅ Build passes: `npx nx build chat`
- ✅ No regressions in existing functionality

---

## Batch 5: Advanced Features (Phase 4.5 - Optional)

**Status**: ⏸️ PENDING
**Developer**: frontend-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 4 complete (all core features working)
**Estimated Duration**: 0.5 day (optional)
**Commit Pattern**: feat(webview): [description]

**Note**: This batch is OPTIONAL and can be deferred to future tasks if needed.

### Task 5.1: Add Tab Context Menu Component

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\tab-context-menu.component.ts
**Action**: CREATE
**Status**: ⏸️ PENDING
**Specification Reference**: implementation-plan.md:317-328

**Description**: Create context menu for right-click on tabs with options: Rename, Duplicate, Close, Close Others, Close to Right.

**Quality Requirements**:

- ✅ Uses Angular 20+ standalone component
- ✅ Triggered by right-click on tab
- ✅ Positioned near clicked tab
- ✅ DaisyUI dropdown styling
- ✅ All menu actions functional

**Implementation Details**:

```typescript
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { LucideAngularModule, Edit, Copy, X, XCircle } from 'lucide-angular';

/**
 * TabContextMenuComponent - Right-click context menu for tabs
 *
 * Features:
 * - Rename tab
 * - Duplicate tab
 * - Close tab
 * - Close other tabs
 * - Close tabs to the right
 */
@Component({
  selector: 'ptah-tab-context-menu',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="dropdown dropdown-end">
      <ul class="menu dropdown-content bg-base-200 rounded-box z-[1] w-52 p-2 shadow-lg border border-base-300">
        <li>
          <button (click)="rename.emit()">
            <lucide-angular [img]="EditIcon" class="w-4 h-4" />
            Rename Tab
          </button>
        </li>
        <li>
          <button (click)="duplicate.emit()">
            <lucide-angular [img]="CopyIcon" class="w-4 h-4" />
            Duplicate Tab
          </button>
        </li>
        <li class="menu-title">
          <span>Close</span>
        </li>
        <li>
          <button (click)="close.emit()">
            <lucide-angular [img]="XIcon" class="w-4 h-4" />
            Close Tab
          </button>
        </li>
        <li>
          <button (click)="closeOthers.emit()">
            <lucide-angular [img]="XCircleIcon" class="w-4 h-4" />
            Close Other Tabs
          </button>
        </li>
        <li>
          <button (click)="closeToRight.emit()">
            <lucide-angular [img]="XCircleIcon" class="w-4 h-4" />
            Close Tabs to the Right
          </button>
        </li>
      </ul>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabContextMenuComponent {
  readonly rename = output<void>();
  readonly duplicate = output<void>();
  readonly close = output<void>();
  readonly closeOthers = output<void>();
  readonly closeToRight = output<void>();

  readonly EditIcon = Edit;
  readonly CopyIcon = Copy;
  readonly XIcon = X;
  readonly XCircleIcon = XCircle;
}
```

**DaisyUI Classes Used**:

- dropdown, dropdown-end, dropdown-content
- menu, menu-title
- bg-base-200, rounded-box, shadow-lg
- border, border-base-300

**Verification**:

- ✅ File created
- ✅ Component renders menu
- ✅ All menu items emit correct events
- ✅ Build passes: `npx nx build chat`

---

### Task 5.2: Add Rename Tab Functionality

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\tab-manager.service.ts
**Action**: MODIFY
**Status**: ⏸️ PENDING
**Dependencies**: Task 5.1 (context menu exists)
**Specification Reference**: implementation-plan.md:317-328

**Description**: Add renameTab() method to TabManagerService and integrate with context menu.

**Quality Requirements**:

- ✅ Uses window.prompt for simplicity
- ✅ Validates input (non-empty, max length)
- ✅ Updates tab title
- ✅ Persists change

**Implementation Details**:

Add method to TabManagerService:

```typescript
/**
 * Rename a tab
 * @param tabId - Tab ID to rename
 */
renameTab(tabId: string): void {
  const tab = this._tabs().find((t) => t.id === tabId);
  if (!tab) return;

  const newTitle = window.prompt('Enter new tab name:', tab.title);

  if (!newTitle || newTitle.trim() === '') {
    console.log('[TabManager] Rename cancelled or empty');
    return;
  }

  if (newTitle.length > 100) {
    window.alert('Tab name is too long (max 100 characters)');
    return;
  }

  this.updateTab(tabId, { title: newTitle.trim() });
  console.log('[TabManager] Tab renamed:', tabId, '->', newTitle);
}

/**
 * Duplicate a tab
 * @param tabId - Tab ID to duplicate
 */
duplicateTab(tabId: string): void {
  const tab = this._tabs().find((t) => t.id === tabId);
  if (!tab) return;

  const newTabId = this.generateTabId();
  const duplicatedTab: TabState = {
    ...tab,
    id: newTabId,
    title: `${tab.title} (Copy)`,
    order: this._tabs().length,
    status: 'loaded', // Duplicated tab is loaded (not streaming)
    isDirty: false,
    lastActivityAt: Date.now(),
  };

  this._tabs.update((tabs) => [...tabs, duplicatedTab]);
  this._activeTabId.set(newTabId);
  this.saveTabState();

  console.log('[TabManager] Tab duplicated:', tabId, '->', newTabId);
}

/**
 * Close all tabs except the specified one
 * @param tabId - Tab ID to keep
 */
closeOtherTabs(tabId: string): void {
  const tab = this._tabs().find((t) => t.id === tabId);
  if (!tab) return;

  const confirmed = window.confirm(
    'Close all other tabs?\n\nThis will close all tabs except the current one.'
  );

  if (!confirmed) return;

  this._tabs.set([tab]);
  this._activeTabId.set(tabId);
  this.saveTabState();

  console.log('[TabManager] Closed all other tabs, kept:', tabId);
}

/**
 * Close all tabs to the right of the specified tab
 * @param tabId - Tab ID (tabs to the right will be closed)
 */
closeTabsToRight(tabId: string): void {
  const tabs = this._tabs();
  const tabIndex = tabs.findIndex((t) => t.id === tabId);

  if (tabIndex === -1 || tabIndex === tabs.length - 1) return;

  const confirmed = window.confirm(
    'Close tabs to the right?\n\nThis will close all tabs after the current one.'
  );

  if (!confirmed) return;

  const remaining = tabs.slice(0, tabIndex + 1);
  this._tabs.set(remaining);

  // If active tab was closed, switch to the kept tab
  if (!remaining.find((t) => t.id === this._activeTabId())) {
    this._activeTabId.set(tabId);
  }

  this.saveTabState();
  console.log('[TabManager] Closed tabs to right of:', tabId);
}
```

**Verification**:

- ✅ File modified
- ✅ Rename dialog works
- ✅ Duplicate creates copy
- ✅ Close others works
- ✅ Close to right works
- ✅ Build passes: `npx nx build chat`

---

### Task 5.3: Add Drag-to-Reorder Support (Angular CDK)

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\tab-bar.component.ts
**Action**: MODIFY
**Status**: ⏸️ PENDING
**Dependencies**: Angular CDK drag-drop module
**Specification Reference**: implementation-plan.md:382-391

**Description**: Add drag-and-drop support for reordering tabs using Angular CDK.

**Quality Requirements**:

- ✅ Uses Angular CDK DragDrop module
- ✅ Smooth drag animations
- ✅ Visual feedback during drag
- ✅ Updates tab order on drop
- ✅ Persists new order

**Implementation Details**:

1. Install Angular CDK (if not already installed):

```bash
npm install @angular/cdk@^20.0.0
```

2. Update TabBarComponent:

```typescript
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { LucideAngularModule, Plus } from 'lucide-angular';
import { TabItemComponent } from '../molecules/tab-item.component';
import { TabManagerService } from '../../services/tab-manager.service';

@Component({
  selector: 'ptah-tab-bar',
  standalone: true,
  imports: [TabItemComponent, LucideAngularModule, DragDropModule],
  template: `
    <div class="flex items-center bg-base-200 border-b border-base-300 h-10 px-1 overflow-x-auto">
      <!-- Draggable tab items -->
      <div cdkDropList cdkDropListOrientation="horizontal" (cdkDropListDropped)="onTabDrop($event)" class="flex">
        @for (tab of tabs(); track tab.id) {
        <div cdkDrag>
          <ptah-tab-item [tab]="tab" [isActive]="tab.id === activeTabId()" (select)="onSelectTab($event)" (close)="onCloseTab($event)" />
        </div>
        }
      </div>

      <!-- New tab button -->
      <button class="btn btn-ghost btn-sm btn-square ml-1 flex-shrink-0" (click)="onCreateTab()" [title]="'New chat (Ctrl+T)'">
        <lucide-angular [img]="PlusIcon" class="w-4 h-4" />
      </button>
    </div>
  `,
  styles: [
    `
      .cdk-drag-preview {
        opacity: 0.8;
        box-shadow: 0 5px 10px rgba(0, 0, 0, 0.3);
      }

      .cdk-drag-animating {
        transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
      }

      .cdk-drop-list-dragging .cdk-drag:not(.cdk-drag-placeholder) {
        transition: transform 250ms cubic-bezier(0, 0, 0.2, 1);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabBarComponent {
  private readonly tabManager = inject(TabManagerService);

  readonly tabs = this.tabManager.tabs;
  readonly activeTabId = this.tabManager.activeTabId;

  readonly PlusIcon = Plus;

  onSelectTab(tabId: string): void {
    this.tabManager.switchTab(tabId);
  }

  onCloseTab(tabId: string): void {
    this.tabManager.closeTab(tabId);
  }

  onCreateTab(): void {
    const newTabId = this.tabManager.createTab();
    this.tabManager.switchTab(newTabId);
  }

  onTabDrop(event: CdkDragDrop<string[]>): void {
    if (event.previousIndex === event.currentIndex) return;

    this.tabManager.reorderTabs(event.previousIndex, event.currentIndex);
  }
}
```

**CDK Directives Used**:

- cdkDropList (container)
- cdkDropListOrientation="horizontal"
- cdkDrag (draggable item)
- (cdkDropListDropped) event

**Verification**:

- ✅ File modified
- ✅ Angular CDK installed
- ✅ Tabs are draggable
- ✅ Drop reorders tabs
- ✅ Visual feedback during drag
- ✅ Build passes: `npx nx build chat`

---

**Batch 5 Verification Requirements** (OPTIONAL):

- ✅ Context menu shows on right-click
- ✅ Rename, duplicate, close operations work
- ✅ Drag-and-drop reordering works
- ✅ Build passes: `npx nx build chat`
- ✅ No regressions in core features

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to frontend-developer
2. Developer executes ALL tasks in batch (in order, respecting dependencies)
3. Developer writes REAL, COMPLETE code (NO stubs/placeholders)
4. Developer commits changes for the batch
5. Developer updates tasks.md with commit SHA
6. Team-leader verifies batch completion

**🚨 CRITICAL: Git Commit Format**:

All commits MUST follow this pattern:

```
feat(webview): [batch description]

- Task X.1: [description]
- Task X.2: [description]
- Task X.3: [description]

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Example**:

```
feat(webview): multi-session state foundation

- Task 1.1: define TabState interface in chat.types.ts
- Task 1.2: create TabManagerService with signal-based state
- Task 1.3: refactor ChatStore to use TabManager for multi-session

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified (SHA recorded)
- All files exist with REAL implementations
- Build passes: `npx nx build chat`
- No TypeScript compilation errors
- Manual testing confirms features work

---

## Testing Checklist

After all batches complete, verify:

### Unit Tests (Future)

- [ ] TabManagerService: create, close, switch, reorder
- [ ] TabState: serialization/deserialization
- [ ] ChatStore: active tab context switching

### Integration Tests (Manual)

- [ ] Start conversation in Tab 1, switch to Tab 2, Tab 1 state preserved
- [ ] Session ID resolution updates correct tab
- [ ] Close tab with streaming session shows confirmation
- [ ] Keyboard shortcuts work globally (Ctrl+T, Ctrl+W, Ctrl+Tab)

### Manual Tests

- [ ] Create 5+ tabs, verify overflow scrolling
- [ ] Close all tabs, verify empty state or new tab creation
- [ ] Reload extension, verify tabs restored from localStorage
- [ ] Switch tabs rapidly, no state corruption
- [ ] Drag-and-drop reorder works smoothly (Batch 5)

---

## Risk Mitigation

| Risk                            | Mitigation                                     |
| ------------------------------- | ---------------------------------------------- |
| State sync issues between tabs  | Single source of truth in TabManager           |
| Performance with many open tabs | Signal-based reactivity (efficient updates)    |
| Session ID mismatch             | Correlation ID between tab and backend request |
| Memory leaks on tab close       | Proper cleanup in closeTab()                   |
| VS Code webview constraints     | Uses localStorage until workspace state ready  |

---

## Dependencies

- TASK_2025_027 (Complete) ✅ - Session lifecycle foundation
- DaisyUI (already available) ✅
- Lucide icons (already available) ✅
- Angular 20+ signals (already available) ✅
- Angular CDK (optional for Batch 5) - needs installation

---

## Success Metrics

1. **Zero regression** in single-tab usage ✅
2. **< 100ms** tab switch time (signal-based updates)
3. **100%** state preservation on tab switch
4. **All commits** follow commitlint rules (type, scope, lowercase)
5. **Positive user feedback** on workflow improvement
