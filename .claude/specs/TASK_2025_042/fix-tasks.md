# Fix Tasks - TASK_2025_042

**Total Tasks**: 17 | **Batches**: 5 | **Status**: 0/5 complete

---

## Plan Validation Summary

**Validation Status**: ✅ PASSED WITH RISKS

### Assumptions Verified

- ✅ `_isLoading` signal exists in both facades
- ✅ `_isCached` signal exists in both facades
- ✅ `clearCache()` methods exist in both facades
- ✅ `chatStore.activeTab()` signal exists in ChatInputComponent
- ✅ Effect pattern exists in chat-input.component.ts (lines 537-559)
- ✅ HostListener pattern exists in unified-suggestions-dropdown.component.ts (line 6)

### Risks Identified

| Risk                                                      | Severity | Mitigation                                                    |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------- |
| Host object keyboard events may not fire correctly        | MEDIUM   | Test keyboard navigation thoroughly; rollback plan documented |
| Session change effect may fire before facades initialized | LOW      | clearCache() is safe to call anytime                          |
| Debug stack trace removal might make debugging harder     | LOW      | Keep other logs for traceability                              |

### Edge Cases to Handle

- ✅ Empty query returns all items (already handled)
- ✅ Network failure sets error signal (catch blocks)
- ✅ Cache invalidation during RPC is safe (finally block)

---

## Batch F1: Error State Management (Both Facades) 🔄 IN PROGRESS

**Developer**: frontend-developer
**Tasks**: 7 | **Dependencies**: None
**Priority**: CRITICAL

### Task F1.1: Add Error Signal to CommandDiscoveryFacade 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:161-178
**Pattern to Follow**: command-discovery.facade.ts:17-23

**Quality Requirements**:

- Error signal must be `signal<string | null>(null)`
- Expose computed accessor `readonly error = computed(() => this._error())`
- Must match AgentDiscoveryFacade pattern for consistency

**Validation Notes**:

- Risk: New state management, potential circular dependencies
- Edge case: Error signal must be nullable (null = no error)

**Implementation Details**:

- Line 18-19: Add `private readonly _error = signal<string | null>(null);` after `_isCached`
- Line 23-24: Add `readonly error = computed(() => this._error());` after `isCached` computed

**Acceptance Criteria**:

- ✅ `_error` signal declared with correct type
- ✅ `error` computed accessor exposed publicly
- ✅ TypeScript compilation passes

---

### Task F1.2: Add Error Signal to AgentDiscoveryFacade 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:316-331
**Dependencies**: Task F1.1 (same pattern)

**Quality Requirements**:

- Must match CommandDiscoveryFacade error signal pattern exactly
- Error signal must be `signal<string | null>(null)`
- Expose computed accessor `readonly error = computed(() => this._error())`

**Validation Notes**:

- Risk: New state management
- Consistency: Must match F1.1 implementation

**Implementation Details**:

- Line 17-18: Add `private readonly _error = signal<string | null>(null);` after `_isCached`
- Line 22-23: Add `readonly error = computed(() => this._error());` after `isCached` computed

**Acceptance Criteria**:

- ✅ `_error` signal declared with correct type
- ✅ `error` computed accessor exposed publicly
- ✅ Pattern matches CommandDiscoveryFacade exactly

---

### Task F1.3: Set Error on CommandDiscoveryFacade Fetch Start 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:256-268
**Dependencies**: Task F1.1

**Quality Requirements**:

- Clear previous error state on new fetch attempt
- Must happen after `_isLoading.set(true)`
- Must happen before RPC call

**Implementation Details**:

- Line 40: Add `this._error.set(null);` after `this._isLoading.set(true);`

**Acceptance Criteria**:

- ✅ Error cleared on fetch start
- ✅ Logs show "fetchCommands called" before error clear
- ✅ No impact on existing RPC logic

---

### Task F1.4: Set Error on AgentDiscoveryFacade Fetch Start 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:383-393
**Dependencies**: Task F1.2, Task F1.3 (same pattern)

