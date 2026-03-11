# Review Fixes Plan - TASK_2025_042

**Software Architect**: AI Agent
**Created**: 2025-12-04
**Priority**: CRITICAL FIXES + SERIOUS IMPROVEMENTS
**Estimated Effort**: 3-4 hours

---

## 📊 Executive Summary

This plan addresses **7 critical/serious issues** and **2 moderate improvements** identified by code-style-reviewer and code-logic-reviewer. The fixes focus on:

1. **Cache invalidation** on session change (data correctness)
2. **Error state management** with retry mechanism (user recovery)
3. **Race condition prevention** (performance guarantee)
4. **Pattern compliance** (@HostListener → host object)
5. **Production code cleanup** (debug logs, stack traces)
6. **Logging consistency** (debugging experience)
7. **Badge color collision** (visual semantics)

**No breaking changes** - all fixes maintain existing API contracts.

---

## 🏗️ Architecture Overview

### 1. Session Monitoring Strategy

**Problem**: Cache never invalidates when user switches sessions/projects, showing stale data.

**Solution**: Effect-based session monitoring in ChatInputComponent

**Pattern**: Angular 20+ effect() with session tracking signal

**Architecture**:

```typescript
// In ChatInputComponent constructor
effect(
  () => {
    const activeTab = this.chatStore.activeTab();

    // Detect session change (new tab selected)
    if (activeTab) {
      // Clear both caches atomically
      this.commandDiscovery.clearCache();
      this.agentDiscovery.clearCache();

      console.log('[ChatInputComponent] Session changed, caches cleared');
    }
  },
  { allowSignalWrites: true }
);
```

**Evidence**:

- Pattern source: chat-input.component.ts:527-549 (existing effect for queue restoration)
- Session tracking: chatStore.activeTab() signal already exists
- Cache methods: clearCache() already exists in both facades (command-discovery.facade.ts:128, agent-discovery.facade.ts:92)

---

### 2. Error State Management Pattern

**Problem**: RPC failures show empty dropdown with no user feedback or retry mechanism.

**Solution**: Add `_error` signal to both facades, expose to UI, implement retry

**Pattern**: Signal-based error state with computed accessor

**Architecture**:

```typescript
// In CommandDiscoveryFacade & AgentDiscoveryFacade
export class CommandDiscoveryFacade {
  private readonly _error = signal<string | null>(null);
  readonly error = computed(() => this._error());

  async fetchCommands(): Promise<void> {
    // Clear previous error on new fetch
    this._error.set(null);

    try {
      // ... existing RPC logic
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this._error.set(message);
      console.error('[CommandDiscoveryFacade] RPC failed:', message);
      this._commands.set([]);
    }
  }

  // NEW: Clear error when clearing cache
  clearCache(): void {
    this._isCached.set(false);
    this._commands.set([]);
    this._error.set(null); // Clear error state
    console.log('[CommandDiscoveryFacade] Cache cleared');
  }
}
```

**UI Integration** (ChatInputComponent - OPTIONAL for this fix):

```typescript
// In template (future enhancement, not required for this fix)
@if (commandDiscovery.error()) {
  <div class="alert alert-error text-xs p-2">
    {{ commandDiscovery.error() }}
    <button class="btn btn-xs" (click)="retryCommands()">Retry</button>
  </div>
}
```

**For this fix**: Expose error signal, log errors clearly. UI display is optional future enhancement.

---

### 3. Race Condition Prevention Approach

**Problem**: Rapid triggers (typing `/` twice within 500ms) send duplicate RPC calls, violating 90% reduction target.

**Solution**: Check `_isLoading` signal in early return alongside `_isCached`

**Pattern**: Loading state guard in async fetch method

**Architecture**:

```typescript
async fetchCommands(): Promise<void> {
  // Cache check - skip if cached
  if (this._isCached()) {
    console.log('[CommandDiscoveryFacade] Cache hit, skipping RPC');
    return;
  }

  // NEW: Prevent duplicate in-flight requests
  if (this._isLoading()) {
    console.log('[CommandDiscoveryFacade] Request in-flight, skipping duplicate');
    return;
  }

  this._isLoading.set(true);

  try {
    // ... existing RPC logic
  } finally {
    this._isLoading.set(false);
  }
}
```

**Evidence**:

- `_isLoading` signal already exists (command-discovery.facade.ts:17, agent-discovery.facade.ts:16)
- Pattern: Early return guards (command-discovery.facade.ts:30-32)

---

## 🔧 Component-by-Component Fixes

### Component 1: CommandDiscoveryFacade

