# DI Token Mismatch Root Cause Analysis

**Date**: January 15, 2025
**Branch**: feature/TASK_INT_002-integration-analysis
**Status**: 🔴 Critical Bug Identified

## Error Message

```
Ptah activation failed: Cannot inject the dependency "chatOrchestration" at position #1 of "MessageHandlerService" constructor. Reason: Cannot inject the dependency "claudeService" at position #1 of "ChatOrchestrationService" constructor. Reason: Cannot inject the dependency "eventPublisher" at position #4 of "ClaudeCliService" constructor. Reason: Cannot inject the dependency "eventBus" at position #0 of "ClaudeDomainEventPublisher" constructor. Reason: Attempted to resolve unregistered dependency token: "IEventBus"
```

## Root Cause: Token Mismatch

### The Problem

The `ClaudeDomainEventPublisher` class expects to inject `IEventBus` using a **string literal**:

```typescript
// In libs/backend/claude-domain/src/events/claude-domain.events.ts
@injectable()
export class ClaudeDomainEventPublisher {
  constructor(@inject('IEventBus') private readonly eventBus: IEventBus) {}
  //                   ^^^^^^^^^^^ STRING LITERAL
}
```

But the registration in `register.ts` uses a **Symbol constant**:

```typescript
// In libs/backend/claude-domain/src/di/register.ts
import { EVENT_BUS } from '../index';

container.register(EVENT_BUS, {
  //                ^^^^^^^^^ Symbol.for('EventBus') ≠ 'IEventBus'
  useValue: {
    publish: <T>(topic: string, payload: T) => {
      eventBus.publish(topic, payload);
    },
  },
});
```

Where `EVENT_BUS` is defined as:

```typescript
// In libs/backend/vscode-core/src/di/tokens.ts
export const EVENT_BUS = Symbol.for('EventBus');
```

**Result**: TSyringe cannot match `'IEventBus'` (string) with `Symbol.for('EventBus')` (symbol).

## Scope of the Issue

### Files with Inconsistent Token Usage

| File                         | Injection Pattern                                                           | Registration Pattern                       | Status      |
| ---------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ | ----------- |
| `claude-domain.events.ts`    | `@inject('IEventBus')`                                                      | `EVENT_BUS` = `Symbol.for('EventBus')`     | ❌ MISMATCH |
| `claude-cli.service.ts`      | `@inject(CLI_EVENT_PUBLISHER)` = `Symbol.for('ClaudeDomainEventPublisher')` | `Symbol.for('ClaudeDomainEventPublisher')` | ✅ MATCH    |
| `session-manager.ts`         | `@inject(EVENT_BUS)` = `Symbol.for('EventBus')`                             | `EVENT_BUS` = `Symbol.for('EventBus')`     | ✅ MATCH    |
| `message-handler.service.ts` | `@inject(EVENT_BUS)` = `Symbol.for('EventBus')`                             | `EVENT_BUS` = `Symbol.for('EventBus')`     | ✅ MATCH    |
| `permission-service.ts`      | `@inject('IPermissionRulesStore')`                                          | `'IPermissionRulesStore'`                  | ✅ MATCH    |

### Multiple EVENT_BUS Definitions

```typescript
// libs/backend/vscode-core/src/di/tokens.ts
export const EVENT_BUS = Symbol.for('EventBus');

// libs/backend/claude-domain/src/session/session-manager.ts
export const EVENT_BUS = Symbol.for('EventBus');

// libs/backend/claude-domain/src/messaging/message-handler.service.ts
export const EVENT_BUS = Symbol.for('EventBus');
```

**Problem**: Multiple duplicate constants, but none match `'IEventBus'` string literal.

## Impact Analysis

### Direct Impact (Broken)

- ✅ ClaudeDomainEventPublisher cannot resolve dependency
- ✅ ClaudeCliService cannot be instantiated (depends on eventPublisher)
- ✅ ChatOrchestrationService cannot be instantiated (depends on claudeService)
- ✅ MessageHandlerService cannot be instantiated (depends on chatOrchestration)
- ✅ **Extension activation fails completely**

### Indirect Impact (Also Broken)

- SessionManager (uses EVENT_BUS correctly, but publisher is broken)
- MessageHandlerService (uses EVENT_BUS correctly, but orchestration services are broken)
- All event-driven communication between extension and webview

