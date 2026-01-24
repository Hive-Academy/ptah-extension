# Task Description - TASK_2025_117

**Created**: 2026-01-24
**Product Manager**: product-manager
**Status**: AWAITING USER VALIDATION

---

## 1. Task Overview

### Task Type

FEATURE

### Complexity Assessment

MEDIUM

**Reasoning**:

- New UI components required but following established Angular patterns
- Existing tab system already provides isolation - no backend changes needed
- Research phase complete - event routing and permission system validated
- Angular CDK already in project for drag-drop and resize
- Clear architectural proposal with minimal risk

### Timeline Estimate

**Initial Estimate**: 6-8 hours (1 day)
**Timeline Discipline**: ✅ Under 2 weeks - well within compliance

---

## 2. Business Requirements

### Primary Objective

Enable users to view and interact with multiple Claude agent conversations simultaneously in a side-by-side split-view layout, enhancing the multi-agent orchestration experience for power users who need to monitor parallel agent workflows.

### User Stories

**US1: Split View Creation**
**As a** Ptah extension user  
**I want** to split my chat view into multiple panes  
**So that** I can monitor multiple agent conversations simultaneously without switching tabs

**US2: Pane Tab Assignment**
**As a** user with multiple chat tabs  
**I want** to assign any open tab to any pane  
**So that** I can choose which conversations to compare or monitor together

**US3: Resizable Panes**
**As a** user viewing split panes  
**I want** to resize panes by dragging the divider  
**So that** I can allocate more space to the conversation I'm focused on

**US4: Pane Closure**
**As a** user with split panes  
**I want** to close a pane and return to single-view mode  
**So that** I can maximize screen space when I no longer need parallel views

**US5: Independent Interaction**
**As a** user with split panes  
**I want** to send messages and respond to permissions in each pane independently  
**So that** I can interact with multiple agents without interference

### Success Metrics

- User can create 2-pane split view from single pane view
- Each pane displays messages from its assigned tab correctly
- Streaming events route to correct pane without cross-talk
- Permissions display in the correct pane (not duplicated)
- Resize divider works smoothly without layout jitter
- Pane state persists across VS Code webview reloads

---

## 3. Functional Requirements (SMART Format)

### FR1: Pane Manager Service

**Specific**: Create `PaneManagerService` with signal-based state management for panes. Must track: pane count, pane IDs, which tab is assigned to each pane, and pane sizes (percentages).

**Measurable**:

- Service exposes `panes` signal with array of `PaneState` objects
- `splitPane()` creates new pane with 50/50 initial split
- `closePane()` removes pane and returns to single view
- `assignTabToPane()` links a tab ID to a pane ID
- `resizePanes()` updates size percentages

**Achievable**: ✅ Follows established `TabManagerService` patterns

**Relevant**: Core state management for entire split-pane feature

**Time-bound**: 1-1.5 hours

---

### FR2: Split Pane Container Component

**Specific**: Create `SplitPaneContainerComponent` as the parent container that orchestrates pane layout. Uses CSS flexbox with dynamic flex-basis percentages from `PaneManagerService`.

**Measurable**:

- Renders 1-N `ChatViewComponent` instances (initially support max 2 panes)
- Each child receives `tabId` input for pane-specific context
- Container reacts to `PaneManagerService.panes` signal
- Layout updates without full re-render on resize

**Achievable**: ✅ Standard Angular component with CDK overlay concepts

**Relevant**: Entry point for split-pane UI, replaces direct `<ptah-chat-view>` usage

**Time-bound**: 1.5-2 hours

---

### FR3: Pane Resizer Component

**Specific**: Create `PaneResizerComponent` - a draggable divider between panes that allows users to resize pane widths by dragging.

**Measurable**:

- Renders as vertical bar between panes (4px wide, cursor: col-resize)
- Drag interaction updates pane sizes in real-time
- Minimum pane width enforced (20% of container)
- Visual feedback on hover/drag (highlight color)
- Touch support for tablet users

**Achievable**: ✅ Can use native pointer events or Angular CDK DragDrop

**Relevant**: Essential UX for flexible pane layouts

**Time-bound**: 1 hour

---

### FR4: ChatView Tab Context Input

