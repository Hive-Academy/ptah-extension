# Requirements Document - TASK_2025_042

## Introduction

This task enhances the autocomplete system's user experience through visual improvements and performance optimizations. The current implementation successfully provides autocomplete functionality for commands (`/`), agents (`@`), and files (`@`), but it lacks visual distinction for command names and makes redundant RPC calls on every trigger activation. This enhancement will improve usability through clear visual hierarchy and reduce backend load through intelligent client-side caching.

**Business Value**: Improved user efficiency through faster autocomplete responses, reduced server load through caching, and enhanced visual clarity for command identification.

## Requirements

### Requirement 1: Visual Enhancement for Command Names

**User Story**: As a user typing slash commands in the chat input, I want command names to be visually highlighted with badges or special styling in the dropdown, so that I can quickly distinguish command text from descriptions.

#### Acceptance Criteria

1. WHEN a user triggers the slash command dropdown (`/`) THEN each command item in the dropdown SHALL display its command name with a visual badge or pill styling
2. WHEN the dropdown renders command suggestions THEN the badge SHALL use DaisyUI badge component classes (e.g., `badge badge-accent`, `badge badge-primary`)
3. WHEN a command has a scope (builtin, project, user, mcp) THEN the command name badge SHALL be styled distinctly from the existing scope badge
4. WHEN multiple commands are displayed THEN all command name badges SHALL maintain consistent styling and alignment
5. WHEN a user hovers over a command item THEN the badge styling SHALL remain visible and maintain appropriate contrast

**Design Constraints**:

- Must use DaisyUI badge component (`badge`, `badge-sm`, `badge-xs`) for styling
- Badge colors must maintain WCAG AA contrast ratios against dropdown background
- Badge must not obstruct or overlap with command description text
- Existing scope badges (Built-in, Project, etc.) must remain unchanged

### Requirement 2: Client-Side Caching for Commands

**User Story**: As a user working with commands, I want the extension to load all commands once and cache them locally, so that I experience instant autocomplete responses without waiting for backend calls.

#### Acceptance Criteria

1. WHEN the slash trigger directive first activates THEN the system SHALL fetch all commands from backend via RPC call
2. WHEN commands are successfully fetched THEN the system SHALL cache the complete command list in frontend state (signal-based)
3. WHEN the user types a query after initial load THEN the system SHALL filter cached commands client-side WITHOUT making additional RPC calls
4. WHEN the user closes and reopens the slash dropdown THEN the system SHALL use cached commands WITHOUT refetching
5. WHEN a cache refresh is needed (session change, explicit refresh) THEN the system SHALL provide a mechanism to invalidate cache and refetch

**Performance Targets**:

- Initial fetch: Complete within 500ms (acceptable delay for first trigger)
- Subsequent filtering: Complete within 16ms (60fps threshold for instant feedback)
- Cache invalidation: Occur only on explicit triggers (session change, manual refresh)

### Requirement 3: Client-Side Caching for Agents

**User Story**: As a user working with agent mentions, I want the extension to load all agents once and cache them locally, so that I experience instant autocomplete responses without waiting for backend calls.

#### Acceptance Criteria

1. WHEN the at trigger directive first activates for agents THEN the system SHALL fetch all agents from backend via RPC call
2. WHEN agents are successfully fetched THEN the system SHALL cache the complete agent list in frontend state (signal-based)
3. WHEN the user types a query after initial load THEN the system SHALL filter cached agents client-side WITHOUT making additional RPC calls
4. WHEN the user switches between "all", "files", and "agents" tabs THEN the system SHALL filter cached results client-side
5. WHEN the user closes and reopens the at dropdown THEN the system SHALL use cached agents WITHOUT refetching
6. WHEN a cache refresh is needed (session change, explicit refresh) THEN the system SHALL provide a mechanism to invalidate cache and refetch

**Performance Targets**:

- Initial fetch: Complete within 500ms (acceptable delay for first trigger)
- Subsequent filtering: Complete within 16ms (60fps threshold for instant feedback)
- Tab switching: Instant (no loading state, pure client-side filtering)

### Requirement 4: Dynamic File Suggestions (No Caching)