**File**: `libs/frontend/core/src/lib/services/command-discovery.facade.ts`

**Priority**: CRITICAL (3 fixes) + SERIOUS (1 fix)

#### Fix 1.1: Add Error Signal (CRITICAL)

**Lines**: 18-19 (add after `_isCached`)

**Implementation**:

```typescript
private readonly _commands = signal<CommandSuggestion[]>([]);
private readonly _isCached = signal(false);
private readonly _error = signal<string | null>(null); // NEW

readonly isLoading = computed(() => this._isLoading());
readonly commands = computed(() => this._commands());
readonly isCached = computed(() => this._isCached());
readonly error = computed(() => this._error()); // NEW
```

**Rationale**: Expose error state to UI for retry mechanism (future enhancement)

---

#### Fix 1.2: Add Race Condition Check (CRITICAL)

**Lines**: 33-34 (add after cache check)

**Implementation**:

```typescript
// Cache check - skip RPC if already cached
if (this._isCached()) {
  console.log('[CommandDiscoveryFacade] Cache hit, skipping RPC');
  return;
}

// NEW: Prevent duplicate in-flight requests
if (this._isLoading()) {
  console.log('[CommandDiscoveryFacade] Request in-flight, skipping duplicate');
  return;
}

console.log('[CommandDiscoveryFacade] fetchCommands called'); // MODIFIED (remove stack trace)
```

**Rationale**: Prevents duplicate RPC calls during rapid triggers

---

#### Fix 1.3: Remove Debug Stack Trace (CRITICAL)

**Lines**: 35-38 (modify existing log)

**BEFORE**:

```typescript
console.log('[CommandDiscoveryFacade] fetchCommands called', new Error().stack);
```

**AFTER**:

```typescript
console.log('[CommandDiscoveryFacade] fetchCommands called');
```

**Rationale**: Removes production log pollution, performance overhead (Error object creation)

---

#### Fix 1.4: Set Error on Catch Block (CRITICAL)

**Lines**: 69-74 (modify catch block)

**BEFORE**:

```typescript
} catch (error) {
  console.error(
    '[CommandDiscoveryFacade] Failed to fetch commands:',
    error
  );
  this._commands.set([]);
}
```

**AFTER**:

```typescript
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to fetch commands';
  this._error.set(message);
  console.error('[CommandDiscoveryFacade] Failed to fetch commands:', error);
  this._commands.set([]);
}
```

**Rationale**: Expose error state for UI feedback

---

#### Fix 1.5: Clear Error on Fetch Start (CRITICAL)

**Lines**: 40 (add after `this._isLoading.set(true)`)

**Implementation**:

```typescript
console.log('[CommandDiscoveryFacade] fetchCommands called');
this._isLoading.set(true);
this._error.set(null); // NEW: Clear previous error
```

**Rationale**: Clear stale error state on new fetch attempt

---

#### Fix 1.6: Add Logging for searchCommands (SERIOUS)

**Lines**: 85-88 (already exists, KEEP ALL LOGS)

**Current Implementation**: CORRECT (3 logs for search operations)

**Action**: NO CHANGE (consistent with AgentDiscoveryFacade fix below)

**Rationale**: CommandDiscoveryFacade logging pattern is correct, mirror in AgentDiscoveryFacade

---

#### Fix 1.7: Clear Error in clearCache (MODERATE)

**Lines**: 128-132 (modify clearCache method)

**BEFORE**:

```typescript
clearCache(): void {
  this._isCached.set(false);
  this._commands.set([]);
  console.log('[CommandDiscoveryFacade] Cache cleared');
}
```

**AFTER**:

```typescript
clearCache(): void {
  this._isCached.set(false);
  this._commands.set([]);
  this._error.set(null); // NEW: Clear error state
  console.log('[CommandDiscoveryFacade] Cache cleared');
}
```

**Rationale**: Reset error state on cache invalidation

---

### Component 2: AgentDiscoveryFacade

**File**: `libs/frontend/core/src/lib/services/agent-discovery.facade.ts`

**Priority**: CRITICAL (3 fixes) + SERIOUS (1 fix)

#### Fix 2.1: Add Error Signal (CRITICAL)

**Lines**: 17-18 (add after `_isCached`)

**Implementation**: Same as CommandDiscoveryFacade Fix 1.1

```typescript
private readonly _agents = signal<AgentSuggestion[]>([]);
private readonly _isCached = signal(false);
private readonly _error = signal<string | null>(null); // NEW

readonly isLoading = computed(() => this._isLoading());
readonly agents = computed(() => this._agents());
readonly isCached = computed(() => this._isCached());
readonly error = computed(() => this._error()); // NEW
```

