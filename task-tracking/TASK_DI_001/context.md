# Task Context - TASK_DI_001

## Original User Request

Fix tsyringe DI issues with proper service registration and injection patterns.
We keep getting issues related to how we are using tsyringe and how we are registering
our services and injecting them. We need to research latest information about how to
properly use tsyringe and compare it to our approach and fix systematically.
We think we are complicating our registrations and service discovery and we could
maintain a proper way following tsyringe best practices or latest update as of 2025.

## Error Context

The extension fails to activate with the following tsyringe injection error:

```typescript
ERR [Extension Host] [ERROR] Failed to activate Ptah extension Error: Cannot inject the dependency "providerOrchestration" at position #2 of "MessageHandlerService" constructor. Reason:
    Cannot inject the dependency "providerManager" at position #0 of "ProviderOrchestrationService" constructor. Reason:
        this.eventBus.subscribe is not a function
```

## Key Issues Identified

1. **EventBus Interface Mismatch**: The EventBus service doesn't have the expected `subscribe` method
2. **Circular Dependencies**: Complex service registration patterns may be creating circular dependencies
3. **Token Management**: Inconsistent token usage across libraries and services
4. **Registration Order**: Services may be registered in incorrect order causing resolution failures

## Current DI Architecture

- Using tsyringe for dependency injection
- Registry-based service initialization pattern
- Cross-library token mapping system
- Factory-based registration for complex dependencies

## Goals

1. Research latest tsyringe best practices (2025)
2. Identify systematic issues in current DI implementation
3. Simplify service registration patterns
4. Fix EventBus interface and subscription patterns
5. Establish consistent DI conventions across the codebase
