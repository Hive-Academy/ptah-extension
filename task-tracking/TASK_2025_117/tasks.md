# Task Breakdown - TASK_2025_117

**Implementation Plan**: [implementation-plan.md](./implementation-plan.md)
**Task Description**: [task-description.md](./task-description.md)
**Context**: [context.md](./context.md)

---

## Task Summary

- **Total Tasks**: 11
- **Frontend Tasks**: 11 (all frontend - no backend changes required)
- **Type/Service Tasks**: 5 (including message sender modifications)
- **Component Tasks**: 5
- **Integration Tasks**: 1

---

## 🚨 CRITICAL ARCHITECTURE NOTE

**All Angular services are singletons** (`providedIn: 'root'`). Both panes share the SAME service instances. This means:

1. **ChatInputComponent** must receive `tabId` input and pass it to send methods
2. **MessageSenderService** must accept explicit `tabId` instead of using `activeTab()`
3. **ConversationService** must accept explicit `tabId` for queueing/sending
4. **PermissionHandlerService** must filter by `tabId` (already planned)

**Without these changes, both panes would send to the global activeTab!**

---

## Execution Order

```
Task 1 (Types) → Task 2 (PaneManagerService) → Task 3 (PaneResizerComponent)
                                              ↓
                        Task 4 (MessageSenderService tabId overloads) ← CRITICAL
                                              ↓
                        Task 5 (ConversationService tabId overloads) ← CRITICAL
                                              ↓
                        Task 6 (SplitPaneContainerComponent)
                                              ↓
                        Task 7 (ChatViewComponent tabId)
                                              ↓
                        Task 8 (ChatInputComponent tabId) ← CRITICAL for input isolation
                                              ↓
                        Task 9 (PermissionHandlerService)
                                              ↓
                        Task 10 (AppShellComponent Integration)
                                              ↓
                        Task 11 (Unit Tests)
```

---

## Task List

### Task 1: Create Pane Type Definitions ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 1 (Simple)
**Estimated Time**: 20 minutes
**Status**: ⏸️ PENDING

**Description**:
Create the `PaneState` and `PaneLayout` type definitions for pane state management. These types define the data structures for managing split-pane layouts.

**Files to Create**:

- `libs/frontend/chat/src/lib/services/pane.types.ts` - New file with PaneState, PaneLayout interfaces

**Files to Modify**:

- `libs/frontend/chat/src/lib/services/index.ts` - Export new types

**Implementation Details**:

```typescript
// pane.types.ts structure
export interface PaneState {
  id: string; // Pane identifier (e.g., "pane_left", "pane_right")
  tabId: string | null; // Which tab is displayed (null = empty/select state)
  sizePercent: number; // Width as percentage (20-80, sum = 100)
}

export interface PaneLayout {
  panes: PaneState[];
  version: number; // For persistence migration
}

// Constants
export const PANE_MIN_SIZE_PERCENT = 20;
export const PANE_MAX_SIZE_PERCENT = 80;
export const DEFAULT_PANE_SIZE_PERCENT = 50;
```

**Verification Criteria**:

- [ ] File `pane.types.ts` exists at specified path
- [ ] `PaneState` interface has: id, tabId, sizePercent properties
- [ ] `PaneLayout` interface has: panes, version properties
- [ ] Constants exported: PANE_MIN_SIZE_PERCENT, PANE_MAX_SIZE_PERCENT, DEFAULT_PANE_SIZE_PERCENT
- [ ] Types exported from `libs/frontend/chat/src/lib/services/index.ts`
- [ ] No TypeScript errors (`nx typecheck chat`)
- [ ] Git commit created with pattern: `feat(chat): add pane type definitions for split-view`

**Dependencies**: None

---

### Task 2: Create PaneManagerService ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 2 (Moderate)
**Estimated Time**: 1.5 hours
**Status**: ⏸️ PENDING

**Description**:
Create `PaneManagerService` with signal-based state management for pane layouts. This service manages pane configuration (which tabs appear in which panes, pane sizes, focused pane) following the established `TabManagerService` patterns.

**Files to Create**:

- `libs/frontend/chat/src/lib/services/pane-manager.service.ts` - Main service

**Files to Modify**:

- `libs/frontend/chat/src/lib/services/index.ts` - Export service

**Implementation Details**:

Follow [tab-manager.service.ts](libs/frontend/chat/src/lib/services/tab-manager.service.ts) patterns:

- Private signals: `_panes`, `_focusedPaneId`
- Public readonly signals: `panes`, `focusedPaneId`, `isSplit` (computed)
- Methods:
  - `splitPane()`: Creates second pane with 50/50 split
  - `closePane(paneId)`: Removes pane, returns to single pane
  - `assignTabToPane(paneId, tabId)`: Links tab to pane
  - `resizePanes(leftPercent, rightPercent)`: Updates sizes (enforces min 20%)
  - `focusPane(paneId)`: Sets focused pane for tab assignment
- Persistence: localStorage with debouncing (key: `ptah.panes`)
- Constructor: Load saved state, default to single pane with activeTab

**Pattern Reference**: [tab-manager.service.ts#L444-L497](libs/frontend/chat/src/lib/services/tab-manager.service.ts#L444-L497) for persistence

**Verification Criteria**:

- [ ] File exists at `libs/frontend/chat/src/lib/services/pane-manager.service.ts`
- [ ] Service decorated with `@Injectable({ providedIn: 'root' })`
- [ ] Private `_panes` signal initialized with single pane
- [ ] Private `_focusedPaneId` signal initialized
- [ ] Public readonly `panes`, `focusedPaneId` signals exposed
- [ ] Computed `isSplit` signal returns `panes().length > 1`
- [ ] `splitPane()` creates second pane at 50/50
- [ ] `closePane()` removes pane and expands remaining to 100%
- [ ] `assignTabToPane()` updates pane's tabId
- [ ] `resizePanes()` enforces min 20% constraint
- [ ] localStorage persistence with debouncing implemented
- [ ] Service exported from index.ts
- [ ] No TypeScript errors
- [ ] Git commit created: `feat(chat): add PaneManagerService for split-view state`

**Dependencies**: Task 1 (pane.types.ts)

---

### Task 3: Create PaneResizerComponent ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 2 (Moderate)
**Estimated Time**: 1 hour
**Status**: ⏸️ PENDING

**Description**:
Create `PaneResizerComponent` - a draggable vertical divider between panes that allows users to resize pane widths by dragging. Uses native pointer events for cross-browser compatibility.

**Files to Create**:

- `libs/frontend/chat/src/lib/components/molecules/pane-resizer.component.ts` - Component with inline template/styles

**Files to Modify**:

- `libs/frontend/chat/src/lib/components/index.ts` - Export component

**Implementation Details**:

- Standalone component with OnPush change detection
- Visual: 4px wide vertical bar, `cursor: col-resize`, hover highlight with `--primary` color
- Pointer events:
  - `pointerdown`: Start drag, set `pointercapture`
  - `pointermove`: Calculate delta, emit resize event (throttled to 60fps)
  - `pointerup`: End drag, release capture
- Output: `sizeChange = output<{ leftPercent: number; rightPercent: number }>()`
- Input: `containerWidth = input.required<number>()` for percentage calculation
- Keyboard: Arrow keys adjust size by 5% increments
- ARIA: `role="separator"`, `aria-valuenow`, `aria-valuemin="20"`, `aria-valuemax="80"`

**Tailwind Classes**:

```
w-1 h-full bg-base-300 hover:bg-primary cursor-col-resize transition-colors
focus:outline-none focus:ring-2 focus:ring-primary
```

**Verification Criteria**:

- [ ] File exists at `libs/frontend/chat/src/lib/components/molecules/pane-resizer.component.ts`
- [ ] Standalone component with `changeDetection: ChangeDetectionStrategy.OnPush`
- [ ] Pointer event handlers (pointerdown, pointermove, pointerup) implemented
- [ ] `sizeChange` output emits leftPercent/rightPercent
- [ ] Minimum 20% enforced in calculations
- [ ] Keyboard accessibility (ArrowLeft, ArrowRight keys)
- [ ] ARIA attributes present: role="separator", aria-valuenow
- [ ] Visual styling matches spec (hover highlight, cursor)
- [ ] Component exported from index.ts
- [ ] No TypeScript errors
- [ ] Git commit created: `feat(chat): add PaneResizerComponent for split-view resize`

**Dependencies**: None (can parallel with Task 2)

---

### Task 4: Add tabId Overloads to MessageSenderService ⏸️ PENDING

**Type**: FRONTEND (CRITICAL)
**Complexity**: Level 2 (Moderate)
**Estimated Time**: 45 minutes
**Status**: ⏸️ PENDING

**Description**:
🚨 **CRITICAL FOR SPLIT-PANE**: Currently `MessageSenderService.send()` uses `tabManager.activeTab()` - meaning ALL chat inputs send to the global active tab. We must add overloads that accept explicit `tabId` so each pane's input sends to its own tab.

**Files to Modify**:

- `libs/frontend/chat/src/lib/services/message-sender.service.ts` - Add tabId parameter overloads

**Implementation Details**:

Add optional `tabId` parameter to key methods:

```typescript
/**
 * Send a message to a specific tab (or activeTab if not specified)
 * @param content - Message content
 * @param tabId - Optional explicit tab ID (for split-pane)
 * @param files - Optional file paths
 */
async send(content: string, tabId?: string | null, files?: string[]): Promise<void> {
  // ... validation ...

  // Use explicit tabId if provided, otherwise fall back to activeTab
  const targetTab = tabId
    ? this.tabManager.tabs().find(t => t.id === tabId)
    : this.tabManager.activeTab();

  if (!targetTab) {
    console.warn('[MessageSender] No target tab found', { tabId });
    return;
  }

  // Rest of logic uses targetTab instead of activeTab
}

/**
 * Start new conversation for specific tab
 */
private async startNewConversation(
  content: string,
  tabId?: string | null,  // NEW parameter
  files?: string[]
): Promise<void> {
  // Get specific tab or create if not exists
  let targetTabId = tabId ?? this.tabManager.activeTabId();
  if (!targetTabId) {
    targetTabId = this.tabManager.createTab();
  }
  // Use targetTabId throughout...
}

/**
 * Continue conversation for specific tab
 */
private async continueConversation(
  content: string,
  sessionId: SessionId,
  tabId?: string | null,  // NEW parameter
  files?: string[]
): Promise<void> {
  // Use explicit tabId for targeting...
}
```

**Key Changes**:

1. Add `tabId?: string | null` parameter to `send()`, `sendOrQueue()`
2. Add `tabId` to `startNewConversation()`, `continueConversation()`
3. Replace `this.tabManager.activeTab()` with explicit tab lookup when `tabId` provided
4. Maintain backward compatibility (tabId is optional)

**Verification Criteria**:

- [ ] `send(content, tabId?, files?)` signature updated
- [ ] `sendOrQueue(content, tabId?, files?)` signature updated
- [ ] Private methods accept `tabId` parameter
- [ ] When `tabId` provided, uses explicit tab (not activeTab)
- [ ] When `tabId` is null/undefined, falls back to activeTab (backward compatible)
- [ ] No TypeScript errors
- [ ] Existing functionality unchanged when `tabId` omitted
- [ ] Git commit created: `feat(chat): add tabId parameter to MessageSenderService for split-view`

**Dependencies**: None (can start after Task 1)

---

### Task 5: Add tabId Overloads to ConversationService ⏸️ PENDING

**Type**: FRONTEND (CRITICAL)  
**Complexity**: Level 2 (Moderate)
**Estimated Time**: 30 minutes
**Status**: ⏸️ PENDING

**Description**:
🚨 **CRITICAL FOR SPLIT-PANE**: `ConversationService` also uses `tabManager.activeTab()` for queue management and conversation flow. Add explicit `tabId` support for proper pane isolation.

**Files to Modify**:

- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts` - Add tabId parameter

**Implementation Details**:

Add optional `tabId` parameter to queue methods:

```typescript
/**
 * Queue message for specific tab (for split-pane isolation)
 */
queueOrAppendMessage(content: string, tabId?: string | null): void {
  const targetTabId = tabId ?? this.tabManager.activeTabId();
  if (!targetTabId) return;

  const targetTab = this.tabManager.tabs().find(t => t.id === targetTabId);
  if (!targetTab) return;

  // Queue to specific tab, not activeTab
  const existingQueue = targetTab.queuedContent;
  const newContent = existingQueue
    ? `${existingQueue}\n\n${content}`
    : content;

  this.tabManager.updateTab(targetTabId, { queuedContent: newContent });
}

/**
 * Check if specific tab is streaming
 */
isStreamingForTab(tabId: string | null): boolean {
  if (!tabId) return this.isStreaming(); // fallback
  const tab = this.tabManager.tabs().find(t => t.id === tabId);
  return tab?.status === 'streaming' || tab?.status === 'resuming';
}
```

**Verification Criteria**:

- [ ] `queueOrAppendMessage(content, tabId?)` updated
- [ ] `isStreamingForTab(tabId)` method added
- [ ] Queue targets specific tab when `tabId` provided
- [ ] Fallback to activeTab when `tabId` is null (backward compatible)
- [ ] No TypeScript errors
- [ ] Git commit created: `feat(chat): add tabId parameter to ConversationService for split-view`

**Dependencies**: Task 4 (MessageSenderService)

---

### Task 6: Create SplitPaneContainerComponent ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 2 (Moderate)
**Estimated Time**: 1.5 hours
**Status**: ⏸️ PENDING

**Description**:
Create `SplitPaneContainerComponent` as the parent container that orchestrates pane layout. This component renders 1-2 `ChatViewComponent` instances with flexbox layout and includes the `PaneResizerComponent` between panes when split.

**Files to Create**:

- `libs/frontend/chat/src/lib/components/organisms/split-pane-container.component.ts` - Component with template

**Files to Modify**:

- `libs/frontend/chat/src/lib/components/index.ts` - Export component

**Implementation Details**:

- Standalone component with OnPush
- Injects: `PaneManagerService`
- Template structure:

  ```html
  <div class="flex h-full w-full">
    @for (pane of paneManager.panes(); track pane.id; let i = $index) {
    <!-- Pane wrapper with dynamic flex-basis -->
    <div class="flex flex-col min-w-0 overflow-hidden" [style.flex-basis.%]="pane.sizePercent" [class.ring-2]="pane.id === paneManager.focusedPaneId()" [class.ring-primary]="pane.id === paneManager.focusedPaneId()" (click)="paneManager.focusPane(pane.id)">
      <ptah-chat-view [tabId]="pane.tabId" />
    </div>

    <!-- Resizer between panes (not after last) -->
    @if (i < paneManager.panes().length - 1) {
    <ptah-pane-resizer [containerWidth]="containerWidth()" (sizeChange)="onResize($event)" />
    } }
  </div>
  ```

- Uses `viewChild` for container ref to get width
- `onResize()` calls `paneManager.resizePanes()`
- Pane focus ring indicates which pane receives tab assignments

**Verification Criteria**:

- [ ] File exists at `libs/frontend/chat/src/lib/components/organisms/split-pane-container.component.ts`
- [ ] Standalone component with OnPush
- [ ] Injects PaneManagerService
- [ ] Renders ChatViewComponent with `[tabId]` input for each pane
- [ ] Uses `@for` with `track pane.id`
- [ ] Dynamic `flex-basis` from `pane.sizePercent`
- [ ] PaneResizerComponent rendered between panes (not after last)
- [ ] Focus ring on focused pane
- [ ] Click handler calls `focusPane()`
- [ ] Resize handler calls `resizePanes()`
- [ ] Component exported from index.ts
- [ ] No TypeScript errors
- [ ] Git commit created: `feat(chat): add SplitPaneContainerComponent for multi-pane layout`

**Dependencies**: Task 2 (PaneManagerService), Task 3 (PaneResizerComponent)

---

### Task 7: Modify ChatViewComponent for Tab Context ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 2 (Moderate)
**Estimated Time**: 1 hour
**Status**: ⏸️ PENDING

**Description**:
Modify `ChatViewComponent` to accept an optional `tabId` input for pane-specific context. When provided, the component reads from the specified tab instead of the global `activeTab`. This enables multiple instances to display different tabs simultaneously.

**Files to Modify**:

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` - Add tabId input, resolvedTab computed
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` - Pass tabId to ChatInputComponent

**Implementation Details**:

Add signal input:

```typescript
readonly tabId = input<string | null>(null);
```

Create resolved tab computed (reads from specific tab or falls back to activeTab):

```typescript
private readonly tabManager = inject(TabManagerService);

private readonly resolvedTab = computed(() => {
  const specificTabId = this.tabId();
  if (specificTabId) {
    // Find specific tab by ID
    return this.tabManager.tabs().find(t => t.id === specificTabId) ?? null;
  }
  // Fallback to active tab (existing behavior)
  return this.chatStore.activeTab();
});

// Expose tabId for template to pass to child components
readonly resolvedTabId = computed(() => this.tabId() ?? this.chatStore.activeTab()?.id ?? null);
```

Update all tab-dependent logic to use `resolvedTab()` instead of `chatStore.activeTab()`:

- `streamingMessages` computed
- `preloadedStats` access
- `liveModelStats` access
- `queuedContent` display

**CRITICAL**: Pass tabId to ChatInputComponent in template:

```html
<ptah-chat-input [tabId]="resolvedTabId()" />
```

**Pattern Reference**: Existing `activeTab` usage at [chat-view.component.ts#L105-L120](libs/frontend/chat/src/lib/components/templates/chat-view.component.ts#L105-L120)

**Verification Criteria**:

- [ ] `tabId = input<string | null>(null)` added
- [ ] `resolvedTab` computed created with fallback logic
- [ ] `resolvedTabId` computed for template usage
- [ ] `streamingMessages` uses `resolvedTab()` instead of `chatStore.activeTab()`
- [ ] Other tab-dependent logic updated to use `resolvedTab()`
- [ ] Template passes `[tabId]="resolvedTabId()"` to ChatInputComponent
- [ ] Component works WITHOUT tabId input (backward compatible - uses activeTab)
- [ ] Component works WITH tabId input (displays specified tab)
- [ ] No breaking changes to existing usage in app-shell
- [ ] No TypeScript errors
- [ ] Git commit created: `feat(chat): add tabId input to ChatViewComponent for split-view`

**Dependencies**: Task 6 (SplitPaneContainerComponent uses this)

---

### Task 8: Modify ChatInputComponent for Tab Context ⏸️ PENDING

**Type**: FRONTEND (CRITICAL)
**Complexity**: Level 2 (Moderate)  
**Estimated Time**: 45 minutes
**Status**: ⏸️ PENDING

**Description**:
🚨 **CRITICAL FOR SPLIT-PANE INPUT ISOLATION**: `ChatInputComponent` must accept `tabId` input and pass it to `chatStore.sendOrQueueMessage()` so each pane sends to its own tab, NOT the global activeTab.

**Files to Modify**:

- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts` - Add tabId input, update send logic

**Implementation Details**:

Add signal input:

```typescript
readonly tabId = input<string | null>(null);
```

Update `handleSend()` to pass tabId:

```typescript
async handleSend(): Promise<void> {
  const content = this.currentMessage().trim();
  if (!content) return;

  try {
    const filePaths = this._selectedFiles().map((f) => f.path);
    // CRITICAL: Pass tabId to ensure message goes to correct tab
    await this.chatStore.sendOrQueueMessage(content, this.tabId(), filePaths);

    // Clear input and files
    this._currentMessage.set('');
    this._selectedFiles.set([]);
    // ... rest of cleanup
  } catch (error) {
    console.error('[ChatInputComponent] Failed to send message:', error);
  }
}
```

Update streaming/queue checks to use specific tab:

```typescript
// Instead of chatStore.activeTab(), use:
readonly isThisTabStreaming = computed(() => {
  const tid = this.tabId();
  if (!tid) return this.chatStore.isStreaming(); // fallback
  const tab = this.tabManager.tabs().find(t => t.id === tid);
  return tab?.status === 'streaming' || tab?.status === 'resuming';
});
```

Update `ChatStore.sendOrQueueMessage()` to accept tabId:

```typescript
// In chat.store.ts
async sendOrQueueMessage(
  content: string,
  tabId?: string | null,  // NEW
  filePaths?: string[]
): Promise<void> {
  // Route to tab-specific or active tab
  const targetTab = tabId
    ? this.tabManager.tabs().find(t => t.id === tabId)
    : this.tabManager.activeTab();

  if (!targetTab) return;

  const isStreaming = targetTab.status === 'streaming' || targetTab.status === 'resuming';

  if (isStreaming) {
    this.conversation.queueOrAppendMessage(content, tabId);
  } else {
    await this.messageSender.send(content, tabId, filePaths);
  }
}
```

**Verification Criteria**:

- [ ] `tabId = input<string | null>(null)` added to ChatInputComponent
- [ ] `handleSend()` passes `this.tabId()` to sendOrQueueMessage
- [ ] `isThisTabStreaming` computed checks specific tab status
- [ ] `ChatStore.sendOrQueueMessage()` accepts optional tabId
- [ ] Each pane's input sends to its OWN tab (not global activeTab)
- [ ] When tabId null, falls back to activeTab (backward compatible)
- [ ] No TypeScript errors
- [ ] Git commit created: `feat(chat): add tabId input to ChatInputComponent for split-view`

**Dependencies**: Tasks 4, 5, 7 (service overloads and ChatViewComponent)

---

### Task 9: Extend PermissionHandlerService for Per-Session Filtering ⏸️ PENDING

**Type**: FRONTEND
**Complexity**: Level 1 (Simple)
**Estimated Time**: 30 minutes
**Status**: ⏸️ PENDING

**Description**:
Add `getPermissionsForTab(tabId)` method to `PermissionHandlerService` that filters permissions by the tab's session context. This ensures each pane only shows permissions for its assigned tab.

**Files to Modify**:

- `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` - Add filtering method

**Implementation Details**:

Add new method:

```typescript
/**
 * Get permissions that belong to a specific tab's session.
 * Filters by matching toolUseId against the tab's toolCallMap.
 * Used by split-pane view to show permissions only in the correct pane.
 */
getPermissionsForTab(tabId: string | null): PermissionRequest[] {
  if (!tabId) {
    // No tab specified - return all (fallback behavior)
    return this._permissionRequests();
  }

  const tab = this.tabManager.tabs().find(t => t.id === tabId);
  if (!tab) return [];

  // Get tool IDs from this tab's context
  const tabToolIds = new Set<string>();

  // From finalized messages
  tab.messages?.forEach(msg => {
    if (msg.streamingState) {
      this.extractToolIds(msg.streamingState, tabToolIds);
    }
  });

  // From current streaming state
  if (tab.streamingState?.toolCallMap) {
    for (const toolCallId of tab.streamingState.toolCallMap.keys()) {
      tabToolIds.add(toolCallId);
    }
  }

  // Filter permissions to those matching this tab's tools
  return this._permissionRequests().filter(req => {
    if (!req.toolUseId) return false;
    return tabToolIds.has(req.toolUseId);
  });
}
```

**Pattern Reference**: Existing `toolIdsInExecutionTree` computed at [permission-handler.service.ts#L130-L162](libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts#L130-L162)

**Verification Criteria**:

- [ ] `getPermissionsForTab(tabId)` method added
- [ ] Returns empty array for null tabId or missing tab
- [ ] Correctly filters permissions by tab's toolCallMap
- [ ] Handles both finalized messages and streaming state
- [ ] No TypeScript errors
- [ ] Git commit created: `feat(chat): add per-tab permission filtering for split-view`

**Dependencies**: Task 7 (ChatViewComponent will call this)

---

### Task 10: Integrate Split-Pane into AppShellComponent ⏸️ PENDING

**Type**: FRONTEND (Integration)
**Complexity**: Level 2 (Moderate)
**Estimated Time**: 45 minutes
**Status**: ⏸️ PENDING

**Description**:
Update `AppShellComponent` to use `SplitPaneContainerComponent` instead of direct `ChatViewComponent`, and add the split view toggle button in the header.

**Files to Modify**:

- `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts` - Import components, add split logic
- `libs/frontend/chat/src/lib/components/templates/app-shell.component.html` - Replace chat-view, add button

**Implementation Details**:

In `app-shell.component.ts`:

```typescript
// Add imports
import { SplitPaneContainerComponent } from '../organisms/split-pane-container.component';
import { PaneManagerService } from '../../services/pane-manager.service';

// Add to imports array
imports: [
  // ... existing imports
  SplitPaneContainerComponent,
],

// Inject service
readonly paneManager = inject(PaneManagerService);

// Add Lucide icon
readonly ColumnsIcon = Columns; // from lucide-angular

// Add toggle method
toggleSplitView(): void {
  if (this.paneManager.isSplit()) {
    // Close the non-focused pane
    const panes = this.paneManager.panes();
    const focusedId = this.paneManager.focusedPaneId();
    const paneToClose = panes.find(p => p.id !== focusedId);
    if (paneToClose) {
      this.paneManager.closePane(paneToClose.id);
    }
  } else {
    this.paneManager.splitPane();
  }
}
```

In `app-shell.component.html`:

1. Replace `<ptah-chat-view />` with `<ptah-split-pane-container />`
2. Add split toggle button near settings button:

```html
<button class="btn btn-square btn-ghost btn-sm" [class.btn-active]="paneManager.isSplit()" aria-label="Toggle split view" title="Toggle split view (Ctrl+\)" (click)="toggleSplitView()">
  <lucide-angular [img]="ColumnsIcon" class="w-4 h-4" />
</button>
```

**Verification Criteria**:

- [ ] SplitPaneContainerComponent imported and added to imports array
- [ ] PaneManagerService injected
- [ ] `<ptah-chat-view />` replaced with `<ptah-split-pane-container />`
- [ ] Split toggle button added to header (near settings)
- [ ] Button shows active state when split
- [ ] `toggleSplitView()` method works (split/unsplit)
- [ ] Lucide Columns icon used
- [ ] No TypeScript errors
- [ ] Build passes (`nx build chat`)
- [ ] Git commit created: `feat(chat): integrate split-pane container into app shell`

**Dependencies**: Tasks 6, 7, 8, 9 (all core components ready)

---

### Task 11: Add Unit Tests for Pane Services ⏸️ PENDING

**Type**: TEST
**Complexity**: Level 2 (Moderate)
**Estimated Time**: 1 hour
**Status**: ⏸️ PENDING

**Description**:
Create unit tests for `PaneManagerService` covering all core operations: split, close, resize, assign, persist. Target ≥80% coverage.

**Files to Create**:

- `libs/frontend/chat/src/lib/services/pane-manager.service.spec.ts` - Unit tests

**Test Cases**:

```typescript
describe('PaneManagerService', () => {
  describe('initialization', () => {
    it('should start with single pane');
    it('should load saved state from localStorage');
  });

  describe('splitPane', () => {
    it('should create second pane with 50/50 split');
    it('should set isSplit to true');
    it('should focus the new pane');
  });

  describe('closePane', () => {
    it('should remove pane and return to single pane');
    it('should set isSplit to false');
    it('should expand remaining pane to 100%');
  });

  describe('assignTabToPane', () => {
    it('should update pane tabId');
    it('should persist state');
  });

  describe('resizePanes', () => {
    it('should update pane sizes');
    it('should enforce minimum 20%');
    it('should enforce maximum 80%');
  });

  describe('persistence', () => {
    it('should save to localStorage on changes');
    it('should debounce rapid saves');
    it('should restore state on init');
  });
});
```

**Verification Criteria**:

- [ ] Test file exists at `libs/frontend/chat/src/lib/services/pane-manager.service.spec.ts`
- [ ] All test cases passing
- [ ] Coverage ≥80% for PaneManagerService
- [ ] Tests run without errors (`nx test chat --testFile=pane-manager`)
- [ ] Git commit created: `test(chat): add unit tests for PaneManagerService`

**Dependencies**: Task 2 (PaneManagerService must exist)

---

## Verification Checklist

After all tasks complete:

- [ ] All 11 tasks have status "✅ COMPLETED"
- [ ] All git commits created (11 commits)
- [ ] Build passes: `nx build chat`
- [ ] Lint passes: `nx lint chat`
- [ ] Tests pass: `nx test chat`
- [ ] Manual verification of BDD scenarios 1-7:
  - [ ] Scenario 1: Split view creates 2 equal panes
  - [ ] Scenario 2: Tab assignment works per-pane
  - [ ] Scenario 3: Resize drag works, min 20% enforced
  - [ ] Scenario 4: **CRITICAL** Each pane sends to ITS OWN tab (not activeTab)
  - [ ] Scenario 5: Permissions show in correct pane only
  - [ ] Scenario 6: Close pane returns to single pane
  - [ ] Scenario 7: Layout persists across reload

---

## FIRST TASK ASSIGNMENT

**Assigned To**: frontend-developer
**Task**: Task 1 - Create Pane Type Definitions

**Instructions for Developer**:

You are assigned Task 1: Create Pane Type Definitions

**Architecture Context**:

- Implementation Plan: [implementation-plan.md](./implementation-plan.md)
- Follow existing pattern: [chat.types.ts](libs/frontend/chat/src/lib/services/chat.types.ts)

**🚨 CRITICAL ARCHITECTURE NOTE**:
This feature requires careful attention to Angular DI and service sharing. All services are singletons. Tasks 4, 5, and 8 are CRITICAL for proper pane isolation - each pane's ChatInput must send to its OWN tab, not the global activeTab.

**Your Mission**:

1. Follow your 10-step developer initialization protocol
2. Implement ONLY Task 1
3. Commit immediately after implementation
4. Self-verify against task criteria
5. Update tasks.md status to "✅ COMPLETED"
6. Report completion with commit SHA

**Verification Criteria**:

- File `pane.types.ts` exists with PaneState, PaneLayout interfaces
- Constants exported
- Types exported from services/index.ts
- No TypeScript errors
- Git commit created

Proceed with implementation.
