# Development Tasks - TASK_2025_042

**Total Tasks**: 8 | **Batches**: 4 | **Status**: 0/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- Signal-based state exists: ✅ Verified in command-discovery.facade.ts:17-18, agent-discovery.facade.ts:16-17
- RPC methods exist: ✅ Verified autocomplete:commands and autocomplete:agents
- DaisyUI badge classes: ✅ Verified in unified-suggestions-dropdown.component.ts:124-127
- Template structure: ✅ Verified layout matches architect's expectations

### Risks Identified

| Risk                                                      | Severity | Mitigation                                                   |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| Simultaneous fetchCommands() calls might both trigger RPC | LOW      | Acceptable for first load, rare occurrence                   |
| Cache marked valid on empty RPC response                  | MEDIUM   | Task 1.1 - Only set \_isCached=true on successful data fetch |
| Dropdown performance with 50+ items                       | LOW      | Existing max-h-80 and browser scrolling handle this          |
| No session change monitoring                              | LOW      | Marked as future enhancement in implementation plan          |

### Edge Cases to Handle

- [ ] Empty RPC response → Don't mark cache as valid (Task 1.1, 2.1)
- [✅] Large item count (50+) → Existing scrolling handles this
- [✅] Keyboard navigation with many items → Existing modulo logic works

---

## Batch 1: Command Caching Enhancement 🔄 IN PROGRESS

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None

### Task 1.1: Add client-side caching to CommandDiscoveryFacade 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts
**Spec Reference**: implementation-plan.md:105-203 (Component 1)
**Pattern to Follow**: Existing signal pattern at lines 17-21

**Quality Requirements**:

- Cache hit must skip RPC call entirely (zero network overhead)
- Cache miss must fetch from backend and mark as cached
- Only set \_isCached=true on successful data fetch (not on empty response)
- Provide clearCache() method for session invalidation

**Validation Notes**:

- RISK: Cache might be marked valid on empty RPC response
  - MITIGATION: Only set `this._isCached.set(true)` when `result.data?.commands` exists and has length > 0
- EDGE CASE: Empty RPC response should not mark cache as valid

**Implementation Details**:

- Add `private readonly _isCached = signal(false);` after line 18
- Add `readonly isCached = computed(() => this._isCached());` after line 21
- Add cache check at start of fetchCommands() (line 26):
  ```typescript
  if (this._isCached()) {
    console.log('[CommandDiscoveryFacade] Cache hit, skipping RPC');
    return;
  }
  ```
- After successful fetch (line 46), add:
  ```typescript
  if (result.data.commands.length > 0) {
    this._isCached.set(true);
  }
  ```
- Add clearCache() method at end of class:
  ```typescript
  clearCache(): void {
    this._isCached.set(false);
    this._commands.set([]);
    console.log('[CommandDiscoveryFacade] Cache cleared');
  }
  ```

**Acceptance Criteria**:

- [ ] \_isCached signal added with initial value false
- [ ] isCached computed accessor added
- [ ] fetchCommands() checks cache and returns early on cache hit
- [ ] \_isCached set to true only after successful fetch with data
- [ ] clearCache() method resets both \_isCached and \_commands signals
- [ ] Console logs show cache hit/miss behavior

---

### Task 1.2: Remove arbitrary item limits from CommandDiscoveryFacade.searchCommands() 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts
**Dependencies**: Task 1.1
**Spec Reference**: implementation-plan.md:153-165 (searchCommands method)

**Quality Requirements**:

- searchCommands() must return ALL matching items (no limits)
- Empty query must return all cached commands (no 10-item limit)
- Query filtering must return all matches (no 20-item limit)

**Implementation Details**:

- Line 76: Change `return allCommands.slice(0, 10);` to `return allCommands;`
- Line 88: Remove `.slice(0, 20)` from filter return statement

**Acceptance Criteria**:

- [ ] Empty query returns ALL cached commands (no slice)
- [ ] Query filtering returns ALL matching commands (no slice)
- [ ] Console logs updated to reflect "all commands" instead of "top 10 commands"

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build core`
- Cache behavior verified with console logs
- No 10/20 item limits in searchCommands()

---

## Batch 2: Agent Caching Enhancement 🔄 IN PROGRESS

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 complete (pattern established)

### Task 2.1: Add client-side caching to AgentDiscoveryFacade 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
**Spec Reference**: implementation-plan.md:206-302 (Component 2)
**Pattern to Follow**: Task 1.1 (CommandDiscoveryFacade caching pattern)

**Quality Requirements**:

- Identical to Task 1.1 (agents instead of commands)
- Cache hit must skip RPC call entirely
- Only set \_isCached=true on successful data fetch (not on empty response)
- Provide clearCache() method

**Validation Notes**:

- RISK: Same cache validation risk as commands
  - MITIGATION: Only set `this._isCached.set(true)` when `result.data?.agents` exists and has length > 0

**Implementation Details**:

- Add `private readonly _isCached = signal(false);` after line 17
- Add `readonly isCached = computed(() => this._isCached());` after line 20
- Add cache check at start of fetchAgents() (line 25):
  ```typescript
  if (this._isCached()) {
    console.log('[AgentDiscoveryFacade] Cache hit, skipping RPC');
    return;
  }
  ```
- After successful fetch (line 48), add:
  ```typescript
  if (result.data.agents.length > 0) {
    this._isCached.set(true);
  }
  ```
- Add clearCache() method at end of class:
  ```typescript
  clearCache(): void {
    this._isCached.set(false);
    this._agents.set([]);
    console.log('[AgentDiscoveryFacade] Cache cleared');
  }
  ```

**Acceptance Criteria**:

- [ ] \_isCached signal added with initial value false
- [ ] isCached computed accessor added
- [ ] fetchAgents() checks cache and returns early on cache hit
- [ ] \_isCached set to true only after successful fetch with data
- [ ] clearCache() method resets both \_isCached and \_agents signals
- [ ] Console logs show cache hit/miss behavior

---

### Task 2.2: Remove arbitrary item limits from AgentDiscoveryFacade.searchAgents() 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\agent-discovery.facade.ts
**Dependencies**: Task 2.1
**Spec Reference**: implementation-plan.md:253-264 (searchAgents method)

**Quality Requirements**:

- searchAgents() must return ALL matching items (no limits)
- Empty query must return all cached agents (no 10-item limit)
- Query filtering must return all matches (no 20-item limit)

**Implementation Details**:

- Line 66: Change `return this._agents().slice(0, 10);` to `return this._agents();`
- Line 76: Remove `.slice(0, 20)` from filter return statement

**Acceptance Criteria**:

- [ ] Empty query returns ALL cached agents (no slice)
- [ ] Query filtering returns ALL matching agents (no slice)

---

**Batch 2 Verification**:

- All files exist at paths
- Build passes: `npx nx build core`
- Cache behavior verified with console logs
- No 10/20 item limits in searchAgents()

---

## Batch 3: Visual Badge Enhancement 🔄 IN PROGRESS

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None (independent of caching)

### Task 3.1: Add DaisyUI badge wrappers for command names 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\unified-suggestions-dropdown.component.ts
**Spec Reference**: implementation-plan.md:305-378 (Component 3)
**Pattern to Follow**: Existing badge usage at lines 122-128

**Quality Requirements**:

- Command names must display with badge-primary class (lapis blue)
- Description must remain muted (text-base-content/60)
- Scope badges must remain unchanged (existing lines 122-128)
- NO TypeScript changes (template only)

**Implementation Details**:
Replace lines 114-121 with badge wrappers:

**BEFORE** (lines 114-121):

```html
<div class="flex-1 min-w-0">
  <div class="font-medium text-sm truncate">{{ getName(suggestion) }}</div>
  <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
</div>
```

**AFTER** (enhanced with badges):

```html
<!-- Badge wrapper based on suggestion type (commands only for this task) -->
@if (suggestion.type === 'command') {
<span class="badge badge-sm badge-primary">{{ getName(suggestion) }}</span>
} @if (suggestion.type !== 'command') {
<div class="font-medium text-sm truncate">{{ getName(suggestion) }}</div>
}

<!-- Description only -->
<div class="flex-1 min-w-0">
  <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
</div>
```

**Acceptance Criteria**:

- [ ] Command names wrapped in badge-primary badge
- [ ] Agent and file names remain unchanged (keep original 2-line layout)
- [ ] Description text remains muted (text-base-content/60)
- [ ] Scope badges unchanged (lines 122-128)
- [ ] NO TypeScript class changes

---

### Task 3.2: Add DaisyUI badge wrappers for agent and file names 🔄 IMPLEMENTED

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\file-suggestions\unified-suggestions-dropdown.component.ts
**Dependencies**: Task 3.1
**Spec Reference**: implementation-plan.md:336-351 (badge wrappers for all types)

**Quality Requirements**:

- Agent names must display with badge-secondary class (pharaoh gold)
- File names must display with badge-ghost class (transparent, border only)
- Layout consistent across all types

**Implementation Details**:
Update the badge wrapper section from Task 3.1 to include all types:

```html
<!-- Badge wrapper based on suggestion type -->
@if (suggestion.type === 'command') {
<span class="badge badge-sm badge-primary">{{ getName(suggestion) }}</span>
} @if (suggestion.type === 'agent') {
<span class="badge badge-sm badge-secondary">{{ getName(suggestion) }}</span>
} @if (suggestion.type === 'file') {
<span class="badge badge-sm badge-ghost">{{ getName(suggestion) }}</span>
}

<!-- Description only -->
<div class="flex-1 min-w-0">
  <div class="text-xs text-base-content/60 truncate">{{ getDescription(suggestion) }}</div>
