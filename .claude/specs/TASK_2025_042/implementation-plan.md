# Implementation Plan - TASK_2025_042

**Task**: Client-Side Caching & Visual Badge Enhancements for Autocomplete
**Architect**: Software Architect (AI Agent)
**Created**: 2025-12-04
**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

---

## 📊 Codebase Investigation Summary

### Libraries Discovered

**Frontend Core Services** (libs/frontend/core/src/lib/services):

- **CommandDiscoveryFacade**: Command autocomplete service

  - Key exports: CommandSuggestion interface, fetchCommands(), searchCommands()
  - Pattern: Signal-based state (\_commands signal, \_isLoading signal)
  - Evidence: Lines 1-108 in command-discovery.facade.ts

- **AgentDiscoveryFacade**: Agent autocomplete service
  - Key exports: AgentSuggestion interface, fetchAgents(), searchAgents()
  - Pattern: Signal-based state (\_agents signal, \_isLoading signal)
  - Evidence: Lines 1-78 in agent-discovery.facade.ts

**Frontend Chat Components** (libs/frontend/chat/src/lib/components):

- **UnifiedSuggestionsDropdownComponent**: Autocomplete dropdown UI

  - Key exports: SuggestionItem discriminated union, keyboard navigation
  - Pattern: Presentation component (no business logic)
  - Evidence: Lines 1-150 in unified-suggestions-dropdown.component.ts

- **ChatInputComponent**: Message input with autocomplete triggers
  - Key exports: Handles @ and / triggers, coordinates autocomplete
  - Pattern: Controller component (delegates to facades)
  - Evidence: Lines 1-551 in chat-input.component.ts

### Patterns Identified

**Pattern 1: Signal-Based State Management**

- Description: Angular 20+ signals for reactive state
- Evidence:
  - command-discovery.facade.ts:17-18 (\_isLoading, \_commands signals)
  - agent-discovery.facade.ts:16-17 (\_isLoading, \_agents signals)
- Components: All facades use private signals with readonly computed accessors
- Conventions: Prefix private signals with `_`, expose via computed() or asReadonly()

**Pattern 2: RPC-Based Data Fetching**

- Description: Backend communication via ClaudeRpcService
- Evidence:
  - command-discovery.facade.ts:31-38 (RPC call to 'autocomplete:commands')
  - agent-discovery.facade.ts:29-35 (RPC call to 'autocomplete:agents')
- Components: Facades inject ClaudeRpcService, call RPC methods with typed responses
- Conventions: Async methods, error handling with console.warn/error

**Pattern 3: DaisyUI Badge Components**

- Description: Semantic badge styling for visual hierarchy
- Evidence:
  - unified-suggestions-dropdown.component.ts:124 (badge-primary for agents)
  - unified-suggestions-dropdown.component.ts:127 (badge-accent for commands)
  - visual-design-specification.md:526-557 (badge class specifications)
- Components: badge, badge-sm, badge-primary, badge-secondary, badge-ghost, badge-accent
- Conventions: 3-class pattern (badge + size + color)

### Integration Points

**CommandDiscoveryFacade ↔ ChatInputComponent**:

- Location: chat-input.component.ts:172 (inject), line 342-355 (fetchCommandSuggestions)
- Interface: async fetchCommands(), searchCommands(query: string)
- Usage: ChatInputComponent calls fetchCommands on slash trigger, searches on query change

**AgentDiscoveryFacade ↔ ChatInputComponent**:

- Location: chat-input.component.ts:171 (inject), line 322-337 (fetchAtSuggestions)
- Interface: async fetchAgents(), searchAgents(query: string)
- Usage: ChatInputComponent calls fetchAgents on at trigger, searches on query change

**Facades ↔ Backend RPC**:

- Location: command-discovery.facade.ts:16 (ClaudeRpcService inject)
- Interface: rpc.call<T>(method, params) returns Promise<{success, data, error}>
- Usage: Facades call 'autocomplete:commands' and 'autocomplete:agents' methods

---

## 🏗️ Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Signal-Based Client-Side Caching with DaisyUI Badge Enhancement

**Rationale**:

- Existing codebase uses Angular 20+ signals for reactive state management
- Facades already maintain local signal-based caches (\_commands, \_agents)
- Current problem: No cache initialization flag, always refetches from backend
- Solution: Add \_isCached signal, check before RPC call, remove arbitrary slice limits
- Visual enhancement aligns with existing DaisyUI badge patterns (15+ components use badges)

**Evidence**:

- Signal pattern: command-discovery.facade.ts:17-18, agent-discovery.facade.ts:16-17
- DaisyUI badges: unified-suggestions-dropdown.component.ts:124-127
- Slice limits: command-discovery.facade.ts:76-78 (slice 0-10), line 88 (slice 0-20)

### Component Specifications

---

#### Component 1: CommandDiscoveryFacade (Caching Enhancement)

**Purpose**: Add client-side caching to command autocomplete service to eliminate redundant RPC calls

**Pattern**: Signal-Based Cache Invalidation
**Evidence**: Existing signal pattern at command-discovery.facade.ts:17-21

**Responsibilities**:

- Track cache initialization state via \_isCached signal
- Check cache before making RPC calls (cache hit → skip RPC)
- Remove arbitrary 10/20 item limits in searchCommands()
- Provide clearCache() method for session invalidation

**Implementation Pattern**:

```typescript
// Pattern source: command-discovery.facade.ts:17-21
// Enhanced with cache tracking signal

export class CommandDiscoveryFacade {
  private readonly _isLoading = signal(false);
  private readonly _commands = signal<CommandSuggestion[]>([]);
  private readonly _isCached = signal(false); // NEW: Cache tracking

  readonly isLoading = computed(() => this._isLoading());
  readonly commands = computed(() => this._commands());
  readonly isCached = computed(() => this._isCached()); // NEW: Cache status

  async fetchCommands(): Promise<void> {
    // NEW: Check cache before RPC call
    if (this._isCached()) {
      console.log('[CommandDiscoveryFacade] Cache hit, skipping RPC');
      return; // Early return on cache hit
    }

    this._isLoading.set(true);
    try {
      const result = await this.rpc.call<{...}>('autocomplete:commands', {...});
      if (result.success && result.data?.commands) {
        this._commands.set([...]); // Existing mapping logic
        this._isCached.set(true); // NEW: Mark as cached
      }
    } catch (error) {
      console.error('[CommandDiscoveryFacade] Fetch failed:', error);
    } finally {
      this._isLoading.set(false);
    }
  }

  searchCommands(query: string): CommandSuggestion[] {
    const allCommands = this._commands();

    if (!query) {
      return allCommands; // CHANGE: Remove .slice(0, 10)
    }

    const lowerQuery = query.toLowerCase();
    return allCommands.filter(c =>
      c.name.toLowerCase().includes(lowerQuery) ||
      c.description.toLowerCase().includes(lowerQuery)
    ); // CHANGE: Remove .slice(0, 20)
  }

  // NEW: Cache invalidation method
  clearCache(): void {
    this._isCached.set(false);
    this._commands.set([]);
    console.log('[CommandDiscoveryFacade] Cache cleared');
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- Cache hit must skip RPC call entirely (zero network overhead)
- Cache miss must fetch from backend and mark as cached
- searchCommands() must return ALL matching items (no limits)
- clearCache() must reset both \_isCached and \_commands signals

**Non-Functional Requirements**:

- Performance: Cache check must complete in < 1ms (signal read)
- RPC Reduction: 90%+ reduction after initial load (from ~10 calls to 1 call per session)
- Memory: Cache must consume < 10KB for typical 50 commands

**Pattern Compliance**:

- Must use signal-based state (verified: command-discovery.facade.ts:17-18)
- Must maintain existing method signatures (no breaking changes)
- Must follow existing console.log pattern for debugging

**Files Affected**:

- `libs/frontend/core/src/lib/services/command-discovery.facade.ts` (MODIFY)
  - Line 18: Add `private readonly _isCached = signal(false);`
  - Line 21: Add `readonly isCached = computed(() => this._isCached());`
  - Line 26-29: Add cache check at start of fetchCommands()
  - Line 46: Add `this._isCached.set(true);` after successful fetch
  - Line 76: Remove `.slice(0, 10)` from empty query return
  - Line 88: Remove `.slice(0, 20)` from query filter return
  - Line 108: Add clearCache() method (new)

---

#### Component 2: AgentDiscoveryFacade (Caching Enhancement)

**Purpose**: Add client-side caching to agent autocomplete service (same pattern as commands)

**Pattern**: Signal-Based Cache Invalidation (mirrors CommandDiscoveryFacade)
**Evidence**: Existing signal pattern at agent-discovery.facade.ts:16-20

**Responsibilities**:

- Track cache initialization state via \_isCached signal
- Check cache before making RPC calls (cache hit → skip RPC)
- Remove arbitrary 10/20 item limits in searchAgents()
- Provide clearCache() method for session invalidation

**Implementation Pattern**:

```typescript
// Pattern source: agent-discovery.facade.ts:16-20
// Enhanced with cache tracking (same as commands)

export class AgentDiscoveryFacade {
  private readonly _isLoading = signal(false);
  private readonly _agents = signal<AgentSuggestion[]>([]);
  private readonly _isCached = signal(false); // NEW: Cache tracking

  readonly isLoading = computed(() => this._isLoading());
  readonly agents = computed(() => this._agents());
  readonly isCached = computed(() => this._isCached()); // NEW: Cache status

  async fetchAgents(): Promise<void> {
    // NEW: Check cache before RPC call
    if (this._isCached()) {
      console.log('[AgentDiscoveryFacade] Cache hit, skipping RPC');
      return; // Early return on cache hit
    }

    this._isLoading.set(true);
    try {
      const result = await this.rpc.call<{...}>('autocomplete:agents', {...});
      if (result.success && result.data?.agents) {
        this._agents.set([...]); // Existing mapping logic
        this._isCached.set(true); // NEW: Mark as cached
      }
    } catch (error) {
      console.error('[AgentDiscoveryFacade] Fetch failed:', error);
    } finally {
      this._isLoading.set(false);
    }
  }

  searchAgents(query: string): AgentSuggestion[] {
    if (!query) {
      return this._agents(); // CHANGE: Remove .slice(0, 10)
    }

    const lowerQuery = query.toLowerCase();
    return this._agents().filter(a =>
      a.name.toLowerCase().includes(lowerQuery) ||
      a.description.toLowerCase().includes(lowerQuery)
    ); // CHANGE: Remove .slice(0, 20)
  }

  // NEW: Cache invalidation method
  clearCache(): void {
    this._isCached.set(false);
    this._agents.set([]);
    console.log('[AgentDiscoveryFacade] Cache cleared');
  }
}
```

**Quality Requirements**:

**Functional Requirements**:

- Identical to CommandDiscoveryFacade (agents instead of commands)
- Cache hit must skip RPC call entirely
- searchAgents() must return ALL matching items (no limits)
- clearCache() must reset both \_isCached and \_agents signals

**Non-Functional Requirements**:

- Performance: Cache check must complete in < 1ms (signal read)
- RPC Reduction: 90%+ reduction after initial load
- Memory: Cache must consume < 5KB for typical 20 agents

**Pattern Compliance**:

- Must use signal-based state (verified: agent-discovery.facade.ts:16-17)
- Must maintain existing method signatures (no breaking changes)
- Must follow existing console.log pattern for debugging

**Files Affected**:

- `libs/frontend/core/src/lib/services/agent-discovery.facade.ts` (MODIFY)
  - Line 17: Add `private readonly _isCached = signal(false);`
  - Line 20: Add `readonly isCached = computed(() => this._isCached());`
  - Line 25-28: Add cache check at start of fetchAgents()
  - Line 48: Add `this._isCached.set(true);` after successful fetch
  - Line 66: Remove `.slice(0, 10)` from empty query return
  - Line 76: Remove `.slice(0, 20)` from query filter return
  - Line 78: Add clearCache() method (new)

---

#### Component 3: UnifiedSuggestionsDropdownComponent (Visual Enhancement)

**Purpose**: Add DaisyUI badge styling to command/agent/file names for visual distinction

**Pattern**: DaisyUI Badge Component Pattern
**Evidence**:

- Existing badge usage: unified-suggestions-dropdown.component.ts:124-127
- Design specification: visual-design-specification.md:576-594

**Responsibilities**:

- Wrap command names in lapis blue badge (badge-primary)
- Wrap agent names in pharaoh gold badge (badge-secondary)
- Wrap file names in ghost badge (badge-ghost)
- Flatten layout from 2-line (name+desc stacked) to 1-line (badge+desc side-by-side)

**Implementation Pattern**:

```html
<!-- Pattern source: unified-suggestions-dropdown.component.ts:113-121 -->
<!-- BEFORE (Current - 2-line stacked layout): -->
<div class="flex-1 min-w-0">
  <div class="font-medium text-sm truncate">{{ getName(suggestion) }}</div>
  <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