---

#### Fix 2.2: Add Race Condition Check (CRITICAL)

**Lines**: 32-33 (add after cache check)

**Implementation**: Same pattern as CommandDiscoveryFacade Fix 1.2

```typescript
// Cache check - skip RPC if already cached
if (this._isCached()) {
  console.log('[AgentDiscoveryFacade] Cache hit, skipping RPC');
  return;
}

// NEW: Prevent duplicate in-flight requests
if (this._isLoading()) {
  console.log('[AgentDiscoveryFacade] Request in-flight, skipping duplicate');
  return;
}

console.log('[AgentDiscoveryFacade] fetchAgents called'); // NEW: Add entry log
```

---

#### Fix 2.3: Set Error on Catch Block (CRITICAL)

**Lines**: 65-68 (modify catch block)

**BEFORE**:

```typescript
} catch (error) {
  console.error('[AgentDiscoveryFacade] Failed to fetch agents:', error);
  this._agents.set([]);
}
```

**AFTER**:

```typescript
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to fetch agents';
  this._error.set(message);
  console.error('[AgentDiscoveryFacade] Failed to fetch agents:', error);
  this._agents.set([]);
}
```

---

#### Fix 2.4: Clear Error on Fetch Start (CRITICAL)

**Lines**: 34-35 (add after `this._isLoading.set(true)`)

**Implementation**:

```typescript
console.log('[AgentDiscoveryFacade] fetchAgents called'); // NEW: Add entry log
this._isLoading.set(true);
this._error.set(null); // NEW: Clear previous error
```

---

#### Fix 2.5: Add Consistent Logging for searchAgents (SERIOUS)

**Lines**: 76-87 (add logging to match CommandDiscoveryFacade)

**BEFORE** (silent search):

```typescript
searchAgents(query: string): AgentSuggestion[] {
  if (!query) {
    return this._agents();
  }

  const lowerQuery = query.toLowerCase();
  return this._agents().filter(
    (a) =>
      a.name.toLowerCase().includes(lowerQuery) ||
      a.description.toLowerCase().includes(lowerQuery)
  );
}
```

**AFTER** (consistent logging):

```typescript
searchAgents(query: string): AgentSuggestion[] {
  const allAgents = this._agents();
  console.log('[AgentDiscoveryFacade] searchAgents called', {
    query,
    totalAgents: allAgents.length,
  });

  if (!query) {
    console.log('[AgentDiscoveryFacade] Returning all agents', {
      count: allAgents.length,
    });
    return allAgents;
  }

  const lowerQuery = query.toLowerCase();
  const results = allAgents.filter(
    (a) =>
      a.name.toLowerCase().includes(lowerQuery) ||
      a.description.toLowerCase().includes(lowerQuery)
  );

  console.log('[AgentDiscoveryFacade] Filtered results', {
    count: results.length,
  });
  return results;
}
```

**Rationale**: Match CommandDiscoveryFacade logging for consistent debugging experience

---

#### Fix 2.6: Clear Error in clearCache (MODERATE)

**Lines**: 92-96 (modify clearCache method)

**BEFORE**:

```typescript
clearCache(): void {
  this._isCached.set(false);
  this._agents.set([]);
  console.log('[AgentDiscoveryFacade] Cache cleared');
}
```

**AFTER**:

```typescript
clearCache(): void {
  this._isCached.set(false);
  this._agents.set([]);
  this._error.set(null); // NEW: Clear error state
  console.log('[AgentDiscoveryFacade] Cache cleared');
}
```

---

### Component 3: ChatInputComponent

**File**: `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`

**Priority**: CRITICAL (1 fix)

#### Fix 3.1: Implement Session Change Detection (CRITICAL)

**Location**: Constructor (after line 549)

**Implementation**:

```typescript
constructor() {
  // ... existing constructor code ...

  // Existing effect for queue restoration (lines 527-549)
  effect(() => {
    const activeTab = this.chatStore.activeTab();
    if (activeTab) {
      this.restoreMessageQueue();
    }
  });

  // NEW: Session change monitoring - clear caches on session change
  effect(() => {
    const activeTab = this.chatStore.activeTab();

    if (activeTab) {
      // Clear both autocomplete caches when session changes
      this.commandDiscovery.clearCache();
      this.agentDiscovery.clearCache();

      console.log('[ChatInputComponent] Session changed, caches cleared', {
        sessionId: activeTab.id,
      });
    }
  }, { allowSignalWrites: true });
}
```