**Quality Requirements**:

- Must match CommandDiscoveryFacade error clearing pattern
- Clear previous error state on new fetch attempt

**Implementation Details**:

- Line 35: Add `this._error.set(null);` after `this._isLoading.set(true);`

**Acceptance Criteria**:

- ✅ Error cleared on fetch start
- ✅ Pattern matches CommandDiscoveryFacade

---

### Task F1.5: Set Error on CommandDiscoveryFacade Catch Block 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:228-253
**Dependencies**: Task F1.1, Task F1.3

**Quality Requirements**:

- Extract error message from Error object or use fallback
- Log full error object for debugging
- Set empty array on failure (existing behavior)

**Implementation Details**:

- Lines 69-74: Modify catch block
- BEFORE: `console.error(...); this._commands.set([]);`
- AFTER:
  ```typescript
  const message = error instanceof Error ? error.message : 'Failed to fetch commands';
  this._error.set(message);
  console.error('[CommandDiscoveryFacade] Failed to fetch commands:', error);
  this._commands.set([]);
  ```

**Acceptance Criteria**:

- ✅ Error message extracted correctly
- ✅ Error signal set with message
- ✅ Full error object logged for debugging
- ✅ Empty array set on failure

---

### Task F1.6: Set Error on AgentDiscoveryFacade Catch Block 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:359-379
**Dependencies**: Task F1.2, Task F1.4, Task F1.5 (same pattern)

**Quality Requirements**:

- Must match CommandDiscoveryFacade error handling pattern
- Extract error message from Error object or use fallback

**Implementation Details**:

- Lines 65-68: Modify catch block
- AFTER:
  ```typescript
  const message = error instanceof Error ? error.message : 'Failed to fetch agents';
  this._error.set(message);
  console.error('[AgentDiscoveryFacade] Failed to fetch agents:', error);
  this._agents.set([]);
  ```

**Acceptance Criteria**:

- ✅ Error message extracted correctly
- ✅ Error signal set with message
- ✅ Pattern matches CommandDiscoveryFacade

---

### Task F1.7: Clear Error on Cache Invalidation (Both Facades) 🔄 IMPLEMENTED

**File**:

- D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts
- D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
  **Spec Reference**: review-fixes-plan.md:283-304, 450-471
  **Dependencies**: Task F1.1, Task F1.2

**Quality Requirements**:

- Clear error state in clearCache() method
- Must happen alongside cache flag and data clear
- Defensive programming (safe to call anytime)

**Implementation Details**:

- CommandDiscoveryFacade line 130: Add `this._error.set(null);` after `this._commands.set([]);`
- AgentDiscoveryFacade line 94: Add `this._error.set(null);` after `this._agents.set([]);`

**Acceptance Criteria**:

- ✅ Error cleared in both clearCache() methods
- ✅ Logs show "Cache cleared" after error clear
- ✅ Safe to call clearCache() at any time

---

**Batch F1 Verification**:

- ✅ All files have error signals with correct types
- ✅ Error set on RPC failure (catch blocks)
- ✅ Error cleared on fetch start
- ✅ Error cleared on cache invalidation
- ✅ Build passes: `npx nx build core`
- ✅ Consistent patterns across both facades

---

## Batch F2: Race Condition Prevention (Both Facades) 🔄 IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch F1 (error signals)
**Priority**: CRITICAL

### Task F2.1: Add Loading Check to CommandDiscoveryFacade 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:181-204
**Pattern to Follow**: command-discovery.facade.ts:30-32 (existing cache check)

**Quality Requirements**:

- Add early return if `_isLoading()` is true
- Must prevent duplicate in-flight RPC requests
- Must log "Request in-flight, skipping duplicate"

**Validation Notes**:

- Risk: Must not break cache hit path
- Edge case: Rapid triggers within 500ms debounce window

**Implementation Details**:

- Lines 33-34: Add after cache check, before log
  ```typescript
  // NEW: Prevent duplicate in-flight requests
  if (this._isLoading()) {
    console.log('[CommandDiscoveryFacade] Request in-flight, skipping duplicate');
    return;
  }
  ```

**Acceptance Criteria**:

- ✅ Loading check added after cache check
- ✅ Early return prevents duplicate RPC
- ✅ Log shows "Request in-flight, skipping duplicate"
- ✅ Cache hit path still works (cache check first)

---

### Task F2.2: Add Loading Check to AgentDiscoveryFacade 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:336-355
**Dependencies**: Task F2.1 (same pattern)

**Quality Requirements**:

- Must match CommandDiscoveryFacade loading check pattern
- Add early return if `_isLoading()` is true

**Implementation Details**:

- Lines 32-33: Add after cache check, before `_isLoading.set(true)`
  ```typescript
  // NEW: Prevent duplicate in-flight requests
  if (this._isLoading()) {
    console.log('[AgentDiscoveryFacade] Request in-flight, skipping duplicate');
    return;
  }
  ```

**Acceptance Criteria**:

- ✅ Loading check added after cache check
- ✅ Pattern matches CommandDiscoveryFacade
- ✅ Log shows "Request in-flight, skipping duplicate"

---

### Task F2.3: Remove Debug Stack Trace from CommandDiscoveryFacade 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:206-225
**Dependencies**: Task F2.1

**Quality Requirements**:

- Remove `new Error().stack` from console.log
- Keep log message for traceability
- Production code cleanup (no debug artifacts)

**Validation Notes**:

- Risk: Might make debugging harder (LOW - other logs remain)

**Implementation Details**:

- Lines 35-38: Modify existing log
- BEFORE: `console.log('[CommandDiscoveryFacade] fetchCommands called', new Error().stack);`
- AFTER: `console.log('[CommandDiscoveryFacade] fetchCommands called');`

**Acceptance Criteria**:

- ✅ Stack trace removed
- ✅ Log message kept for traceability
- ✅ No performance overhead from Error object creation

---

**Batch F2 Verification**:

- ✅ All files have loading checks
- ✅ Race condition prevented (rapid triggers)
- ✅ Debug stack trace removed
- ✅ Build passes: `npx nx build core`
- ✅ Test race condition: Type `/` twice rapidly, only 1 RPC call

---

## Batch F3: Session Monitoring (ChatInputComponent) 🔄 IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 1 | **Dependencies**: Batch F1 (clearCache methods need error clear)
**Priority**: CRITICAL

### Task F3.1: Add Session Change Monitoring Effect 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input.component.ts
**Spec Reference**: review-fixes-plan.md:481-521
**Pattern to Follow**: chat-input.component.ts:537-559 (existing effect)

**Quality Requirements**:

- Use effect() to monitor chatStore.activeTab()
- Clear both caches atomically on session change
- Use `allowSignalWrites: true` to prevent circular dependencies
- Log session changes for debugging

**Validation Notes**:

- Risk: Effect may fire before facades initialized (LOW - clearCache is safe)
- Risk: Session change timing issues (MEDIUM - use allowSignalWrites)
- Edge case: Session change during RPC call (handled by clearCache safety)

**Implementation Details**:

- Lines 550-565: Add after existing effect (after line 559)

  ```typescript
  // NEW: Session change monitoring - clear caches on session change
  effect(
    () => {
      const activeTab = this.chatStore.activeTab();

      if (activeTab) {
        // Clear both autocomplete caches when session changes
        this.commandDiscovery.clearCache();
        this.agentDiscovery.clearCache();

        console.log('[ChatInputComponent] Session changed, caches cleared', {
          sessionId: activeTab.id,
        });
      }
    },
    { allowSignalWrites: true }
  );
  ```

**Acceptance Criteria**:

- ✅ Effect added to constructor
- ✅ Monitors chatStore.activeTab() signal
- ✅ Calls clearCache() on both facades
- ✅ Uses allowSignalWrites: true
- ✅ Logs session change with session ID
- ✅ No circular dependency errors

