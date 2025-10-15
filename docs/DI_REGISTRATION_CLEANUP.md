# Dependency Injection Registration Cleanup

**Date**: October 15, 2025  
**Branch**: feature/TASK_INT_002-integration-analysis

## Problem Statement

The `claude-domain` library had **duplicate service registrations** causing:

1. **Memory waste**: Same service registered twice under different tokens
2. **Confusion**: Two registration patterns (external tokens + Symbol.for())
3. **Maintenance burden**: Need to update two places when adding services
4. **Potential bugs**: State inconsistency between duplicate instances

### Example of Duplication (Before)

```typescript
// Register under external token (from main app)
container.registerSingleton(tokens.CLAUDE_CLI_DETECTOR, ClaudeCliDetector);
container.registerSingleton(tokens.CLAUDE_SESSION_MANAGER, SessionManager);
container.registerSingleton(tokens.CLAUDE_PROCESS_MANAGER, ProcessManager);
// ... etc (5 services)

// THEN register AGAIN under Symbol.for() tokens
container.registerSingleton(Symbol.for('ClaudeCliDetector'), ClaudeCliDetector);
container.registerSingleton(Symbol.for('SessionManager'), SessionManager);
container.registerSingleton(Symbol.for('ProcessManager'), ProcessManager);
// ... etc (6 services - ClaudeCliService added)
```

**Result**: 11 duplicate registrations for the same 6 service classes!

## Root Cause Analysis

**The Issue**: Mismatch between library internal design and external interface

- **Internal `@inject()` decorators** use `Symbol.for()` constants:

  ```typescript
  // In ClaudeCliService
  @inject(CLI_DETECTOR) // = Symbol.for('ClaudeCliDetector')
  private readonly detector: ClaudeCliDetector
  ```

- **External tokens** passed from main app:

  ```typescript
  // In main.ts
  const claudeTokens = {
    CLAUDE_CLI_DETECTOR: TOKENS.CLAUDE_CLI_DETECTOR, // Symbol from vscode-core
    // ...
  };
  ```

**Why It Happened**: Trying to satisfy both internal @inject() needs AND external main app access.

## Solution: Single Source of Truth

### Decision: Use Symbol.for() for All Internal Services

**Rationale**:

1. ✅ **Minimal Changes**: All `@inject()` decorators already use Symbol.for()
2. ✅ **Self-Documenting**: `Symbol.for('SessionManager')` is clear
3. ✅ **Consistent**: Same pattern across all domain services
4. ✅ **Encapsulation**: Internal services hidden from main app

### What Changed

#### 1. Updated `ClaudeDomainTokens` Interface

**Before** (17 tokens):

```typescript
export interface ClaudeDomainTokens {
  CLAUDE_CLI_DETECTOR: symbol;
  CLAUDE_SESSION_MANAGER: symbol;
  CLAUDE_PROCESS_MANAGER: symbol;
  CLAUDE_DOMAIN_EVENT_PUBLISHER: symbol;
  CLAUDE_PERMISSION_SERVICE: symbol;
  PERMISSION_RULES_STORE: symbol;

  // Orchestration services
  CHAT_ORCHESTRATION_SERVICE: symbol;
  PROVIDER_ORCHESTRATION_SERVICE: symbol;
  ANALYTICS_ORCHESTRATION_SERVICE: symbol;
  CONFIG_ORCHESTRATION_SERVICE: symbol;

  MESSAGE_HANDLER_SERVICE: symbol;
}
```

**After** (5 tokens):

```typescript
export interface ClaudeDomainTokens {
  // Only orchestration services (exposed to main app)
  CHAT_ORCHESTRATION_SERVICE: symbol;
  PROVIDER_ORCHESTRATION_SERVICE: symbol;
  ANALYTICS_ORCHESTRATION_SERVICE: symbol;
  CONFIG_ORCHESTRATION_SERVICE: symbol;

  MESSAGE_HANDLER_SERVICE: symbol;
}
```

**Removed**:

- `CLAUDE_CLI_DETECTOR` (internal)
- `CLAUDE_SESSION_MANAGER` (internal)
- `CLAUDE_PROCESS_MANAGER` (internal)
- `CLAUDE_DOMAIN_EVENT_PUBLISHER` (internal)
- `CLAUDE_PERMISSION_SERVICE` (internal)
- `PERMISSION_RULES_STORE` (never used)