**Evidence**:

- Pattern source: chat-input.component.ts:527-549 (existing effect)
- Session tracking: chatStore.activeTab() signal
- Cache methods: clearCache() exists in both facades

**Rationale**: Invalidate caches when user switches sessions/projects to prevent stale data

---

### Component 4: UnifiedSuggestionsDropdownComponent

**File**: `libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts`

**Priority**: BLOCKING (1 fix) + SERIOUS (1 fix)

#### Fix 4.1: Migrate @HostListener to host Object (BLOCKING)

**Lines**: 202-251 (replace @HostListener with host object)

**BEFORE** (@HostListener pattern - Angular 18 style):

```typescript
@Component({
  selector: 'ptah-unified-suggestions-dropdown',
  standalone: true,
  imports: [CommonModule],
  template: `...`,
  styles: [...],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnifiedSuggestionsDropdownComponent {
  // ... component properties ...

  // Keyboard navigation
  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    // ... keyboard handling logic ...
  }
}
```

**AFTER** (host object - Angular 20+ best practice):

```typescript
@Component({
  selector: 'ptah-unified-suggestions-dropdown',
  standalone: true,
  imports: [CommonModule],
  host: {
    '(document:keydown)': 'onKeyDown($event)'
  },
  template: `...`,
  styles: [...],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnifiedSuggestionsDropdownComponent {
  // ... component properties ...

  // Keyboard navigation (method remains unchanged)
  onKeyDown(event: KeyboardEvent): void {
    const suggestions = this.suggestions();

    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        this.setFocusedIndex((this._focusedIndex() + 1) % suggestions.length);
        break;
      }
      // ... rest of method unchanged
    }
  }
}
```

**Changes**:

1. **Remove** import of `HostListener` from `@angular/core` (line 6)
2. **Add** `host: { '(document:keydown)': 'onKeyDown($event)' }` to `@Component` decorator
3. **Remove** `@HostListener('document:keydown', ['$event'])` decorator from method
4. **Keep** `onKeyDown()` method implementation unchanged

**Evidence**:

- Angular 20+ best practices: "Do NOT use @HostBinding and @HostListener decorators. Put host bindings inside the host object of the @Component or @Directive decorator instead"
- Pattern violation identified by code-style-reviewer (code-style-review.md:243-260)

**Rationale**: Follow Angular 20+ best practices, improve tree-shaking

---

#### Fix 4.2: Fix Badge Color Collision (SERIOUS)

**Lines**: 138 (change agent scope badge from badge-primary to badge-accent)

**Problem**: Command names use `badge-primary`, agent scope badges also use `badge-primary` → visual collision

**BEFORE** (badge-primary for agent scope):

```typescript
@if (suggestion.type === 'agent' && suggestion.scope === 'builtin') {
  <span class="badge badge-primary badge-sm">Built-in</span>
} @if (suggestion.type === 'command' && suggestion.scope === 'builtin') {
  <span class="badge badge-accent badge-sm">Built-in</span>
}
```

**AFTER** (badge-accent for command names, consistent scope colors):

```typescript
@if (suggestion.type === 'agent' && suggestion.scope === 'builtin') {
  <span class="badge badge-accent badge-sm">Built-in</span>
} @if (suggestion.type === 'command' && suggestion.scope === 'builtin') {
  <span class="badge badge-accent badge-sm">Built-in</span>
}
```

**Color Mapping**:

- Command **names**: `badge-primary` (lapis blue)
- Agent **names**: `badge-secondary` (pharaoh gold)
- File **names**: `badge-ghost` (transparent)
- **Scope badges** (any type): `badge-accent` (distinct from names)

**Rationale**: Eliminate visual collision, use accent color for scope badges consistently

---

## 📋 Implementation Details (Line-by-Line)

### File 1: command-discovery.facade.ts

**Total Changes**: 7 modifications across 10 line ranges

| Line Range | Change Type | Description                                    |
| ---------- | ----------- | ---------------------------------------------- |
| 18-19      | ADD         | Add `_error` signal after `_isCached`          |
| 23-24      | ADD         | Add `error` computed accessor after `isCached` |
| 33-34      | ADD         | Add `_isLoading` check after cache check       |
| 35-38      | MODIFY      | Remove stack trace from console.log            |
| 40         | ADD         | Clear `_error` on fetch start                  |
| 69-74      | MODIFY      | Set `_error` in catch block                    |
| 130        | ADD         | Clear `_error` in clearCache()                 |

**Risk Assessment**:

- HIGH RISK: Error signal addition (new state management)
- MEDIUM RISK: Race condition check (early return logic)
- LOW RISK: Stack trace removal (log cleanup)
- LOW RISK: Error clearing (defensive programming)

---

### File 2: agent-discovery.facade.ts

**Total Changes**: 7 modifications across 10 line ranges

| Line Range | Change Type | Description                                    |
| ---------- | ----------- | ---------------------------------------------- |
| 17-18      | ADD         | Add `_error` signal after `_isCached`          |
| 22-23      | ADD         | Add `error` computed accessor after `isCached` |
| 32-33      | ADD         | Add `_isLoading` check after cache check       |
| 34         | ADD         | Add entry console.log                          |
| 35         | ADD         | Clear `_error` on fetch start                  |
| 65-68      | MODIFY      | Set `_error` in catch block                    |
| 76-87      | MODIFY      | Add consistent logging for searchAgents        |
| 94         | ADD         | Clear `_error` in clearCache()                 |

**Risk Assessment**:

- HIGH RISK: Error signal addition (new state management)
- MEDIUM RISK: Race condition check (early return logic)
- LOW RISK: Logging additions (debugging improvements)
- LOW RISK: Error clearing (defensive programming)

---

### File 3: chat-input.component.ts

**Total Changes**: 1 addition after line 549

| Line Range | Change Type | Description                      |
| ---------- | ----------- | -------------------------------- |
| 550-565    | ADD         | Session change monitoring effect |

**Risk Assessment**:

- MEDIUM RISK: Session monitoring (cache invalidation timing)
- Mitigation: Use `allowSignalWrites: true` to prevent circular dependencies
- Fallback: Can be disabled by commenting out effect

---

### File 4: unified-suggestions-dropdown.component.ts

**Total Changes**: 2 modifications

| Line Range | Change Type | Description                               |
| ---------- | ----------- | ----------------------------------------- |
| 6          | REMOVE      | Remove `HostListener` import              |
| 42-48      | ADD         | Add `host` object to @Component decorator |
| 202        | REMOVE      | Remove @HostListener decorator            |
| 138        | MODIFY      | Change badge-primary to badge-accent      |

**Risk Assessment**:

- MEDIUM RISK: @HostListener migration (keyboard navigation behavior)
- LOW RISK: Badge color change (CSS-only change)
- Mitigation: Test keyboard navigation thoroughly after migration

---

## 🧪 Testing Strategy

### Test 1: Session Change Cache Invalidation

**Scenario**: User switches chat sessions, expects fresh commands

**Steps**:

1. Open session A, type `/` → commands cached
2. Switch to session B (different project)
3. Type `/` → verify RPC called (cache was cleared)
4. Check console logs for "Session changed, caches cleared"

**Expected Result**:

- Console shows session change log
- Console shows "fetchCommands called" (not "Cache hit")
- Dropdown shows fresh commands for session B

**Verification**:

```bash
# Console output should show:
[ChatInputComponent] Session changed, caches cleared { sessionId: "xyz" }
[CommandDiscoveryFacade] fetchCommands called
```

---

### Test 2: Error State and Retry

**Scenario**: RPC fails, user sees error message (future enhancement: retry button)

**Steps**:

1. Simulate network failure (disconnect WiFi)
2. Type `/` → RPC fails
3. Check error signal: `commandDiscovery.error()` should return error message
4. Reconnect WiFi
5. Type `/` again → verify error cleared, RPC retried

**Expected Result**:

- Error signal set with message: "Failed to fetch commands"
- Console shows error log with details
- Second trigger clears error, fetches successfully

**Verification**:

```bash
# Console output after failure:
[CommandDiscoveryFacade] Failed to fetch commands: NetworkError: ...

# After retry:
[CommandDiscoveryFacade] fetchCommands called
[CommandDiscoveryFacade] Cache hit, skipping RPC (after successful fetch)
```

---

### Test 3: Race Condition Prevention

**Scenario**: User types `/` twice rapidly, only 1 RPC call sent

**Steps**:

1. Clear cache: `commandDiscovery.clearCache()`
2. Type `/` → immediately type `/` again (within 500ms)
3. Check console logs for "Request in-flight, skipping duplicate"
4. Verify only 1 RPC call made (check network tab)

**Expected Result**:

- First trigger: "fetchCommands called" → RPC sent
- Second trigger: "Request in-flight, skipping duplicate" → no RPC
- Network tab shows 1 RPC call only

**Verification**:

```bash
# Console output:
[CommandDiscoveryFacade] fetchCommands called
[CommandDiscoveryFacade] Request in-flight, skipping duplicate
```