</div>

<!-- AFTER (Enhanced - 1-line badge layout): -->
<!-- Badge wrapper based on suggestion type -->
@if (suggestion.type === 'command') {
<span class="badge badge-sm badge-primary">{{ getName(suggestion) }}</span>
} @if (suggestion.type === 'agent') {
<span class="badge badge-sm badge-secondary">{{ getName(suggestion) }}</span>
} @if (suggestion.type === 'file') {
<span class="badge badge-sm badge-ghost">{{ getName(suggestion) }}</span>
}

<!-- Description only (no name div) -->
<div class="flex-1 min-w-0">
  <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
</div>
```

**Quality Requirements**:

**Functional Requirements**:

- Command badges must display with badge-primary class (lapis blue background)
- Agent badges must display with badge-secondary class (pharaoh gold background)
- File badges must display with badge-ghost class (transparent, border only)
- Description must remain muted (text-base-content/60)
- Scope badges must remain unchanged (existing lines 122-128)

**Non-Functional Requirements**:

- Accessibility: Badge text must be announced by screen readers naturally (no ARIA changes)
- Contrast: All badge colors must meet WCAG AA 4.5:1 ratio (verified in design specs)
- Responsive: Badge text must NOT truncate in narrow sidebar (< 300px)
- Performance: Badge rendering must add < 1ms per item (pure CSS, no JS)

**Pattern Compliance**:

- Must use DaisyUI badge classes only (verified: badge, badge-sm, badge-primary, badge-secondary, badge-ghost)
- Must maintain existing keyboard navigation (lines 185-236 in component)
- Must maintain existing ARIA attributes (role="listbox", role="option")
- NO TypeScript changes (getName/getDescription/getIcon methods unchanged)

**Files Affected**:

- `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts` (MODIFY)
  - Lines 113-121: REPLACE with badge wrappers + simplified description (9 lines → 17 lines)
  - NO changes to TypeScript class (lines 1-12, 42-240)
  - NO changes to styles (lines 136-164)

---

#### Component 4: Cache Invalidation Strategy (Future Enhancement - Optional)

**Purpose**: Provide cache invalidation mechanism for session changes

**Pattern**: Session Monitoring (future implementation)
**Evidence**: Requirements document mentions session change invalidation (task-description.md:188-194)

**Responsibilities**:

- Monitor session ID changes in ChatInputComponent
- Call clearCache() on both facades when session changes
- Provide manual refresh mechanism (optional)

**Implementation Pattern** (OPTIONAL - Not required for MVP):

```typescript
// Pattern: Effect-based session monitoring in ChatInputComponent
// Location: chat-input.component.ts:524-549 (constructor with effects)

constructor() {
  // Existing effect for queue restoration (lines 527-549)

  // NEW: Optional session change monitoring (future enhancement)
  effect(() => {
    const activeTab = this.chatStore.activeTab();
    if (activeTab) {
      // Clear caches when session changes (future)
      // this.commandDiscovery.clearCache();
      // this.agentDiscovery.clearCache();
    }
  });
}
```

**Quality Requirements**:

- NOT REQUIRED for TASK_2025_042 (defer to future task)
- If implemented, must use effect-based monitoring (Angular 20+ pattern)
- Must call clearCache() on both facades atomically

**Files Affected**:

- NONE for TASK_2025_042 (future enhancement)
- Future: chat-input.component.ts (add effect in constructor)

---

## 🔗 Integration Architecture

### Integration Points

**Integration 1: ChatInputComponent → CommandDiscoveryFacade**

- Pattern: Existing async/await RPC delegation pattern
- Evidence: chat-input.component.ts:342-355 (fetchCommandSuggestions method)
- NO CHANGES NEEDED: Facade handles cache check internally (Single Responsibility Principle)

**Integration 2: ChatInputComponent → AgentDiscoveryFacade**

- Pattern: Existing async/await RPC delegation pattern
- Evidence: chat-input.component.ts:322-337 (fetchAtSuggestions method)
- NO CHANGES NEEDED: Facade handles cache check internally (Single Responsibility Principle)

**Integration 3: UnifiedSuggestionsDropdownComponent → Badge Rendering**

- Pattern: DaisyUI utility class composition
- Evidence: Existing badge usage at unified-suggestions-dropdown.component.ts:124-127
- TEMPLATE CHANGE ONLY: No TypeScript integration changes

### Data Flow

**Caching Data Flow**:

```
User types '/' trigger
  ↓
SlashTriggerDirective emits slashTriggered event (debounced 150ms)
  ↓
ChatInputComponent.handleSlashTriggered() called
  ↓
ChatInputComponent.fetchCommandSuggestions() called
  ↓
CommandDiscoveryFacade.fetchCommands() called
  ↓
[CHECK] Is _isCached === true?
  ├─ YES → Return early (cache hit, no RPC)
  └─ NO → Call RPC, set _isCached = true
  ↓
CommandDiscoveryFacade.searchCommands(query) called
  ↓
Returns ALL matching commands (no slice limits)
  ↓
ChatInputComponent.filteredSuggestions computed
  ↓
UnifiedSuggestionsDropdownComponent renders with badges
```

**Visual Enhancement Data Flow**:

```
UnifiedSuggestionsDropdownComponent receives suggestions
  ↓
Template renders @for loop (line 102)
  ↓
For each suggestion:
  ├─ @if type === 'command' → Render badge-primary
  ├─ @if type === 'agent' → Render badge-secondary
  └─ @if type === 'file' → Render badge-ghost
  ↓
DaisyUI classes apply styling (pure CSS)
  ↓
