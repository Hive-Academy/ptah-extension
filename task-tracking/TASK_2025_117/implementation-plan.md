# Implementation Plan - TASK_2025_117

**Created**: 2026-01-24
**Architect**: software-architect
**Status**: AWAITING USER VALIDATION

---

## 1. Architecture Overview

### High-Level Design

This feature implements a split-pane multi-tab view for the Ptah VS Code extension webview, allowing users to view and interact with two chat tabs simultaneously. The architecture follows the established signal-based patterns from `TabManagerService` and introduces a new `PaneManagerService` for pane state management.

The design uses a layered approach where `PaneManagerService` manages pane configuration (which tabs appear in which panes, pane sizes) while `TabManagerService` continues to manage tab lifecycle (messages, streaming state, session IDs). The `SplitPaneContainerComponent` orchestrates layout rendering using CSS flexbox with dynamic `flex-basis` percentages, and each pane receives a specific `tabId` input to render tab-specific content.

All changes are frontend-only. The existing backend event routing (via `tabId` in streaming events) and permission matching (via `toolUseId`) require no modifications - they were already validated as safe for multi-pane scenarios during pre-task research.

### Design Patterns Applied

- **State Management Pattern** (Behavioral): Signal-based reactive state with readonly public signals and private writable signals - matches existing `TabManagerService` pattern at [tab-manager.service.ts#L32-L49](libs/frontend/chat/src/lib/services/tab-manager.service.ts#L32-L49)
- **Facade Pattern** (Structural): `ChatStore` continues as the facade for chat-related state, now with pane-aware computed signals for permission filtering
- **Composition Pattern** (Structural): `SplitPaneContainerComponent` composes multiple `ChatViewComponent` instances with different tab contexts
- **Persistence Pattern** (Behavioral): localStorage persistence with debouncing - follows existing pattern at [tab-manager.service.ts#L444-L497](libs/frontend/chat/src/lib/services/tab-manager.service.ts#L444-L497)

### Component Interaction

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           AppShellComponent                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ Header (Tab Bar + Split Button)                                   │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    SplitPaneContainerComponent                     │  │
│  │  ┌─────────────────────┬───┬─────────────────────────────────────┐│  │
│  │  │   ChatViewComponent │ R │      ChatViewComponent              ││  │
│  │  │   [tabId="tab_a"]   │ e │      [tabId="tab_b"]                ││  │
│  │  │                     │ s │                                     ││  │
│  │  │ ┌─────────────────┐ │ i │  ┌─────────────────┐                ││  │
│  │  │ │ Messages        │ │ z │  │ Messages        │                ││  │
│  │  │ │ Permissions     │ │ e │  │ Permissions     │                ││  │
│  │  │ │ ChatInput       │ │ r │  │ ChatInput       │                ││  │
│  │  │ └─────────────────┘ │   │  └─────────────────┘                ││  │
│  │  └─────────────────────┴───┴─────────────────────────────────────┘│  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                   ┌────────────────┼────────────────┐
                   ▼                ▼                ▼
           PaneManagerService  TabManagerService  PermissionHandlerService
            (pane layout)      (tab lifecycle)    (per-tab filtering)
```

---

## 2. SOLID Principles Compliance

### Single Responsibility Principle

- **PaneManagerService**: Manages pane layout state only (pane IDs, tab assignments, sizes)
- **TabManagerService**: Continues to manage tab lifecycle (unchanged responsibility)
- **SplitPaneContainerComponent**: Orchestrates pane layout rendering only
- **PaneResizerComponent**: Handles resize interaction only
- **ChatViewComponent**: Displays chat for a specific tab context (now parameterized via input)

### Open/Closed Principle

- **Extensibility**: Adding more than 2 panes in future requires only `PaneManagerService.MAX_PANES` constant change
- **Abstraction**: `PaneState` interface allows extension without modifying existing consumers

### Liskov Substitution Principle

- **ChatViewComponent**: Works identically whether `tabId` is provided (pane mode) or null (legacy single-pane mode)
- **No breaking changes**: All existing usages continue to work unchanged

### Interface Segregation Principle

- **PaneState**: Focused interface for pane configuration (id, tabId, sizePercent)
- **No bloated interfaces**: Pane state doesn't include tab lifecycle concerns

### Dependency Inversion Principle

- **Dependencies injected**: All services use Angular DI with `inject()` function
- **Signal-based contracts**: Components depend on readonly signals, not implementation details

**Compliance Assessment**: ✅ All SOLID principles satisfied

---

## 3. Type/Schema Reuse Strategy

### Existing Types to Reuse

**Search Completed**: Glob `libs/shared/src/**/*.ts` + semantic search for "pane", "split", "layout"

**Found Types (Reused)**:

- `TabState` from `libs/frontend/chat/src/lib/services/chat.types.ts`

  - **Purpose**: Represents a chat tab with messages, streaming state, session ID
  - **How We'll Use It**: Reference via `tabId` in `PaneState` - no duplication

- No existing `PaneState` or split-view types found (this is a new feature)

### New Types Required

- `PaneState` in `libs/frontend/chat/src/lib/services/pane.types.ts`

  - **Purpose**: Represents a single pane in split view
  - **Structure**:

  ```typescript
  interface PaneState {
    id: string; // Pane identifier (e.g., "pane_left", "pane_right")
    tabId: string | null; // Which tab is displayed (null = empty pane)
    sizePercent: number; // Width as percentage (20-80, sum = 100)
  }
  ```

  - **Rationale**: New concept not represented in existing types; pane != tab

- `PaneLayout` in `libs/frontend/chat/src/lib/services/pane.types.ts`

  - **Purpose**: Represents the overall pane configuration
  - **Structure**:

  ```typescript
  interface PaneLayout {
    panes: PaneState[];
    isSplit: boolean; // Convenience computed from panes.length > 1
    version: number; // For persistence migration
  }
  ```

  - **Rationale**: Encapsulates persistence format with migration support

### Type Safety Guarantees

- ✅ Zero `any` types - all strictly typed
- ✅ `tabId` uses existing `string` type (matches `TabState.id`)
- ✅ Null safety with explicit `| null` for optional assignments
- ✅ Size constraints enforced via validation logic (not type system)

---

## 4. File Changes

### Frontend Files to Modify

#### 1. `libs/frontend/chat/src/lib/components/templates/app-shell.component.ts`

**Purpose**: Replace direct `<ptah-chat-view>` with `<ptah-split-pane-container>`
**Scope**: Import SplitPaneContainerComponent, update template to use it
**Estimated LOC**: ~10 lines changed
**Evidence**: Current usage at [app-shell.component.html#L219](libs/frontend/chat/src/lib/components/templates/app-shell.component.html#L219)

#### 2. `libs/frontend/chat/src/lib/components/templates/app-shell.component.html`

**Purpose**: Add split view toggle button in header, replace chat-view with split-pane-container
**Scope**: Add button near settings icon, replace `<ptah-chat-view />` with `<ptah-split-pane-container />`
**Estimated LOC**: ~15 lines changed

#### 3. `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`

**Purpose**: Add `tabId` input for pane-specific context, create tab-aware computed signals
**Scope**: Add `tabId = input<string | null>(null)`, create `resolvedTab()` computed that uses tabId or falls back to activeTab
**Estimated LOC**: ~40 lines added
**Pattern Evidence**: Similar pattern at [tab-manager.service.ts#L59-L61](libs/frontend/chat/src/lib/services/tab-manager.service.ts#L59-L61)

#### 4. `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts`

**Purpose**: Add `getPermissionsForSession()` method for pane-specific filtering
**Scope**: New method that filters `_permissionRequests` by session ID matching
**Estimated LOC**: ~25 lines added
**Pattern Evidence**: Existing `unmatchedPermissions` computed at [permission-handler.service.ts#L163-L180](libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts#L163-L180)

#### 5. `libs/frontend/chat/src/lib/components/index.ts`

**Purpose**: Export new components
**Scope**: Add exports for SplitPaneContainerComponent, PaneResizerComponent
**Estimated LOC**: ~5 lines added

### Files to Create

#### 1. `libs/frontend/chat/src/lib/services/pane.types.ts`

**Purpose**: Type definitions for pane state
**Content**: `PaneState`, `PaneLayout` interfaces
**Estimated LOC**: ~35 lines
**Rationale**: Separate file for new domain types, following existing pattern of `chat.types.ts`

#### 2. `libs/frontend/chat/src/lib/services/pane-manager.service.ts`

**Purpose**: Signal-based pane state management
**Content**:

- Private signals: `_panes`, `_focusedPaneId`
- Public readonly signals: `panes`, `focusedPaneId`, `isSplit`
- Methods: `splitPane()`, `closePane()`, `assignTabToPane()`, `resizePanes()`, `focusPane()`
- Persistence: localStorage with debouncing (pattern from TabManagerService)
  **Estimated LOC**: ~180 lines
  **Pattern Evidence**: Follows [tab-manager.service.ts](libs/frontend/chat/src/lib/services/tab-manager.service.ts) structure exactly

#### 3. `libs/frontend/chat/src/lib/components/organisms/split-pane-container.component.ts`

**Purpose**: Parent container that orchestrates pane layout
**Content**:

- Injects PaneManagerService, renders 1-2 ChatViewComponent instances
- Uses `@for` with `track pane.id` for efficient rendering
- Passes `[tabId]="pane.tabId"` to each ChatViewComponent
- Flexbox layout with dynamic `flex-basis` from pane sizes
  **Estimated LOC**: ~80 lines (component + template)
  **Pattern Evidence**: Follows AppShellComponent structure at [app-shell.component.ts](libs/frontend/chat/src/lib/components/templates/app-shell.component.ts)

#### 4. `libs/frontend/chat/src/lib/components/molecules/pane-resizer.component.ts`

**Purpose**: Draggable divider between panes
**Content**:

- Pointer event handlers (pointerdown, pointermove, pointerup)
- Calculates new size percentages based on drag delta
- Emits `sizeChange` event with new left/right percentages
- Visual feedback (cursor, highlight color)
- Minimum size enforcement (20%)
  **Estimated LOC**: ~100 lines
  **CDK Evidence**: Can use native pointer events, CDK DragDrop is optional enhancement

---

## 5. Integration Points

### 🚨 CRITICAL: Angular DI and Service Sharing Analysis

**All services are singletons** (`providedIn: 'root'`). This means BOTH panes share:

- `TabManagerService` - ✅ Correct (manages all tabs centrally)
- `PaneManagerService` - ✅ Correct (manages pane layout centrally)
- `PermissionHandlerService` - ✅ Correct (with per-tab filtering method)
- `MessageSenderService` - ⚠️ **REQUIRES MODIFICATION** (currently uses `activeTab()`)
- `ChatStore` - ⚠️ **REQUIRES MODIFICATION** (currently uses `activeTab()`)
- `ConversationService` - ⚠️ **REQUIRES MODIFICATION** (currently uses `activeTab()`)

**Key Insight**: Components share service instances, so we MUST pass `tabId` context explicitly through the component hierarchy and modify APIs to accept `tabId` parameters.

### ChatInputComponent Context Flow (CRITICAL FIX)

**Current (Broken for Split-Pane)**:

```
ChatInputComponent.handleSend()
  → chatStore.sendOrQueueMessage(content)
    → tabManager.activeTab()  ← WRONG! Uses global active, not pane's tab
```

**Required (Correct for Split-Pane)**:

```
ChatInputComponent[tabId input]
  → chatStore.sendOrQueueMessageForTab(content, tabId)
    → tabManager.tabs().find(t => t.id === tabId)  ← Uses explicit tab
```

### Internal Dependencies

- **PaneManagerService** → Injects nothing (standalone state)
- **SplitPaneContainerComponent** → Injects `PaneManagerService`
- **ChatViewComponent** → Injects `ChatStore`, `TabManagerService` (existing), adds conditional logic for `tabId` input
- **ChatInputComponent** → **NEW**: Add `tabId` input, pass to ChatStore methods
- **PermissionHandlerService** → Adds method, no new dependencies
- **MessageSenderService** → **NEW**: Add overloads that accept explicit `tabId`
- **ConversationService** → **NEW**: Add overloads that accept explicit `tabId`

### Component Communication

- **AppShell → SplitPaneContainer**: Parent-child composition
- **SplitPaneContainer → ChatView**: Input binding `[tabId]="pane.tabId"`
- **SplitPaneContainer ↔ PaneResizer**: Bidirectional - pane sizes read from service, resize events update service
- **Tab Bar → PaneManager**: Tab clicks call `assignTabToPane(focusedPaneId, clickedTabId)`

### Service Communication

```
AppShellComponent
    │
    ├── splitPane() ─────────────► PaneManagerService._panes.update()
    │
    ├── TabBarComponent
    │       │
    │       └── onTabClick(tabId) ──► PaneManagerService.assignTabToPane()
    │                                        │
    │                                        ▼
SplitPaneContainerComponent ◄───── PaneManagerService.panes() [reactive]
    │
    └── ChatViewComponent[tabId]
            │
            ├── messages() ──────► TabManagerService.tabs().find(t => t.id === tabId)
            │
            └── permissions() ───► PermissionHandlerService.getPermissionsForSession()
```

### Breaking Changes Assessment

- [x] ✅ **No Breaking Changes** - Fully backward compatible
  - `ChatViewComponent` without `tabId` input continues to work (uses activeTab fallback)
  - Single-pane mode is the default (isSplit = false initially)
  - All existing behavior preserved

---

## 6. Implementation Tasks Outline

**NOTE**: Team-leader MODE 1 will decompose these into atomic tasks in tasks.md

### Task Category: Type Definitions

1. **Create pane.types.ts**
   - Define `PaneState` interface
   - Define `PaneLayout` interface
   - Export from services barrel

### Task Category: Service Implementation

1. **Create PaneManagerService**

   - Signal-based state (`_panes`, `_focusedPaneId`)
   - Public readonly signals
   - Core methods: `splitPane()`, `closePane()`, `assignTabToPane()`, `resizePanes()`
   - localStorage persistence with debouncing
   - Unit tests (≥80% coverage)

2. **🚨 CRITICAL: Modify MessageSenderService for Tab Context**

   - Add `tabId?: string | null` parameter to `send()` method
   - Add `tabId?: string | null` parameter to `sendOrQueue()` method
   - When `tabId` provided: use `tabManager.tabs().find(t => t.id === tabId)`
   - When `tabId` is null/undefined: fallback to `tabManager.activeTab()` (backward compatible)
   - **Evidence**: Lines 112, 143, 201, 212 currently use `activeTab()` - must respect tabId override

3. **🚨 CRITICAL: Modify ConversationService for Tab Context**

   - Add `tabId?: string | null` parameter to `queueOrAppendMessage()` method
   - When `tabId` provided: use explicit tab for queue operations
   - When `tabId` is null/undefined: fallback to activeTab (backward compatible)
   - **Evidence**: Lines 180-280 use activeTab for queue management

4. **Extend PermissionHandlerService**
   - Add `getPermissionsForSession(sessionId)` method
   - Filter by matching toolUseId in session's toolCallMap
   - Unit tests for new method

### Task Category: Component Implementation

1. **Create SplitPaneContainerComponent**

   - Standalone component with OnPush
   - Inject PaneManagerService
   - Render ChatViewComponent instances with `[tabId]` input
   - Flexbox layout with dynamic sizing
   - Include PaneResizer when split

2. **Create PaneResizerComponent**

   - Standalone component with OnPush
   - Pointer event handling for drag resize
   - Output event for size changes
   - Visual feedback (cursor, highlight)
   - Minimum size enforcement
   - Keyboard accessibility (arrow keys)

3. **Modify ChatViewComponent for Tab Context**

   - Add `tabId = input<string | null>(null)` signal input
   - Create `resolvedTab()` computed: uses tabId if provided, else activeTab
   - Update all tab-dependent computeds to use resolvedTab()
   - Filter permissions by tab context
   - **Pass tabId to child components** (ChatInputComponent, PermissionCards)
   - No breaking changes to existing usage

4. **🚨 CRITICAL: Modify ChatInputComponent for Tab Context**
   - Add `tabId = input<string | null>(null)` signal input
   - Modify `handleSend()` to pass tabId to `chatStore.sendOrQueueMessage(content, tabId, files)`
   - When `tabId` is null: use activeTab (backward compatible)
   - **Evidence**: Lines 631-651 currently send without tabId context

### Task Category: Layout Integration

1. **Update AppShellComponent**

   - Add split view toggle button (Lucide Columns icon)
   - Replace `<ptah-chat-view>` with `<ptah-split-pane-container>`
   - Wire up keyboard shortcut (Ctrl+\)

2. **Update Tab Bar Interaction**
   - Tab click assigns to focused pane (via PaneManagerService)
   - Visual indicator for which pane is focused

### Task Category: Testing & Polish

1. **Unit Tests**

   - PaneManagerService: split/close/resize/persist operations
   - PermissionHandlerService: session filtering
   - ChatViewComponent: tab context resolution

2. **Manual E2E Validation**
   - All 7 BDD scenarios from task-description.md

---

## 7. Timeline & Scope Discipline

### Current Scope (This Task)

**Timeline Estimate**: 6-8 hours (1 day) ✅ Under 2 weeks

**Core Deliverable**:

- Users can split view into 2 panes
- Each pane displays different tab content
- Panes are resizable with drag divider
- Permissions display in correct pane only
- Layout persists across reloads

**Quality Threshold**:

- All 7 acceptance criteria met
- ≥80% test coverage on new services
- Zero `any` types
- Build passes (compile + lint)

### Timeline Breakdown

| Task Category                        | Estimated Time | Priority    |
| ------------------------------------ | -------------- | ----------- |
| Type Definitions                     | 0.5 hours      | High        |
| PaneManagerService                   | 1.5 hours      | High        |
| MessageSenderService tabId overloads | 0.5 hours      | 🚨 CRITICAL |
| ConversationService tabId overloads  | 0.5 hours      | 🚨 CRITICAL |
| PermissionHandlerService extension   | 0.5 hours      | High        |
| SplitPaneContainerComponent          | 1.5 hours      | High        |
| PaneResizerComponent                 | 1 hour         | High        |
| ChatViewComponent modification       | 1 hour         | High        |
| ChatInputComponent tabId input       | 0.5 hours      | 🚨 CRITICAL |
| AppShellComponent integration        | 0.5 hours      | Medium      |
| Testing                              | 1-1.5 hours    | High        |

**Total**: ~9-10 hours (increased due to CRITICAL service modifications) ✅ Under 2 weeks

### Future Work (Deferred)

| Future Task ID | Description                        | Effort | Priority |
| -------------- | ---------------------------------- | ------ | -------- |
| TASK_FW_118    | More than 2 panes (3-4 panes)      | M      | Low      |
| TASK_FW_119    | Vertical split (top/bottom layout) | M      | Low      |
| TASK_FW_120    | Drag tabs between panes            | L      | Low      |
| TASK_FW_121    | Pane-specific settings             | S      | Low      |

---

## 8. Risk Assessment & Mitigation

### Technical Risks

#### Risk 1: ChatViewComponent refactor breaks existing single-pane mode

**Probability**: Low
**Impact**: High
**Mitigation**: Use optional `tabId` input with null fallback - when null, behavior is identical to current implementation
**Contingency**: Revert to passing activeTab through context if input approach fails

#### Risk 2: Resize performance issues

**Probability**: Low
**Impact**: Medium
**Mitigation**: Use `transform: translateX()` for visual feedback during drag, only update `flex-basis` on pointerup; throttle pointermove to ~60fps
**Contingency**: Simplify to click-to-resize buttons instead of drag

#### Risk 3: Memory leak with multiple ChatViewComponent instances

**Probability**: Low
**Impact**: Medium
**Mitigation**: Each ChatViewComponent already has proper cleanup in `destroyRef.onDestroy()` at [chat-view.component.ts#L145-L151](libs/frontend/chat/src/lib/components/templates/chat-view.component.ts#L145-L151)
**Contingency**: Add explicit cleanup logging to detect leaks early

### Performance Considerations

**Concern**: Two ChatViewComponent instances with MutationObservers
**Strategy**: Observers already scoped to their container elements, no cross-contamination
**Measurement**: Monitor memory usage in DevTools during split-view streaming

### Security Considerations

**Concern**: Cross-pane data leakage
**Strategy**: Each pane reads from isolated `tabId` context; toolUseId matching is globally unique
**Validation**: Already validated during pre-task research (see context.md)

---

## 9. Testing Strategy

### Unit Test Requirements

**PaneManagerService (`pane-manager.service.spec.ts`)**:

- `splitPane()` creates second pane with 50/50 split
- `closePane()` returns to single pane
- `assignTabToPane()` updates tabId correctly
- `resizePanes()` respects minimum 20%
- Persistence saves/loads correctly
- Coverage target: ≥80%

**PermissionHandlerService (extend existing spec)**:

- `getPermissionsForSession()` returns only matching permissions
- Empty session returns empty array
- Coverage target: ≥80%

**ChatViewComponent (extend existing spec)**:

- `tabId` input uses specified tab
- `tabId` null uses activeTab
- Computed signals update when tabId changes
- Coverage target: ≥80%

### Integration Test Requirements

- Split view renders two ChatViewComponent instances
- Tab click assigns to focused pane
- Resize updates pane sizes

### Manual Testing Scenarios

From BDD acceptance criteria:

- [ ] **Scenario 1**: Create split view - verify 2 equal panes appear
- [ ] **Scenario 2**: Assign tab to pane - verify correct content displays
- [ ] **Scenario 3**: Resize panes - verify drag works, min 20% enforced
- [ ] **Scenario 4**: Independent messaging - verify both panes can send/receive
- [ ] **Scenario 5**: Permission isolation - verify permissions show in correct pane
- [ ] **Scenario 6**: Close pane - verify return to single pane
- [ ] **Scenario 7**: Persist layout - verify state survives reload

### Acceptance Criteria Traceability

| Acceptance Criterion        | Test Type     | Test File                          |
| --------------------------- | ------------- | ---------------------------------- |
| AC-1: Create split view     | Unit + Manual | pane-manager.service.spec.ts       |
| AC-2: Assign tab to pane    | Unit + Manual | pane-manager.service.spec.ts       |
| AC-3: Resize panes          | Unit + Manual | pane-resizer.component.spec.ts     |
| AC-4: Independent messaging | Integration   | Manual E2E                         |
| AC-5: Permission isolation  | Unit          | permission-handler.service.spec.ts |
| AC-6: Close pane            | Unit + Manual | pane-manager.service.spec.ts       |
| AC-7: Persist layout        | Unit          | pane-manager.service.spec.ts       |

---

## 10. Accessibility Compliance

### Keyboard Navigation

- **Split toggle**: Accessible via Ctrl+\ shortcut
- **Pane focus**: Tab key moves between panes
- **Resizer**: Arrow keys adjust size (5% increments)
- **ARIA**: `role="separator"` on resizer, `aria-valuenow` for current position

### Screen Reader Support

- Announce "Split view enabled, 2 panes" on split
- Announce "Pane 1 focused" / "Pane 2 focused" on focus change
- Announce "Split view closed" on close

### Color Contrast

- Resizer highlight: Uses `--primary` color with 4.5:1 contrast ratio
- Focus ring: Standard DaisyUI focus ring

---

## 11. Quality Checklist

Before considering architecture complete:

- [x] SOLID principles compliance documented
- [x] Type/schema reuse strategy documented (search completed)
- [x] Zero `any` types planned
- [x] All file changes identified
- [x] Integration points defined
- [x] Timeline <2 weeks (8 hours estimated)
- [x] Risk assessment complete
- [x] Testing strategy defined
- [x] Accessibility requirements defined

---

**ARCHITECTURE PLANNING COMPLETE - AWAITING USER VALIDATION**