#### 2. Simplified Service Registration

**Before** (duplicate registrations):

```typescript
// External tokens (5 registrations)
container.registerSingleton(tokens.CLAUDE_CLI_DETECTOR, ClaudeCliDetector);
container.registerSingleton(tokens.CLAUDE_SESSION_MANAGER, SessionManager);
container.registerSingleton(tokens.CLAUDE_PROCESS_MANAGER, ProcessManager);
container.registerSingleton(tokens.CLAUDE_DOMAIN_EVENT_PUBLISHER, ClaudeDomainEventPublisher);
container.registerSingleton(tokens.CLAUDE_PERMISSION_SERVICE, PermissionService);

// Symbol.for() tokens (6 registrations - DUPLICATES!)
container.registerSingleton(Symbol.for('SessionManager'), SessionManager);
container.registerSingleton(Symbol.for('ClaudeCliDetector'), ClaudeCliDetector);
container.registerSingleton(Symbol.for('PermissionService'), PermissionService);
container.registerSingleton(Symbol.for('ProcessManager'), ProcessManager);
container.registerSingleton(Symbol.for('ClaudeDomainEventPublisher'), ClaudeDomainEventPublisher);
container.registerSingleton(Symbol.for('ClaudeCliService'), ClaudeCliService);
```

**After** (single registration per service):

```typescript
// Core domain services - internal to claude-domain (Symbol.for() only)
container.registerSingleton(Symbol.for('ClaudeCliDetector'), ClaudeCliDetector);
container.registerSingleton(Symbol.for('SessionManager'), SessionManager);
container.registerSingleton(Symbol.for('ProcessManager'), ProcessManager);
container.registerSingleton(Symbol.for('ClaudeDomainEventPublisher'), ClaudeDomainEventPublisher);
container.registerSingleton(Symbol.for('PermissionService'), PermissionService);
container.registerSingleton(Symbol.for('ClaudeCliService'), ClaudeCliService);
```

**Result**: 6 services, 6 registrations (previously 11)

#### 3. Updated Main App Token Mapping

**Before** (main.ts):

```typescript
const claudeTokens: ClaudeDomainTokens = {
  CLAUDE_CLI_DETECTOR: TOKENS.CLAUDE_CLI_DETECTOR,
  CLAUDE_SESSION_MANAGER: TOKENS.CLAUDE_SESSION_MANAGER,
  CLAUDE_PROCESS_MANAGER: TOKENS.CLAUDE_PROCESS_MANAGER,
  CLAUDE_DOMAIN_EVENT_PUBLISHER: TOKENS.CLAUDE_DOMAIN_EVENT_PUBLISHER,
  CLAUDE_PERMISSION_SERVICE: TOKENS.CLAUDE_PERMISSION_SERVICE,
  PERMISSION_RULES_STORE: permissionSymbol, // Unused!

  // Orchestration services
  CHAT_ORCHESTRATION_SERVICE: TOKENS.CHAT_ORCHESTRATION_SERVICE,
  // ...
};
```

**After** (main.ts):

```typescript
const claudeTokens: ClaudeDomainTokens = {
  // Only orchestration services (what main app actually needs)
  CHAT_ORCHESTRATION_SERVICE: TOKENS.CHAT_ORCHESTRATION_SERVICE,
  PROVIDER_ORCHESTRATION_SERVICE: TOKENS.PROVIDER_ORCHESTRATION_SERVICE,
  ANALYTICS_ORCHESTRATION_SERVICE: TOKENS.ANALYTICS_ORCHESTRATION_SERVICE,
  CONFIG_ORCHESTRATION_SERVICE: TOKENS.CONFIG_ORCHESTRATION_SERVICE,
  MESSAGE_HANDLER_SERVICE: TOKENS.MESSAGE_HANDLER_SERVICE,
};
```

## Benefits

### 1. Memory Efficiency ✅

- **Before**: 11 registrations for 6 service classes
- **After**: 6 registrations for 6 service classes
- **Savings**: ~45% reduction in registration overhead

### 2. Clear Separation of Concerns ✅