**User Story**: As a user working with file mentions, I want file suggestions to remain dynamically fetched based on my query, so that I see relevant files without overwhelming the system with large workspace data.

#### Acceptance Criteria

1. WHEN the at trigger directive activates for files THEN the system SHALL fetch file suggestions via RPC call for EACH query change
2. WHEN the user types a file query THEN the backend SHALL return filtered results based on the query (existing behavior preserved)
3. WHEN the user switches to the "files" tab THEN the system SHALL NOT preload all files into cache
4. WHEN file suggestions are returned THEN they SHALL be displayed using existing presentation logic
5. WHEN workspace file count exceeds 10,000 files THEN the dynamic fetching approach SHALL prevent client memory issues

**Technical Rationale**: Files remain dynamic because large workspaces can contain tens of thousands of files, making client-side caching impractical due to memory constraints and initial load time.

### Requirement 5: Show All Available Commands (Remove 10-Item Limit)

**User Story**: As a user exploring available commands, I want to see all commands in the dropdown (not just 10), so that I can discover and access any command without needing to type a query first.

#### Acceptance Criteria

1. WHEN the user triggers the slash dropdown with no query (empty string) THEN the system SHALL display ALL cached commands
2. WHEN the user types a query THEN the system SHALL filter and display ALL matching commands (no arbitrary limit)
3. WHEN the dropdown contains more items than can fit in viewport THEN the dropdown SHALL provide vertical scrolling
4. WHEN the dropdown is scrollable THEN keyboard navigation (ArrowUp, ArrowDown) SHALL scroll the dropdown to keep focused item visible
5. WHEN 100+ commands exist THEN the dropdown SHALL render performantly without UI lag (virtualization if needed)

**Current Limitation Removal**:

- Remove `slice(0, 10)` in `CommandDiscoveryFacade.searchCommands()` for empty query
- Remove `slice(0, 20)` in `CommandDiscoveryFacade.searchCommands()` for non-empty query
- Apply same removal to `AgentDiscoveryFacade.searchAgents()`

### Requirement 6: Show All Available Agents (Remove 10-Item Limit)

**User Story**: As a user exploring available agents, I want to see all agents in the dropdown (not just 10), so that I can discover and access any agent without needing to type a query first.

#### Acceptance Criteria

1. WHEN the user triggers the at dropdown with no query (empty string) THEN the system SHALL display ALL cached agents
2. WHEN the user types a query THEN the system SHALL filter and display ALL matching agents (no arbitrary limit)
3. WHEN the dropdown contains more items than can fit in viewport THEN the dropdown SHALL provide vertical scrolling
4. WHEN the dropdown is scrollable THEN keyboard navigation (ArrowUp, ArrowDown) SHALL scroll the dropdown to keep focused item visible
5. WHEN 50+ agents exist THEN the dropdown SHALL render performantly without UI lag

**Current Limitation Removal**:

- Remove `slice(0, 10)` in `AgentDiscoveryFacade.searchAgents()` for empty query
- Remove `slice(0, 20)` in `AgentDiscoveryFacade.searchAgents()` for non-empty query

## Non-Functional Requirements

### Performance Requirements

- **Initial Load Time**: Command/agent fetch SHALL complete within 500ms for 90% of users
- **Client-Side Filtering**: Filter operations SHALL complete within 16ms to maintain 60fps responsiveness
- **RPC Call Reduction**: After initial load, slash/at triggers SHALL make ZERO RPC calls for commands/agents (100% reduction)
- **Memory Usage**: Command cache SHALL consume < 500KB memory for typical project (50 commands, 20 agents)
- **Dropdown Rendering**: Dropdown with 100+ items SHALL render within 100ms using existing Angular change detection

### Usability Requirements

- **Visual Clarity**: Command name badges SHALL be distinguishable from descriptions at a glance (no user confusion)
- **Keyboard Navigation**: All keyboard shortcuts (ArrowUp, ArrowDown, Enter, Tab, Escape) SHALL continue working without regression
- **Loading States**: Initial load SHALL show loading spinner; subsequent filtering SHALL NOT show loading state
- **Error Handling**: Network failures during initial fetch SHALL display user-friendly error message with retry option