## Previous Cleanup Attempt

The `DI_REGISTRATION_CLEANUP.md` document attempted to fix duplicate registrations but **missed the token mismatch** between:

- `@inject('IEventBus')` in ClaudeDomainEventPublisher
- `EVENT_BUS = Symbol.for('EventBus')` in registration

## Solution Strategy

### Option 1: Fix ClaudeDomainEventPublisher (Recommended)

**Change**:

```typescript
// FROM:
constructor(@inject('IEventBus') private readonly eventBus: IEventBus) {}

// TO:
const EVENT_BUS = Symbol.for('EventBus');
constructor(@inject(EVENT_BUS) private readonly eventBus: IEventBus) {}
```

**Pros**:

- ✅ Aligns with pattern used in SessionManager and MessageHandler
- ✅ Uses Symbol.for() consistently
- ✅ Minimal code changes
- ✅ No changes to registration logic

**Cons**:

- ❌ Another EVENT_BUS constant (already have 3)

### Option 2: Change Registration to 'IEventBus' String

**Change**:

```typescript
// In register.ts
container.register('IEventBus', {
  useValue: eventBus,
});
```

**Pros**:

- ✅ Matches existing @inject('IEventBus') in ClaudeDomainEventPublisher
- ✅ Matches existing @inject('IPermissionRulesStore') pattern

**Cons**:

- ❌ SessionManager and MessageHandler use Symbol.for('EventBus')
- ❌ Would need to change multiple files
- ❌ Mixing string literals and Symbols is inconsistent

### Option 3: Consolidate All EVENT_BUS References (Best Practice)

**Changes**:

1. Export EVENT_BUS constant from `claude-domain/src/index.ts`
2. Update all files to import from single source
3. Change ClaudeDomainEventPublisher to use imported constant

**Pros**:

- ✅ Single source of truth
- ✅ Type-safe Symbol.for() pattern
- ✅ Prevents future duplicate definitions
- ✅ Aligns with SOLID principles

**Cons**:

- ❌ More files to change (comprehensive fix)
- ❌ Need to verify no circular dependencies

## Recommended Fix Plan

### Phase 1: Emergency Fix (Option 1)

1. Fix `ClaudeDomainEventPublisher` to use `Symbol.for('EventBus')`
2. Import EVENT_BUS constant from session-manager.ts (already exists)
3. Test extension activation
4. Commit as "fix(di): resolve IEventBus token mismatch"

### Phase 2: Comprehensive Cleanup (Option 3)

1. Create single EVENT_BUS export in claude-domain/src/constants.ts
2. Update all imports across:
   - claude-domain.events.ts
   - session-manager.ts
   - message-handler.service.ts
   - di/register.ts
3. Remove duplicate EVENT_BUS constants
4. Update DI_REGISTRATION_CLEANUP.md with comprehensive token strategy
5. Test all DI resolution paths
6. Commit as "refactor(di): consolidate EVENT_BUS token definitions"

## Files to Modify

### Phase 1 (Emergency)

- `libs/backend/claude-domain/src/events/claude-domain.events.ts`

### Phase 2 (Comprehensive)

- `libs/backend/claude-domain/src/constants.ts` (create)
- `libs/backend/claude-domain/src/events/claude-domain.events.ts`
- `libs/backend/claude-domain/src/session/session-manager.ts`
- `libs/backend/claude-domain/src/messaging/message-handler.service.ts`
- `libs/backend/claude-domain/src/di/register.ts`
- `libs/backend/claude-domain/src/index.ts`
- `docs/DI_REGISTRATION_CLEANUP.md`

## Verification Checklist

After fix, verify:

- [ ] Extension activates without errors
- [ ] ClaudeDomainEventPublisher resolves successfully
- [ ] ClaudeCliService instantiates correctly
- [ ] ChatOrchestrationService resolves
- [ ] MessageHandlerService resolves
- [ ] Event publishing works end-to-end
- [ ] No duplicate EVENT_BUS constants
- [ ] All imports use single source

## Next Steps

1. Implement Phase 1 emergency fix immediately
2. Test extension activation
3. Schedule Phase 2 comprehensive cleanup
4. Update DEPENDENCY_INJECTION_PATTERNS.md (future recommendation from DI_REGISTRATION_CLEANUP.md)