---

### Test 4: @HostListener Migration

**Scenario**: Keyboard navigation still works after migration to host object

**Steps**:

1. Type `/` → dropdown opens
2. Press ArrowDown → verify focus moves to next item
3. Press ArrowUp → verify focus moves to previous item
4. Press Enter → verify suggestion selected
5. Press Escape → verify dropdown closes
6. Type `@`, press Tab → verify category changes (if showTabs enabled)

**Expected Result**:

- All keyboard navigation works identically to before
- No console errors
- Focus outlines appear on correct items

**Verification**: Visual inspection + keyboard interaction

---

### Test 5: Badge Color Distinction

**Scenario**: Command names and agent scope badges use different colors

**Steps**:

1. Type `/` → dropdown shows commands
2. Verify command name badges are lapis blue (badge-primary)
3. Verify command scope badges (if any) are accent color (badge-accent)
4. Type `@` → dropdown shows agents
5. Verify agent name badges are pharaoh gold (badge-secondary)
6. Verify agent scope badges are accent color (badge-accent)

**Expected Result**:

- Command names: Lapis blue
- Agent names: Pharaoh gold
- All scope badges: Accent color (distinct from names)

**Verification**: Visual inspection via DevTools color picker

---

### Test 6: Consistent Logging

**Scenario**: AgentDiscoveryFacade has same logging as CommandDiscoveryFacade

**Steps**:

1. Type `@` → trigger agent search
2. Check console for 3 logs: "searchAgents called", "Returning all agents", "Filtered results"
3. Type `@test` → check console for query filtering log
4. Compare with command search logs (should match structure)

**Expected Result**:

- AgentDiscoveryFacade logs match CommandDiscoveryFacade pattern
- Query, total count, result count all logged
- Consistent log prefix format: `[AgentDiscoveryFacade]`

**Verification**:

```bash
# Console output for agent search:
[AgentDiscoveryFacade] searchAgents called { query: "", totalAgents: 20 }
[AgentDiscoveryFacade] Returning all agents { count: 20 }
```

---

## 📁 Files Affected Summary

### MODIFY (4 files)

1. **libs/frontend/core/src/lib/services/command-discovery.facade.ts**

   - Risk: HIGH (error state + race condition logic)
   - Lines: 18-19, 23-24, 33-34, 35-38, 40, 69-74, 130
   - Complexity: 7 changes across 10 line ranges

2. **libs/frontend/core/src/lib/services/agent-discovery.facade.ts**

   - Risk: HIGH (error state + race condition logic)
   - Lines: 17-18, 22-23, 32-33, 34, 35, 65-68, 76-87, 94
   - Complexity: 7 changes across 10 line ranges

3. **libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts**

   - Risk: MEDIUM (session monitoring effect)
   - Lines: 550-565 (add after existing effect)
   - Complexity: 1 effect addition (16 lines)

4. **libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts**
   - Risk: MEDIUM (@HostListener migration)
   - Lines: 6 (import), 42-48 (host object), 138 (badge color), 202 (decorator removal)
   - Complexity: 4 changes

### NO CHANGES

- slash-trigger.directive.ts (trigger logic unchanged)
- at-trigger.directive.ts (trigger logic unchanged)
- Backend RPC handlers (autocomplete:commands, autocomplete:agents unchanged)

---

## 🎯 Quality Requirements

### Functional Requirements

**Error State Management**:

- System MUST expose error state via signal in both facades
- System MUST clear error state on new fetch attempt
- System MUST set error message on RPC failure (catch block)
- System MUST clear error state on cache invalidation

**Race Condition Prevention**:

- System MUST check `_isLoading` before RPC call
- System MUST prevent duplicate in-flight requests
- System MUST maintain 90%+ RPC reduction (1 call per session)

**Session Monitoring**:

- System MUST detect session change via chatStore.activeTab()
- System MUST clear both caches atomically on session change
- System MUST log session changes for debugging

**Pattern Compliance**:

- System MUST use host object instead of @HostListener (Angular 20+)
- System MUST maintain keyboard navigation behavior after migration
- System MUST use distinct badge colors for names vs scope badges

### Non-Functional Requirements

**Performance**:

- Error signal check MUST add < 1ms overhead
- Loading state check MUST add < 1ms overhead
- Session monitoring MUST add < 5ms overhead per session change
- Host object MUST maintain same keyboard event handling performance

**Maintainability**:

- Error handling MUST follow consistent pattern across both facades
- Logging MUST follow consistent format across both facades
- Session monitoring MUST use existing effect pattern
- Badge colors MUST use semantic naming (primary/secondary/accent)

