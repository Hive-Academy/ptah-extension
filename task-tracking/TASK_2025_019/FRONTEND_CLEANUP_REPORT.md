# Frontend Event Subscription Cleanup Report

**Task**: Remove all orphaned event subscriptions, MESSAGE_TYPES imports, and event-based observable calls from frontend code

**Status**: ❌ **BLOCKED** - Cannot complete due to missing ProviderService methods

---

## ✅ COMPLETED FRONTEND CLEANUPS

### 1. Provider Manager Component

**File**: `libs/frontend/providers/src/lib/containers/provider-manager.component.ts`

**Changes**:

- Removed 3 event subscriptions in `setupProviderEventListeners()`:
  - `providerService.onProviderSwitch()`
  - `providerService.onProviderHealthChange()`
  - `providerService.onProviderError()`
- Disabled event listener setup in constructor
- Added TODO comments for Phase 2 RPC implementation

**Rationale**: These observable methods were deleted from ProviderService during the event purge.

---

### 2. Dashboard Component

**File**: `libs/frontend/dashboard/src/lib/containers/dashboard/dashboard.component.ts`

**Changes**:

- Removed `combineLatest` subscription in `setupPerformanceMonitoring()`
- Removed unused RxJS imports (`combineLatest`, `toObservable`, `takeUntilDestroyed`)
- Added TODO comment for Phase 2 RPC-based performance monitoring

**Rationale**: The subscription was using event-based observables that were removed.

---

### 3. VSCode Service

**File**: `libs/frontend/core/src/lib/services/vscode.service.ts`

**Changes**:

- Replaced `SYSTEM_MESSAGE_TYPES.ERROR` with string literal `'system:error'`
- Added explanatory comment

**Rationale**: MESSAGE_TYPES constants were deleted from `@ptah-extension/shared` during the purge.

---

## ❌ BLOCKERS DISCOVERED

### 🚨 CRITICAL: ProviderService Method Removal

**Problem**: During the event purge, `ProviderService` had ALL its action methods removed, leaving only readonly signals and getters. This breaks ALL frontend components that need to modify provider state.

**Missing Methods**:

```typescript
// ❌ REMOVED (but still called by components)
switchProvider(providerId: string, reason?: string): void
setFallbackEnabled(enabled: boolean): void
setAutoSwitchEnabled(enabled: boolean): void
refreshProviders(): void
clearError(): void
setDefaultProvider(providerId: string): void
```

**Affected Components** (Build Errors):

1. `provider-manager.component.ts:150` - `switchProvider()` call
2. `provider-manager.component.ts:162` - `setFallbackEnabled()` call
3. `provider-manager.component.ts:174` - `setAutoSwitchEnabled()` call
4. `provider-manager.component.ts:182` - `refreshProviders()` call
5. `provider-manager.component.ts:190` - `clearError()` call
6. `settings-view.component.ts:86` - `switchProvider()` call
7. `settings-view.component.ts:93` - `setDefaultProvider()` call

**Root Cause**: The event purge removed event-based subscriptions BUT ALSO removed the action methods without providing RPC-based replacements.

---

### 🚨 CRITICAL: Backend Event Infrastructure Missing

**Problem**: Backend libraries still import deleted event infrastructure.

**Files Affected**:

1. `libs/backend/vscode-core/src/api-wrappers/command-manager.ts`

   - Missing import: `EventBus` from `'../messaging/event-bus'`
   - Missing import: `ANALYTICS_MESSAGE_TYPES` from `@ptah-extension/shared`
   - Missing import: `SYSTEM_MESSAGE_TYPES` from `@ptah-extension/shared`
   - Missing import: `COMMAND_MESSAGE_TYPES` from `@ptah-extension/shared`

2. `libs/backend/vscode-core/src/api-wrappers/file-system-manager.ts`
   - Missing import: `EventBus` from `'../messaging/event-bus'`
   - Missing import: `ANALYTICS_MESSAGE_TYPES` from `@ptah-extension/shared`

**Root Cause**: Backend cleanup was incomplete - event infrastructure was deleted but usages remain.

---