**Specific**: Modify `ChatViewComponent` to accept optional `tabId` input. When provided, component reads from specified tab instead of global `activeTab`.

**Measurable**:

- New `tabId = input<string | null>(null)` signal input
- Computed signals (`messages`, `isStreaming`, `permissions`) use `tabId` when provided
- Falls back to `chatStore.activeTab()` when `tabId` is null
- No breaking changes to existing single-pane usage

**Achievable**: ✅ Minor refactor - add conditional logic to existing computeds

**Relevant**: Enables each pane to display different tab content

**Time-bound**: 1 hour

---

### FR5: Per-Pane Permission Filtering

**Specific**: Modify `PermissionHandlerService` to support filtering permissions by tab context. Each pane should only show permissions for its assigned session.

**Measurable**:

- New `getPermissionsForSession(sessionId)` method
- `ChatViewComponent` uses session-filtered permissions when `tabId` provided
- Unmatched permissions still show in fallback area (existing behavior preserved)
- No duplicate permission display across panes

**Achievable**: ✅ Filter existing `_permissionRequests` signal by `toolUseId` matching

**Relevant**: Prevents confusing UX where permissions appear in wrong pane

**Time-bound**: 0.5 hours

---

### FR6: Split/Close UI Controls

**Specific**: Add UI controls to initiate split view and close panes.

**Measurable**:

- "Split View" button in header or tab bar (icon: columns/split-horizontal)
- "Close Pane" button in each pane header (icon: X)
- Keyboard shortcut: Ctrl+\ to toggle split view
- Controls disabled during streaming (optional - prevents layout shifts)

**Achievable**: ✅ DaisyUI buttons with Lucide icons

**Relevant**: User entry point for feature

**Time-bound**: 0.5-1 hour

---

### FR7: Pane State Persistence

**Specific**: Persist pane layout state to browser localStorage alongside existing tab state.

**Measurable**:

- Pane count and tab assignments survive webview reload
- Pane sizes (percentages) persist
- Invalid state (missing tabs) gracefully falls back to single pane
- Uses debounced save pattern (existing in TabManagerService)

**Achievable**: ✅ Follow existing localStorage pattern in TabManagerService

**Relevant**: Prevents frustration of losing layout on reload

**Time-bound**: 0.5 hours

---

## 4. Non-Functional Requirements

### Performance

- Pane resize must feel smooth (60fps, no layout thrashing)
- No additional memory overhead when using single pane (lazy pane creation)
- Streaming performance unaffected (events already route by tabId)

### Usability

- Minimum pane width of 20% prevents unusable narrow panes
- Clear visual feedback during resize operation
- Intuitive split/close controls (follows VS Code editor split patterns)

### Accessibility

- Resizer must be keyboard accessible (arrow keys to adjust size)
- Focus management: split action focuses new pane
- Screen reader announcement: "Split view enabled, 2 panes"

### Compatibility

- Works in VS Code webview panel (no iframe restrictions)
- Responsive: graceful degradation on narrow sidebar widths (hide split option if <600px)

---

## 5. Acceptance Criteria (BDD Format)

### Scenario 1: Create Split View

**Given** I have a single chat pane with Tab A displayed  
**When** I click the "Split View" button  
**Then** the view splits into two equal-width panes  
**And** the left pane shows Tab A  
**And** the right pane shows a tab selector or empty state  
**And** a resize divider appears between panes

### Scenario 2: Assign Tab to Pane

**Given** I have a split view with left pane showing Tab A and right pane empty  
**When** I select Tab B from the tab bar while the right pane is focused  
**Then** Tab B content displays in the right pane  
**And** Tab A remains in the left pane  
**And** both panes can scroll independently

### Scenario 3: Resize Panes

**Given** I have a split view with two panes at 50/50 width  
**When** I drag the resize divider to the right  
**Then** the left pane expands and right pane shrinks proportionally  
**And** the resize updates in real-time as I drag  
**And** panes cannot be resized below 20% width

### Scenario 4: Independent Messaging

**Given** I have a split view with Tab A (streaming) and Tab B (idle)  
**When** I type a message in Tab B's chat input and send it  
**Then** Tab B starts a new streaming session  
**And** Tab A continues streaming without interruption  
**And** both streaming indicators show correctly

### Scenario 5: Permission Isolation

