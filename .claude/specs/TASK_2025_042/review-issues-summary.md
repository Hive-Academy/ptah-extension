# Code Review Issues Summary - TASK_2025_042

## Critical Issues (2)

### 1. Cache Never Invalidates on Session Change

**Severity**: CRITICAL
**Files**: CommandDiscoveryFacade, AgentDiscoveryFacade
**Issue**: `clearCache()` method exists but is never called. Users see stale commands from previous projects/sessions.
**Fix**: Implement session change detection and call clearCache()

### 2. RPC Failure Silent to User

**Severity**: CRITICAL
**Files**: CommandDiscoveryFacade, AgentDiscoveryFacade
**Issue**: Network errors show empty dropdown with no error message or retry mechanism.
**Fix**: Add `_error` signal, expose to UI, show error message with retry button

## Serious Issues (5)

### 3. Race Condition with Rapid Triggers

**Severity**: SERIOUS
**Files**: CommandDiscoveryFacade, AgentDiscoveryFacade
**Issue**: Typing `/` twice within 500ms sends 2 RPC calls, violates 90% reduction target.
**Fix**: Check `_isLoading` in fetchCommands/fetchAgents early return

### 4. New Commands Not Discovered

**Severity**: SERIOUS
**Files**: CommandDiscoveryFacade, AgentDiscoveryFacade
**Issue**: After creating new commands, cache never refreshes (requires extension restart).
**Fix**: Add manual refresh mechanism or file watcher (future enhancement)

### 5. @HostListener Pattern Violation

**Severity**: BLOCKING
**Files**: UnifiedSuggestionsDropdownComponent
**Issue**: Uses deprecated `@HostListener('document:keydown')`, should use `host` object in @Component decorator.
**Fix**: Migrate to `host: { '(document:keydown)': 'onKeyDown($event)' }`

### 6. Debug Stack Trace in Production

**Severity**: SERIOUS
**Files**: CommandDiscoveryFacade
**Issue**: `new Error().stack` on every cache miss pollutes logs.
**Fix**: Remove stack trace logging

### 7. 80% Code Duplication

**Severity**: SERIOUS
**Files**: CommandDiscoveryFacade, AgentDiscoveryFacade
**Issue**: No shared abstraction for caching logic, future changes require updating 2 files.
**Fix**: Extract base class or shared caching service (future refactoring)

## Moderate Issues (3)

### 8. No RPC Cancellation on Component Destroy

**Files**: CommandDiscoveryFacade, AgentDiscoveryFacade
**Issue**: RPC completes after component destroyed, potential memory leak.
**Fix**: Use AbortController or takeUntilDestroyed()

### 9. Inconsistent Debug Logging

**Files**: AgentDiscoveryFacade
**Issue**: CommandDiscoveryFacade has 6 logs, AgentDiscoveryFacade has 3, inconsistent debugging experience.
**Fix**: Match logging pattern between facades

### 10. Badge Color Semantic Collision

**Files**: UnifiedSuggestionsDropdownComponent
**Issue**: `badge-primary` used for both command names AND agent scope badges.
**Fix**: Use different color for command name badges (badge-accent)

## Priority Fix List

**Must Fix (MVP)**:

1. ✅ Cache invalidation on session change (#1)
2. ✅ RPC failure error handling (#2)
3. ✅ Race condition fix (#3)
4. ✅ @HostListener migration (#5)
5. ✅ Remove debug stack traces (#6)

**Should Fix (Quality)**: 6. ✅ Consistent logging (#9) 7. ✅ Badge color collision (#10)

**Nice to Have (Future)**: 8. ⏳ New command discovery (#4) 9. ⏳ RPC cancellation (#8) 10. ⏳ Code duplication (#7)