User sees visual distinction (badge colors)
```

### Dependencies

**External Dependencies** (No new dependencies):

- Angular 20+ signals API (existing)
- DaisyUI 5.x badge components (existing)
- ClaudeRpcService (existing)

**Internal Dependencies**:

- CommandDiscoveryFacade ← ClaudeRpcService
- AgentDiscoveryFacade ← ClaudeRpcService
- ChatInputComponent ← CommandDiscoveryFacade, AgentDiscoveryFacade
- UnifiedSuggestionsDropdownComponent ← SuggestionItem type (existing)

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

**Caching System**:

- System MUST cache commands/agents on first trigger
- System MUST skip RPC calls on cache hit (verify with console logs)
- System MUST return ALL matching items (verify no slice limits)
- System MUST provide clearCache() for invalidation (future session monitoring)

**Visual System**:

- System MUST display command names in lapis blue badges (badge-primary)
- System MUST display agent names in pharaoh gold badges (badge-secondary)
- System MUST display file names in ghost badges (badge-ghost)
- System MUST maintain existing keyboard navigation (ArrowUp/Down/Enter/Escape)

**Integration System**:

- System MUST maintain backward compatibility (no API changes)
- System MUST preserve existing RPC method signatures
- System MUST preserve existing component input/output contracts

### Non-Functional Requirements

**Performance**:

- RPC Reduction: 90%+ reduction after initial load (target: 2 RPC calls per session)
- Client-Side Filtering: < 16ms per filter operation (60fps threshold)
- Cache Hit Latency: < 1ms (signal read overhead)
- Badge Rendering: < 1ms per badge (pure CSS, no JS overhead)

**Security**:

- Cache MUST NOT persist sensitive data across sessions
- Cache MUST clear on extension restart (no localStorage persistence)
- RPC calls MUST maintain existing authentication/authorization

**Maintainability**:

- All cache logic MUST reside in facades (Single Responsibility)
- ChatInputComponent MUST remain unchanged (Open/Closed Principle)
- Template changes MUST use DaisyUI classes only (no custom CSS)
- Code MUST follow existing console.log debugging pattern

**Testability**:

- Cache hit/miss MUST be verifiable via unit tests
- RPC call count MUST be mockable in tests
- Badge rendering MUST be verifiable via visual tests
- Keyboard navigation MUST be testable via integration tests

### Pattern Compliance

**Signal-Based State Pattern**:

- Evidence: command-discovery.facade.ts:17-18, agent-discovery.facade.ts:16-17
- Requirement: All cache state MUST use signal() and computed()
- Verification: Check \_isCached signal initialization and usage

**DaisyUI Badge Pattern**:

- Evidence: unified-suggestions-dropdown.component.ts:124-127
- Requirement: Badge styling MUST use badge, badge-sm, badge-{color} classes
- Verification: Check template renders correct DaisyUI classes

**RPC Delegation Pattern**:

- Evidence: command-discovery.facade.ts:31-38, agent-discovery.facade.ts:29-35
- Requirement: Facades MUST handle RPC calls, not components
- Verification: ChatInputComponent unchanged, facades handle cache logic

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **frontend-developer**

**Rationale**:

1. **Frontend-Heavy Work**: 3 of 3 components are frontend (facades + template)
2. **Angular Expertise Required**: Signal-based state management (Angular 20+ patterns)
3. **DaisyUI Styling**: Template modifications with DaisyUI classes
4. **No Backend Changes**: RPC handlers unchanged (no backend developer needed)
5. **Browser Testing**: Visual verification in VS Code webview environment

**Breakdown**:

- Caching logic: Frontend service layer (facades) - requires Angular signals knowledge
- Visual enhancement: Frontend template (DaisyUI badges) - requires Tailwind/DaisyUI knowledge
- Integration: No changes (existing patterns preserved)

### Complexity Assessment

**Complexity**: MEDIUM

**Estimated Effort**: 4-6 hours

**Breakdown**:

- Caching implementation: 2-3 hours
  - CommandDiscoveryFacade modifications: 1 hour
  - AgentDiscoveryFacade modifications: 30 minutes
  - Unit tests for cache logic: 1 hour
- Visual enhancement: 1-2 hours
  - Template modifications: 30 minutes
  - Visual verification: 30 minutes
  - Accessibility testing: 30 minutes
- Integration testing: 1 hour
  - Cache hit/miss verification: 30 minutes
  - End-to-end dropdown testing: 30 minutes

**Risk Factors**:

- MEDIUM RISK: Cache logic affects core autocomplete functionality
- LOW RISK: Template change only (no logic changes)
- LOW RISK: No breaking changes to existing APIs

### Files Affected Summary

**MODIFY** (3 files):

1. `libs/frontend/core/src/lib/services/command-discovery.facade.ts` (MODIFY - Caching)

   - Add \_isCached signal (line 18)
   - Add isCached computed (line 21)
   - Add cache check in fetchCommands() (lines 26-29)
   - Set \_isCached after fetch (line 46)
   - Remove slice(0, 10) from searchCommands() (line 76)
   - Remove slice(0, 20) from searchCommands() (line 88)
   - Add clearCache() method (line 108)

2. `libs/frontend/core/src/lib/services/agent-discovery.facade.ts` (MODIFY - Caching)

   - Add \_isCached signal (line 17)
   - Add isCached computed (line 20)
   - Add cache check in fetchAgents() (lines 25-28)
   - Set \_isCached after fetch (line 48)
   - Remove slice(0, 10) from searchAgents() (line 66)
   - Remove slice(0, 20) from searchAgents() (line 76)
   - Add clearCache() method (line 78)

3. `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts` (MODIFY - Visual)
   - Replace lines 113-121 with badge wrappers (template only)
   - NO TypeScript changes
   - NO style changes

**NO CHANGES**:

- chat-input.component.ts (facade handles cache internally)
- slash-trigger.directive.ts (trigger logic unchanged)
- at-trigger.directive.ts (trigger logic unchanged)
- Backend RPC handlers (autocomplete:commands, autocomplete:agents unchanged)

### Critical Verification Points

**Before Implementation, Frontend-Developer Must Verify**:

1. **All imports exist in codebase**:

   - `signal, computed` from '@angular/core' ✅ (verified: command-discovery.facade.ts:1)
   - DaisyUI badge classes ✅ (verified: unified-suggestions-dropdown.component.ts:124-127)
   - ClaudeRpcService ✅ (verified: command-discovery.facade.ts:2)

2. **All patterns verified from examples**:

   - Signal-based state ✅ (verified: command-discovery.facade.ts:17-18)
   - DaisyUI badge pattern ✅ (verified: unified-suggestions-dropdown.component.ts:124-127)
   - RPC call pattern ✅ (verified: command-discovery.facade.ts:31-38)

3. **Design documentation consulted**:

   - visual-design-specification.md (badge design, color specs)
   - design-quick-reference.md (implementation guide)
   - task-description.md (requirements, acceptance criteria)

4. **No hallucinated APIs**:
   - signal() ✅ (Angular 20+ core API)
   - computed() ✅ (Angular 20+ core API)
   - badge-primary ✅ (DaisyUI 5.x class)
   - badge-secondary ✅ (DaisyUI 5.x class)
   - badge-ghost ✅ (DaisyUI 5.x class)

### Architecture Delivery Checklist

**Caching Architecture**:

- ✅ Cache initialization pattern specified (signal-based)
- ✅ Cache hit/miss logic defined (early return pattern)
- ✅ Cache invalidation strategy documented (clearCache method)
- ✅ RPC reduction target defined (90%+ reduction)
- ✅ Memory constraints specified (< 10KB for commands, < 5KB for agents)

**Visual Architecture**:

- ✅ Badge color specifications provided (lapis blue, pharaoh gold, ghost)
- ✅ Template structure defined (before/after comparison)
- ✅ DaisyUI classes specified (badge badge-sm badge-{color})
- ✅ Accessibility requirements documented (WCAG AA contrast, screen reader)
- ✅ Layout transformation specified (2-line stacked → 1-line badge+desc)

**Integration Architecture**:

- ✅ Component integration points documented (facades ↔ ChatInputComponent)
- ✅ Data flow diagrams provided (caching flow, visual flow)
- ✅ No breaking changes verified (API signatures preserved)
- ✅ Backward compatibility ensured (existing behavior unchanged)

**Quality Assurance**:

- ✅ Functional requirements defined (cache hit/miss, badge rendering)
- ✅ Non-functional requirements defined (performance, security, maintainability)
- ✅ Pattern compliance verified (signal-based, DaisyUI, RPC delegation)
- ✅ Testing strategy documented (unit, integration, visual, manual)

**Implementation Readiness**:

- ✅ All files affected identified with line numbers
- ✅ All code patterns verified from codebase
- ✅ All imports verified as existing
- ✅ Complexity assessed (MEDIUM, 4-6 hours)
- ✅ Developer type recommended (frontend-developer)
- ✅ Rollback plan documented

---

## 📋 Implementation Batches (for Team-Leader)

### Batch 1: Command Caching (Backend Pattern)

**Priority**: HIGH (foundational caching logic)
**Estimated Time**: 1.5 hours

**Tasks**:

1. Add \_isCached signal to CommandDiscoveryFacade
2. Add cache check in fetchCommands() (early return if cached)
3. Remove slice(0, 10) and slice(0, 20) from searchCommands()
4. Add clearCache() method
5. Add unit tests for cache hit/miss

**Verification**:

- Run existing tests: `nx test core`
- Verify console logs show "Cache hit, skipping RPC" on second trigger
- Verify searchCommands() returns all items (no 10/20 limit)

### Batch 2: Agent Caching (Backend Pattern)

**Priority**: HIGH (foundational caching logic)
**Estimated Time**: 1 hour

**Tasks**:

1. Apply same pattern as Batch 1 to AgentDiscoveryFacade
2. Add unit tests for agent cache hit/miss

**Verification**:

- Run existing tests: `nx test core`
- Verify console logs show "Cache hit, skipping RPC" on second @ trigger
- Verify searchAgents() returns all items (no 10/20 limit)

### Batch 3: Visual Badge Enhancement (Frontend Pattern)

**Priority**: MEDIUM (UX improvement, independent of caching)
**Estimated Time**: 1.5 hours

**Tasks**:

1. Modify UnifiedSuggestionsDropdownComponent template (lines 113-121)
2. Add badge wrappers for command/agent/file types
3. Visual verification in VS Code webview
4. Accessibility testing (screen reader, keyboard navigation)

**Verification**:

- Run existing tests: `nx test chat`
- Visual: Command badges are lapis blue, agent badges are gold, file badges are ghost
- Keyboard: ArrowUp/Down/Enter/Escape still work
- Screen reader: Badge text announced naturally

### Batch 4: Integration Testing (End-to-End)

**Priority**: HIGH (system verification)
**Estimated Time**: 1 hour

**Tasks**:

1. Manual test: First `/` trigger → RPC called, all commands shown
2. Manual test: Second `/` trigger → RPC NOT called, all commands shown
3. Manual test: Query filtering → client-side filtering (no RPC)
4. Manual test: Badge visual verification (colors, layout, hover states)
5. Manual test: Narrow sidebar (250px) → badge not truncated

**Verification**:

- Console logs show RPC reduction (1 call vs 10+ calls in old behavior)
- Dropdown shows all items with scrolling (no 10-item limit)
- Badge colors match design specs (lapis blue, gold, ghost)
- Keyboard navigation still functional

---

## 🧪 Testing Strategy

### Unit Tests (Caching Logic)

**CommandDiscoveryFacade Unit Tests**:

```typescript
describe('CommandDiscoveryFacade Caching', () => {
  it('should call RPC on first fetchCommands() call', async () => {
    // GIVEN: Empty cache (_isCached = false)
    expect(facade.isCached()).toBe(false);

    // WHEN: fetchCommands() called
    await facade.fetchCommands();

    // THEN: RPC called, cache marked as initialized
    expect(rpcService.call).toHaveBeenCalledWith('autocomplete:commands', {...});
    expect(facade.isCached()).toBe(true);
  });

  it('should NOT call RPC on second fetchCommands() call (cache hit)', async () => {
    // GIVEN: Cache populated (_isCached = true)
    await facade.fetchCommands(); // First call
    rpcService.call.mockClear(); // Clear mock call history

    // WHEN: fetchCommands() called again
    await facade.fetchCommands();

    // THEN: RPC NOT called (cache hit)
    expect(rpcService.call).not.toHaveBeenCalled();
    expect(facade.isCached()).toBe(true);
  });

  it('should return ALL commands when query is empty', () => {
    // GIVEN: Cache with 50 commands
    facade._commands.set([...50 mock commands]);

    // WHEN: searchCommands('') called
    const results = facade.searchCommands('');

    // THEN: All 50 commands returned (no slice(0, 10))
    expect(results.length).toBe(50);
  });

  it('should return ALL matching commands when query provided', () => {
    // GIVEN: Cache with 30 commands matching 'test'
    facade._commands.set([...30 mock commands with 'test' in name/desc]);

    // WHEN: searchCommands('test') called
    const results = facade.searchCommands('test');

    // THEN: All 30 matching commands returned (no slice(0, 20))
    expect(results.length).toBe(30);
  });

  it('should clear cache on clearCache() call', () => {
    // GIVEN: Cache populated
    facade._isCached.set(true);
    facade._commands.set([...mock commands]);

    // WHEN: clearCache() called
    facade.clearCache();

    // THEN: Cache cleared
    expect(facade.isCached()).toBe(false);
    expect(facade.commands()).toEqual([]);
  });
});
```

**AgentDiscoveryFacade Unit Tests**:

- Same test structure as CommandDiscoveryFacade
- Replace "commands" with "agents"
- Verify 'autocomplete:agents' RPC method called

### Integration Tests (Component Integration)

**ChatInputComponent Integration Tests**:

```typescript
describe('ChatInputComponent Autocomplete Caching', () => {
  it('should cache commands on first slash trigger', async () => {
    // GIVEN: Empty cache
    expect(commandDiscovery.isCached()).toBe(false);

    // WHEN: User types '/' trigger
    component.handleSlashTriggered({ query: '', position: 1 });
    await fixture.whenStable();

    // THEN: Commands cached
    expect(commandDiscovery.isCached()).toBe(true);
    expect(component.filteredSuggestions().length).toBeGreaterThan(0);
  });

  it('should NOT refetch commands on second slash trigger', async () => {
    // GIVEN: Commands already cached
    await component.handleSlashTriggered({ query: '', position: 1 });
    await fixture.whenStable();
    const callCountBefore = rpcService.call.mock.calls.length;

    // WHEN: User types '/' trigger again
    await component.handleSlashTriggered({ query: '', position: 1 });
    await fixture.whenStable();

    // THEN: No additional RPC calls
    expect(rpcService.call.mock.calls.length).toBe(callCountBefore);
  });

  it('should show all commands without query (no 10-item limit)', async () => {
    // GIVEN: 50 commands cached
    commandDiscovery._commands.set([...50 mock commands]);
    commandDiscovery._isCached.set(true);

    // WHEN: User types '/' with no query
    component.handleSlashTriggered({ query: '', position: 1 });
    await fixture.whenStable();

    // THEN: All 50 commands displayed
    expect(component.filteredSuggestions().length).toBe(50);
  });
});
```

### Visual Tests (Badge Implementation)

**UnifiedSuggestionsDropdownComponent Visual Tests**:

```typescript
describe('UnifiedSuggestionsDropdownComponent Badge Rendering', () => {
  it('should render command names with badge-primary badge', () => {
    // GIVEN: Command suggestions
    const suggestions = [{ type: 'command', name: 'orchestrate', ... }];
    component.suggestions = signal(suggestions);

    // WHEN: Template rendered
    fixture.detectChanges();

    // THEN: Badge with badge-primary class rendered
    const badge = fixture.nativeElement.querySelector('.badge-primary');
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe('orchestrate');
  });

  it('should render agent names with badge-secondary badge', () => {
    // GIVEN: Agent suggestions
    const suggestions = [{ type: 'agent', name: 'team-leader', ... }];
    component.suggestions = signal(suggestions);

    // WHEN: Template rendered
    fixture.detectChanges();

    // THEN: Badge with badge-secondary class rendered
    const badge = fixture.nativeElement.querySelector('.badge-secondary');
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe('team-leader');
  });

  it('should render file names with badge-ghost badge', () => {
    // GIVEN: File suggestions
    const suggestions = [{ type: 'file', name: 'src/app.ts', ... }];
    component.suggestions = signal(suggestions);

    // WHEN: Template rendered
    fixture.detectChanges();

    // THEN: Badge with badge-ghost class rendered
    const badge = fixture.nativeElement.querySelector('.badge-ghost');
    expect(badge).toBeTruthy();
    expect(badge.textContent.trim()).toBe('src/app.ts');
  });

  it('should maintain keyboard navigation with badges', () => {
    // GIVEN: Dropdown with badge suggestions
    component.suggestions = signal([...mock suggestions]);
    fixture.detectChanges();

    // WHEN: ArrowDown pressed
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown' });
    fixture.nativeElement.dispatchEvent(event);

    // THEN: Focus moves to next item
    expect(component.focusedIndex()).toBe(1);
  });
});
```

### Manual Test Scenarios

**Scenario 1: Command Caching Flow**

1. Open VS Code with Ptah extension
2. Type `/` in chat input
3. **VERIFY**: Loading spinner appears briefly (< 500ms)
4. **VERIFY**: Dropdown shows all commands (> 10 items if available)
5. **VERIFY**: Console log shows "autocomplete:commands RPC called"
6. Close dropdown (Escape)
7. Type `/` again
8. **VERIFY**: No loading spinner (instant display)
9. **VERIFY**: Console log shows "Cache hit, skipping RPC"
10. **VERIFY**: Dropdown shows same commands (no RPC call)

**Scenario 2: Agent Caching Flow**

1. Type `@` in chat input
2. **VERIFY**: Loading spinner appears briefly (< 500ms)
3. **VERIFY**: Dropdown shows all agents (> 10 items if available)
4. **VERIFY**: Console log shows "autocomplete:agents RPC called"
5. Close dropdown (Escape)
6. Type `@` again
7. **VERIFY**: No loading spinner (instant display)
8. **VERIFY**: Console log shows "Cache hit, skipping RPC"
9. **VERIFY**: Dropdown shows same agents (no RPC call)

**Scenario 3: Visual Badge Verification**

1. Type `/` in chat input
2. **VERIFY**: Each command name wrapped in lapis blue badge
3. **VERIFY**: Badge text color is papyrus (light, readable)
4. **VERIFY**: Description text is muted gray (60% opacity)
5. **VERIFY**: Scope badges remain gold (badge-accent, unchanged)
6. Hover over command item
7. **VERIFY**: Background lightens, badge color unchanged
8. Press ArrowDown
9. **VERIFY**: 2px lapis blue outline appears on focused item

**Scenario 4: Agent Badge Verification**

1. Type `@` in chat input
2. **VERIFY**: Each agent name wrapped in pharaoh gold badge
3. **VERIFY**: Badge text color is black (readable on gold)
4. **VERIFY**: Scope badges remain lapis blue (badge-primary, unchanged)

**Scenario 5: File Badge Verification**

1. Type `@` in chat input
2. Click "Files" tab
3. **VERIFY**: Each file name wrapped in ghost badge (transparent, border only)
4. **VERIFY**: File path shown as description (muted)

**Scenario 6: Narrow Sidebar Responsive Test**

1. Resize VS Code sidebar to 250px (narrow)
2. Type `/` in chat input
3. **VERIFY**: Badge text NOT truncated (full command name visible)
4. **VERIFY**: Description text DOES truncate with ellipsis
5. **VERIFY**: Scope badges remain visible at end of item

**Scenario 7: Query Filtering (No RPC)**

1. Type `/` in chat input (cache populated)
2. Type `/orch` (query: "orch")
3. **VERIFY**: Dropdown filters to "orchestrate" command
4. **VERIFY**: Console log shows NO RPC call (client-side filtering)
5. **VERIFY**: Filtering completes instantly (< 16ms, no loading state)

**Scenario 8: Show All Items (No 10-Item Limit)**

1. Type `/` in chat input
2. **VERIFY**: Dropdown shows more than 10 commands (if available)
3. **VERIFY**: Vertical scrolling enabled if > 8 items
4. Press ArrowDown repeatedly
5. **VERIFY**: Focused item scrolls into view automatically

---

## 🔙 Rollback Plan

### Caching Rollback (If Cache Breaks)

**Problem Indicators**:

- Dropdown shows stale data after session change
- RPC calls completely blocked (no data loaded)
- Console errors related to \_isCached signal

**Rollback Steps**:

1. **Remove cache check from fetchCommands()**:

   ```typescript
   // BEFORE (with cache check):
   async fetchCommands(): Promise<void> {
     if (this._isCached()) return; // Remove this line
     // ... rest of method
   }

   // AFTER (rollback):
   async fetchCommands(): Promise<void> {
     // ... rest of method (original behavior)
   }
   ```

2. **Remove \_isCached signal**:

   ```typescript
   // REMOVE these lines:
   private readonly _isCached = signal(false);
   readonly isCached = computed(() => this._isCached());
   ```

3. **Restore slice limits in searchCommands()**:

   ```typescript
   // BEFORE (no limits):
   if (!query) {
     return allCommands; // Remove this
   }

   // AFTER (rollback):
   if (!query) {
     return allCommands.slice(0, 10); // Restore original limit
   }

   // For query filtering:
   return allCommands.filter(...); // Remove this

   // Rollback:
   return allCommands.filter(...).slice(0, 20); // Restore original limit
   ```

4. **Apply same rollback to AgentDiscoveryFacade**

**Verification**:

- Run `nx test core` (all tests pass)
- Manual test: Every `/` trigger calls RPC (verify in console)
- Dropdown shows max 10 items (original behavior restored)

### Visual Rollback (If Badges Break Layout)

**Problem Indicators**:

- Badge text truncates in normal sidebar width
- Layout breaks (badges overlap description)
- Keyboard navigation broken
- Screen reader announces badge text twice

**Rollback Steps**:

1. **Restore original template** (lines 113-121):

   ```html
   <!-- ROLLBACK to original 2-line stacked layout: -->
   <div class="flex-1 min-w-0">
     <div class="font-medium text-sm truncate">{{ getName(suggestion) }}</div>
     <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
   </div>
   ```

2. **Remove badge wrappers** (lines added for badges)

**Verification**:

- Run `nx test chat` (all tests pass)
- Visual: Dropdown shows original 2-line layout (name + description stacked)
- Keyboard navigation works (ArrowUp/Down/Enter/Escape)

### Feature Flag Strategy (Optional)

**If partial rollback needed**:

```typescript
// Add feature flag in environment config
export const environment = {
  enableCaching: true, // Toggle this to disable caching
  enableBadges: true,  // Toggle this to disable badges
};