</div>
```

**Acceptance Criteria**:

- [ ] Command names wrapped in badge-primary (lapis blue)
- [ ] Agent names wrapped in badge-secondary (pharaoh gold)
- [ ] File names wrapped in badge-ghost (transparent, border)
- [ ] All badges use badge-sm size
- [ ] Consistent layout across all types

---

**Batch 3 Verification**:

- All files exist at paths
- Build passes: `npx nx build chat`
- Visual verification: Command badges lapis blue, agent badges gold, file badges ghost
- Keyboard navigation still works (ArrowUp/Down/Enter/Escape)
- Scope badges remain unchanged

---

## Batch 4: Integration Testing & Documentation ⏸️ PENDING

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1, 2, 3 complete

### Task 4.1: Manual testing of caching behavior ⏸️ PENDING

**File**: MANUAL TESTING (no file changes)
**Spec Reference**: implementation-plan.md:955-1023 (Manual Test Scenarios)

**Test Scenarios**:

1. **Command Caching Flow**:

   - Type `/` in chat input
   - VERIFY: Loading spinner appears briefly (< 500ms)
   - VERIFY: Dropdown shows all commands (> 10 items if available)
   - VERIFY: Console log shows "autocomplete:commands RPC called"
   - Close dropdown (Escape)
   - Type `/` again
   - VERIFY: No loading spinner (instant display)
   - VERIFY: Console log shows "Cache hit, skipping RPC"

2. **Agent Caching Flow**:

   - Type `@` in chat input
   - VERIFY: Loading spinner appears briefly
   - VERIFY: Console log shows "autocomplete:agents RPC called"
   - Close dropdown
   - Type `@` again
   - VERIFY: Console log shows "Cache hit, skipping RPC"

3. **Query Filtering (No RPC)**:

   - Type `/` (cache populated)
   - Type `/orch` (query: "orch")
   - VERIFY: Dropdown filters to matching commands
   - VERIFY: Console log shows NO RPC call (client-side filtering)

4. **Show All Items (No 10-Item Limit)**:
   - Type `/` with no query
   - VERIFY: Dropdown shows more than 10 commands (if available)
   - VERIFY: Vertical scrolling enabled if > 8 items

**Acceptance Criteria**:

- [ ] First trigger calls RPC (verified in console)
- [ ] Second trigger uses cache (verified in console)
- [ ] Query filtering is client-side (no RPC)
- [ ] All items displayed (no 10/20 limit)
- [ ] Dropdown scrolls with 10+ items

---

### Task 4.2: Manual testing of visual badge enhancements ⏸️ PENDING

**File**: MANUAL TESTING (no file changes)
**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md:980-1002 (Visual Badge Verification)

**Test Scenarios**:

1. **Visual Badge Verification**:

   - Type `/` in chat input
   - VERIFY: Each command name wrapped in lapis blue badge
   - VERIFY: Description text is muted gray (60% opacity)
   - VERIFY: Scope badges remain gold (badge-accent, unchanged)
   - Hover over command item
   - VERIFY: Background lightens, badge color unchanged

2. **Agent Badge Verification**:

   - Type `@` in chat input
   - VERIFY: Each agent name wrapped in pharaoh gold badge
   - VERIFY: Scope badges remain lapis blue (badge-primary, unchanged)

3. **File Badge Verification**:

   - Type `@` in chat input
   - Click "Files" tab
   - VERIFY: Each file name wrapped in ghost badge (transparent, border only)

4. **Keyboard Navigation**:
   - Press ArrowDown/ArrowUp
   - VERIFY: Focus moves correctly
   - VERIFY: Focused item scrolls into view

**Acceptance Criteria**:

- [ ] Command badges are lapis blue (badge-primary)
- [ ] Agent badges are pharaoh gold (badge-secondary)
- [ ] File badges are ghost (badge-ghost)
- [ ] Scope badges remain unchanged
- [ ] Keyboard navigation works correctly
- [ ] Hover states work correctly

---

**Batch 4 Verification**:

- All manual test scenarios passed
- Console logs verified for cache behavior
- Visual verification for badge colors and layout
- Keyboard navigation verified
- Ready for code review

---

## Commit Message Templates

**Batch 1 Commit**:

```
feat(core): add client-side caching for command autocomplete

- Add _isCached signal to CommandDiscoveryFacade
- Add cache check in fetchCommands() to skip redundant RPC calls
- Remove arbitrary 10/20 item limits from searchCommands()
- Add clearCache() method for cache invalidation

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch 2 Commit**:

```
feat(core): add client-side caching for agent autocomplete

- Add _isCached signal to AgentDiscoveryFacade
- Add cache check in fetchAgents() to skip redundant RPC calls
- Remove arbitrary 10/20 item limits from searchAgents()
- Add clearCache() method for cache invalidation

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch 3 Commit**:

```
feat(chat): add DaisyUI badge wrappers for autocomplete suggestions

- Wrap command names in badge-primary (lapis blue)
- Wrap agent names in badge-secondary (pharaoh gold)
- Wrap file names in badge-ghost (transparent, border)
- Maintain existing scope badges unchanged

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Batch 4 Commit** (if documentation changes):

```
docs(task): add manual testing results for TASK_2025_042

- Document cache behavior verification
- Document visual badge verification
- Confirm all acceptance criteria met

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

**Document Version**: 1.0
**Created**: 2025-12-04
**Team Leader**: AI Agent
**Task ID**: TASK_2025_042
**Status**: ⏸️ PENDING - Ready for Batch 1 Assignment