**Given** Tab A has a pending permission request for "Bash" tool  
**And** Tab B has no pending permissions  
**When** I view both tabs in split view  
**Then** the permission badge appears only in Tab A's pane  
**And** Tab B's pane shows no permission requests

### Scenario 6: Close Pane

**Given** I have a split view with two panes  
**When** I click the "Close Pane" button on the right pane  
**Then** the right pane is removed  
**And** the left pane expands to full width  
**And** the resize divider is removed

### Scenario 7: Persist Layout

**Given** I have a split view with Tab A (60%) and Tab B (40%)  
**When** the VS Code webview reloads  
**Then** the split view restores with the same tabs assigned  
**And** the pane sizes restore to 60/40

---

## 6. Risk Assessment

### Technical Risks

| Risk                                                        | Probability | Impact | Mitigation                                                                 |
| ----------------------------------------------------------- | ----------- | ------ | -------------------------------------------------------------------------- |
| ChatViewComponent refactor breaks existing single-pane mode | LOW         | HIGH   | Use optional `tabId` input with null fallback to preserve default behavior |
| Resize performance issues on lower-end machines             | LOW         | MEDIUM | Use CSS transforms instead of layout properties, throttle resize events    |
| Permission duplication in panes                             | LOW         | MEDIUM | Already validated - `toolUseId` matching is globally unique                |
| Memory leak with multiple pane observers                    | LOW         | MEDIUM | Ensure proper cleanup in `ngOnDestroy` for each ChatViewComponent instance |

### Business Risks

| Risk                                       | Probability | Impact | Mitigation                                                     |
| ------------------------------------------ | ----------- | ------ | -------------------------------------------------------------- |
| Feature complexity confuses users          | LOW         | MEDIUM | Hide behind explicit "Split View" action, not default behavior |
| Narrow VS Code sidebar unusable with split | MEDIUM      | LOW    | Disable split option when sidebar width < 600px                |

---

## 7. Research Recommendations

**Technical Research Needed**: NO

**Reasoning**:

- Pre-task analysis already completed comprehensive research on:
  - Tab/session routing architecture (uses `tabId` for all events ✅)
  - Permission matching (uses `toolUseId`, globally unique, safe ✅)
  - Concurrent streaming (already works in multi-tab scenario ✅)
- Angular CDK already in project (`@angular/cdk` in package.json)
- Established patterns exist in codebase (TabManagerService, signal-based state)
- No external libraries or new technologies required

---

## 8. UI/UX Requirements

**UI/UX Design Needed**: NO (Minor)

**Reasoning**:

- Follows established VS Code split editor pattern (familiar UX)
- Uses existing DaisyUI + Lucide icon system
- No new visual design language required
- Simple layout primitives (flexbox, dividers)

**Visual Components Required**:

- Resize divider: 4px vertical bar, hover highlight
- Split button: Lucide `Columns` or `PanelLeftOpen` icon
- Close pane button: Lucide `X` icon in pane header

**Accessibility Requirements**:

- Keyboard-accessible resizer (arrow keys)
- Focus ring on active pane
- ARIA labels for screen readers

---

## 9. Dependencies & Integration Points

### External Dependencies

- `@angular/cdk`: ^20.2.14 (already installed - drag-drop utilities)
- `lucide-angular`: ^0.542.0 (already installed - icons)

### Internal Dependencies

- `TabManagerService`: Tab state, switching, streaming indicators
- `ChatStore`: Message state, permission handling facade
- `PermissionHandlerService`: Permission request filtering
- `ChatViewComponent`: Main chat display (modified)
- `AppShellComponent`: Entry point (modified)

### Third-Party Services

- None required

---

## 10. Out of Scope

Explicitly NOT included in this task:

- **More than 2 panes**: Initial implementation supports max 2 panes only
- **Vertical split**: Only horizontal (side-by-side) split supported
- **Drag tabs between panes**: Tabs selected via tab bar, not drag-drop
- **Pane-specific settings**: Both panes share global settings
- **Mobile/touch optimization**: Desktop-first, basic touch support only
- **Backend changes**: All changes are frontend-only
- **New session creation per-pane**: Uses existing tabs, doesn't create new sessions

---

**REQUIREMENTS COMPLETE - AWAITING USER VALIDATION**