### Accessibility Requirements

- **Screen Reader Support**: Badge text SHALL be announced by screen readers as part of command item text
- **Keyboard Navigation**: Focus management SHALL work correctly for scrollable dropdowns (focused item always visible)
- **Color Contrast**: Badge colors SHALL maintain WCAG AA contrast ratio (4.5:1 for normal text)
- **ARIA Attributes**: Dropdown SHALL maintain existing ARIA attributes (`role="listbox"`, `aria-selected`)

### Maintainability Requirements

- **Signal-Based Architecture**: All cache state SHALL use Angular signals (no RxJS BehaviorSubject)
- **Single Responsibility**: Cache logic SHALL reside in facade services (`CommandDiscoveryFacade`, `AgentDiscoveryFacade`)
- **No Breaking Changes**: Existing component APIs SHALL remain unchanged (input/output signatures preserved)
- **DaisyUI Consistency**: All visual changes SHALL use DaisyUI components and utility classes only

## User Experience Requirements

### Visual Design Goals

1. **Command Name Highlighting**:

   - Command text (e.g., `/orchestrate`, `/review`) SHALL be wrapped in a badge component
   - Badge SHALL appear at the start of each dropdown item, before the description
   - Badge size: `badge-sm` for optimal density in dropdown
   - Badge color: `badge-accent` for commands (distinct from `badge-primary` for scope badges)
   - Example: `[/orchestrate] badge-accent badge-sm` followed by description text

2. **Layout Structure**:

   - Each dropdown item SHALL maintain existing layout: `icon → command-name-badge → description → scope-badge`
   - Badge SHALL NOT increase item height beyond current dropdown item dimensions
   - Text truncation SHALL apply to description text if needed, NOT to badge text

3. **Hover/Focus States**:
   - Badge SHALL maintain visibility and contrast in both normal and hover/focus states
   - Badge SHALL NOT change color on hover (remains consistent for recognition)

### Interaction Patterns

1. **First Trigger Behavior**:

   - User types `/` → brief loading spinner (< 500ms) → all commands displayed
   - User types `@` → brief loading spinner (< 500ms) → all agents + files displayed

2. **Subsequent Trigger Behavior**:

   - User types `/` → instant display of all cached commands (no loading state)
   - User types `/@command-query` → instant client-side filtering (no loading state)

3. **Scrolling Behavior**:

   - Dropdown SHALL display max-height of `20rem` (320px, ~8 items visible)
   - Overflow SHALL trigger vertical scrolling
   - Keyboard navigation SHALL auto-scroll to keep focused item in viewport

4. **Error States**:
   - Initial fetch failure → show error message: "Failed to load commands. [Retry]"
   - Retry button SHALL trigger cache invalidation and refetch

## Performance Requirements

### Caching Strategy

1. **Cache Initialization**:

   - Commands: Fetch once on first `/` trigger, cache in `CommandDiscoveryFacade._commands` signal
   - Agents: Fetch once on first `@` trigger, cache in `AgentDiscoveryFacade._agents` signal
   - Files: NO caching, dynamic RPC calls per query (existing behavior)

2. **Cache Invalidation**:

   - Session change (user switches chat session) → clear all caches
   - Manual refresh trigger (optional future enhancement) → clear all caches
   - Extension restart → caches cleared automatically (no persistence)

3. **RPC Call Reduction Targets**:
   - **Current Behavior**: 1 RPC call per trigger (every time user types `/` or `@`)
   - **Target Behavior**: 1 RPC call on first trigger, 0 RPC calls on subsequent triggers
   - **Expected Reduction**: ~90% reduction in RPC calls for typical user workflow (10+ triggers per session)

### Filtering Performance

1. **Filtering Logic**:

   - Use existing case-insensitive substring matching: `name.toLowerCase().includes(query.toLowerCase())`
   - Use existing OR logic: match against `name` OR `description`
   - NO complex scoring or ranking (maintain existing simplicity)

2. **Performance Benchmarks**:
   - 50 commands, empty query → render all 50 items within 100ms
   - 50 commands, query "test" → filter and render within 16ms (60fps)
   - 100+ commands → consider virtual scrolling if performance degrades (future optimization)