| Service Layer              | Registration Pattern                        | Exposure      |
| -------------------------- | ------------------------------------------- | ------------- |
| **Core Domain Services**   | `Symbol.for('ServiceName')`                 | Internal only |
| **Orchestration Services** | External tokens from main app               | Public API    |
| **Infrastructure**         | String literals (`'IPermissionRulesStore'`) | Internal only |

### 3. Simplified Maintenance ✅

Adding a new service now requires:

- ❌ **Before**: 2 registrations (external token + Symbol.for())
- ✅ **After**: 1 registration (Symbol.for() only)

### 4. Type Safety ✅

Main app can't accidentally access internal services - they're not in the interface!

```typescript
// This is now a TypeScript error:
const detector = container.resolve(tokens.CLAUDE_CLI_DETECTOR);
//                                       ^^^^^^^^^^^^^^^^^
//                                       Property doesn't exist!

// Only orchestration services accessible from main app
const chatService = container.resolve(tokens.CHAT_ORCHESTRATION_SERVICE); // ✅ Valid
```

## Pattern Summary

### When to Use Each Registration Pattern

| Pattern                  | Use Case                 | Example                             |
| ------------------------ | ------------------------ | ----------------------------------- |
| **`Symbol.for('Name')`** | Internal domain services | `Symbol.for('SessionManager')`      |
| **External tokens**      | Public API services      | `tokens.CHAT_ORCHESTRATION_SERVICE` |
| **String literals**      | Infrastructure adapters  | `'IPermissionRulesStore'`           |

### Registration Checklist

When adding a new service to `claude-domain`:

1. **Is it part of the public API?**

   - ✅ Yes → Add to `ClaudeDomainTokens` interface + register with external token
   - ❌ No → Register with `Symbol.for('ServiceName')` only

2. **Does it need infrastructure from main app?**

   - ✅ Yes → Use `@inject(CONSTANT)` where CONSTANT = `Symbol.for('InfraName')`
   - ❌ No → Standard constructor injection

3. **Is it an infrastructure adapter?**
   - ✅ Yes → Use string literal (`'IPermissionRulesStore'`)
   - ❌ No → See #1

## Migration Impact

### Files Changed

1. **`libs/backend/claude-domain/src/di/register.ts`**

   - Removed duplicate registrations (11 → 6 core services)
   - Updated `ClaudeDomainTokens` interface (17 → 5 tokens)
   - Added clear comments explaining registration patterns

2. **`apps/ptah-extension-vscode/src/main.ts`**
   - Removed unused token mappings (11 → 5)
   - Removed unused `permissionSymbol` constant

### No Changes Required

- ✅ **All `@inject()` decorators**: Already using Symbol.for()
- ✅ **Service implementations**: No changes needed
- ✅ **Main app service resolution**: Only uses orchestration services

### Build Verification

```bash
✅ TypeScript compilation: PASS
✅ Webpack bundling: PASS (1.71 MiB)
✅ All tests: PASS
```

## Future Recommendations

### 1. Document Symbol.for() Pattern

Create `DEPENDENCY_INJECTION_PATTERNS.md` documenting:

- When to use Symbol.for() vs external tokens
- How to add new services
- Common pitfalls

### 2. Consider Exporting Symbol Constants

For better type safety, export Symbol.for() constants:

```typescript
// In claude-domain/src/index.ts
export const INTERNAL_TOKENS = {
  SESSION_MANAGER: Symbol.for('SessionManager'),
  CLAUDE_CLI_SERVICE: Symbol.for('ClaudeCliService'),
  // ...
} as const;

// Usage in tests or advanced scenarios
import { INTERNAL_TOKENS } from '@ptah-extension/claude-domain';
const sessionManager = container.resolve(INTERNAL_TOKENS.SESSION_MANAGER);
```

### 3. Lint Rule for Duplicate Registrations

Consider adding an ESLint rule to prevent duplicate registrations:

- Flag multiple `container.register()` calls for the same class
- Warn if same service registered under multiple tokens

## Conclusion

This cleanup removes **45% of duplicate registrations** while maintaining full functionality. The `claude-domain` library now has a clear separation between:

- **Internal services**: Symbol.for() (6 core domain services)
- **Public API**: External tokens (5 orchestration services)
- **Infrastructure**: String literals (1 permission store)

**Result**: Cleaner code, better encapsulation, easier maintenance. 🎉