---

**Batch F3 Verification**:

- ✅ Session change effect works correctly
- ✅ Cache cleared on session switch
- ✅ Logs show "Session changed, caches cleared"
- ✅ Build passes: `npx nx build chat`
- ✅ Test: Switch sessions, verify cache cleared (RPC called, not "Cache hit")

---

## Batch F4: Pattern Migrations (Component + Facade) 🔄 IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: None (independent fixes)
**Priority**: HIGH (HostListener blocking), MEDIUM (badge color)

### Task F4.1: Migrate @HostListener to Host Object 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\unified-suggestions-dropdown.component.ts
**Spec Reference**: review-fixes-plan.md:530-598
**Pattern to Follow**: Angular 20+ best practices (host object)

**Quality Requirements**:

- Remove `HostListener` import from @angular/core
- Add `host` object to @Component decorator
- Remove `@HostListener` decorator from onKeyDown method
- Keep onKeyDown method implementation unchanged
- Test keyboard navigation thoroughly

**Validation Notes**:

- Risk: Keyboard events may not fire correctly (MEDIUM)
- Rollback plan: Documented in review-fixes-plan.md:1108-1119
- Edge case: document-level events may behave differently

**Implementation Details**:

1. Line 6: Remove `HostListener` from imports

   - BEFORE: `import { Component, input, output, signal, HostListener, ChangeDetectionStrategy } from '@angular/core';`
   - AFTER: `import { Component, input, output, signal, ChangeDetectionStrategy } from '@angular/core';`

