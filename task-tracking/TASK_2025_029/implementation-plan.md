# TASK_2025_029: Implementation Plan

## Tab-Based Multi-Session Support (Phases 2-4)

---

## Phase 2: Multi-Session State Management

### Objective

Extend the current single-session architecture to support multiple concurrent sessions.

### 2.1 Define Tab State Model

**File**: `libs/frontend/chat/src/lib/services/chat.types.ts`

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

### 2.2 Create TabManager Service

**File**: `libs/frontend/chat/src/lib/services/tab-manager.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class TabManagerService {
  // State signals
  private readonly _tabs = signal<TabState[]>([]);
  private readonly _activeTabId = signal<string | null>(null);

  // Public readonly signals
  readonly tabs = this._tabs.asReadonly();
  readonly activeTabId = this._activeTabId.asReadonly();

  // Computed signals
  readonly activeTab = computed(() => this._tabs().find((t) => t.id === this._activeTabId()) ?? null);
  readonly tabCount = computed(() => this._tabs().length);

  // Tab operations
  createTab(title?: string): string;
  closeTab(tabId: string): void;
  switchTab(tabId: string): void;
  updateTab(tabId: string, updates: Partial<TabState>): void;
  reorderTabs(fromIndex: number, toIndex: number): void;

  // Session ID resolution (called when Claude responds)
  resolveSessionId(tabId: string, claudeSessionId: string): void;

  // Persistence
  saveTabState(): void;
  loadTabState(): void;
}
```

### 2.3 Refactor ChatStore for Multi-Session

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

Changes needed:

1. Remove single-session signals (`_currentSessionId`, `_messages`, etc.)
2. Delegate to TabManagerService for state
3. Operations work on "active tab" context
4. `handleSessionIdResolved()` updates correct tab

```typescript
@Injectable({ providedIn: 'root' })
export class ChatStore {
  private readonly tabManager = inject(TabManagerService);

  // Computed from active tab
  readonly currentSessionId = computed(() => this.tabManager.activeTab()?.claudeSessionId ?? null);
  readonly messages = computed(() => this.tabManager.activeTab()?.messages ?? []);
  readonly isStreaming = computed(() => this.tabManager.activeTab()?.status === 'streaming');

  // Operations now context-aware
  async startNewConversation(content: string, files?: string[]): Promise<void> {
    const tabId = this.tabManager.activeTabId();
    if (!tabId) {
      // Create new tab if none exists
      const newTabId = this.tabManager.createTab();
      this.tabManager.switchTab(newTabId);
    }
    // ... rest of implementation
  }
}
```

### 2.4 Update Session Resolution Flow

When `session:id-resolved` arrives:

1. Find tab by correlation (draft tab that started the request)
2. Update that tab's `claudeSessionId`
3. Transition tab status from 'draft' to 'streaming'

---

## Phase 3: Tab UI Components

### Objective

Build the visual tab bar interface with DaisyUI styling.

### 3.1 TabBarComponent (Container)

**File**: `libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts`

```typescript
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
      <button class="btn btn-ghost btn-sm btn-square ml-1 flex-shrink-0" (click)="onCreateTab()" title="New chat (Ctrl+T)">
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

### 3.2 TabItemComponent (Individual Tab)

**File**: `libs/frontend/chat/src/lib/components/molecules/tab-item.component.ts`

```typescript
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
      @if (tab().status === 'streaming') {
      <span class="loading loading-spinner loading-xs text-primary"></span>
      } @else if (tab().status === 'draft') {
      <lucide-angular [img]="EditIcon" class="w-3 h-3 text-warning" />
      }

      <!-- Tab title -->
      <span class="truncate text-sm flex-1" [title]="tab().title">
        {{ tab().title || 'New Chat' }}
      </span>

      <!-- Close button -->
      <button class="btn btn-ghost btn-xs btn-square opacity-50 hover:opacity-100" (click)="onClose($event)" title="Close tab">
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

  onClose(event: Event): void {
    event.stopPropagation();
    this.close.emit(this.tab().id);
  }
}
```

### 3.3 Integrate into AppShell

**File**: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`

```html
<div class="flex flex-col h-full">
  <!-- Tab bar at top -->
  <ptah-tab-bar />

  <!-- Chat view takes remaining space -->
  <div class="flex-1 overflow-hidden">
    <ptah-chat-view />
  </div>
</div>
```

### 3.4 Update ChatView for Tab Context

Ensure `ChatViewComponent` renders the active tab's content:

- Messages from `chatStore.messages()` (computed from active tab)
- Execution tree from `chatStore.currentExecutionTree()` (computed from active tab)
- Input state preserved per-tab

---

## Phase 4: Advanced Features

### Objective

Polish the multi-session experience with productivity features.

### 4.1 Keyboard Shortcuts