## Technical Constraints

### Must-Follow Rules

1. **Signal-Based State Management**:

   - All cache state MUST use Angular signals (`signal()`, `computed()`)
   - NO RxJS `BehaviorSubject` or `Observable` for cache state
   - Existing RxJS debouncing in trigger directives remains unchanged

2. **DaisyUI Component Usage**:

   - Visual changes MUST use DaisyUI badge component classes
   - NO custom CSS for badges (use existing DaisyUI utility classes)
   - Allowed badge classes: `badge`, `badge-sm`, `badge-xs`, `badge-accent`, `badge-primary`

3. **Files Remain Dynamic**:

   - File suggestions MUST continue using RPC calls per query
   - NO caching of file lists in frontend
   - Existing `FilePickerService.searchFiles()` behavior unchanged

4. **No Breaking Changes**:

   - `UnifiedSuggestionsDropdownComponent` input/output API unchanged
   - `ChatInputComponent` integration logic unchanged
   - Trigger directives (`SlashTriggerDirective`, `AtTriggerDirective`) unchanged

5. **Existing Architecture Preserved**:
   - Debouncing logic (150ms) in trigger directives remains
   - RPC method signatures (`autocomplete:commands`, `autocomplete:agents`) unchanged
   - Suggestion type discrimination (`type: 'file' | 'agent' | 'command'`) preserved

## Dependencies

### Related Files

**Frontend Services** (cache implementation):

- `libs/frontend/core/src/lib/services/command-discovery.facade.ts` - Add cache initialization flag, remove slicing limits
- `libs/frontend/core/src/lib/services/agent-discovery.facade.ts` - Add cache initialization flag, remove slicing limits

**Components** (visual enhancements):

- `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts` - Add badge rendering for command names
- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts` - Update cache initialization logic

**Directives** (no changes required):

- `libs/frontend/chat/src/lib/directives/slash-trigger.directive.ts` - No changes (trigger logic unchanged)
- `libs/frontend/chat/src/lib/directives/at-trigger.directive.ts` - No changes (trigger logic unchanged)

**Backend RPC Handlers** (no changes required):

- `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts` - No changes (existing handlers sufficient)

### Service Dependencies

- `CommandDiscoveryFacade` depends on `ClaudeRpcService` (existing)
- `AgentDiscoveryFacade` depends on `ClaudeRpcService` (existing)
- `ChatInputComponent` depends on `CommandDiscoveryFacade`, `AgentDiscoveryFacade`, `FilePickerService` (existing)

### Library Dependencies

- DaisyUI 5.x (existing, no new dependencies)
- Angular 20+ signals API (existing)
- Lucide Angular icons (existing)

## Acceptance Criteria Summary

**Visual Enhancements**:

- [x] Command names display with DaisyUI badge styling
- [x] Badge colors maintain WCAG AA contrast ratios
- [x] Badge layout does not break existing dropdown structure

**Performance Optimizations**:

- [x] Commands cached on first trigger, zero RPC calls thereafter
- [x] Agents cached on first trigger, zero RPC calls thereafter
- [x] Files remain dynamic (no caching)
- [x] Client-side filtering completes within 16ms
- [x] RPC call reduction of ~90% for typical workflow

**User Experience**:

- [x] All commands visible without query (no 10-item limit)
- [x] All agents visible without query (no 10-item limit)
- [x] Dropdown scrolls for large lists
- [x] Keyboard navigation works correctly
- [x] Loading states clear and appropriate

**Technical Quality**:

- [x] Signal-based cache implementation
- [x] DaisyUI components only (no custom CSS)
- [x] No breaking changes to component APIs
- [x] Existing architecture preserved

## Success Metrics

1. **Performance**: RPC call reduction from 10+ calls to 2 calls (commands + agents) per session
2. **User Experience**: Zero perceived latency for autocomplete filtering after initial load
3. **Visual Clarity**: Command names immediately recognizable through badge styling
4. **Discoverability**: All commands/agents visible without prior knowledge (no hidden items)

---

**Document Version**: 1.0
**Created**: 2025-12-04
**Author**: Project Manager (AI Agent)
**Task ID**: TASK_2025_042
