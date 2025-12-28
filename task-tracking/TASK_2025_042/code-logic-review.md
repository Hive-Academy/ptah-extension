# Code Logic Review - TASK_2025_042

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6.5/10         |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 3              |
| Moderate Issues     | 2              |
| Failure Modes Found | 7              |

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Failure Mode 1: Empty RPC Response Caches "Success" State**

- **Scenario**: Backend returns `{success: true, data: {commands: []}}` (valid response but no data)
- **Current Behavior**: Cache marked valid at line 59-61 ONLY if `length > 0` ✅ (CORRECT)
- **Impact**: Cache NOT marked valid on empty response (good)
- **Assessment**: HANDLED CORRECTLY

**Failure Mode 2: RPC Call Fails, User Sees Empty Dropdown Forever**

- **Scenario**: First `fetchCommands()` call fails with network error
- **Current Behavior**: Lines 69-74 catch error, set `_commands` to empty array, BUT `_isCached` remains false
- **Impact**: Second trigger will retry RPC (good recovery), but user sees no feedback about failure
- **User Experience**: User types `/`, sees loading spinner, then empty dropdown with "No suggestions found"
- **Missing**: Error state signal to distinguish "loading failed" from "no results"
- **Recommendation**: Add `_error` signal to expose error state to UI
- **Severity**: SERIOUS (user confused about why autocomplete isn't working)

**Failure Mode 3: Cache Never Invalidates on Session Change**

- **Scenario**: User switches to different project, commands list should change
- **Current Behavior**: `clearCache()` method exists but is NEVER called
- **Evidence**: No session monitoring in ChatInputComponent or elsewhere
- **Impact**: User sees stale commands from previous project/session
- **Missing**: Session change detection effect (noted as "future enhancement" in architecture)
- **Recommendation**: Document as known limitation OR implement session monitoring
- **Severity**: MODERATE (stale data, not catastrophic)

### 2. What user action causes unexpected behavior?

**Failure Mode 4: Rapid Trigger Spam Before Cache Loads**

- **Scenario**: User types `/`, immediately closes (Escape), types `/` again within 500ms (before first RPC completes)
- **Current Behavior**:
  - First trigger: `_isCached = false`, RPC call initiated
  - Second trigger: `_isCached = false` (still), RPC call initiated AGAIN
- **Race Condition**: Two RPC calls in flight, second response overwrites first
- **Data Flow**:
  ```
  T=0ms:   User types '/' → fetchCommands() → _isCached=false → RPC 1 sent
  T=100ms: User types '/' → fetchCommands() → _isCached=false → RPC 2 sent
  T=300ms: RPC 1 completes → _commands set → _isCached=true
  T=400ms: RPC 2 completes → _commands set AGAIN → _isCached=true
  ```
- **Impact**: Duplicate RPC calls (performance waste), last response wins (potential data inconsistency if RPC ordering changes)
- **Missing**: In-flight request tracking (e.g., `_isLoading` doesn't prevent duplicate calls)
- **Recommendation**: Check `_isLoading` OR `_isCached` in early return
- **Severity**: MODERATE (rare user behavior, wastes RPC calls but doesn't break functionality)

**Failure Mode 5: User Expects Commands to Update After New Slash Command Installed**

- **Scenario**: User installs new project slash command via `.claude/commands/foo.md` file
- **Current Behavior**: Cache never invalidates, new command NOT shown
- **User Experience**: User types `/foo` expecting autocomplete, sees nothing
- **Missing**: File system watcher OR manual refresh mechanism
- **Recommendation**: Add "Refresh Commands" action OR implement file watcher
- **Severity**: SERIOUS (user discovers new commands exist but autocomplete doesn't show them)

### 3. What data makes this produce wrong results?

**Failure Mode 6: Malformed RPC Response with Partial Data**

- **Scenario**: Backend returns `{success: true, data: {commands: [{name: "test", scope: "builtin"}]}}` (missing `description` field)
- **Current Behavior**: Lines 52-57 map response, TypeScript allows undefined `description`
- **Template Impact**: Line 133 in dropdown: `getDescription(suggestion)` returns undefined, rendered as empty string
- **Data Flow Validation**: NO validation that required fields exist
- **Impact**: Commands with missing descriptions appear in dropdown with blank description text
- **Missing**: Runtime validation of RPC response shape
- **Recommendation**: Add Zod schema validation OR runtime checks for required fields
- **Severity**: MODERATE (UI looks broken but doesn't crash)

**Failure Mode 7: Special Characters in Command Names Break Badge Rendering**

- **Scenario**: Command name contains HTML entities: `/test<script>alert()</script>`
- **Template Behavior**: Angular sanitizes by default, so XSS prevented ✅
- **Badge Rendering**: Line 117-119 interpolates name directly into `<span>{{ getName(suggestion) }}</span>`
- **Impact**: Safe (Angular auto-escapes), but long command names might break layout
- **Edge Case**: Command name with 100+ characters overflows badge
- **Missing**: CSS truncation on badge text (only description has `truncate` class)
- **Recommendation**: Add `max-w-xs truncate` to badge spans
- **Severity**: MINOR (rare, only UX issue)

### 4. What happens when dependencies fail?

**Integration Failure Analysis:**

| Integration                                      | Failure Mode                                              | Current Handling                       | Assessment                                     |
| ------------------------------------------------ | --------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| ClaudeRpcService.call() network timeout          | RPC never resolves                                        | Lines 41-77 try/catch catches error ✅ | OK (caught, logged, empty array returned)      |
| ClaudeRpcService.call() returns malformed JSON   | RPC throws parse error                                    | Lines 41-77 try/catch catches error ✅ | OK (caught, logged)                            |
| Backend returns `{success: false, error: "..."}` | Error case                                                | Lines 62-67 handle `result.error` ✅   | OK (logged, empty array returned)              |
| `_commands` signal mutation during render        | Angular throws change detection error                     | Signal-based, safe ✅                  | OK (Angular handles signal updates atomically) |
| Dropdown component destroyed mid-RPC             | RPC completes, tries to set signal on destroyed component | NO cleanup in fetchCommands() ❌       | CONCERN: Memory leak potential                 |

**Critical Missing: RPC Cancellation on Component Destroy**

- **Scenario**: User triggers `/`, immediately closes dropdown, RPC completes 500ms later
- **Current Behavior**: `fetchCommands()` completes and sets `_commands` signal on potentially destroyed component
- **Impact**: Wasted RPC call, potential memory leak if component destroyed
- **Missing**: AbortController for RPC cancellation OR effect cleanup
- **Recommendation**: Add `ngOnDestroy()` cleanup OR use Angular's takeUntilDestroyed()
- **Severity**: MODERATE (minor memory leak, rare user behavior)

### 5. What's missing that the requirements didn't mention?

**Gap 1: No Loading State Distinction (Initial vs Cached)**

- **User Expectation**: First trigger shows loading spinner (acceptable), subsequent triggers instant
- **Current Implementation**: `_isLoading` used for both cases
- **Problem**: ChatInputComponent can't distinguish "loading from cache" vs "loading from RPC"
- **UI Impact**: Dropdown might show loading state even when data already cached
- **Recommendation**: Expose `isCached` signal to UI to skip loading state when cached
- **Assessment**: Requirements met (caching works), but UX suboptimal

**Gap 2: No Cache Expiration Strategy**

- **User Expectation**: Cache lasts for session lifetime
- **Current Implementation**: Cache never expires until `clearCache()` called manually
- **Problem**: If backend data changes (commands updated), frontend never knows
- **Implicit Requirement**: Cache should be "fresh enough" for user workflow
- **Recommendation**: Add TTL (time-to-live) OR polling refresh (low priority)
- **Assessment**: Acceptable for MVP (manual refresh suffices)

**Gap 3: No Cache Size Limits**

- **Scenario**: Workspace has 1000+ slash commands (rare but possible with MCP)
- **Current Implementation**: All commands cached in memory (no limit)
- **Memory Impact**: 1000 commands × 100 bytes = 100KB (acceptable)
- **Performance Impact**: Filtering 1000 commands might exceed 16ms target
- **Missing**: Virtual scrolling OR pagination for large lists
- **Assessment**: Acceptable for MVP (requirements specify "< 100 items typical")

**Gap 4: No Retry Mechanism for Failed RPC**

- **Scenario**: Network glitch causes first RPC to fail
- **Current Implementation**: User must manually close/reopen dropdown to retry
- **User Experience**: Confusing (empty dropdown, no retry button)
- **Missing**: Automatic retry with exponential backoff OR manual retry button
- **Recommendation**: Add retry button in error state
- **Assessment**: UX gap, not critical

## Failure Mode Analysis

### Failure Mode 1: Empty RPC Response Incorrectly Caches Success

- **Trigger**: Backend returns `{success: true, data: {commands: []}}`
- **Symptoms**: Cache marked valid despite no data
- **Impact**: Second trigger skips RPC, shows empty dropdown forever
- **Current Handling**: Lines 59-61 check `commands.length > 0` before marking cached ✅
- **Recommendation**: CORRECT implementation, no changes needed

**Status**: ✅ HANDLED CORRECTLY

---

### Failure Mode 2: RPC Failure Leaves User in Permanent Error State

- **Trigger**: First `fetchCommands()` fails with network error
- **Symptoms**: Empty dropdown with "No suggestions found", no indication of error
- **Impact**: User confused why autocomplete doesn't work, no way to retry
- **Current Handling**: Lines 69-74 catch error, log to console, set empty array
- **Recommendation**: Add error state signal to expose to UI

**Code Location**: `command-discovery.facade.ts:69-74`

```typescript
// CURRENT (hides error from UI)
} catch (error) {
  console.error('[CommandDiscoveryFacade] Failed to fetch commands:', error);
  this._commands.set([]);
}

// RECOMMENDED (expose error state)
private readonly _error = signal<string | null>(null);
readonly error = computed(() => this._error());

} catch (error) {
  console.error('[CommandDiscoveryFacade] Failed to fetch commands:', error);
  this._error.set(error instanceof Error ? error.message : 'Unknown error');
  this._commands.set([]);
}

// In ChatInputComponent, check error signal and show retry button
```

**Status**: ⚠️ SERIOUS ISSUE (user can't distinguish error from empty results)

---

### Failure Mode 3: Cache Never Invalidates on Session/Project Change

- **Trigger**: User switches workspace OR chat session
- **Symptoms**: Old commands shown, new project commands missing
- **Impact**: User sees stale data from previous context
- **Current Handling**: `clearCache()` exists but never called
- **Recommendation**: Implement session monitoring OR document as known limitation

**Code Location**: `command-discovery.facade.ts:128-132` (clearCache exists but unused)

**Evidence**: No session monitoring found in ChatInputComponent or elsewhere

**User Workaround**: Restart extension OR manually close/reopen dropdown (doesn't help, cache persists)

**Status**: ⚠️ MODERATE ISSUE (stale data, confusing UX)

---

### Failure Mode 4: Race Condition with Rapid Trigger Spam

- **Trigger**: User types `/` twice within 500ms (before first RPC completes)
- **Symptoms**: Two RPC calls sent, both complete, last response wins
- **Impact**: Wasted network calls (90% reduction target not met), potential data inconsistency
- **Current Handling**: NO duplicate request prevention
- **Recommendation**: Check `_isLoading` in early return alongside `_isCached`

**Code Location**: `command-discovery.facade.ts:28-33`

```typescript
// CURRENT (only checks _isCached)
async fetchCommands(): Promise<void> {
  if (this._isCached()) {
    console.log('[CommandDiscoveryFacade] Cache hit, skipping RPC');
    return;
  }
  // ... RPC call

// RECOMMENDED (prevent duplicate in-flight requests)
async fetchCommands(): Promise<void> {
  if (this._isCached()) {
    console.log('[CommandDiscoveryFacade] Cache hit, skipping RPC');
    return;
  }

  // NEW: Prevent duplicate in-flight requests
  if (this._isLoading()) {
    console.log('[CommandDiscoveryFacade] Request in-flight, skipping duplicate');
    return;
  }

  // ... rest of method
```

**Status**: ⚠️ MODERATE ISSUE (edge case, wastes RPC calls)

---

### Failure Mode 5: New Commands Not Discovered After Installation

- **Trigger**: User creates `.claude/commands/foo.md`, expects autocomplete to show it
- **Symptoms**: New command missing from dropdown
- **Impact**: User discovers commands exist but autocomplete doesn't show them
- **Current Handling**: Cache never invalidates, no file system watcher
- **Recommendation**: Add manual refresh action OR implement file watcher

**User Workaround**: Restart extension (nukes all caches)

**Status**: ⚠️ SERIOUS ISSUE (discoverability gap, user expects dynamic updates)

---

### Failure Mode 6: Malformed RPC Response with Missing Fields

- **Trigger**: Backend bug returns command without `description` field
- **Symptoms**: Dropdown item shows blank description
- **Impact**: UI looks broken, user confused
- **Current Handling**: NO runtime validation of RPC response shape
- **Recommendation**: Add Zod schema validation OR defensive checks

**Code Location**: `command-discovery.facade.ts:52-57`

```typescript
// CURRENT (trusts backend response)
this._commands.set(
  result.data.commands.map((c) => ({
    ...c,
    icon: this.getCommandIcon(c.scope),
  }))
);

// RECOMMENDED (defensive validation)
this._commands.set(
  result.data.commands
    .filter((c) => c.name && c.description && c.scope) // Basic validation
    .map((c) => ({
      ...c,
      icon: this.getCommandIcon(c.scope),
    }))
);
```

**Status**: ⚠️ MODERATE ISSUE (backend contract violation, rare)

---

### Failure Mode 7: Long Command Names Overflow Badge Layout

- **Trigger**: Command name with 100+ characters (rare, but possible with MCP)
- **Symptoms**: Badge text overflows, breaks dropdown layout
- **Impact**: UI looks broken, text unreadable
- **Current Handling**: Badge has no truncation (only description has `truncate` class)
- **Recommendation**: Add `max-w-xs truncate` to badge elements

**Code Location**: `unified-suggestions-dropdown.component.ts:117-127`

```html
<!-- CURRENT (no truncation on badge) -->
<span class="badge badge-sm badge-primary">{{ getName(suggestion) }}</span>

<!-- RECOMMENDED (truncate long names) -->
<span class="badge badge-sm badge-primary max-w-xs truncate">{{ getName(suggestion) }}</span>
```

**Status**: ⚠️ MINOR ISSUE (rare edge case, only UX)

---

## Critical Issues

### Issue 1: RPC Failure Silent to User (No Error State Exposed)

- **File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\command-discovery.facade.ts:69-74`
- **Scenario**: Network failure on first trigger, user sees empty dropdown forever
- **Impact**: User can't distinguish "no results" from "loading failed", no retry mechanism
- **Evidence**:
  ```typescript
  } catch (error) {
    console.error('[CommandDiscoveryFacade] Failed to fetch commands:', error);
    this._commands.set([]); // User sees "No suggestions found"
  }
  ```
- **Fix**: Add `_error` signal and expose to UI with retry button

**Severity**: CRITICAL (blocks user from using autocomplete after network glitch)

---

### Issue 2: Cache Never Invalidates on Session Change

- **File**: No session monitoring exists (missing implementation)
- **Scenario**: User switches project/session, expects fresh commands
- **Impact**: Stale data from previous context shown, new commands missing
- **Evidence**: `clearCache()` method exists but never called (line 128-132)
- **Fix**: Implement session change detection effect in ChatInputComponent OR document as known limitation

**Severity**: CRITICAL (data correctness issue, confusing UX)

---

## Serious Issues

### Issue 1: Race Condition with Rapid Triggers

- **File**: `command-discovery.facade.ts:28-33`
- **Scenario**: User types `/` twice within 500ms (before first RPC completes)
- **Impact**: Two RPC calls sent (90% reduction target not met), potential data inconsistency
- **Evidence**: Only `_isCached` checked, not `_isLoading`
- **Fix**: Add `if (this._isLoading()) return;` after cache check

**Severity**: SERIOUS (wastes RPC calls, violates performance target)

---

### Issue 2: New Commands Not Discovered Until Extension Restart

- **File**: No file system watcher (missing implementation)
- **Scenario**: User creates `.claude/commands/foo.md`, expects autocomplete to show it
- **Impact**: User discovers commands exist but autocomplete doesn't show them
- **Evidence**: Cache never invalidates except manual `clearCache()` (never called)
- **Fix**: Add manual "Refresh" action OR implement file watcher

**Severity**: SERIOUS (discoverability gap, user frustration)

---

### Issue 3: No RPC Cancellation on Component Destroy

- **File**: `command-discovery.facade.ts:28-77` (no cleanup)
- **Scenario**: User triggers `/`, immediately closes dropdown, RPC completes 500ms later
- **Impact**: Wasted RPC call, potential memory leak
- **Evidence**: No AbortController or takeUntilDestroyed usage
- **Fix**: Add RPC cancellation mechanism

**Severity**: SERIOUS (minor memory leak, rare but accumulates)

---

## Moderate Issues

### Issue 1: Malformed RPC Response Breaks Dropdown Display

- **File**: `command-discovery.facade.ts:52-57`
- **Scenario**: Backend bug returns command without `description` field
- **Impact**: Dropdown shows blank description, looks broken
- **Evidence**: No runtime validation of response shape
- **Fix**: Add defensive validation filter

**Severity**: MODERATE (backend contract violation, rare)

---

### Issue 2: Long Command Names Overflow Badge Layout

- **File**: `unified-suggestions-dropdown.component.ts:117-127`
- **Scenario**: Command name with 100+ characters
- **Impact**: Badge overflows, breaks layout
- **Evidence**: No `truncate` class on badge (only on description)
- **Fix**: Add `max-w-xs truncate` to badge elements

**Severity**: MODERATE (rare edge case, only UX)

---

## Data Flow Analysis

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
[CHECK 1] Is _isCached === true?
  ├─ YES → Return early (cache hit, no RPC) ✅
  └─ NO → Proceed to RPC call
  ↓
[MISSING CHECK] Is _isLoading === true?
  ├─ SHOULD: Return early (prevent duplicate in-flight)
  └─ CURRENT: Proceeds (allows duplicate RPCs) ❌
  ↓
[RPC CALL] RPC to 'autocomplete:commands' sent
  ↓
[SUCCESS PATH] Backend returns {success: true, data: {commands: [...]}}
  ├─ Map response to CommandSuggestion[] ✅
  ├─ Set _commands signal ✅
  └─ Set _isCached = true ONLY if length > 0 ✅
  ↓
[ERROR PATH] Backend returns {success: false, error: "..."}
  ├─ Log warning ✅
  ├─ Set _commands to empty array ✅
  └─ [MISSING] Set _error signal for UI ❌
  ↓
[EXCEPTION PATH] Network failure throws error
  ├─ Catch error ✅
  ├─ Log error ✅
  ├─ Set _commands to empty array ✅
  └─ [MISSING] Set _error signal for UI ❌
  ↓
CommandDiscoveryFacade.searchCommands(query) called
  ↓
Returns ALL matching commands (no slice limits) ✅
  ↓
ChatInputComponent.filteredSuggestions computed
  ↓
UnifiedSuggestionsDropdownComponent renders with badges ✅
  ↓
[UI RENDERING] Template displays suggestions
  ├─ Commands: badge-primary (lapis blue) ✅
  ├─ Agents: badge-secondary (pharaoh gold) ✅
  ├─ Files: badge-ghost (transparent) ✅
  └─ [MISSING] Badge truncation for long names ❌
```

### Gap Points Identified:

1. **No duplicate in-flight request prevention** (after cache check, before RPC call)
2. **No error state exposed to UI** (after catch blocks, user sees empty state)
3. **No cache invalidation on session change** (cache lives forever until manual clear)
4. **No badge truncation** (long command names overflow layout)
5. **No RPC cancellation** (in-flight requests complete even after component destroyed)

---

## Requirements Fulfillment

| Requirement                            | Status      | Concern                                            |
| -------------------------------------- | ----------- | -------------------------------------------------- |
| R1: Visual Enhancement (Badge Styling) | ✅ COMPLETE | Minor: No badge truncation for long names          |
| R2: Client-Side Caching (Commands)     | ✅ COMPLETE | Serious: Cache never invalidates on session change |
| R3: Client-Side Caching (Agents)       | ✅ COMPLETE | Same as R2                                         |
| R4: Dynamic File Suggestions           | ✅ COMPLETE | No changes needed (correctly preserved)            |
| R5: Show All Commands (No Limit)       | ✅ COMPLETE | No issues                                          |
| R6: Show All Agents (No Limit)         | ✅ COMPLETE | No issues                                          |
| NF1: Performance (90% RPC Reduction)   | ⚠️ PARTIAL  | Concern: Duplicate requests if rapid triggers      |
| NF2: Usability (Error Handling)        | ❌ MISSING  | Critical: No error state exposed to UI             |
| NF3: Cache Invalidation                | ❌ MISSING  | Critical: No session monitoring                    |

### Implicit Requirements NOT Addressed:

1. **Session Change Detection**: User expects commands to refresh when switching projects/sessions

   - **Current**: Cache persists across session changes (stale data)
   - **Expected**: Cache invalidates on session change
   - **Gap**: No session monitoring effect

2. **Error Recovery**: User expects retry mechanism when RPC fails

   - **Current**: Silent error, user sees empty state
   - **Expected**: Error message with retry button
   - **Gap**: No error state signal

3. **File System Monitoring**: User expects new commands to appear after creating `.claude/commands/foo.md`

   - **Current**: Cache persists until extension restart
   - **Expected**: Dynamic discovery OR manual refresh
   - **Gap**: No file watcher OR refresh action

4. **Long Name Handling**: User expects UI to remain intact with edge case data
   - **Current**: Long command names overflow badge
   - **Expected**: Badge truncates with ellipsis
   - **Gap**: Missing `truncate` class on badges

---

## Edge Case Analysis

| Edge Case                               | Handled  | How                                           | Concern                   |
| --------------------------------------- | -------- | --------------------------------------------- | ------------------------- |
| Null/undefined toolId                   | N/A      | Not applicable to this task                   | None                      |
| Empty RPC response (valid but no data)  | ✅ YES   | Lines 59-61 check `length > 0` before caching | None                      |
| Malformed RPC response (missing fields) | ❌ NO    | No validation, blank UI                       | Moderate issue            |
| Network timeout                         | ✅ YES   | Try/catch handles errors                      | Serious: No error UI      |
| Rapid double-trigger (race condition)   | ❌ NO    | No duplicate prevention                       | Serious: Wastes RPC calls |
| Long command name (100+ chars)          | ❌ NO    | No badge truncation                           | Moderate: Layout breaks   |
| Special chars in name (HTML entities)   | ✅ YES   | Angular auto-escapes                          | None                      |
| Session change (project switch)         | ❌ NO    | Cache never invalidates                       | Critical: Stale data      |
| New command installed                   | ❌ NO    | Cache never refreshes                         | Serious: Discoverability  |
| Component destroyed mid-RPC             | ❌ NO    | No cancellation                               | Moderate: Memory leak     |
| 1000+ commands (performance)            | ⚠️ MAYBE | No virtualization, might exceed 16ms          | Low priority (rare)       |

---

## Integration Risk Assessment

| Integration                                  | Failure Probability   | Impact                     | Mitigation                                     |
| -------------------------------------------- | --------------------- | -------------------------- | ---------------------------------------------- |
| CommandDiscoveryFacade → ClaudeRpcService    | LOW (network issues)  | HIGH (blocks autocomplete) | Current: Try/catch. Needed: Error state signal |
| AgentDiscoveryFacade → ClaudeRpcService      | LOW (network issues)  | HIGH (blocks autocomplete) | Same as above                                  |
| ChatInputComponent → Facades                 | VERY LOW (in-process) | NONE                       | Well-structured dependency                     |
| UnifiedSuggestionsDropdown → Badge Rendering | VERY LOW (pure CSS)   | NONE                       | DaisyUI handles styling                        |
| Session Monitoring (missing)                 | N/A (not implemented) | HIGH (stale data)          | CRITICAL: Need to implement                    |
| Badge Truncation (missing)                   | MEDIUM (long names)   | LOW (only UX)              | Add `truncate` class                           |

---

## Verdict

**Recommendation**: NEEDS_REVISION

**Confidence**: HIGH

**Top Risk**: Cache never invalidates on session change, causing stale data to be shown when user switches projects or chat sessions. This is a data correctness issue that will confuse users.

**Critical Blockers**:

1. No session change detection → stale data across sessions
2. No error state exposed to UI → user can't recover from RPC failures

**Serious Issues**:

1. Race condition with rapid triggers → wastes RPC calls (violates 90% reduction target)
2. New commands not discovered → poor discoverability UX
3. No RPC cancellation → minor memory leak

**Approval Criteria**:

- Must implement session change monitoring OR document as known limitation
- Must expose error state to UI with retry mechanism
- Should add duplicate request prevention
- Should add badge truncation for long names

---

## What Robust Implementation Would Include

A bulletproof implementation of this feature would have:

### 1. Error State Management

```typescript
// In CommandDiscoveryFacade
private readonly _error = signal<string | null>(null);
readonly error = computed(() => this._error());

// In ChatInputComponent
@if (commandDiscovery.error()) {
  <div class="alert alert-error">
    <span>Failed to load commands: {{ commandDiscovery.error() }}</span>
    <button (click)="retryCommands()">Retry</button>
  </div>
}
```

### 2. Session Change Monitoring

```typescript
// In ChatInputComponent constructor
effect(() => {
  const activeTab = this.chatStore.activeTab();
  if (activeTab) {
    // Clear caches when session changes
    this.commandDiscovery.clearCache();
    this.agentDiscovery.clearCache();
  }
});
```

### 3. Duplicate Request Prevention

```typescript
// In CommandDiscoveryFacade.fetchCommands()
if (this._isCached() || this._isLoading()) {
  console.log('[CommandDiscoveryFacade] Skipping duplicate request');
  return;
}
```

### 4. RPC Cancellation

```typescript
// In CommandDiscoveryFacade
private abortController: AbortController | null = null;

async fetchCommands(): Promise<void> {
  // Cancel previous request if in-flight
  this.abortController?.abort();
  this.abortController = new AbortController();

  try {
    const result = await this.rpc.call('autocomplete:commands', {
      signal: this.abortController.signal
    });
    // ...
  }
}
```

### 5. Badge Layout Protection

```html
<!-- In unified-suggestions-dropdown.component.ts -->
<span class="badge badge-sm badge-primary max-w-xs truncate"> {{ getName(suggestion) }} </span>
```

### 6. File System Watcher (Advanced)

```typescript
// In backend RPC handler
vscode.workspace.onDidCreateFiles((event) => {
  if (event.files.some((f) => f.path.includes('.claude/commands'))) {
    // Notify frontend to clear cache
    webview.postMessage({ type: 'commands:invalidate' });
  }
});
```

### 7. Runtime Response Validation

```typescript
// In CommandDiscoveryFacade.fetchCommands()
this._commands.set(
  result.data.commands
    .filter((c) => typeof c.name === 'string' && c.name.length > 0 && typeof c.description === 'string' && ['builtin', 'project', 'user', 'mcp'].includes(c.scope))
    .map((c) => ({
      ...c,
      icon: this.getCommandIcon(c.scope),
    }))
);
```

### 8. Cache Expiration Strategy (Future)

```typescript
// In CommandDiscoveryFacade
private readonly _cacheTimestamp = signal<number>(0);
private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async fetchCommands(): Promise<void> {
  const now = Date.now();
  if (this._isCached() && now - this._cacheTimestamp() < this.CACHE_TTL) {
    return; // Cache still fresh
  }

  // ... fetch logic
  this._cacheTimestamp.set(now);
}
```

---

**Document Version**: 1.0
**Created**: 2025-12-04
**Reviewer**: Code Logic Reviewer (AI Agent)
**Task ID**: TASK_2025_042
**Status**: ⚠️ NEEDS_REVISION - 2 Critical Issues, 3 Serious Issues, 2 Moderate Issues