// In CommandDiscoveryFacade.fetchCommands():
if (this._isCached() && environment.enableCaching) {
  return; // Cache check only if flag enabled
}

// In UnifiedSuggestionsDropdownComponent template:
@if (environment.enableBadges && suggestion.type === 'command') {
  <span class="badge badge-sm badge-primary">{{ getName(suggestion) }}</span>
}
@else {
  <div class="font-medium text-sm truncate">{{ getName(suggestion) }}</div>
}
```

**Usage**:

- Set `enableCaching: false` to disable caching only
- Set `enableBadges: false` to disable badges only
- Allows A/B testing and gradual rollout

---

## 📈 Performance Analysis

### RPC Call Reduction Analysis

**Current Behavior (Before Caching)**:

- User workflow: 10 slash triggers per session (typical)
- RPC calls: 10 calls to 'autocomplete:commands' (1 per trigger)
- Network overhead: 10 × ~100ms = 1 second total
- User perceived latency: 10 × 100ms = 1 second wasted

**Target Behavior (After Caching)**:

- User workflow: 10 slash triggers per session
- RPC calls: 1 call to 'autocomplete:commands' (first trigger only)
- Network overhead: 1 × ~100ms = 100ms total
- User perceived latency: 1 × 100ms = 100ms, then 9 × 0ms (instant)
- **RPC Reduction**: 90% (from 10 calls to 1 call)

**Memory Usage Estimate**:

- 50 commands × 100 bytes/command = 5KB
- 20 agents × 100 bytes/agent = 2KB
- **Total**: 7KB (well under 500KB target)
- Browser memory impact: Negligible (< 0.01% of typical 1GB tab memory)

### Client-Side Filtering Performance

**Filtering Benchmark** (estimated):

- 50 commands, empty query → return all 50 items

  - Operation: Array read (no filter)
  - Time: < 1ms (O(1) operation)

- 50 commands, query "test" → filter matching items

  - Operation: Array.filter() with 2 toLowerCase() + 2 includes() per item
  - Time: 50 × 0.1ms = 5ms (well under 16ms target)

- 100 commands, query "test" → filter matching items
  - Operation: Same as above
  - Time: 100 × 0.1ms = 10ms (still under 16ms target)

**Rendering Performance**:

- Angular change detection: ~1ms per component update
- DaisyUI badge CSS: Pure CSS (no JS overhead)
- Dropdown rendering: 50 items × 1ms = 50ms (well under 100ms target)

**Scrolling Performance**:

- Browser native scrolling: 60fps (16ms per frame)
- No virtualization needed: < 100 items typical
- Keyboard navigation: Browser native behavior (no JS overhead)

### Dropdown Scroll Performance (100+ Items)

**Current Implementation** (unified-suggestions-dropdown.component.ts:101):

```html
<ul class="menu-compact overflow-y-auto max-h-80">
  @for (suggestion of suggestions(); track trackBy($index, suggestion)) {
  <li>...</li>
  }