## 📊 CLEANUP SUMMARY

### Files Modified (Frontend Only): 3

1. ✅ `libs/frontend/providers/src/lib/containers/provider-manager.component.ts`
2. ✅ `libs/frontend/dashboard/src/lib/containers/dashboard/dashboard.component.ts`
3. ✅ `libs/frontend/core/src/lib/services/vscode.service.ts`

### Event Subscriptions Removed: 4

- 3 from provider-manager.component.ts
- 1 from dashboard.component.ts

### MESSAGE_TYPES Replacements: 1

- `SYSTEM_MESSAGE_TYPES.ERROR` → `'system:error'`

### Build Status: ❌ FAILING

- **Frontend Errors**: 6 (missing ProviderService methods)
- **Backend Errors**: 6 (missing EventBus + MESSAGE_TYPES)

---

## 🔧 REQUIRED ACTIONS TO UNBLOCK

### Option 1: Restore ProviderService Methods (Temporary Fix)

**Add stub methods to ProviderService** that send messages to backend but don't use event subscriptions:

```typescript
// In libs/frontend/core/src/lib/services/provider.service.ts

switchProvider(providerId: string, reason: string = 'user-request'): void {
  this.vscodeService.postStrictMessage('provider:switch', {
    providerId,
    reason,
    correlationId: CorrelationId.create()
  });
}

setFallbackEnabled(enabled: boolean): void {
  this._fallbackEnabled.set(enabled);
  this.vscodeService.postStrictMessage('provider:setFallbackEnabled', {
    enabled,
    correlationId: CorrelationId.create()
  });
}

setAutoSwitchEnabled(enabled: boolean): void {
  this._autoSwitchEnabled.set(enabled);
  this.vscodeService.postStrictMessage('provider:setAutoSwitchEnabled', {
    enabled,
    correlationId: CorrelationId.create()
  });
}

refreshProviders(): void {
  this._isLoading.set(true);
  this.vscodeService.postStrictMessage('provider:refresh', {
    correlationId: CorrelationId.create()
  });
}

clearError(): void {
  this._lastError.set(null);
}

setDefaultProvider(providerId: string): void {
  this.vscodeService.postStrictMessage('provider:setDefault', {
    providerId,
    correlationId: CorrelationId.create()
  });
}
```

**Pros**: Unblocks build, allows Phase 2 RPC implementation
**Cons**: Still fire-and-forget, no response handling

---

### Option 2: Complete Backend Cleanup (Correct Fix)

**Fix backend event infrastructure**:

1. Remove EventBus imports from `command-manager.ts` and `file-system-manager.ts`
2. Remove MESSAGE_TYPES imports from backend files
3. Replace with direct string literals or RPC calls

**Pros**: Completes the event purge properly
**Cons**: More work, requires backend expertise

---

### Option 3: Phase 2 RPC Implementation (Future)

**Implement proper RPC request/response pattern**:

1. Define RPC message types (request + response pairs)
2. Implement correlation ID tracking
3. Add response handlers
4. Update ProviderService to use RPC methods

**Pros**: Correct architecture, proper error handling
**Cons**: Significant work, out of scope for cleanup mission

---

## 🎯 RECOMMENDATION

**Proceed with Option 1 (Restore ProviderService Methods)**:

1. Add the 6 missing methods to ProviderService as stubs
2. Methods send messages to backend (fire-and-forget)
3. Document as temporary until Phase 2
4. Unblocks build and allows testing
5. Phase 2 will replace with proper RPC

**Next Steps**:

1. Get user approval for Option 1
2. Implement stub methods in ProviderService
3. Verify build passes
4. Create commit with frontend cleanup complete
5. Create separate ticket for backend cleanup (Option 2)

---

## 📝 NOTES

- Frontend event subscription cleanup is **technically complete**
- Build failure is due to **incomplete ProviderService refactoring** during initial purge
- Backend cleanup is **separate concern** (not part of frontend cleanup mission)
- All event-based `.subscribe()` calls have been removed or replaced
- All MESSAGE_TYPES usages have been replaced with string literals

**Waiting for user decision on how to proceed with blockers.**