**Reliability**:

- Error state MUST NOT cause memory leaks (signals cleaned up properly)
- Session monitoring MUST NOT cause infinite loops (allowSignalWrites)
- Race condition check MUST NOT break cache hit path
- Host object MUST NOT break keyboard navigation

**Testability**:

- Error state MUST be verifiable via unit tests (signal inspection)
- Race condition MUST be verifiable via console logs
- Session change MUST be verifiable via console logs
- Keyboard navigation MUST be verifiable via integration tests

---

## 🎯 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **frontend-developer**

**Rationale**:

1. All fixes are frontend (facades + component + template)
2. Angular 20+ signals expertise required (error signals, effects)
3. Angular best practices knowledge (host object migration)
4. No backend changes needed

**Complexity Assessment**: MEDIUM-HIGH

**Estimated Effort**: 3-4 hours

**Breakdown**:

- Error state implementation: 1-1.5 hours (both facades)
- Race condition fix: 30 minutes (simple early return)
- Session monitoring: 30 minutes (effect addition)
- @HostListener migration: 30 minutes (pattern change)
- Logging consistency: 30 minutes (add logs to AgentDiscoveryFacade)
- Testing all fixes: 1 hour (manual + console verification)

**Risk Factors**:

- HIGH RISK: Error state (new signals, potential circular dependencies)
- MEDIUM RISK: Session monitoring (cache invalidation timing)
- MEDIUM RISK: Host object migration (keyboard event handling)
- LOW RISK: Race condition check (defensive programming)
- LOW RISK: Badge color change (CSS-only)

### Critical Verification Points

**Before Implementation, Frontend-Developer Must Verify**:

1. **All signals exist**:

   - `_isLoading` signal ✅ (command-discovery.facade.ts:17, agent-discovery.facade.ts:16)
   - `chatStore.activeTab()` signal ✅ (chat.store.ts)
   - `clearCache()` methods ✅ (command-discovery.facade.ts:128, agent-discovery.facade.ts:92)

2. **All patterns verified**:

   - Effect pattern ✅ (chat-input.component.ts:527-549)
   - Signal-based state ✅ (facades use signal() and computed())
   - Host object pattern ✅ (Angular 20+ best practices)

3. **No hallucinated APIs**:
   - `signal<string | null>()` ✅ (Angular 20+ core API)
   - `effect()` with `allowSignalWrites` ✅ (Angular 20+ core API)
   - `host: { '(document:keydown)': 'onKeyDown($event)' }` ✅ (Angular 20+ @Component API)

### Architecture Delivery Checklist

**Error State Architecture**:

- ✅ Error signal pattern specified (signal<string | null>)
- ✅ Error clearing strategy defined (on fetch start, on cache clear)
- ✅ Error setting logic defined (catch blocks)
- ✅ Error exposure pattern defined (computed accessor)

**Race Condition Architecture**:

- ✅ Loading state check pattern specified (early return)
- ✅ Duplicate prevention logic defined (if \_isLoading return)
- ✅ RPC reduction maintained (90%+ target)

**Session Monitoring Architecture**:

- ✅ Session detection pattern specified (effect on activeTab)
- ✅ Cache invalidation strategy defined (clearCache on both facades)
- ✅ Logging strategy defined (session change logs)

**Pattern Compliance Architecture**:

- ✅ Host object migration pattern specified (remove @HostListener)
- ✅ Badge color semantics defined (accent for scope badges)
- ✅ Logging consistency pattern defined (match CommandDiscoveryFacade)

**Implementation Readiness**:

- ✅ All files affected identified with line numbers
- ✅ All code patterns verified from codebase
- ✅ All imports verified as existing
- ✅ Complexity assessed (MEDIUM-HIGH, 3-4 hours)
- ✅ Developer type recommended (frontend-developer)
- ✅ Testing strategy documented (6 test scenarios)

---

## 📊 Priority Matrix

### Must Fix Before Merge (CRITICAL)

1. ✅ **Cache invalidation on session change** (ChatInputComponent)

   - Impact: Data correctness (stale data from previous sessions)
   - Effort: 30 minutes
   - Risk: MEDIUM (session timing)

2. ✅ **RPC failure error state** (both facades)

   - Impact: User can't recover from network errors
   - Effort: 1-1.5 hours
   - Risk: HIGH (new state management)

3. ✅ **Race condition fix** (both facades)

   - Impact: Performance target (90% RPC reduction)
   - Effort: 30 minutes
   - Risk: MEDIUM (early return logic)