</ul>
```

**Analysis**:

- max-h-80 (320px) limits visible items to ~10 items (32px per item)
- overflow-y-auto enables native browser scrolling
- Browser renders all items but only paints visible viewport
- 100 items × 32px = 3200px total height (320px visible)
- Scrolling performance: 60fps (browser native, no JS overhead)

**No Optimization Needed**:

- Angular change detection only fires on signal changes (not on scroll)
- Browser handles scroll performance natively
- No need for virtual scrolling (< 100 items typical)

---

## ✅ Acceptance Criteria Mapping

### Requirement 1: Visual Enhancement for Command Names (task-description.md:11-26)

**Acceptance Criteria**:

- ✅ AC1: Command names display with DaisyUI badge styling (badge-primary)

  - Implementation: unified-suggestions-dropdown.component.ts:113-115 (new badge wrapper)
  - Verification: Visual test (lapis blue badges visible)

- ✅ AC2: Badge uses DaisyUI classes (badge badge-sm badge-primary)

  - Implementation: Template uses exact classes specified
  - Verification: DevTools inspection (classes applied)

- ✅ AC3: Command badge distinct from scope badge (primary vs accent)

  - Implementation: Command badge uses badge-primary, scope uses badge-accent
  - Verification: Visual comparison (different colors)

- ✅ AC4: Consistent styling across all commands

  - Implementation: @if block ensures uniform badge application
  - Verification: Visual inspection (all commands have same badge style)

- ✅ AC5: Badge remains visible during hover
  - Implementation: No hover state change on badge (only background)
  - Verification: Hover test (badge color unchanged)

### Requirement 2: Client-Side Caching for Commands (task-description.md:28-44)

**Acceptance Criteria**:

- ✅ AC1: Commands fetched once on first trigger

  - Implementation: CommandDiscoveryFacade.fetchCommands() checks \_isCached
  - Verification: Console log shows 1 RPC call on first trigger

- ✅ AC2: Commands cached in frontend signal

  - Implementation: \_commands signal stores cached data
  - Verification: Signal state inspection (\_commands not empty after fetch)

- ✅ AC3: Subsequent queries filter client-side (no RPC)

  - Implementation: searchCommands() filters \_commands signal locally
  - Verification: Console log shows no RPC calls on query change

- ✅ AC4: Closing/reopening dropdown uses cache (no refetch)

  - Implementation: \_isCached prevents refetch in fetchCommands()
  - Verification: Console log shows "Cache hit, skipping RPC"

- ✅ AC5: Cache invalidation mechanism provided
  - Implementation: clearCache() method resets \_isCached and \_commands
  - Verification: Call clearCache(), next trigger fetches from backend

### Requirement 3: Client-Side Caching for Agents (task-description.md:46-62)

**Acceptance Criteria**:

- ✅ AC1-5: Same as Requirement 2 (commands), applied to agents
  - Implementation: AgentDiscoveryFacade mirrors CommandDiscoveryFacade pattern
  - Verification: Same test scenarios for agents instead of commands

### Requirement 4: Dynamic File Suggestions (task-description.md:64-76)

**Acceptance Criteria**:

- ✅ AC1-5: Files remain dynamic (NO CHANGES NEEDED)
  - Implementation: FilePickerService unchanged (existing behavior preserved)
  - Verification: Files continue fetching dynamically per query

### Requirement 5: Show All Available Commands (task-description.md:78-94)

**Acceptance Criteria**:

- ✅ AC1: Empty query displays ALL commands

  - Implementation: searchCommands('') returns allCommands (no slice)
  - Verification: Manual test (> 10 commands visible with empty query)

- ✅ AC2: Query displays ALL matching commands

  - Implementation: searchCommands(query) filters without slice limit
  - Verification: Manual test (> 20 matching commands visible with query)

- ✅ AC3: Dropdown scrolls for large lists

  - Implementation: Existing max-h-64 overflow-y-auto (unchanged)
  - Verification: Manual test (scroll visible with 10+ items)

- ✅ AC4: Keyboard navigation scrolls to focused item

  - Implementation: Browser native scroll-into-view (unchanged)
  - Verification: Manual test (ArrowDown scrolls dropdown)

- ✅ AC5: 100+ commands render performantly
  - Implementation: Angular change detection + native scrolling
  - Verification: Performance test (< 100ms render time for 100 items)

### Requirement 6: Show All Available Agents (task-description.md:96-110)

**Acceptance Criteria**:

- ✅ AC1-5: Same as Requirement 5 (commands), applied to agents
  - Implementation: AgentDiscoveryFacade.searchAgents() mirrors searchCommands()
  - Verification: Same test scenarios for agents instead of commands

---

## 📚 References

**Task Documents**:

- context.md (user intent, conversation summary)
- task-description.md (requirements, acceptance criteria)
- visual-design-specification.md (badge design, color specs, layout)
- design-quick-reference.md (implementation guide, testing checklist)
- design-summary.md (executive summary, design approach)

**Codebase Evidence**:

- command-discovery.facade.ts:1-108 (command autocomplete service)
- agent-discovery.facade.ts:1-78 (agent autocomplete service)
- chat-input.component.ts:1-551 (autocomplete trigger coordination)
- unified-suggestions-dropdown.component.ts:1-240 (dropdown UI)

**Design System**:

- apps/ptah-extension-webview/tailwind.config.js:23-73 (Anubis theme colors)
- apps/ptah-extension-webview/src/styles.css:735-737 (badge sizing)
- DaisyUI 5.x badge component documentation

**Angular Patterns**:

- Angular 20+ signals API (signal, computed)
- Angular 20+ control flow (@if, @for)
- Angular 20+ change detection (zoneless)

---

**Document Version**: 1.0
**Created**: 2025-12-04
**Architect**: Software Architect (AI Agent)
**Task ID**: TASK_2025_042
**Status**: ✅ Architecture Complete - Ready for Team-Leader Decomposition