**File**: `libs/frontend/chat/src/lib/services/keyboard-shortcuts.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutsService {
  private readonly tabManager = inject(TabManagerService);

  constructor() {
    this.setupShortcuts();
  }

  private setupShortcuts(): void {
    fromEvent<KeyboardEvent>(window, 'keydown')
      .pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (event.ctrlKey || event.metaKey) {
          switch (event.key) {
            case 't':
              event.preventDefault();
              this.tabManager.createTab();
              break;
            case 'w':
              event.preventDefault();
              const activeId = this.tabManager.activeTabId();
              if (activeId) this.tabManager.closeTab(activeId);
              break;
            case 'Tab':
              event.preventDefault();
              this.cycleTab(event.shiftKey ? -1 : 1);
              break;
          }
        }
      });
  }

  private cycleTab(direction: 1 | -1): void {
    const tabs = this.tabManager.tabs();
    const activeId = this.tabManager.activeTabId();
    const currentIndex = tabs.findIndex((t) => t.id === activeId);
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    this.tabManager.switchTab(tabs[nextIndex].id);
  }
}
```

### 4.2 Tab Context Menu

**File**: `libs/frontend/chat/src/lib/components/molecules/tab-context-menu.component.ts`

Features:

- Rename tab
- Duplicate tab
- Close tab
- Close other tabs
- Close tabs to the right

### 4.3 Tab Persistence

Store tab state in VS Code workspace state:

```typescript
// TabManagerService
saveTabState(): void {
  const state = {
    tabs: this._tabs(),
    activeTabId: this._activeTabId(),
  };
  this.vscodeService.setWorkspaceState('ptah.tabs', state);
}

loadTabState(): void {
  const state = this.vscodeService.getWorkspaceState('ptah.tabs');
  if (state) {
    this._tabs.set(state.tabs);
    this._activeTabId.set(state.activeTabId);
  }
}
```

### 4.4 Close Confirmation Dialog

When closing a tab with unsaved input or active streaming:

```typescript
async closeTab(tabId: string): Promise<void> {
  const tab = this._tabs().find(t => t.id === tabId);

  if (tab?.isDirty || tab?.status === 'streaming') {
    const confirmed = await this.showConfirmDialog(
      'Close tab?',
      'This session has unsaved changes. Are you sure you want to close it?'
    );
    if (!confirmed) return;
  }

  this._tabs.update(tabs => tabs.filter(t => t.id !== tabId));

  // Switch to adjacent tab if closing active
  if (this._activeTabId() === tabId) {
    const remaining = this._tabs();
    if (remaining.length > 0) {
      this._activeTabId.set(remaining[0].id);
    } else {
      this._activeTabId.set(null);
    }
  }
}
```

### 4.5 Drag-to-Reorder (Optional)

Use Angular CDK DragDrop or a lightweight library:

```typescript
// In TabBarComponent
onTabDrop(event: CdkDragDrop<TabState[]>): void {
  this.tabManager.reorderTabs(event.previousIndex, event.currentIndex);
}
```

---

## Implementation Batches

### Batch 1: State Foundation (Phase 2.1-2.3)

- Define TabState interface
- Create TabManagerService
- Refactor ChatStore to use TabManager
- **Estimated: 1 day**

### Batch 2: Basic Tab UI (Phase 3.1-3.4)

- TabBarComponent
- TabItemComponent
- AppShell integration
- ChatView context updates
- **Estimated: 1 day**

### Batch 3: Session Integration (Phase 2.4)

- Session ID resolution per-tab
- Message routing to correct tab
- Streaming state per-tab
- **Estimated: 0.5 day**

### Batch 4: Polish & Shortcuts (Phase 4.1-4.4)

- Keyboard shortcuts
- Tab persistence
- Close confirmation
- **Estimated: 0.5 day**

### Batch 5: Advanced Features (Phase 4.5, Optional)

- Drag-to-reorder
- Context menu
- **Estimated: 0.5 day (optional)**

---

## Testing Checklist

### Unit Tests

- [ ] TabManagerService: create, close, switch, reorder
- [ ] TabState: serialization/deserialization
- [ ] ChatStore: active tab context switching

### Integration Tests

- [ ] Start conversation in Tab 1, switch to Tab 2, Tab 1 state preserved
- [ ] Session ID resolution updates correct tab
- [ ] Close tab with streaming session shows confirmation
- [ ] Keyboard shortcuts work globally

### Manual Tests

- [ ] Create 5+ tabs, verify overflow scrolling
- [ ] Close all tabs, verify empty state
- [ ] Restart extension, verify tabs restored
- [ ] Send message in wrong tab (shouldn't happen)

---

## Risk Mitigation

| Risk                            | Mitigation                                     |
| ------------------------------- | ---------------------------------------------- |
| State sync issues between tabs  | Single source of truth in TabManager           |
| Performance with many open tabs | Lazy load message history                      |
| Session ID mismatch             | Correlation ID between tab and backend request |
| Memory leaks on tab close       | Proper cleanup in closeTab()                   |

---

## Dependencies

- TASK_2025_027 (Complete) - Session lifecycle foundation
- DaisyUI tab styles
- Lucide icons (Plus, X, Edit3)
- Optional: Angular CDK for drag-drop

---

## Success Metrics

1. **Zero regression** in single-tab usage
2. **< 100ms** tab switch time
3. **< 50MB** memory per open tab
4. **100%** state preservation on tab switch
5. **Positive user feedback** on workflow improvement