4. ✅ **@HostListener pattern violation** (UnifiedSuggestionsDropdownComponent)

   - Impact: Pattern compliance (Angular 20+ best practices)
   - Effort: 30 minutes
   - Risk: MEDIUM (keyboard events)

5. ✅ **Debug stack trace removal** (CommandDiscoveryFacade)
   - Impact: Production log pollution
   - Effort: 5 minutes
   - Risk: LOW (log cleanup)

### Should Fix (SERIOUS)

6. ✅ **Consistent logging** (AgentDiscoveryFacade)

   - Impact: Debugging experience
   - Effort: 30 minutes
   - Risk: LOW (log additions)

7. ✅ **Badge color collision** (UnifiedSuggestionsDropdownComponent)
   - Impact: Visual semantics
   - Effort: 5 minutes
   - Risk: LOW (CSS change)

---

## 🔄 Rollback Plan

### If Error State Breaks

**Symptoms**: Circular dependency errors, infinite re-renders

**Rollback Steps**:

1. Remove `_error` signal from both facades
2. Remove `error` computed accessor
3. Remove `this._error.set()` calls in fetch/catch/clearCache
4. Restore original catch blocks (no error state setting)

**Verification**: `nx test core` passes, no console errors

---

### If Session Monitoring Breaks

**Symptoms**: Infinite cache clears, console spam, performance issues

**Rollback Steps**:

1. Comment out session monitoring effect in ChatInputComponent
2. Keep clearCache() methods (no harm, just not called automatically)

**Code**:

```typescript
// effect(() => {
//   const activeTab = this.chatStore.activeTab();
//   if (activeTab) {
//     this.commandDiscovery.clearCache();
//     this.agentDiscovery.clearCache();
//   }
// }, { allowSignalWrites: true });
```

**Verification**: Manual cache testing (type `/` twice → cache hit)

---

### If Host Object Migration Breaks

**Symptoms**: Keyboard navigation stops working, events not firing

**Rollback Steps**:

1. Re-add `HostListener` import to line 6
2. Remove `host` object from @Component decorator
3. Re-add `@HostListener('document:keydown', ['$event'])` decorator to onKeyDown method

**Verification**: Keyboard navigation works (ArrowUp/Down/Enter/Escape)

---

## 📈 Expected Outcomes

### Before Fixes

**Issues**:

- ❌ Cache never invalidates on session change (stale data)
- ❌ RPC failures show empty dropdown (no error feedback)
- ❌ Rapid triggers send duplicate RPCs (< 90% reduction)
- ❌ @HostListener pattern violation (Angular 20+ compliance)
- ❌ Debug stack traces in production logs
- ❌ Inconsistent logging between facades
- ❌ Badge color collision (primary used for 2 purposes)

**User Experience**:

- User switches sessions → sees old commands (confusion)
- Network fails → empty dropdown (no recovery)
- Rapid typing → duplicate RPCs (performance waste)

---

### After Fixes

**Improvements**:

- ✅ Cache clears on session change (fresh data)
- ✅ Error state exposed (retry mechanism ready)
- ✅ Race condition prevented (90%+ RPC reduction guaranteed)
- ✅ Angular 20+ pattern compliance (host object)
- ✅ Clean production logs (no stack traces)
- ✅ Consistent logging (debugging parity)
- ✅ Clear badge semantics (accent for scope)

**User Experience**:

- User switches sessions → fresh commands (correct)
- Network fails → error state available (future: retry button)
- Rapid typing → 1 RPC call (performance maintained)
- Keyboard navigation → works identically (no regression)

---

## 📚 References

**Review Documents**:

- review-issues-summary.md (issue prioritization)
- code-style-review.md (pattern violations, logging issues)
- code-logic-review.md (cache invalidation, error handling, race conditions)

**Codebase Evidence**:

- command-discovery.facade.ts:1-134 (command caching implementation)
- agent-discovery.facade.ts:1-97 (agent caching implementation)
- chat-input.component.ts:527-549 (existing effect pattern)
- unified-suggestions-dropdown.component.ts:202-251 (keyboard navigation)

**Angular Best Practices**:

- Angular 20+ signals API (signal, computed, effect)
- Angular 20+ @Component host object (replaces @HostListener)
- Angular 20+ effect with allowSignalWrites (circular dependency prevention)

---

**Document Version**: 1.0
**Created**: 2025-12-04
**Software Architect**: AI Agent
**Task ID**: TASK_2025_042
**Status**: ✅ Architecture Complete - Ready for Frontend-Developer Implementation