2. Lines 42-48: Add host object to @Component decorator

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
   ```

3. Line 202: Remove @HostListener decorator

   - BEFORE: `@HostListener('document:keydown', ['$event'])`
   - AFTER: (just remove decorator, keep method)

4. onKeyDown method: NO CHANGES (keep existing implementation)

**Acceptance Criteria**:

- ✅ HostListener import removed
- ✅ host object added to @Component
- ✅ @HostListener decorator removed
- ✅ onKeyDown method unchanged
- ✅ Build passes: `npx nx build chat`
- ✅ Keyboard navigation works (ArrowUp, ArrowDown, Enter, Escape, Tab)

---

### Task F4.2: Test Keyboard Navigation Still Works 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\unified-suggestions-dropdown.component.ts
**Spec Reference**: review-fixes-plan.md:530-598
**Dependencies**: Task F4.1

**Quality Requirements**:

- Keyboard navigation must work identically after migration
- All keys tested: ArrowUp, ArrowDown, Enter, Escape, Tab

**Acceptance Criteria**:

- ✅ @HostListener migration complete
- ✅ onKeyDown method unchanged
- ✅ Keyboard navigation preserved

---

### Task F4.3: Remove \_focusedIndex Signal Mutation in Event Handler 🔄 IMPLEMENTED

**Note**: Task not required - no signal mutation issue found in event handler

---

### Task F4.4: Update onKeyDown to Use Event Parameter Directly 🔄 IMPLEMENTED

**Note**: Task already satisfied - onKeyDown uses event parameter directly

---

### Task F4.2: Fix Badge Color Collision 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\unified-suggestions-dropdown.component.ts
**Spec Reference**: review-fixes-plan.md:601-632
**Dependencies**: None

**Quality Requirements**:

- Change agent scope badge from `badge-primary` to `badge-accent`
- Maintain visual distinction between command/agent names and scope badges
- Keep command scope badges consistent

**Validation Notes**:

- Risk: LOW (CSS-only change)
- Edge case: None (purely visual)

**Implementation Details**:

- Line 138: Change badge class
- BEFORE: `<span class="badge badge-primary badge-sm">Built-in</span>`
- AFTER: `<span class="badge badge-accent badge-sm">Built-in</span>`

**Context**: Color mapping after fix:

- Command names: `badge-primary` (lapis blue)
- Agent names: `badge-secondary` (pharaoh gold)
- File names: `badge-ghost` (transparent)
- **Scope badges (all types)**: `badge-accent` (distinct from names)

**Acceptance Criteria**:

- ✅ Agent scope badge uses badge-accent
- ✅ Command scope badge uses badge-accent
- ✅ Visual distinction between names and scope badges
- ✅ Build passes: `npx nx build chat`

---

**Batch F4 Verification**:

- ✅ @HostListener migrated to host object
- ✅ Keyboard navigation works correctly
- ✅ Badge colors distinct (no collision)
- ✅ Build passes: `npx nx build chat`
- ✅ Visual inspection: Scope badges use accent color

---

## Batch F5: Logging & Styling Consistency 🔄 IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None
**Priority**: LOW (code quality improvements)

### Task F5.1: Add Consistent Logging to AgentDiscoveryFacade 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:395-447
**Pattern to Follow**: command-discovery.facade.ts:85-107 (searchCommands logging)

**Quality Requirements**:

- Add logging to searchAgents() method
- Match CommandDiscoveryFacade logging structure exactly
- Log: query, total count, result count
- Use consistent log prefix format: `[AgentDiscoveryFacade]`

**Implementation Details**:

- Lines 76-87: Modify searchAgents method
- BEFORE (silent search):

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

- AFTER (consistent logging):

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

**Acceptance Criteria**:

- ✅ searchAgents has 3 logs (called, all agents, filtered results)
- ✅ Log structure matches CommandDiscoveryFacade
- ✅ Log prefix: `[AgentDiscoveryFacade]`
- ✅ Build passes: `npx nx build core`

---

### Task F5.2: Add Entry Log to AgentDiscoveryFacade.fetchAgents 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
**Spec Reference**: review-fixes-plan.md:336-355
**Dependencies**: None

**Quality Requirements**:

- Add entry log to fetchAgents() method
- Match CommandDiscoveryFacade entry log pattern
- Must appear after cache check, before loading state set

**Implementation Details**:

- Line 34: Add log before `_isLoading.set(true)`
  ```typescript
  console.log('[AgentDiscoveryFacade] fetchAgents called');
  ```

**Acceptance Criteria**:

- ✅ Entry log added
- ✅ Log appears after cache check
- ✅ Pattern matches CommandDiscoveryFacade
- ✅ Build passes: `npx nx build core`

---

**Batch F5 Verification**:

- ✅ AgentDiscoveryFacade logging matches CommandDiscoveryFacade
- ✅ All logs have consistent format
- ✅ Build passes: `npx nx build core`
- ✅ Console logs show consistent debugging output

---

## Git Commit Standards

**Commit Type**: `fix` (these are fixes to existing implementation)
**Scope**: `webview` (frontend changes)

**Commit Message Templates**:

**Batch F1**:

```bash
git commit -m "$(cat <<'EOF'
fix(webview): add error state management to autocomplete facades

- Add error signals to CommandDiscoveryFacade and AgentDiscoveryFacade
- Set error on RPC failure with user-friendly messages
- Clear error on fetch start and cache invalidation
- Expose error computed accessors for UI feedback

Addresses code review issue: RPC failures show empty dropdown with no recovery

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**Batch F2**:

```bash
git commit -m "$(cat <<'EOF'
fix(webview): prevent race conditions in autocomplete RPC calls

- Add loading state checks to prevent duplicate in-flight requests
- Remove debug stack trace from production logs
- Maintain 90%+ RPC call reduction guarantee

Addresses code review issue: Rapid triggers may send duplicate RPC calls

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**Batch F3**:

```bash
git commit -m "$(cat <<'EOF'
fix(webview): implement session change cache invalidation

- Add effect to monitor session changes via chatStore.activeTab()
- Clear both autocomplete caches atomically on session switch
- Prevent stale commands/agents from previous sessions

Addresses code review issue: Cache never invalidates on session change

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**Batch F4**:

```bash
git commit -m "$(cat <<'EOF'
fix(webview): migrate @HostListener to host object and fix badge colors

- Migrate UnifiedSuggestionsDropdown to Angular 20+ host object pattern
- Fix badge color collision (scope badges now use badge-accent)
- Maintain keyboard navigation behavior

Addresses code review issues: @HostListener pattern violation, badge color collision

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

**Batch F5**:

```bash
git commit -m "$(cat <<'EOF'
fix(webview): add consistent logging to AgentDiscoveryFacade

- Add logging to searchAgents() matching CommandDiscoveryFacade pattern
- Add entry log to fetchAgents() for debugging parity
- Improve debugging experience with consistent log format

Addresses code review issue: Inconsistent logging between facades

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Testing Strategy

### Test 1: Error State Management

1. Simulate network failure (disconnect WiFi)
2. Type `/` → verify error signal set
3. Check console for error log
4. Reconnect WiFi
5. Type `/` again → verify error cleared, RPC succeeds

**Expected**: Error exposed via signal, cleared on retry

### Test 2: Race Condition Prevention

1. Clear cache: `commandDiscovery.clearCache()`
2. Type `/` twice rapidly (within 500ms)
3. Check console for "Request in-flight, skipping duplicate"
4. Check network tab for only 1 RPC call

**Expected**: Only 1 RPC call, second trigger prevented

### Test 3: Session Change Cache Invalidation

1. Open session A, type `/` → commands cached
2. Switch to session B (different project)
3. Type `/` → verify RPC called (not "Cache hit")
4. Check console for "Session changed, caches cleared"

**Expected**: Cache cleared on session switch, fresh RPC call

### Test 4: @HostListener Migration

1. Type `/` → dropdown opens
2. Press ArrowDown → focus moves to next item
3. Press ArrowUp → focus moves to previous item
4. Press Enter → suggestion selected
5. Press Escape → dropdown closes
6. Type `@`, press Tab → category changes

**Expected**: All keyboard navigation works identically to before

### Test 5: Badge Color Distinction

1. Type `/` → dropdown shows commands
2. Verify command name badges are lapis blue (badge-primary)
3. Verify command scope badges are accent color (badge-accent)
4. Type `@` → dropdown shows agents
5. Verify agent name badges are pharaoh gold (badge-secondary)
6. Verify agent scope badges are accent color (badge-accent)

**Expected**: Clear visual distinction between names and scope badges

### Test 6: Logging Consistency

1. Type `@` → trigger agent search
2. Check console for 3 logs: "searchAgents called", "Returning all agents", "Filtered results"
3. Type `@test` → check console for query filtering log
4. Compare with command search logs (should match structure)

**Expected**: Consistent logging format across both facades

---

## Files Affected Summary

### MODIFY (4 files)

1. **libs/frontend/core/src/lib/services/command-discovery.facade.ts**

   - Tasks: F1.1, F1.3, F1.5, F1.7, F2.1, F2.3
   - Risk: HIGH (error state + race condition logic)
   - Changes: 7 modifications across 10 line ranges

2. **libs/frontend/core/src/lib/services/agent-discovery.facade.ts**

   - Tasks: F1.2, F1.4, F1.6, F1.7, F2.2, F5.1, F5.2
   - Risk: HIGH (error state + race condition logic)
   - Changes: 8 modifications across 11 line ranges

3. **libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts**

   - Tasks: F3.1
   - Risk: MEDIUM (session monitoring effect)
   - Changes: 1 effect addition (16 lines)

4. **libs/frontend/chat/src/lib/components/file-suggestions/unified-suggestions-dropdown.component.ts**
   - Tasks: F4.1, F4.2
   - Risk: MEDIUM (@HostListener migration)
   - Changes: 4 modifications (import, host object, decorator removal, badge color)

---

**Document Version**: 1.0
**Created**: 2025-12-04
**Team Leader**: AI Agent
**Task ID**: TASK_2025_042
**Status**: ✅ Decomposition Complete - Ready for Frontend-Developer Implementation
